//! macOS lockdown via `NSApplicationPresentationOptions`.
//!
//! This is the real thing, not a keystroke filter: the window server itself
//! stops honouring the Cmd+Tab switcher and the force-quit panel while these
//! options are in effect. Apple's own documentation describes the flags as:
//!
//! | Flag                       | Effect                                        |
//! |----------------------------|-----------------------------------------------|
//! | `DisableProcessSwitching`  | "Cmd+Tab UI is disabled."                     |
//! | `DisableForceQuit`         | "Cmd+Opt+Esc panel is disabled."              |
//! | `DisableSessionTermination`| Power key panel, Restart/Shut Down/Log Out    |
//! | `DisableHideApplication`   | Cmd+H                                         |
//! | `HideDock` / `HideMenuBar` | Dock and menu bar entirely unavailable        |
//! | `DisableAppleMenu`         | Apple menu items disabled                     |
//!
//! Three constraints drive the shape of this module:
//!
//! 1. The options apply **only while our app is frontmost**, and macOS resets
//!    them when it isn't. Hence `reassert`, called on every focus gain.
//! 2. `setPresentationOptions:` **raises an ObjC exception** on an invalid flag
//!    combination, so we catch and degrade rather than taking down the process
//!    mid-exam.
//! 3. AppKit is main-thread-only, and the code that engages lockdown does not
//!    run there. Tauri dispatches `async` commands onto the async runtime, so
//!    `start_session` - and therefore `engage` - executes on a worker thread.
//!    Every AppKit call below is hopped onto the main thread by `on_main`.
//!
//! What macOS still will not let us stop: Ctrl+Cmd+Q (lock screen), the power
//! button, and anything a student does with Accessibility permissions they
//! granted themselves.

use std::sync::mpsc;
use std::time::Duration;

use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSApplicationPresentationOptions};
use tauri::{Runtime, WebviewWindow};

use super::LockdownReport;

/// Apple's documented kiosk combination. `DisableProcessSwitching` is only
/// honoured alongside a dock-hiding flag, which `HideDock` supplies.
fn kiosk_options() -> NSApplicationPresentationOptions {
    NSApplicationPresentationOptions::HideDock
        | NSApplicationPresentationOptions::HideMenuBar
        | NSApplicationPresentationOptions::DisableAppleMenu
        | NSApplicationPresentationOptions::DisableProcessSwitching
        | NSApplicationPresentationOptions::DisableForceQuit
        | NSApplicationPresentationOptions::DisableSessionTermination
        | NSApplicationPresentationOptions::DisableHideApplication
}

/// Fallback if the full set is rejected: still hides the Dock and menu bar and
/// blocks Cmd+Tab, but gives up the force-quit and session-termination locks.
fn reduced_options() -> NSApplicationPresentationOptions {
    NSApplicationPresentationOptions::HideDock
        | NSApplicationPresentationOptions::HideMenuBar
        | NSApplicationPresentationOptions::DisableProcessSwitching
}

/// How long to wait for the main thread to run an AppKit closure. Generous:
/// the main thread is only ever briefly busy, and failing early here would
/// silently drop lockdown.
const MAIN_THREAD_TIMEOUT: Duration = Duration::from_secs(2);

/// Run `f` on the main thread and return its result.
///
/// Callers are usually on a worker thread (see constraint 3 above), but not
/// always - `reassert` runs from the window event handler. Calling
/// `run_on_main_thread` from the main thread would queue the closure behind
/// ourselves and then block waiting for it, so check first and run inline.
fn on_main<R: Runtime, T: Send + 'static>(
    window: &WebviewWindow<R>,
    f: impl FnOnce(MainThreadMarker) -> T + Send + 'static,
) -> Option<T> {
    if let Some(mtm) = MainThreadMarker::new() {
        return Some(f(mtm));
    }

    let (tx, rx) = mpsc::channel();
    window
        .run_on_main_thread(move || {
            if let Some(mtm) = MainThreadMarker::new() {
                let _ = tx.send(f(mtm));
            }
        })
        .ok()?;

    rx.recv_timeout(MAIN_THREAD_TIMEOUT).ok()
}

/// Apply presentation options, catching the ObjC exception an invalid
/// combination raises. Returns whether it stuck.
fn apply<R: Runtime>(window: &WebviewWindow<R>, options: NSApplicationPresentationOptions) -> bool {
    on_main(window, move |mtm| {
        objc2::exception::catch(|| {
            let app = NSApplication::sharedApplication(mtm);
            app.setPresentationOptions(options);
        })
        .is_ok()
    })
    .unwrap_or(false)
}

/// Simple fullscreen, NOT native fullscreen. Native fullscreen allocates a
/// dedicated Space, which *re-enables* Ctrl+Left/Right and the three-finger
/// swipe - strictly worse for a kiosk. Simple fullscreen just resizes the
/// window over the whole screen with no Space of its own.
///
/// Done at startup so the student never sees the Space tear down as their exam
/// opens.
/// Returns whether simple fullscreen took; the caller reports the fallback.
pub fn prepare<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    let _ = window.set_fullscreen(false);
    let simple = window.set_simple_fullscreen(true).is_ok();
    if !simple {
        let _ = window.set_fullscreen(true);
    }
    // Keep the window on every Space, so even a successful Space switch lands
    // the student back on the exam.
    let _ = window.set_visible_on_all_workspaces(true);
    simple
}

pub fn engage<R: Runtime>(window: &WebviewWindow<R>, report: &mut LockdownReport) {
    // Idempotent - re-run in case the window was restored since startup.
    if prepare(window) {
        report.engaged("fullscreen without a dedicated Space (no swipe-away)");
    } else {
        report.failed("simple fullscreen - Mission Control swipe may work");
    }

    if apply(window, kiosk_options()) {
        report.engaged("Cmd+Tab app switcher disabled");
        report.engaged("Cmd+Opt+Esc force-quit panel disabled");
        report.engaged("Cmd+H hide disabled");
        report.engaged("Dock and menu bar hidden");
        report.engaged("Restart / Shut Down / Log Out disabled");
    } else if apply(window, reduced_options()) {
        report.engaged("Cmd+Tab app switcher disabled");
        report.engaged("Dock and menu bar hidden");
        report.failed("force-quit and session-termination locks");
    } else {
        report.failed("macOS presentation lockdown (Cmd+Tab remains available)");
    }

    // Honest about what macOS does not expose to an unprivileged app.
    report.unavailable("Ctrl+Cmd+Q screen lock");
    report.unavailable("hardware power and sleep keys");
}

pub fn reassert<R: Runtime>(window: &WebviewWindow<R>) {
    // macOS clears presentation options whenever another app is frontmost, so
    // this has to run on every focus gain, not just once at startup.
    if !apply(window, kiosk_options()) {
        apply(window, reduced_options());
    }
}

pub fn force_foreground<R: Runtime>(window: &WebviewWindow<R>) {
    on_main(window, |mtm| {
        let _ = objc2::exception::catch(|| {
            let app = NSApplication::sharedApplication(mtm);
            // Deprecated in favour of `activate()` on Ventura+, but this is the
            // variant that still steals focus from whatever the student
            // switched to, which is exactly what we want here.
            #[allow(deprecated)]
            app.activateIgnoringOtherApps(true);
        });
    });
}

pub fn release<R: Runtime>(window: &WebviewWindow<R>) {
    // Restoring this matters: leaving the options set would strand the user
    // with no Dock and no menu bar after the app exits.
    apply(window, NSApplicationPresentationOptions::Default);
    let _ = window.set_simple_fullscreen(false);
    let _ = window.set_visible_on_all_workspaces(false);
}
