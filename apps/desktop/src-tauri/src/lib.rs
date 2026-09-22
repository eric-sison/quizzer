//! Quizzer secure exam client.
//!
//! The shape of this app is driven by one decision: the webview renders a
//! locally bundled UI and is given no network access at all. Every call to the
//! exam backend originates in this process, authenticated with a credential the
//! frontend never sees. That makes the navigation policy trivial (one origin,
//! forever) and means tampering with frontend state cannot forge a submission.
//!
//! See `lockdown/mod.rs` for what the kiosk layer can and cannot enforce.

mod api;
mod commands;
mod error;
mod events;
mod lockdown;
mod session;

#[cfg(test)]
mod tests;

use std::time::Duration;

use tauri::menu::Menu;
#[cfg(target_os = "macos")]
use tauri::menu::{PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Runtime, WindowEvent};
use url::Url;

use commands::{event, AppState};
use events::kind;

const MAIN_WINDOW: &str = "main";

/// How often we tell the server we're still here, and re-sync our copy of the
/// deadline with its clock.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);
/// How often we check whether time has run out.
///
/// Separate from the heartbeat, and far shorter, because this one costs
/// nothing: it compares two numbers already in memory. Riding on the heartbeat
/// meant a student could sit past the deadline for up to fifteen seconds with
/// the clock reading 00:00, still typing into inputs the server had already
/// begun refusing.
const DEADLINE_CHECK_INTERVAL: Duration = Duration::from_secs(1);
/// Audit events flush faster than the heartbeat so a proctor watching live sees
/// an escape attempt promptly.
const EVENT_FLUSH_INTERVAL: Duration = Duration::from_secs(5);

/// Is this URL somewhere the exam webview is allowed to go?
///
/// In a release build the answer is "only the bundled app". Tauri serves that
/// from `tauri://localhost` on macOS and `http://tauri.localhost` on Windows.
/// The dev server is allowed only in debug builds.
fn is_navigation_allowed(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => matches!(
            url.host_str(),
            Some("tauri.localhost") | Some("ipc.localhost")
        ) || (cfg!(debug_assertions) && url.host_str() == Some("localhost")),
        _ => false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(AppState::new())
        .menu(build_app_menu)
        .invoke_handler(tauri::generate_handler![
            commands::validate_link,
            commands::preview_link,
            commands::start_session,
            commands::save_answer,
            commands::submit_exam,
            commands::report_event,
            commands::get_session_state,
            commands::get_lockdown_report,
            commands::quit_app,
        ])
        .setup(|app| {
            let window = build_main_window(app.handle())?;
            lockdown::prepare_window(&window);
            spawn_heartbeat(app.handle().clone());
            spawn_deadline_watch(app.handle().clone());
            spawn_event_flusher(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            let handle = window.app_handle().clone();
            let Some(webview) = handle.get_webview_window(MAIN_WINDOW) else {
                return;
            };

            match event {
                // The single most reliable signal that the student left the
                // exam, whatever route they took to do it - including the ones
                // we cannot block, like Ctrl+Alt+Del.
                WindowEvent::Focused(false) => commands::on_focus_lost(&handle, &webview),
                WindowEvent::Focused(true) => commands::on_focus_gained(&handle, &webview),

                WindowEvent::CloseRequested { api, .. } => {
                    let state = handle.state::<AppState>();
                    if state.session.is_active() {
                        api.prevent_close();
                        state.events.record(kind::CLOSE_ATTEMPT, None);
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building the exam client");

    app.run(|handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            let state = handle.state::<AppState>();
            if state.session.is_active() {
                // Quitting mid-exam has to go through submission, not the OS.
                api.prevent_exit();
                state.events.record(kind::CLOSE_ATTEMPT, Some("exit requested".into()));
            }
        }
    });
}

/// The app menu.
///
/// On macOS the menu is load-bearing twice over, in opposite directions.
/// Tauri's default menu supplies Cmd+Q, Cmd+W, Cmd+M and Cmd+H, which an exam
/// client must not offer - removing the items is the only way to remove those
/// accelerators, since `presentationOptions` does not touch them.
///
/// But Cmd+X/C/V/A are *also* menu key equivalents on macOS, living on the Edit
/// menu. An app with no Edit menu has no clipboard shortcuts in its text
/// fields - which breaks the very first thing a student does, pasting their
/// quiz link. So: an Edit menu and nothing else.
///
/// Copy is safe to include. `guard.js` blocks text selection outside editable
/// fields, so Cmd+C reaches the student's own answers and not the question
/// paper. Omitting it would only stop them editing their own writing.
///
/// Windows needs none of this - WebView2 handles clipboard keys itself, and
/// with `decorations: false` a menu bar would have nowhere to render.
fn build_app_menu<R: Runtime>(handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    #[cfg(target_os = "macos")]
    {
        let edit = Submenu::with_items(
            handle,
            "Edit",
            true,
            &[
                &PredefinedMenuItem::undo(handle, None)?,
                &PredefinedMenuItem::redo(handle, None)?,
                &PredefinedMenuItem::separator(handle)?,
                &PredefinedMenuItem::cut(handle, None)?,
                &PredefinedMenuItem::copy(handle, None)?,
                &PredefinedMenuItem::paste(handle, None)?,
                &PredefinedMenuItem::select_all(handle, None)?,
            ],
        )?;

        // macOS renders the first submenu as the application menu, so give it
        // an empty one rather than letting Edit be promoted into that slot.
        let app = Submenu::with_items(handle, "Quizzer Exam", true, &[])?;

        Menu::with_items(handle, &[&app, &edit])
    }

    #[cfg(not(target_os = "macos"))]
    {
        Menu::new(handle)
    }
}

/// Build the main window in Rust rather than letting the config create it, so
/// we can attach the navigation handler. `"create": false` in
/// `tauri.conf.json` keeps the window's properties declarative while handing
/// construction to us.
fn build_main_window(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == MAIN_WINDOW)
        .expect("no `main` window in tauri.conf.json")
        .clone();

    let handle = app.clone();

    let window = tauri::WebviewWindowBuilder::from_config(app, &config)?
        .initialization_script(include_str!("guard.js"))
        .on_navigation(move |url| {
            let allowed = is_navigation_allowed(url);
            if !allowed {
                // A blocked navigation during an exam is worth a proctor's
                // attention: it means a link in the question content, or
                // injected script, tried to leave.
                let state = handle.state::<AppState>();
                state
                    .events
                    .record(kind::BLOCKED_NAVIGATION, Some(url.to_string()));
            }
            allowed
        })
        .build()?;

    Ok(window)
}

/// Keep the server informed we're alive and keep our deadline in sync with its
/// clock. The deadline itself is watched separately, below.
fn spawn_heartbeat(handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(HEARTBEAT_INTERVAL);
        // The first tick fires immediately; skip it so we don't heartbeat
        // before a session exists.
        ticker.tick().await;

        loop {
            ticker.tick().await;

            let state = handle.state::<AppState>();
            if !state.session.is_active() {
                continue;
            }

            let Ok(jwt) = state.session.jwt() else {
                continue;
            };
            let elapsed = state.session.with(|s| s.manifest.duration_s.saturating_sub(s.remaining_s())).unwrap_or(0);

            match state.api.heartbeat(&jwt, elapsed).await {
                Ok(hb) => {
                    // The server owns the deadline; adopt whatever it says, so
                    // a proctor granting extra time takes effect here.
                    let _ = state.session.with(|s| {
                        s.expires_at = hb.expires_at;
                        s.clock_skew_s = hb.server_time as i64 - session::now_epoch_secs() as i64;
                    });

                    if hb.revoked {
                        if let Some(window) = handle.get_webview_window(MAIN_WINDOW) {
                            commands::end_revoked_session(&state, &window);
                        }
                        continue;
                    }
                }
                // The server currently reports revocation as a 403 on the call
                // itself rather than via the `revoked` flag; both roads lead to
                // the same place: this session is over, by proctor decision.
                Err(error::AppError::Revoked) => {
                    if let Some(window) = handle.get_webview_window(MAIN_WINDOW) {
                        commands::end_revoked_session(&state, &window);
                    }
                    continue;
                }
                Err(_) => {
                    state.events.record(kind::HEARTBEAT_MISSED, None);
                }
            }

        }
    });
}

/// Submit the moment the deadline passes, whatever state the exam is in.
///
/// Auto-submit lives in this process rather than in the frontend: a student who
/// has broken the UI must not thereby avoid submission, and the answers are
/// already on the server - submitting finalises the attempt, it does not upload
/// it. So "unfinished" is not a special case here. It is just the attempt as it
/// stood when the clock ran out.
fn spawn_deadline_watch(handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(DEADLINE_CHECK_INTERVAL);
        // Delay rather than burst: if a submit attempt fails and takes a while
        // doing it, the retry waits a tick instead of hammering the server.
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        // Whether this sitting has already been told its time is up, and
        // whether a failed submit has already been logged. Held here rather
        // than in shared state because they belong to the loop: they clear
        // themselves when the session ends, ready for the next one.
        let mut announced = false;
        let mut failure_logged = false;

        loop {
            ticker.tick().await;

            let state = handle.state::<AppState>();
            // False once a receipt exists, so a submitted exam stops the loop
            // without a second flag to keep in step.
            if !state.session.is_active() {
                announced = false;
                failure_logged = false;
                continue;
            }

            if state.session.with(|s| s.remaining_s()).unwrap_or(1) > 0 {
                continue;
            }

            let Some(window) = handle.get_webview_window(MAIN_WINDOW) else {
                continue;
            };

            // Tell the UI first. It freezes the exam behind this, so the
            // student stops typing into a form the server is already refusing,
            // rather than finding out when a save fails.
            if !announced {
                let _ = window.emit(event::TIME_UP, ());
                announced = true;
            }

            // Offline at the deadline: this fails, `is_active` stays true
            // because no receipt was written, and the next tick tries again.
            if let Err(error) = commands::do_submit(&state, &window).await {
                // Once per sitting, not once a second: a submit that cannot
                // land is worth a line in the proctor log - it is the record
                // of a student who ran out of time and could not hand in - but
                // a retry loop writing to that log every second would bury it.
                if !failure_logged {
                    failure_logged = true;
                    state
                        .events
                        .record(kind::SUBMIT_FAILED, Some(error.to_string()));
                }
            }
        }
    });
}

/// Drain the proctor event queue on its own cadence, independent of whatever
/// the student is doing.
fn spawn_event_flusher(handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(EVENT_FLUSH_INTERVAL);
        loop {
            ticker.tick().await;
            let state = handle.state::<AppState>();
            commands::flush_events(&state).await;
        }
    });
}

#[cfg(test)]
mod navigation_tests {
    use super::*;

    fn allowed(raw: &str) -> bool {
        is_navigation_allowed(&Url::parse(raw).unwrap())
    }

    #[test]
    fn allows_the_bundled_app_origin() {
        assert!(allowed("tauri://localhost/index.html"));
        assert!(allowed("http://tauri.localhost/index.html"));
    }

    #[test]
    fn blocks_the_open_web() {
        assert!(!allowed("https://example.com/"));
        assert!(!allowed("http://evil.example/exfiltrate"));
        // Even the exam backend itself: the webview talks to Rust, never HTTP.
        assert!(!allowed("https://exams.school.edu/e/token"));
    }

    #[test]
    fn blocks_non_web_schemes() {
        assert!(!allowed("file:///etc/passwd"));
        assert!(!allowed("javascript:alert(1)"));
        assert!(!allowed("data:text/html,<h1>hi"));
        assert!(!allowed("mailto:someone@example.com"));
    }
}
