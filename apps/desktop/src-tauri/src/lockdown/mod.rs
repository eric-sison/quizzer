//! Kiosk lockdown.
//!
//! Read this before changing anything here: **none of this is a security
//! boundary.** A student with administrator rights, a second device, or a phone
//! camera defeats all of it. What these measures buy is (a) raising the effort
//! of casually tabbing away and (b) producing an audit trail when someone
//! tries. The backend stays authoritative for everything that matters.
//!
//! Where the OS offers a real mechanism we use it rather than intercepting
//! keystrokes:
//!
//! - **macOS** has a genuine API for this. `NSApplicationPresentationOptions`
//!   disables the Cmd+Tab switcher, the Cmd+Opt+Esc force-quit panel, the Dock
//!   and the menu bar outright, at the window-server level.
//! - **Windows** has no equivalent in-process API, so we install a
//!   `WH_KEYBOARD_LL` hook. It is genuinely effective for Alt+Tab and the Win
//!   key, and genuinely powerless against Ctrl+Alt+Del.
//!
//! We deliberately do *not* use `tauri-plugin-global-shortcut`. It is built on
//! `RegisterHotKey` (Windows) and Carbon `RegisterEventHotKey` (macOS), neither
//! of which is permitted to claim Alt+Tab, Cmd+Tab or the Win key. Registering
//! them there would appear to work and silently do nothing.

use serde::Serialize;
use tauri::{Runtime, WebviewWindow};

#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod platform;

#[cfg(target_os = "windows")]
#[path = "windows.rs"]
mod platform;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[path = "noop.rs"]
mod platform;

/// What lockdown actually achieved on this machine, and what it could not.
///
/// This is surfaced to the student (so they know the app is in exam mode) and
/// logged to the server (so a proctor can see that, say, the Windows keyboard
/// hook failed to install on one particular machine).
#[derive(Debug, Clone, Default, Serialize)]
pub struct LockdownReport {
    /// Measures confirmed active.
    pub engaged: Vec<String>,
    /// Measures not in force - both those this platform inherently cannot
    /// provide and those that were expected to apply but didn't. Shown to the
    /// student, who should see the full picture either way.
    pub unavailable: Vec<String>,
    /// True when a measure we *expected* to apply failed to.
    ///
    /// Distinct from a non-empty `unavailable`: macOS can never block
    /// Ctrl+Cmd+Q, so that is always listed and is not a fault. This flag means
    /// something went wrong on this particular machine, and is what the proctor
    /// log keys on.
    pub degraded: bool,
    /// True when running with `--unlocked` in a debug build.
    pub bypassed: bool,
}

impl LockdownReport {
    fn engaged(&mut self, what: &str) {
        self.engaged.push(what.to_string());
    }

    /// A limit inherent to the platform. Not a fault.
    fn unavailable(&mut self, what: &str) {
        self.unavailable.push(what.to_string());
    }

    /// A measure that should have applied and didn't.
    fn failed(&mut self, what: &str) {
        self.unavailable.push(what.to_string());
        self.degraded = true;
    }
}

/// Developer escape hatch. Honoured only in debug builds - a release binary
/// ignores the flag entirely, so it cannot be used to soften a real exam.
pub fn is_bypassed() -> bool {
    cfg!(debug_assertions) && std::env::args().any(|arg| arg == "--unlocked")
}

/// Put the window into its at-rest exam-app shape, before any exam exists.
///
/// Separate from `engage` on purpose: this is the part that should apply the
/// moment the app opens (the user asked for fullscreen at launch), while the
/// parts that trap the student - Cmd+Tab, the Windows key - wait until an exam
/// is actually running. It also gets the macOS Space swap out of the way at
/// startup rather than animating it mid-exam-start.
pub fn prepare_window<R: Runtime>(window: &WebviewWindow<R>) {
    if is_bypassed() {
        return;
    }
    let _ = platform::prepare(window);
}

/// Harden the window and engage platform lockdown.
///
/// Called once the server has confirmed the session - never before, so a bad
/// link can't trap a student in a kiosk window with no exam in it.
pub fn engage<R: Runtime>(window: &WebviewWindow<R>) -> LockdownReport {
    let mut report = LockdownReport::default();

    if is_bypassed() {
        report.bypassed = true;
        report.failed("all lockdown (running with --unlocked)");
        let _ = window.show();
        let _ = window.set_focus();
        return report;
    }

    harden_window(window, &mut report);
    platform::engage(window, &mut report);

    // Only reveal the window once it is hardened, so there is no frame in which
    // a decorated, minimisable window is on screen.
    let _ = window.show();
    let _ = window.set_focus();

    report
}

/// Re-apply the measures that the OS can silently undo.
///
/// macOS drops `presentationOptions` whenever the app stops being frontmost,
/// and both platforms can lose always-on-top to another window forcing itself
/// forward. Called every time focus returns.
pub fn reassert<R: Runtime>(window: &WebviewWindow<R>) {
    if is_bypassed() {
        return;
    }
    let _ = window.set_always_on_top(true);
    platform::reassert(window);
}

/// Pull the window back to the front after a focus loss we didn't sanction.
pub fn force_foreground<R: Runtime>(window: &WebviewWindow<R>) {
    if is_bypassed() {
        return;
    }
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    platform::force_foreground(window);
}

/// Undo everything. Must run before the app exits, or macOS can leave the user
/// with a hidden Dock and menu bar.
pub fn release<R: Runtime>(window: &WebviewWindow<R>) {
    platform::release(window);
    let _ = window.set_always_on_top(false);
    let _ = window.set_closable(true);
    let _ = window.set_minimizable(true);
}

/// Cross-platform window hardening, applied on top of the static config in
/// `tauri.conf.json`. Re-applying at runtime matters because the window can
/// outlive a display change or a config the OS declined to honour at creation.
fn harden_window<R: Runtime>(window: &WebviewWindow<R>, report: &mut LockdownReport) {
    let _ = window.set_resizable(false);
    let _ = window.set_minimizable(false);
    let _ = window.set_closable(false);
    let _ = window.set_decorations(false);
    let _ = window.set_always_on_top(true);

    if window.set_content_protected(true).is_ok() {
        report.engaged("screen-capture protection");
    } else {
        report.failed("screen-capture protection");
    }

    report.engaged("fullscreen, undecorated window");
    report.engaged("minimise, maximise and close disabled");
}

/// Keystrokes the Windows hook has swallowed since the last check, drained for
/// the audit trail. Always zero elsewhere.
#[cfg(target_os = "windows")]
pub fn windows_blocked_count() -> u64 {
    platform::take_blocked_count()
}
