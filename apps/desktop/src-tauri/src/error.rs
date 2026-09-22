//! Typed errors shared across the IPC boundary.
//!
//! Every failure the student can actually hit gets its own `code` so the UI can
//! render a purpose-built screen instead of a generic "something went wrong".
//! The `message` is safe to show; it never carries server internals.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("That doesn't look like a valid quiz link.")]
    InvalidLink,

    #[error("This quiz link points somewhere we don't recognise.")]
    UntrustedHost,

    #[error("This exam link has expired.")]
    Expired,

    #[error("This exam has already been submitted.")]
    AlreadySubmitted,

    #[error("This exam hasn't opened yet.")]
    NotYetOpen,

    #[error("This exam link has been revoked. Ask your teacher for a new one.")]
    Revoked,

    #[error("This exam is already open on another device.")]
    SessionConflict,

    #[error("Can't reach the exam server. Check the network connection.")]
    NetworkUnavailable,

    #[error("No exam session is active.")]
    NoSession,

    #[error("Sign in with your school account before starting the exam.")]
    NotSignedIn,

    #[error("You're already signed in.")]
    AlreadySignedIn,

    #[error("The sign-in code expired before it was used. Start again for a fresh one.")]
    SignInExpired,

    #[error("That sign-in was declined. Try again, or ask your teacher for help.")]
    SignInDenied,

    #[error("This account isn't allowed to take exams here. Ask your teacher for help.")]
    AccountNotAllowed,

    #[error("The exam server returned an unexpected response.")]
    ServerError,
}

impl AppError {
    /// Stable machine-readable discriminant. The frontend switches on this.
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidLink => "invalid_link",
            Self::UntrustedHost => "untrusted_host",
            Self::Expired => "expired",
            Self::AlreadySubmitted => "already_submitted",
            Self::NotYetOpen => "not_yet_open",
            Self::Revoked => "revoked",
            Self::SessionConflict => "session_conflict",
            Self::NetworkUnavailable => "network_unavailable",
            Self::NoSession => "no_session",
            Self::NotSignedIn => "not_signed_in",
            Self::AlreadySignedIn => "already_signed_in",
            Self::SignInExpired => "sign_in_expired",
            Self::SignInDenied => "sign_in_denied",
            Self::AccountNotAllowed => "account_not_allowed",
            Self::ServerError => "server_error",
        }
    }

    /// Whether retrying the same call could plausibly succeed. Drives whether
    /// the UI offers a "Try again" button.
    pub fn is_retryable(&self) -> bool {
        matches!(self, Self::NetworkUnavailable | Self::ServerError)
    }

    /// (Live client only - the fixture returns typed errors directly.)
    #[cfg_attr(feature = "mock-api", allow(dead_code))]
    /// Map a server-supplied error code onto our own taxonomy. Unknown codes
    /// collapse to `ServerError` rather than leaking the raw string.
    pub fn from_server_code(code: &str) -> Self {
        match code {
            "expired" => Self::Expired,
            "already_submitted" => Self::AlreadySubmitted,
            "not_yet_open" => Self::NotYetOpen,
            "revoked" => Self::Revoked,
            "session_conflict" => Self::SessionConflict,
            "invalid_token" => Self::InvalidLink,
            // No or invalid student token on the claim. The command layer also
            // resets the auth store on this one, so the UI reopens sign-in.
            "auth_required" => Self::NotSignedIn,
            // Suspended account or delisted domain: signing in again won't fix
            // it, which is why it is distinct from `auth_required`.
            "student_not_allowed" => Self::AccountNotAllowed,
            _ => Self::ServerError,
        }
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        // Decode failures mean the server spoke a dialect we don't understand;
        // everything else at this layer is a transport problem.
        if err.is_decode() {
            Self::ServerError
        } else {
            Self::NetworkUnavailable
        }
    }
}

/// Wire shape the frontend receives when a command rejects.
#[derive(Serialize)]
struct ErrorPayload<'a> {
    code: &'a str,
    message: String,
    retryable: bool,
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        ErrorPayload {
            code: self.code(),
            message: self.to_string(),
            retryable: self.is_retryable(),
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;
