//! The desktop client's contract with the companion backend.
//!
//! All networking is confined to this module and runs in the Rust process.
//! The webview has no network permission at all (see the CSP in
//! `tauri.conf.json`), so a tampered frontend cannot reach the API directly.

use serde::{Deserialize, Serialize};

use crate::session::{ExamManifest, Receipt};

#[cfg(not(feature = "mock-api"))]
mod live;
#[cfg(not(feature = "mock-api"))]
pub use live::ApiClient;

#[cfg(feature = "mock-api")]
mod mock;
#[cfg(feature = "mock-api")]
pub use mock::ApiClient;

// Only the live client sends these; the fixture backend has no use for them.
#[cfg_attr(feature = "mock-api", allow(dead_code))]
pub const CLIENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg_attr(feature = "mock-api", allow(dead_code))]
pub fn platform_tag() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "other"
    }
}

// --- requests ---------------------------------------------------------------

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "mock-api", allow(dead_code))]
pub struct StartSessionRequest {
    pub token: String,
    pub client_version: &'static str,
    pub platform: &'static str,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "mock-api", allow(dead_code))]
pub struct PreviewRequest {
    pub token: String,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "mock-api", allow(dead_code))]
pub struct SaveAnswerRequest {
    pub question_id: String,
    pub value: serde_json::Value,
    /// Monotonic per-session counter. Lets the server discard answers that
    /// arrive out of order after a retry.
    pub client_seq: u64,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "mock-api", allow(dead_code))]
pub struct HeartbeatRequest {
    pub elapsed_s: u64,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "mock-api", allow(dead_code))]
pub struct SubmitRequest {
    pub idempotency_key: String,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "mock-api", allow(dead_code))]
pub struct EventBatchRequest {
    pub events: Vec<ProctorEvent>,
}

/// One entry in the proctoring audit trail.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProctorEvent {
    /// Per-session sequence number. Gaps tell the server we dropped events.
    pub seq: u64,
    pub kind: String,
    /// Client epoch seconds. The server should record its own receipt time too
    /// and treat this as advisory - the client clock is not trustworthy.
    pub at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

// --- responses --------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct StartSessionResponse {
    pub session_jwt: String,
    pub exam: ExamManifest,
    /// Server's own clock, used to derive skew.
    pub server_time: u64,
    pub expires_at: u64,
}

/// The exam's configuration, shown on the link-entry screen before the student
/// commits to lockdown. Serialize as well: it crosses the IPC boundary to the
/// frontend unchanged. Deliberately no questions and no credential.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreviewResponse {
    pub title: String,
    /// Teacher's blurb for the link-entry screen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub duration_s: u64,
    #[serde(default)]
    pub allow_backtracking: bool,
    #[serde(default)]
    pub shuffle_questions: bool,
    #[serde(default)]
    pub question_count: u32,
}

#[derive(Debug, Deserialize)]
pub struct HeartbeatResponse {
    /// Server may shorten or extend the deadline (e.g. a proctor grants time).
    pub expires_at: u64,
    pub server_time: u64,
    #[serde(default)]
    pub revoked: bool,
}

/// Envelope the backend uses for failures: `{"error":{"code":"expired",...}}`.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "mock-api", allow(dead_code))]
pub struct ApiErrorBody {
    pub error: ApiErrorDetail,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "mock-api", allow(dead_code))]
pub struct ApiErrorDetail {
    pub code: String,
}

pub type SubmitResponse = Receipt;
