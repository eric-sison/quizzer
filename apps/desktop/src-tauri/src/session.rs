//! Quiz-link parsing and the single source of truth for exam state.
//!
//! The session JWT lives here and *only* here: it is never serialised to the
//! frontend and never written to disk. The frontend holds a rendering of the
//! exam, not the credential for it.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use url::Url;

use crate::error::{AppError, AppResult};

/// Origin the exam backend is served from, baked in at compile time.
/// Override with `QUIZZER_API_ORIGIN=https://exams.school.edu cargo tauri build`.
pub const API_ORIGIN: &str = match option_env!("QUIZZER_API_ORIGIN") {
    Some(origin) => origin,
    None => "http://localhost:3000",
};

/// Path prefix that marks a URL as an exam link: `<origin>/e/<token>`.
const EXAM_PATH_PREFIX: &str = "/e/";

const TOKEN_MIN_LEN: usize = 16;
const TOKEN_MAX_LEN: usize = 128;

pub fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Link parsing
// ---------------------------------------------------------------------------

/// What we learned from a link *before* touching the network.
#[derive(Debug, Clone, Serialize)]
pub struct LinkInfo {
    /// Host we would contact. Shown to the student so they can sanity-check it.
    pub host: String,
    /// Truncated token, for display only - never the whole thing.
    pub token_preview: String,
}

/// Validated exam link. The token is kept out of `Serialize` reach.
#[derive(Debug, Clone)]
pub struct ExamLink {
    pub token: String,
    pub host: String,
}

impl ExamLink {
    pub fn info(&self) -> LinkInfo {
        let preview: String = self.token.chars().take(6).collect();
        LinkInfo {
            host: self.host.clone(),
            token_preview: format!("{preview}\u{2026}"),
        }
    }
}

/// Parse and validate a pasted quiz link.
///
/// This runs entirely offline and rejects anything not matching the configured
/// origin, so a malicious link can never cause an outbound request to an
/// attacker-controlled host.
pub fn parse_link(raw: &str) -> AppResult<ExamLink> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err(AppError::InvalidLink);
    }

    let url = Url::parse(raw).map_err(|_| AppError::InvalidLink)?;
    let expected = Url::parse(API_ORIGIN).map_err(|_| AppError::ServerError)?;

    // Scheme, host and port must all match the build-time origin exactly.
    // Matching on the parsed components rather than a string prefix avoids the
    // classic `https://evil.com/?x=https://exams.school.edu` bypass.
    if url.scheme() != expected.scheme() {
        return Err(AppError::UntrustedHost);
    }
    if url.host_str() != expected.host_str() {
        return Err(AppError::UntrustedHost);
    }
    if url.port_or_known_default() != expected.port_or_known_default() {
        return Err(AppError::UntrustedHost);
    }

    // Credentials embedded in the URL are always a red flag.
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::InvalidLink);
    }

    let path = url.path();
    let token = path
        .strip_prefix(EXAM_PATH_PREFIX)
        .ok_or(AppError::InvalidLink)?
        .trim_end_matches('/');

    if !is_valid_token(token) {
        return Err(AppError::InvalidLink);
    }

    Ok(ExamLink {
        token: token.to_string(),
        host: url.host_str().unwrap_or_default().to_string(),
    })
}

fn is_valid_token(token: &str) -> bool {
    (TOKEN_MIN_LEN..=TOKEN_MAX_LEN).contains(&token.len())
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

// ---------------------------------------------------------------------------
// Exam contract (what the backend returns)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuestionKind {
    SingleChoice,
    MultipleChoice,
    TrueFalse,
    Essay,
    /// Any kind this build predates.
    ///
    /// Without this, a quiz published with a newer question type fails to
    /// deserialise and takes the *whole paper* down for a student running an
    /// older client. With it, they lose one question and can sit the rest.
    #[serde(other)]
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Choice {
    pub id: String,
    pub label: String,
    /// Formatted label, when the plain text above would lose something.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label_doc: Option<serde_json::Value>,
}

/// A question as the *student* sees it. Note the absence of any correct-answer
/// field: the backend must never send one, and this struct gives it nowhere to
/// land even if it did.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Question {
    pub id: String,
    pub kind: QuestionKind,
    /// Plain text, always populated, so a client that ignores `prompt_doc`
    /// still renders something correct.
    pub prompt: String,
    /// Constrained ProseMirror JSON. Passed through to the webview as opaque
    /// data: Rust does not interpret it, and `packages/quiz-ui` maps it to
    /// React elements rather than to an HTML string.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_doc: Option<serde_json::Value>,
    #[serde(default)]
    pub choices: Vec<Choice>,
    #[serde(default)]
    pub points: u32,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_words: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_words: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExamManifest {
    pub id: String,
    pub title: String,
    pub duration_s: u64,
    pub questions: Vec<Question>,
    #[serde(default)]
    pub allow_backtracking: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Receipt {
    pub receipt_id: String,
    pub submitted_at: u64,
    #[serde(default)]
    pub question_count: u32,
}

// ---------------------------------------------------------------------------
// Live session
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Idle,
    Active,
    Submitted,
}

pub struct ExamSession {
    /// Bearer credential for every subsequent API call. Stays in Rust.
    pub jwt: String,
    pub manifest: ExamManifest,
    /// Server's deadline, in epoch seconds. The server re-checks this itself;
    /// we mirror it only to drive the countdown and auto-submit.
    pub expires_at: u64,
    /// Offset between server clock and ours, applied so a student fiddling with
    /// the system clock doesn't move their own deadline.
    pub clock_skew_s: i64,
    /// Local echo of what's been saved, used to re-render on resume.
    pub answers: HashMap<String, serde_json::Value>,
    /// Stable across retries so the server can dedupe a double submit.
    pub idempotency_key: String,
    pub receipt: Option<Receipt>,
    pub strikes: u32,
}

impl ExamSession {
    pub fn remaining_s(&self) -> u64 {
        let now = (now_epoch_secs() as i64 + self.clock_skew_s).max(0) as u64;
        self.expires_at.saturating_sub(now)
    }

    pub fn phase(&self) -> Phase {
        if self.receipt.is_some() {
            Phase::Submitted
        } else {
            Phase::Active
        }
    }
}

/// Snapshot handed to the frontend. Contains no credential and no answer key.
#[derive(Debug, Clone, Serialize)]
pub struct SessionSnapshot {
    pub phase: Phase,
    pub manifest: Option<ExamManifest>,
    pub answers: HashMap<String, serde_json::Value>,
    pub remaining_s: u64,
    pub strikes: u32,
    pub receipt: Option<Receipt>,
}

impl SessionSnapshot {
    pub fn idle() -> Self {
        Self {
            phase: Phase::Idle,
            manifest: None,
            answers: HashMap::new(),
            remaining_s: 0,
            strikes: 0,
            receipt: None,
        }
    }
}

#[derive(Default)]
pub struct SessionStore {
    inner: Mutex<Option<ExamSession>>,
}

impl SessionStore {
    /// Run `f` against the live session, or fail with `NoSession`.
    ///
    /// Callers must not hold this across an `.await`; clone what you need out
    /// of the guard first, then release it before touching the network.
    pub fn with<T>(&self, f: impl FnOnce(&mut ExamSession) -> T) -> AppResult<T> {
        let mut guard = self.inner.lock().expect("session mutex poisoned");
        let session = guard.as_mut().ok_or(AppError::NoSession)?;
        Ok(f(session))
    }

    pub fn snapshot(&self) -> SessionSnapshot {
        let guard = self.inner.lock().expect("session mutex poisoned");
        match guard.as_ref() {
            None => SessionSnapshot::idle(),
            Some(s) => SessionSnapshot {
                phase: s.phase(),
                manifest: Some(s.manifest.clone()),
                answers: s.answers.clone(),
                remaining_s: s.remaining_s(),
                strikes: s.strikes,
                receipt: s.receipt.clone(),
            },
        }
    }

    pub fn jwt(&self) -> AppResult<String> {
        self.with(|s| s.jwt.clone())
    }

    pub fn is_active(&self) -> bool {
        let guard = self.inner.lock().expect("session mutex poisoned");
        matches!(guard.as_ref().map(|s| s.phase()), Some(Phase::Active))
    }

    pub fn set(&self, session: ExamSession) {
        *self.inner.lock().expect("session mutex poisoned") = Some(session);
    }

    /// Drop the session entirely. Used when a proctor revokes an in-flight
    /// exam; kept on the store so that path doesn't have to reach inside.
    #[allow(dead_code)]
    pub fn clear(&self) {
        *self.inner.lock().expect("session mutex poisoned") = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = "http://localhost:3000/e/abcdef0123456789ABCDEF";

    #[test]
    fn accepts_a_well_formed_link() {
        let link = parse_link(GOOD).expect("should parse");
        assert_eq!(link.token, "abcdef0123456789ABCDEF");
    }

    #[test]
    fn tolerates_surrounding_whitespace() {
        assert!(parse_link(&format!("  {GOOD}\n")).is_ok());
    }

    #[test]
    fn rejects_a_foreign_host() {
        let err = parse_link("http://evil.example/e/abcdef0123456789ABCDEF").unwrap_err();
        assert_eq!(err.code(), "untrusted_host");
    }

    #[test]
    fn rejects_the_host_smuggled_into_a_query_string() {
        let err = parse_link("http://evil.example/e/abcdef0123456789ABCDEF?x=http://localhost:3000")
            .unwrap_err();
        assert_eq!(err.code(), "untrusted_host");
    }

    #[test]
    fn rejects_embedded_credentials() {
        let err = parse_link("http://user:pw@localhost:3000/e/abcdef0123456789ABCDEF").unwrap_err();
        assert_eq!(err.code(), "invalid_link");
    }

    #[test]
    fn rejects_a_wrong_path() {
        assert!(parse_link("http://localhost:3000/admin/abcdef0123456789ABCDEF").is_err());
    }

    #[test]
    fn rejects_a_short_or_malformed_token() {
        assert!(parse_link("http://localhost:3000/e/short").is_err());
        assert!(parse_link("http://localhost:3000/e/has spaces in it here").is_err());
        assert!(parse_link("http://localhost:3000/e/../../etc/passwd").is_err());
    }

    #[test]
    fn rejects_non_urls() {
        assert!(parse_link("").is_err());
        assert!(parse_link("not a url").is_err());
        assert!(parse_link("javascript:alert(1)").is_err());
    }
}

#[cfg(test)]
mod contract_tests {
    use super::*;

    /// A manifest from a server that already speaks a newer dialect.
    fn future_manifest() -> serde_json::Value {
        serde_json::json!({
            "id": "quiz-1",
            "title": "Midterm",
            "duration_s": 2700,
            "allow_backtracking": true,
            "questions": [
                {
                    "id": "q1",
                    "kind": "essay",
                    "prompt": "Explain photosynthesis.",
                    "choices": [],
                    "points": 4,
                    "required": true,
                    "min_words": 20,
                    "max_words": 200
                },
                {
                    "id": "q2",
                    "kind": "matching",
                    "prompt": "Pair each term with its definition.",
                    "choices": [],
                    "points": 3,
                    "required": false
                }
            ]
        })
    }

    #[test]
    fn a_question_type_this_build_predates_does_not_take_the_paper_down() {
        let manifest: ExamManifest =
            serde_json::from_value(future_manifest()).expect("a newer kind must still parse");

        assert_eq!(manifest.questions.len(), 2);
        assert!(matches!(manifest.questions[0].kind, QuestionKind::Essay));
        // The student loses one question, not the whole exam.
        assert!(matches!(manifest.questions[1].kind, QuestionKind::Unsupported));
    }

    #[test]
    fn essay_limits_survive_the_round_trip() {
        let manifest: ExamManifest = serde_json::from_value(future_manifest()).unwrap();
        let essay = &manifest.questions[0];

        assert_eq!(essay.min_words, Some(20));
        assert_eq!(essay.max_words, Some(200));
        assert!(essay.required);
    }

    #[test]
    fn a_manifest_without_the_newer_fields_still_parses() {
        // What an older published version looks like: no prompt_doc, no
        // required, no word limits.
        let older = serde_json::json!({
            "id": "quiz-1",
            "title": "Midterm",
            "duration_s": 600,
            "questions": [
                { "id": "q1", "kind": "true_false", "prompt": "True?",
                  "choices": [{ "id": "true", "label": "True" }] }
            ]
        });

        let manifest: ExamManifest = serde_json::from_value(older).expect("must parse");
        let q = &manifest.questions[0];

        assert!(q.prompt_doc.is_none());
        assert!(q.min_words.is_none());
        assert!(!q.required);
        assert!(manifest.questions[0].choices[0].label_doc.is_none());
    }

    #[test]
    fn a_prompt_doc_is_carried_through_untouched() {
        // Rust does not interpret it. It is handed to the webview, where
        // packages/quiz-ui maps the nodes to React elements.
        let with_doc = serde_json::json!({
            "id": "quiz-1",
            "title": "Midterm",
            "duration_s": 600,
            "questions": [{
                "id": "q1",
                "kind": "essay",
                "prompt": "Bold word.",
                "prompt_doc": {
                    "type": "doc",
                    "content": [{
                        "type": "paragraph",
                        "content": [
                            { "type": "text", "text": "Bold", "marks": [{ "type": "bold" }] },
                            { "type": "text", "text": " word." }
                        ]
                    }]
                },
                "choices": [],
                "points": 1
            }]
        });

        let manifest: ExamManifest = serde_json::from_value(with_doc.clone()).unwrap();
        let doc = manifest.questions[0].prompt_doc.as_ref().expect("prompt_doc kept");

        assert_eq!(doc, &with_doc["questions"][0]["prompt_doc"]);
    }

    /// A real response from `POST /api/exam/session`, captured against a
    /// running apps/api and checked in. Hand-written fixtures only ever confirm
    /// what their author already believed about the shape; this one caught the
    /// backend's actual field names, casing and optionality.
    ///
    /// Regenerate it by publishing a quiz with all four question kinds and
    /// saving the session response, with `session_jwt` redacted.
    const REAL_SESSION_RESPONSE: &str =
        include_str!("../tests/fixtures/session-response.json");

    #[derive(Debug, serde::Deserialize)]
    struct StartSessionBody {
        #[allow(dead_code)]
        session_jwt: String,
        exam: ExamManifest,
        #[allow(dead_code)]
        server_time: u64,
        expires_at: u64,
    }

    #[test]
    fn the_backends_real_response_still_fits_these_structs() {
        let body: StartSessionBody = serde_json::from_str(REAL_SESSION_RESPONSE)
            .expect("apps/api and these structs have drifted");

        assert_eq!(body.exam.questions.len(), 4);
        assert!(body.expires_at > 0);
        assert!(body.exam.allow_backtracking);

        let kinds: Vec<_> = body
            .exam
            .questions
            .iter()
            .map(|q| match q.kind {
                QuestionKind::TrueFalse => "true_false",
                QuestionKind::SingleChoice => "single_choice",
                QuestionKind::MultipleChoice => "multiple_choice",
                QuestionKind::Essay => "essay",
                QuestionKind::Unsupported => "unsupported",
            })
            .collect();

        // Nothing fell through to Unsupported: every kind the authoring app can
        // publish today is one this build renders.
        assert_eq!(
            kinds,
            ["true_false", "single_choice", "multiple_choice", "essay"]
        );
    }

    #[test]
    fn the_real_response_carries_formatting_and_essay_limits() {
        let body: StartSessionBody = serde_json::from_str(REAL_SESSION_RESPONSE).unwrap();

        let formatted = body
            .exam
            .questions
            .iter()
            .find(|q| q.prompt_doc.is_some())
            .expect("the fixture includes a formatted prompt");
        assert!(!formatted.prompt.is_empty(), "plain text must always be populated");

        let essay = body
            .exam
            .questions
            .iter()
            .find(|q| matches!(q.kind, QuestionKind::Essay))
            .expect("the fixture includes an essay");
        assert_eq!(essay.min_words, Some(20));
        assert_eq!(essay.max_words, Some(200));
    }

    #[test]
    fn the_real_response_carries_no_answer_key() {
        // The same guarantee as the IPC test, one layer earlier: checked
        // against what the server actually sent, not against a fixture we wrote.
        for forbidden in [
            "\"correct\"",
            "correct_option_id",
            "correct_option_ids",
            "answer_key",
            "rubric",
        ] {
            assert!(
                !REAL_SESSION_RESPONSE.contains(forbidden),
                "the backend sent `{forbidden}`"
            );
        }
    }

    #[test]
    fn the_question_struct_has_nowhere_to_put_an_answer() {
        // Even handed one, it does not land: deserialising ignores unknown
        // fields, and serialising back out cannot invent them.
        let hostile = serde_json::json!({
            "id": "quiz-1",
            "title": "Midterm",
            "duration_s": 600,
            "questions": [{
                "id": "q1",
                "kind": "single_choice",
                "prompt": "Pick one.",
                "choices": [{ "id": "a", "label": "7", "correct": true }],
                "points": 1,
                "correct_option_id": "a",
                "answer_key": { "q1": "a" }
            }]
        });

        let manifest: ExamManifest = serde_json::from_value(hostile).unwrap();
        let out = serde_json::to_string(&manifest).unwrap();

        for forbidden in ["correct", "answer_key", "correct_option_id"] {
            assert!(!out.contains(forbidden), "leaked `{forbidden}`: {out}");
        }
    }
}
