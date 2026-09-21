//! In-process fixture backend, compiled only under `--features mock-api`.
//!
//! Exists so the exam flow, the lockdown behaviour and every failure screen can
//! be exercised before `apps/web` grows real route handlers. It deliberately
//! enforces the same server-side rules the real backend owes us - deadline,
//! revocation, single submit - so the client is never written against a more
//! forgiving contract than it will meet in production.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use super::{
    HeartbeatResponse, PreviewResponse, ProctorEvent, StartSessionResponse, SubmitResponse,
};
use crate::error::{AppError, AppResult};
use crate::session::{
    now_epoch_secs, Choice, ExamManifest, Question, QuestionKind, Receipt,
};

/// Tokens the fixture recognises. Anything else behaves like an unknown link.
/// Paste `http://localhost:3000/e/<one of these>` into the app to exercise each.
const TOKEN_OK: &str = "mockexamtoken000000001";
const TOKEN_EXPIRED: &str = "mockexamtoken000000002";
const TOKEN_SUBMITTED: &str = "mockexamtoken000000003";
const TOKEN_NOT_OPEN: &str = "mockexamtoken000000004";
const TOKEN_REVOKED: &str = "mockexamtoken000000005";
const TOKEN_OFFLINE: &str = "mockexamtoken000000006";
/// Two-minute exam, for testing auto-submit on timeout without waiting around.
const TOKEN_SHORT: &str = "mockexamtoken000000007";

const MOCK_JWT: &str = "mock-session-jwt";
const DEFAULT_DURATION_S: u64 = 45 * 60;

/// The one image the fixture exam references, on its first question.
pub const MOCK_IMAGE_ID: &str = "00000000-0000-4000-8000-00000000img1";
/// 1x1 transparent PNG, so the media path is exercised without shipping a file.
const MOCK_IMAGE_PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
    0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x04, 0x00, 0x00, 0x00, 0xB5,
    0x1C, 0x0C, 0x02, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x60,
    0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x05, 0x00, 0x01, 0x87, 0xA1, 0x4E, 0xD4, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
];

#[derive(Default)]
struct MockState {
    submitted: bool,
    answers: HashMap<String, serde_json::Value>,
    events: Vec<ProctorEvent>,
    expires_at: u64,
}

pub struct ApiClient {
    state: Mutex<MockState>,
}

impl ApiClient {
    pub fn new() -> Self {
        eprintln!("[mock-api] fixture backend active - this build must not be used for a real exam");
        Self {
            state: Mutex::new(MockState::default()),
        }
    }

    /// Stand in for network latency so loading states are actually visible.
    async fn latency() {
        tokio::time::sleep(Duration::from_millis(350)).await;
    }

    /// Every way a link can be dead, shared by preview and session claim so
    /// the fixture can never disagree with itself the way the real backend
    /// (which shares its resolution too) never will.
    fn resolve(token: &str) -> AppResult<u64> {
        match token {
            TOKEN_EXPIRED => Err(AppError::Expired),
            TOKEN_SUBMITTED => Err(AppError::AlreadySubmitted),
            TOKEN_NOT_OPEN => Err(AppError::NotYetOpen),
            TOKEN_REVOKED => Err(AppError::Revoked),
            TOKEN_OFFLINE => Err(AppError::NetworkUnavailable),
            TOKEN_SHORT => Ok(120),
            TOKEN_OK => Ok(DEFAULT_DURATION_S),
            _ => Err(AppError::InvalidLink),
        }
    }

    pub async fn preview(&self, token: String) -> AppResult<PreviewResponse> {
        Self::latency().await;
        let duration_s = Self::resolve(&token)?;
        let exam = fixture_exam(duration_s);
        Ok(PreviewResponse {
            title: exam.title,
            duration_s,
            allow_backtracking: exam.allow_backtracking,
            shuffle_questions: exam.shuffle_questions,
            question_count: exam.questions.len() as u32,
        })
    }

    pub async fn start_session(&self, token: String) -> AppResult<StartSessionResponse> {
        Self::latency().await;

        let duration_s = Self::resolve(&token)?;

        let now = now_epoch_secs();
        let expires_at = now + duration_s;

        {
            let mut state = self.state.lock().expect("mock state poisoned");
            if state.submitted {
                return Err(AppError::AlreadySubmitted);
            }
            state.expires_at = expires_at;
        }

        Ok(StartSessionResponse {
            session_jwt: MOCK_JWT.to_string(),
            exam: fixture_exam(duration_s),
            server_time: now,
            expires_at,
        })
    }

    pub async fn fetch_media(&self, _jwt: &str, media_id: &str) -> AppResult<(String, Vec<u8>)> {
        Self::latency().await;
        if media_id == MOCK_IMAGE_ID {
            Ok(("image/png".to_string(), MOCK_IMAGE_PNG.to_vec()))
        } else {
            Err(AppError::ServerError)
        }
    }

    pub async fn save_answer(
        &self,
        _jwt: &str,
        question_id: String,
        value: serde_json::Value,
        _client_seq: u64,
    ) -> AppResult<()> {
        Self::latency().await;
        let mut state = self.state.lock().expect("mock state poisoned");
        if state.submitted {
            return Err(AppError::AlreadySubmitted);
        }
        if now_epoch_secs() > state.expires_at {
            return Err(AppError::Expired);
        }
        state.answers.insert(question_id, value);
        Ok(())
    }

    pub async fn heartbeat(&self, _jwt: &str, _elapsed_s: u64) -> AppResult<HeartbeatResponse> {
        let state = self.state.lock().expect("mock state poisoned");
        Ok(HeartbeatResponse {
            expires_at: state.expires_at,
            server_time: now_epoch_secs(),
            revoked: false,
        })
    }

    pub async fn send_events(&self, _jwt: &str, events: Vec<ProctorEvent>) -> AppResult<()> {
        let mut state = self.state.lock().expect("mock state poisoned");
        for event in &events {
            eprintln!("[mock-api] proctor event #{} {} {:?}", event.seq, event.kind, event.detail);
        }
        state.events.extend(events);
        Ok(())
    }

    pub async fn submit(&self, _jwt: &str, idempotency_key: String) -> AppResult<SubmitResponse> {
        Self::latency().await;
        let mut state = self.state.lock().expect("mock state poisoned");
        if state.submitted {
            // Idempotent: the real backend must also replay the same receipt
            // rather than rejecting, so a retried submit is never a failure.
            return Ok(Receipt {
                receipt_id: idempotency_key,
                submitted_at: now_epoch_secs(),
                question_count: fixture_exam(0).questions.len() as u32,
            });
        }
        state.submitted = true;
        Ok(Receipt {
            receipt_id: idempotency_key,
            submitted_at: now_epoch_secs(),
            question_count: fixture_exam(0).questions.len() as u32,
        })
    }
}

impl Default for ApiClient {
    fn default() -> Self {
        Self::new()
    }
}

fn choice(id: &str, label: &str) -> Choice {
    Choice {
        id: id.to_string(),
        label: label.to_string(),
        label_doc: None,
    }
}

/// Keeps the fixture readable now that Question has optional fields the mock
/// has no opinion about.
fn question(id: &str, kind: QuestionKind, prompt: &str, choices: Vec<Choice>, points: u32) -> Question {
    Question {
        id: id.to_string(),
        kind,
        prompt: prompt.to_string(),
        prompt_doc: None,
        choices,
        points,
        required: true,
        min_words: None,
        max_words: None,
    }
}

fn fixture_exam(duration_s: u64) -> ExamManifest {
    ExamManifest {
        id: "exam-fixture-1".to_string(),
        title: "Introduction to Photosynthesis".to_string(),
        duration_s,
        allow_backtracking: true,
        shuffle_questions: false,
        questions: vec![
            Question {
                // The image travels inside the prompt document, as the real
                // backend ships it: an `image` node holding only a media id.
                prompt_doc: Some(serde_json::json!({
                    "type": "doc",
                    "content": [
                        { "type": "paragraph", "content": [{
                            "type": "text",
                            "text": "Which organelle is primarily responsible for photosynthesis?"
                        }]},
                        { "type": "image", "attrs": {
                            "mediaId": MOCK_IMAGE_ID,
                            "alt": "A plant cell under a microscope"
                        }}
                    ]
                })),
                ..question(
                    "q1",
                    QuestionKind::SingleChoice,
                    "Which organelle is primarily responsible for photosynthesis?",
                    vec![
                        choice("a", "Mitochondrion"),
                        choice("b", "Chloroplast"),
                        choice("c", "Ribosome"),
                        choice("d", "Golgi apparatus"),
                    ],
                    2,
                )
            },
            question(
                "q2",
                QuestionKind::TrueFalse,
                "Photosynthesis releases oxygen as a by-product.",
                vec![choice("true", "True"), choice("false", "False")],
                1,
            ),
            question(
                "q3",
                QuestionKind::MultipleChoice,
                "Select every input required by the light-dependent reactions.",
                vec![
                    choice("a", "Water"),
                    choice("b", "Light energy"),
                    choice("c", "Glucose"),
                    choice("d", "NADP+"),
                ],
                3,
            ),
            Question {
                min_words: Some(20),
                max_words: Some(120),
                ..question(
                    "q4",
                    QuestionKind::Essay,
                    "In one sentence, explain the role of chlorophyll.",
                    vec![],
                    4,
                )
            },
        ],
    }
}
