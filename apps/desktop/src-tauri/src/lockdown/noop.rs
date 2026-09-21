//! Stub for platforms we don't ship to (Linux, and anything else a developer
//! happens to run `cargo check` on).
//!
//! It reports honestly that no lockdown is in effect rather than pretending,
//! so a build on an unsupported platform can never look secure.

use tauri::{Runtime, WebviewWindow};

use super::LockdownReport;

pub fn prepare<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    let _ = window.set_fullscreen(true);
    true
}

pub fn engage<R: Runtime>(window: &WebviewWindow<R>, report: &mut LockdownReport) {
    let _ = prepare(window);
    report.unavailable("platform lockdown (unsupported OS - exams should not be taken here)");
}

pub fn reassert<R: Runtime>(_window: &WebviewWindow<R>) {}

pub fn force_foreground<R: Runtime>(_window: &WebviewWindow<R>) {}

pub fn release<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.set_fullscreen(false);
}
