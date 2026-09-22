//! Student identity: the OAuth device-flow state and the session token.
//!
//! Mirrors `session.rs` in its one load-bearing decision: the Better Auth
//! session token and the device code live here and *only* here. What the
//! webview sees is `AuthSnapshot`, which carries the parts of the flow that
//! are public by design - the user code a student types into the web app, the
//! address they type it at, and who they turned out to be - and nothing that
//! could be replayed to act as them.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use url::Url;

use crate::error::{AppError, AppResult};
use crate::session::now_epoch_secs;

/// Origin the companion web app is served from, baked in at compile time -
/// the same pattern as `API_ORIGIN`. The device-code response *tells* us where
/// to send the student; this constant is how we refuse to pass on an address
/// we did not already trust, however the response was tampered with.
/// Override with `QUIZZER_WEB_ORIGIN=https://quizzer.school.edu`.
pub const WEB_ORIGIN: &str = match option_env!("QUIZZER_WEB_ORIGIN") {
    Some(origin) => origin,
    None => "http://localhost:3001",
};

/// Component-wise origin check for the verification URI, mirroring
/// `parse_link`'s treatment of `API_ORIGIN`: scheme, host and port each
/// compared on the parsed URL, never a string prefix, so
/// `http://evil.example/?x=http://localhost:3001` has nowhere to hide.
pub fn verify_verification_uri(raw: &str) -> AppResult<()> {
    let url = Url::parse(raw).map_err(|_| AppError::UntrustedHost)?;
    let expected = Url::parse(WEB_ORIGIN).map_err(|_| AppError::ServerError)?;

    if url.scheme() != expected.scheme() {
        return Err(AppError::UntrustedHost);
    }
    if url.host_str() != expected.host_str() {
        return Err(AppError::UntrustedHost);
    }
    if url.port_or_known_default() != expected.port_or_known_default() {
        return Err(AppError::UntrustedHost);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// Where the student stands. Deliberately not `Serialize`: the `device_code`
/// and `token` fields must never be reachable from the IPC layer, and the type
/// system is the cheapest guard - a snapshot has to be built by hand, field by
/// field, and neither secret has a field to land in.
pub enum AuthState {
    SignedOut,
    Pending {
        /// The polling credential. Anyone holding it collects the session
        /// token the moment the student approves, so it stays in Rust.
        device_code: String,
        /// Shown to the student to type into the web app. Public by design.
        user_code: String,
        /// Where to type it. Verified against `WEB_ORIGIN` before it is stored.
        verification_uri: String,
        expires_at_epoch_s: u64,
        /// Which sign-in attempt this is; a stale poll task carries an old one.
        generation: u64,
    },
    SignedIn {
        /// The Better Auth session token. Stays in Rust, like the exam JWT.
        token: String,
        name: String,
        email: String,
    },
}

impl AuthState {
    /// The webview's rendering of this state. `user_code`, `verification_uri`
    /// and the expiry are the sign-in instructions a student must see;
    /// `device_code` and `token` have no field here to leak through.
    pub fn snapshot(&self) -> AuthSnapshot {
        match self {
            Self::SignedOut => AuthSnapshot::signed_out(),
            Self::Pending {
                user_code,
                verification_uri,
                expires_at_epoch_s,
                ..
            } => AuthSnapshot {
                status: "pending",
                user_code: Some(user_code.clone()),
                verification_uri: Some(verification_uri.clone()),
                expires_in_s: Some(expires_at_epoch_s.saturating_sub(now_epoch_secs())),
                name: None,
                email: None,
                error: None,
            },
            Self::SignedIn { name, email, .. } => AuthSnapshot {
                status: "signed_in",
                user_code: None,
                verification_uri: None,
                expires_in_s: None,
                name: Some(name.clone()),
                email: Some(email.clone()),
                error: None,
            },
        }
    }
}

/// What crosses the IPC boundary. No credential, no device code.
#[derive(Debug, Clone, Serialize)]
pub struct AuthSnapshot {
    /// "signed_out" | "pending" | "signed_in"
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_in_s: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Why the last attempt ended without a sign-in: an `AppError` code such
    /// as "sign_in_expired" or "sign_in_denied". Set only on the snapshot
    /// emitted when a pending attempt fails.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl AuthSnapshot {
    pub fn signed_out() -> Self {
        Self {
            status: "signed_out",
            user_code: None,
            verification_uri: None,
            expires_in_s: None,
            name: None,
            email: None,
            error: None,
        }
    }

    pub fn signed_out_with_error(code: &AppError) -> Self {
        Self {
            error: Some(code.code().to_string()),
            ..Self::signed_out()
        }
    }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/// Holds the auth state behind a mutex, plus the generation counter that lets
/// a cancelled or superseded sign-in orphan its poll task: every transition
/// away from a `Pending` bumps the counter, and the poll task refuses to write
/// unless the state is still the very attempt it was spawned for.
#[derive(Default)]
pub struct AuthStore {
    inner: Mutex<AuthState>,
    generation: AtomicU64,
}

impl Default for AuthState {
    fn default() -> Self {
        Self::SignedOut
    }
}

impl AuthStore {
    pub fn snapshot(&self) -> AuthSnapshot {
        self.inner.lock().expect("auth mutex poisoned").snapshot()
    }

    pub fn is_signed_in(&self) -> bool {
        matches!(
            *self.inner.lock().expect("auth mutex poisoned"),
            AuthState::SignedIn { .. }
        )
    }

    /// The session token, if signed in. Only Rust-side callers can reach this;
    /// it exists so the exam claim can send the Authorization header.
    pub fn signed_in_token(&self) -> Option<String> {
        match &*self.inner.lock().expect("auth mutex poisoned") {
            AuthState::SignedIn { token, .. } => Some(token.clone()),
            _ => None,
        }
    }

    /// Start a new sign-in attempt. Returns the attempt's generation, which
    /// the poll task carries and must present to write anything back.
    pub fn begin_pending(
        &self,
        device_code: String,
        user_code: String,
        verification_uri: String,
        expires_at_epoch_s: u64,
    ) -> u64 {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        *self.inner.lock().expect("auth mutex poisoned") = AuthState::Pending {
            device_code,
            user_code,
            verification_uri,
            expires_at_epoch_s,
            generation,
        };
        generation
    }

    /// The device code, if `generation` is still the live pending attempt.
    /// `None` tells a poll task it has been orphaned - cancelled, replaced, or
    /// already resolved - and must exit without touching anything. Handing the
    /// code out per poll rather than at spawn keeps it in one place.
    pub fn pending_device_code(&self, generation: u64) -> Option<String> {
        match &*self.inner.lock().expect("auth mutex poisoned") {
            AuthState::Pending {
                device_code,
                generation: g,
                ..
            } if *g == generation => Some(device_code.clone()),
            _ => None,
        }
    }

    /// Resolve a pending attempt into a signed-in student, but only if it is
    /// still the live one. Returns whether the write happened.
    pub fn set_signed_in_if_current(
        &self,
        generation: u64,
        token: String,
        name: String,
        email: String,
    ) -> bool {
        let mut guard = self.inner.lock().expect("auth mutex poisoned");
        if !matches!(&*guard, AuthState::Pending { generation: g, .. } if *g == generation) {
            return false;
        }
        self.generation.fetch_add(1, Ordering::SeqCst);
        *guard = AuthState::SignedIn { token, name, email };
        true
    }

    /// Fail a pending attempt (expiry, denial), but only if it is still the
    /// live one. Returns whether the write happened, so exactly one party -
    /// the poll task or whoever superseded it - announces the outcome.
    pub fn fail_if_current(&self, generation: u64) -> bool {
        let mut guard = self.inner.lock().expect("auth mutex poisoned");
        if !matches!(&*guard, AuthState::Pending { generation: g, .. } if *g == generation) {
            return false;
        }
        self.generation.fetch_add(1, Ordering::SeqCst);
        *guard = AuthState::SignedOut;
        true
    }

    /// Student changed their mind. Bumping the generation is what orphans the
    /// poll task; it notices on its next tick and exits silently.
    pub fn cancel_pending(&self) {
        let mut guard = self.inner.lock().expect("auth mutex poisoned");
        if matches!(&*guard, AuthState::Pending { .. }) {
            self.generation.fetch_add(1, Ordering::SeqCst);
            *guard = AuthState::SignedOut;
        }
    }

    /// Sign out locally, handing back the token so the caller can do the
    /// best-effort server-side revocation. Also clears a pending attempt, and
    /// bumps the generation either way so nothing stale can write over the
    /// signed-out state.
    pub fn take_signed_out(&self) -> Option<String> {
        let mut guard = self.inner.lock().expect("auth mutex poisoned");
        self.generation.fetch_add(1, Ordering::SeqCst);
        let token = match &*guard {
            AuthState::SignedIn { token, .. } => Some(token.clone()),
            _ => None,
        };
        *guard = AuthState::SignedOut;
        token
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET_TOKEN: &str = "very-secret-session-token";
    const SECRET_DEVICE_CODE: &str = "very-secret-device-code";

    fn every_state() -> Vec<AuthState> {
        vec![
            AuthState::SignedOut,
            AuthState::Pending {
                device_code: SECRET_DEVICE_CODE.to_string(),
                user_code: "ABCD-EFGH".to_string(),
                verification_uri: format!("{WEB_ORIGIN}/device"),
                expires_at_epoch_s: now_epoch_secs() + 300,
                generation: 1,
            },
            AuthState::SignedIn {
                token: SECRET_TOKEN.to_string(),
                name: "Alex Student".to_string(),
                email: "alex@school.edu".to_string(),
            },
        ]
    }

    #[test]
    fn no_snapshot_of_any_state_carries_the_token_or_the_device_code() {
        for state in every_state() {
            let serialised =
                serde_json::to_string(&state.snapshot()).expect("snapshot must serialise");
            assert!(
                !serialised.contains(SECRET_TOKEN),
                "session token leaked from {}: {serialised}",
                state.snapshot().status
            );
            assert!(
                !serialised.contains(SECRET_DEVICE_CODE),
                "device code leaked from {}: {serialised}",
                state.snapshot().status
            );
            // Field names too: their absence is what makes a future leak a
            // deliberate act rather than a slip.
            for forbidden in ["token", "device_code", "deviceCode"] {
                assert!(
                    !serialised.contains(&format!("\"{forbidden}\"")),
                    "snapshot grew a `{forbidden}` field: {serialised}"
                );
            }
        }
    }

    #[test]
    fn the_pending_snapshot_shows_what_the_student_must_see() {
        let state = &every_state()[1];
        let snap = state.snapshot();
        assert_eq!(snap.status, "pending");
        assert_eq!(snap.user_code.as_deref(), Some("ABCD-EFGH"));
        assert_eq!(
            snap.verification_uri.as_deref(),
            Some(format!("{WEB_ORIGIN}/device").as_str())
        );
        assert!(snap.expires_in_s.unwrap_or(0) > 0);
    }

    #[test]
    fn the_signed_in_snapshot_names_the_student_and_nothing_else() {
        let snap = every_state()[2].snapshot();
        assert_eq!(snap.status, "signed_in");
        assert_eq!(snap.name.as_deref(), Some("Alex Student"));
        assert_eq!(snap.email.as_deref(), Some("alex@school.edu"));
        assert!(snap.user_code.is_none());
        assert!(snap.verification_uri.is_none());
    }

    #[test]
    fn accepts_the_web_origins_own_verification_uri() {
        assert!(verify_verification_uri(&format!("{WEB_ORIGIN}/device")).is_ok());
    }

    #[test]
    fn refuses_a_verification_uri_on_a_foreign_host() {
        let err = verify_verification_uri("http://evil.example:3001/device").unwrap_err();
        assert_eq!(err.code(), "untrusted_host");
    }

    #[test]
    fn refuses_a_verification_uri_on_the_wrong_scheme() {
        // Same host and port, downgraded/upgraded scheme.
        let err = verify_verification_uri("https://localhost:3001/device").unwrap_err();
        assert_eq!(err.code(), "untrusted_host");
    }

    #[test]
    fn refuses_a_verification_uri_on_the_wrong_port() {
        let err = verify_verification_uri("http://localhost:3999/device").unwrap_err();
        assert_eq!(err.code(), "untrusted_host");
    }

    #[test]
    fn refuses_the_origin_smuggled_into_a_query_string() {
        let err = verify_verification_uri("http://evil.example/device?x=http://localhost:3001")
            .unwrap_err();
        assert_eq!(err.code(), "untrusted_host");
    }

    #[test]
    fn refuses_garbage() {
        assert!(verify_verification_uri("").is_err());
        assert!(verify_verification_uri("not a url").is_err());
        assert!(verify_verification_uri("javascript:alert(1)").is_err());
    }

    #[test]
    fn a_cancelled_attempt_orphans_its_generation() {
        let store = AuthStore::default();
        let generation = store.begin_pending(
            SECRET_DEVICE_CODE.to_string(),
            "ABCD-EFGH".to_string(),
            format!("{WEB_ORIGIN}/device"),
            now_epoch_secs() + 300,
        );
        assert_eq!(
            store.pending_device_code(generation).as_deref(),
            Some(SECRET_DEVICE_CODE)
        );

        store.cancel_pending();

        assert_eq!(store.pending_device_code(generation), None);
        // The orphaned poll task's write attempts land on nothing.
        assert!(!store.set_signed_in_if_current(
            generation,
            SECRET_TOKEN.to_string(),
            "Alex".to_string(),
            "alex@school.edu".to_string()
        ));
        assert!(!store.fail_if_current(generation));
        assert_eq!(store.snapshot().status, "signed_out");
    }

    #[test]
    fn a_superseded_attempt_cannot_write_over_its_successor() {
        let store = AuthStore::default();
        let first = store.begin_pending(
            "old-device-code".to_string(),
            "OLD-CODE".to_string(),
            format!("{WEB_ORIGIN}/device"),
            now_epoch_secs() + 300,
        );
        let second = store.begin_pending(
            "new-device-code".to_string(),
            "NEW-CODE".to_string(),
            format!("{WEB_ORIGIN}/device"),
            now_epoch_secs() + 300,
        );

        assert_eq!(
            store.pending_device_code(first),
            None,
            "the superseded attempt must not hand its successor's code to a stale task"
        );
        assert!(!store.fail_if_current(first), "the old task must not clear the new attempt");
        assert_eq!(store.snapshot().user_code.as_deref(), Some("NEW-CODE"));

        assert!(store.set_signed_in_if_current(
            second,
            SECRET_TOKEN.to_string(),
            "Alex".to_string(),
            "alex@school.edu".to_string()
        ));
        assert_eq!(store.snapshot().status, "signed_in");
    }

    #[test]
    fn signing_out_hands_back_the_token_exactly_once() {
        let store = AuthStore::default();
        let generation = store.begin_pending(
            SECRET_DEVICE_CODE.to_string(),
            "ABCD-EFGH".to_string(),
            format!("{WEB_ORIGIN}/device"),
            now_epoch_secs() + 300,
        );
        store.set_signed_in_if_current(
            generation,
            SECRET_TOKEN.to_string(),
            "Alex".to_string(),
            "alex@school.edu".to_string(),
        );

        assert_eq!(store.take_signed_out().as_deref(), Some(SECRET_TOKEN));
        assert_eq!(store.take_signed_out(), None);
        assert_eq!(store.snapshot().status, "signed_out");
    }
}
