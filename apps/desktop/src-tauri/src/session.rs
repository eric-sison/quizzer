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
    ShortText,
    TrueFalse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Choice {
    pub id: String,
    pub label: String,
}

/// A question as the *student* sees it. Note the absence of any correct-answer
/// field: the backend must never send one, and this struct gives it nowhere to
/// land even if it did.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Question {
    pub id: String,
    pub kind: QuestionKind,
    pub prompt: String,
    #[serde(default)]
    pub choices: Vec<Choice>,
    #[serde(default)]
    pub points: u32,
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
