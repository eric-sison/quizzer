//! The desktop client's contract with the companion backend.
//!
//! All networking is confined to this module and runs in the Rust process.
//! The webview has no network permission at all (see the CSP in
//! `tauri.conf.json`), so a tampered frontend cannot reach the API directly.

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::session::{ExamManifest, Receipt};

#[cfg(not(feature = "mock-api"))]
mod live;
#[cfg(not(feature = "mock-api"))]
pub use live::ApiClient;

#[cfg(feature = "mock-api")]
mod mock;
#[cfg(feature = "mock-api")]
pub use mock::ApiClient;
#[cfg(all(test, feature = "mock-api"))]
pub use mock::MOCK_STUDENT_TOKEN;

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

/// The OAuth client this app identifies as when it asks for a device code.
#[cfg_attr(feature = "mock-api", allow(dead_code))]
pub const DEVICE_CLIENT_ID: &str = "quizzer-desktop";

/// The grant type the device flow polls with, verbatim from RFC 8628.
#[cfg_attr(feature = "mock-api", allow(dead_code))]
pub const DEVICE_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";

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
pub struct DeviceCodeRequest {
    pub client_id: &'static str,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "mock-api", allow(dead_code))]
pub struct DeviceTokenRequest<'a> {
    pub grant_type: &'static str,
    pub device_code: &'a str,
    pub client_id: &'static str,
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

/// What starting the device flow hands back. Parsed only as far as the client
/// needs: `verification_uri_complete` is deliberately dropped, because handing
/// the student a pre-filled clickable path is exactly what this UI must not do
/// (navigation is blocked by design; they read the code and type it elsewhere).
#[derive(Debug, Deserialize)]
pub struct DeviceCodeResponse {
    /// The polling credential. Never leaves Rust.
    pub device_code: String,
    /// The short code the student types. Public by design.
    pub user_code: String,
    /// Where they type it. Verified against `WEB_ORIGIN` before it is stored.
    pub verification_uri: String,
    /// Seconds until the codes above stop working.
    pub expires_in: u64,
    /// Seconds between polls; the server may say "slow_down" to stretch it.
    pub interval: u64,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "mock-api", allow(dead_code))]
pub struct DeviceTokenResponse {
    pub access_token: String,
}

/// The device flow's own error dialect: a 400 whose body says why, and only
/// one of the reasons is actually an error. Not the app's `{"error":{"code"}}`
/// envelope - Better Auth speaks RFC 8628 here.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "mock-api", allow(dead_code))]
pub struct DeviceTokenError {
    pub error: String,
}

/// Why one poll of the token endpoint did not produce a token.
///
/// (The fixture backend only ever answers with a subset of these; the live
/// client and the unit tests construct them all.)
#[derive(Debug)]
#[cfg_attr(feature = "mock-api", allow(dead_code))]
pub enum PollOutcome {
    /// The student has not approved yet. Keep polling.
    Pending,
    /// Polling too fast; the server wants 5 more seconds between polls.
    SlowDown,
    /// The device code is dead - timed out or consumed. Start over.
    Expired,
    /// The student (or their domain policy) said no.
    Denied,
    /// Anything else: network trouble, an unrecognised code. The poll loop
    /// treats it as transient and keeps going until the code expires. The
    /// payload is carried for tests and Debug output; the loop never reads it.
    Other(#[allow(dead_code)] AppError),
}

impl PollOutcome {
    /// Map an RFC 8628 error code onto a poll outcome. Unknown codes collapse
    /// to `Other` rather than leaking the raw string, same as
    /// `AppError::from_server_code`. (Live client only; the fixture returns
    /// outcomes directly.)
    #[cfg_attr(feature = "mock-api", allow(dead_code))]
    pub fn from_oauth_code(code: &str) -> Self {
        match code {
            "authorization_pending" => Self::Pending,
            "slow_down" => Self::SlowDown,
            "expired_token" => Self::Expired,
            "access_denied" => Self::Denied,
            // The device code is not one the server recognises any more -
            // consumed, revoked, or never real. Whatever the history, the fix
            // is the same as an expiry: start a fresh attempt.
            "invalid_grant" => Self::Expired,
            _ => Self::Other(AppError::ServerError),
        }
    }
}

/// Who the session token belongs to, from `GET /api/auth/get-session`. The
/// endpoint returns a much larger object; this parses only what the client
/// shows, and gives anything else nowhere to land.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "mock-api", allow(dead_code))]
pub struct GetSessionResponse {
    pub user: SessionUser,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "mock-api", allow(dead_code))]
pub struct SessionUser {
    pub name: String,
    pub email: String,
}

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
    /// Set only while the link is still shut: epoch seconds at which it opens.
    /// Its absence is the client's answer to "may I start", so the frontend
    /// never compares a date against the machine clock to decide that.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opens_at: Option<u64>,
    /// The server's clock when it answered, so a countdown to `opens_at` is
    /// drawn against the clock that decides. `None` from a server too old to
    /// send it, in which case the frontend falls back to its own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_time: Option<u64>,
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

#[cfg(test)]
mod poll_outcome_tests {
    use super::*;

    #[test]
    fn each_oauth_code_maps_to_its_outcome() {
        assert!(matches!(
            PollOutcome::from_oauth_code("authorization_pending"),
            PollOutcome::Pending
        ));
        assert!(matches!(
            PollOutcome::from_oauth_code("slow_down"),
            PollOutcome::SlowDown
        ));
        assert!(matches!(
            PollOutcome::from_oauth_code("expired_token"),
            PollOutcome::Expired
        ));
        assert!(matches!(
            PollOutcome::from_oauth_code("access_denied"),
            PollOutcome::Denied
        ));
        // A dead device code, whatever killed it, means "start over".
        assert!(matches!(
            PollOutcome::from_oauth_code("invalid_grant"),
            PollOutcome::Expired
        ));
    }

    #[test]
    fn an_unknown_code_collapses_rather_than_leaking() {
        assert!(matches!(
            PollOutcome::from_oauth_code("some_future_code"),
            PollOutcome::Other(AppError::ServerError)
        ));
    }
}
