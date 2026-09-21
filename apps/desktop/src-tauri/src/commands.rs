//! The complete IPC surface.
//!
//! This is the entire attack surface the webview is given, so it stays small
//! and every entry point is written on the assumption that the caller is
//! hostile. Nothing here trusts a value from the frontend for anything that
//! affects grading: answers are relayed to the server, which scores them; the
//! session credential never crosses this boundary in either direction.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow};

use crate::api::ApiClient;
use crate::error::{AppError, AppResult};
use crate::events::{kind, EventQueue};
use crate::lockdown::{self, LockdownReport};
use crate::session::{
    now_epoch_secs, parse_link, ExamSession, LinkInfo, Receipt, SessionSnapshot, SessionStore,
};

/// Focus losses tolerated before the warning escalates. The exam is never
/// terminated client-side - that decision belongs to the server and the
/// proctor, because OS notifications and installer popups produce false
/// positives that would otherwise fail honest students.
pub const STRIKE_WARNING_THRESHOLD: u32 = 3;

pub struct AppState {
    pub api: ApiClient,
    pub session: SessionStore,
    pub events: EventQueue,
    /// Monotonic counter so the server can discard answers that arrive out of
    /// order after a retry.
    pub answer_seq: AtomicU64,
    pub lockdown: Mutex<LockdownReport>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            api: ApiClient::new(),
            session: SessionStore::default(),
            events: EventQueue::default(),
            answer_seq: AtomicU64::new(0),
            lockdown: Mutex::new(LockdownReport::default()),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

/// Event names the frontend subscribes to.
pub mod event {
    pub const STATE: &str = "exam://state";
    pub const STRIKE: &str = "exam://strike";
    pub const SUBMITTED: &str = "exam://submitted";
    pub const TIME_UP: &str = "exam://time-up";
    pub const LOCKDOWN: &str = "exam://lockdown";
}

#[derive(Clone, Serialize)]
pub struct StrikePayload {
    pub strikes: u32,
    pub reason: String,
    pub warn: bool,
}

#[derive(Serialize)]
pub struct StartPayload {
    pub snapshot: SessionSnapshot,
    pub lockdown: LockdownReport,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Check a pasted link without touching the network.
///
/// Lets the UI give immediate feedback on a typo, and guarantees a malicious
/// link never produces an outbound request to an attacker-chosen host.
#[tauri::command]
pub fn validate_link(raw: String) -> AppResult<LinkInfo> {
    parse_link(&raw).map(|link| link.info())
}

/// Claim the exam session and enter lockdown.
///
/// Lockdown is engaged only *after* the server confirms the session, so a bad
/// link can never trap a student in a kiosk window with no exam in it.
#[tauri::command]
pub async fn start_session<R: Runtime>(
    raw: String,
    window: WebviewWindow<R>,
    state: State<'_, AppState>,
) -> AppResult<StartPayload> {
    if state.session.is_active() {
        return Err(AppError::SessionConflict);
    }

    let link = parse_link(&raw)?;
    let response = state.api.start_session(link.token).await?;

    // Trust the server's clock, not ours: a student who moves the system clock
    // forward must not be able to shorten or extend their own deadline.
    let clock_skew_s = response.server_time as i64 - now_epoch_secs() as i64;

    state.session.set(ExamSession {
        jwt: response.session_jwt,
        manifest: response.exam,
        expires_at: response.expires_at,
        clock_skew_s,
        answers: Default::default(),
        idempotency_key: uuid::Uuid::new_v4().to_string(),
        receipt: None,
        strikes: 0,
    });
    state.events.reset();
    state.answer_seq.store(0, Ordering::SeqCst);

    let report = lockdown::engage(&window);
    if let Ok(mut slot) = state.lockdown.lock() {
        *slot = report.clone();
    }

    state.events.record(kind::EXAM_STARTED, None);
    state.events.record(
        if report.unavailable.is_empty() {
            kind::LOCKDOWN_ENGAGED
        } else {
            kind::LOCKDOWN_DEGRADED
        },
        Some(report.unavailable.join("; ")),
    );
    if clock_skew_s.abs() > 120 {
        state.events.record(
            kind::CLOCK_TAMPERING,
            Some(format!("client clock off by {clock_skew_s}s")),
        );
    }

    let _ = window.emit(event::LOCKDOWN, &report);

    Ok(StartPayload {
        snapshot: state.session.snapshot(),
        lockdown: report,
    })
}

/// Relay one answer to the server.
///
/// The local copy is only an echo for re-rendering; the server's record is the
/// one that counts, so editing frontend state achieves nothing.
#[tauri::command]
pub async fn save_answer(
    question_id: String,
    value: serde_json::Value,
    state: State<'_, AppState>,
) -> AppResult<()> {
    // Reject answers to questions that aren't in this exam, so the frontend
    // can't be used to probe the API with arbitrary ids.
    let known = state
        .session
        .with(|s| s.manifest.questions.iter().any(|q| q.id == question_id))?;
    if !known {
        return Err(AppError::NoSession);
    }

    let jwt = state.session.jwt()?;
    let seq = state.answer_seq.fetch_add(1, Ordering::SeqCst) + 1;

    state
        .api
        .save_answer(&jwt, question_id.clone(), value.clone(), seq)
        .await?;

    let _ = state.session.with(|s| {
        s.answers.insert(question_id, value);
    });

    Ok(())
}

/// Submit the exam. Safe to call twice: the idempotency key is stable for the
/// session, so a retried submit replays the same receipt instead of creating a
/// second attempt.
#[tauri::command]
pub async fn submit_exam<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, AppState>,
) -> AppResult<Receipt> {
    do_submit(&state, &window).await
}

/// Shared submit path, used by the student-initiated command and by the
/// deadline-triggered auto-submit. Keeping one implementation means the
/// timeout path can never diverge from the one that is actually exercised.
pub async fn do_submit<R: Runtime>(
    state: &AppState,
    window: &WebviewWindow<R>,
) -> AppResult<Receipt> {
    // Already submitted? Hand back the receipt we have rather than calling out
    // again - this is the common case when a student double-clicks.
    if let Ok(Some(receipt)) = state.session.with(|s| s.receipt.clone()) {
        return Ok(receipt);
    }

    let jwt = state.session.jwt()?;
    let key = state.session.with(|s| s.idempotency_key.clone())?;

    let receipt = state.api.submit(&jwt, key).await?;

    let _ = state.session.with(|s| {
        s.receipt = Some(receipt.clone());
    });

    state.events.record(kind::EXAM_SUBMITTED, None);
    // Flush the audit trail before lockdown drops, so the final events aren't
    // lost if the student closes the app straight after submitting.
    flush_events(state).await;

    lockdown::release(window);
    let _ = window.emit(event::SUBMITTED, &receipt);

    Ok(receipt)
}

/// Record something the frontend noticed (blocked shortcut, context menu,
/// visibility change). Advisory only - the frontend is not trusted, so these
/// supplement the Rust-side signals rather than replacing them.
#[tauri::command]
pub fn report_event(kind: String, detail: Option<String>, state: State<'_, AppState>) {
    // Keep the taxonomy closed so a compromised frontend can't flood the audit
    // log with arbitrary event types.
    let allowed = matches!(
        kind.as_str(),
        "blocked_shortcut" | "blocked_key" | "blocked_navigation" | "focus_lost" | "focus_restored"
    );
    if allowed {
        state.events.record(&kind, detail);
    }
}

/// Quit the app. Refused while an exam is in flight - leaving has to go
/// through submission. Needed because the empty app menu (which is what
/// removes Cmd+Q during an exam) also removes the only other way out, and a
/// student who opened the app by mistake must not be stranded.
#[tauri::command]
pub fn quit_app<R: Runtime>(app: AppHandle<R>, state: State<'_, AppState>) -> AppResult<()> {
    if state.session.is_active() {
        state.events.record(kind::CLOSE_ATTEMPT, Some("quit requested".into()));
        return Err(AppError::SessionConflict);
    }
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn get_session_state(state: State<'_, AppState>) -> SessionSnapshot {
    state.session.snapshot()
}

#[tauri::command]
pub fn get_lockdown_report(state: State<'_, AppState>) -> LockdownReport {
    state.lockdown.lock().map(|r| r.clone()).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Shared helpers used by the background loops and window-event handlers
// ---------------------------------------------------------------------------

/// Send any queued audit events. On failure they go back on the queue so a
/// brief network drop doesn't erase the trail.
pub async fn flush_events(state: &AppState) {
    let Ok(jwt) = state.session.jwt() else {
        return;
    };

    while state.events.has_pending() {
        let batch = state.events.take_batch();
        if batch.is_empty() {
            break;
        }
        if state.api.send_events(&jwt, batch.clone()).await.is_err() {
            state.events.requeue(batch);
            break;
        }
    }
}

/// Handle the app losing focus during an exam: log it, count it, pull the
/// window back, and tell the student it was noticed.
pub fn on_focus_lost<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) {
    let state = app.state::<AppState>();
    if !state.session.is_active() {
        return;
    }

    let strikes = state
        .session
        .with(|s| {
            s.strikes += 1;
            s.strikes
        })
        .unwrap_or(0);

    state.events.record(
        kind::FOCUS_LOST,
        Some(format!("strike {strikes}")),
    );

    #[cfg(target_os = "windows")]
    {
        let blocked = crate::lockdown::windows_blocked_count();
        if blocked > 0 {
            state
                .events
                .record(kind::BLOCKED_KEY, Some(format!("{blocked} keystrokes")));
        }
    }

    lockdown::force_foreground(window);

    let _ = window.emit(
        event::STRIKE,
        StrikePayload {
            strikes,
            reason: "The exam window lost focus.".to_string(),
            warn: strikes >= STRIKE_WARNING_THRESHOLD,
        },
    );
}

/// Focus came back: re-apply the measures macOS silently dropped while we were
/// in the background.
pub fn on_focus_gained<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) {
    let state = app.state::<AppState>();
    if !state.session.is_active() {
        return;
    }
    state.events.record(kind::FOCUS_RESTORED, None);
    lockdown::reassert(window);
}
