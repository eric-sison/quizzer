//! Windows lockdown via a low-level keyboard hook.
//!
//! Windows gives an unprivileged process no equivalent of macOS's presentation
//! options, so the only in-process lever is `WH_KEYBOARD_LL`. It runs before
//! the shell sees the keystroke, needs no administrator rights, and genuinely
//! swallows:
//!
//!   Win (either), Alt+Tab, Alt+Shift+Tab, Alt+Esc, Ctrl+Esc,
//!   Ctrl+Shift+Esc (Task Manager), Alt+F4, F11
//!
//! It **cannot** intercept **Ctrl+Alt+Del**. That is the Secure Attention
//! Sequence, handled by the kernel specifically so that no user-mode process
//! can fake or suppress it. Anyone claiming otherwise for a normal desktop app
//! is wrong. The only supported answers are the Keyboard Filter feature on
//! Windows IoT Enterprise, or Group Policy disabling Task Manager - both are
//! IT-deployment concerns, not things this binary can do. We settle for
//! detecting the resulting focus loss and logging it.
//!
//! For a real deployment, pair this with **Assigned Access** or **Shell
//! Launcher** on a dedicated exam account; see the README. That is the layer
//! that actually holds, and it makes everything here defence in depth.
//!
//! Implementation note: the hook callback is invoked on the thread that
//! installed it, and that thread must pump messages. So the hook lives on its
//! own thread with its own message loop, and communicates through statics -
//! there is no way to hand a closure's captured state to a raw `extern "system"`
//! callback.

use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::OnceLock;

use tauri::{Runtime, WebviewWindow};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_CONTROL, VK_ESCAPE, VK_F11, VK_F4, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    VK_TAB,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, SetForegroundWindow, SetWindowsHookExW,
    UnhookWindowsHookEx, HHOOK, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
};

use super::LockdownReport;

/// Whether the hook should currently swallow anything. Flipped off on release
/// so the hook can stay installed while we tear down in an orderly way.
static ACTIVE: AtomicBool = AtomicBool::new(false);
/// Installed hook handle, as an isize so it fits in an atomic.
static HOOK: AtomicIsize = AtomicIsize::new(0);
/// Count of swallowed keystrokes, drained by the caller for the audit trail.
static BLOCKED_COUNT: AtomicU64 = AtomicU64::new(0);
/// Set once, so repeated engage calls don't stack up hook threads.
static INSTALLED: OnceLock<bool> = OnceLock::new();

fn key_down(vk: i32) -> bool {
    // High bit set means currently held.
    (unsafe { GetAsyncKeyState(vk) } as u16 & 0x8000) != 0
}

/// Decide whether this keystroke is an escape attempt we should swallow.
fn should_block(vk: u32) -> bool {
    let alt = key_down(VK_MENU.0 as i32);
    let ctrl = key_down(VK_CONTROL.0 as i32);
    let shift = key_down(VK_SHIFT.0 as i32);

    match vk {
        // Either Windows key, alone or as part of any Win+X combination.
        v if v == VK_LWIN.0 as u32 || v == VK_RWIN.0 as u32 => true,
        // Alt+Tab / Alt+Shift+Tab - the app switcher.
        v if v == VK_TAB.0 as u32 && alt => true,
        // Ctrl+Esc opens Start; Alt+Esc cycles windows;
        // Ctrl+Shift+Esc opens Task Manager.
        v if v == VK_ESCAPE.0 as u32 && (ctrl || alt) => true,
        // Alt+F4 closes the window out from under the exam.
        v if v == VK_F4.0 as u32 && alt => true,
        // F11 would toggle the webview out of fullscreen.
        v if v == VK_F11.0 as u32 => true,
        _ => {
            let _ = shift;
            false
        }
    }
}

/// The hook callback. Must stay fast and allocation-free: Windows removes hooks
/// that exceed `LowLevelHooksTimeout`, which would silently disable lockdown.
unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && ACTIVE.load(Ordering::Relaxed) {
        let msg = wparam.0 as u32;
        if msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN {
            let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            if should_block(info.vkCode) {
                BLOCKED_COUNT.fetch_add(1, Ordering::Relaxed);
                // Returning non-zero swallows the keystroke entirely - the
                // shell never sees it.
                return LRESULT(1);
            }
        }
    }

    CallNextHookEx(Some(HHOOK(HOOK.load(Ordering::Relaxed) as *mut _)), code, wparam, lparam)
}

/// Install the hook on a dedicated thread with a message pump, and block there
/// for the life of the process. Returns whether installation succeeded.
fn install_hook() -> bool {
    let (tx, rx): (Sender<bool>, _) = mpsc::channel();

    std::thread::Builder::new()
        .name("kiosk-keyboard-hook".into())
        .spawn(move || {
            // Module handle may be null for WH_KEYBOARD_LL; the hook is global
            // but the callback runs in this process.
            let hook = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), None, 0) };

            match hook {
                Ok(h) => {
                    HOOK.store(h.0 as isize, Ordering::SeqCst);
                    let _ = tx.send(true);

                    // A low-level hook only fires while its installing thread
                    // pumps messages, so this loop is load-bearing.
                    let mut msg = MSG::default();
                    while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {
                        unsafe { DispatchMessageW(&msg) };
                    }

                    let _ = unsafe { UnhookWindowsHookEx(h) };
                }
                Err(_) => {
                    let _ = tx.send(false);
                }
            }
        })
        .ok();

    // Don't let a wedged hook thread stall app startup.
    rx.recv_timeout(std::time::Duration::from_secs(2))
        .unwrap_or(false)
}

/// Number of keystrokes swallowed since the last call, for the audit trail.
pub fn take_blocked_count() -> u64 {
    BLOCKED_COUNT.swap(0, Ordering::Relaxed)
}

pub fn prepare<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    let _ = window.set_fullscreen(true);
    let _ = window.set_skip_taskbar(true);
    true
}

pub fn engage<R: Runtime>(window: &WebviewWindow<R>, report: &mut LockdownReport) {
    let _ = prepare(window);

    let installed = *INSTALLED.get_or_init(install_hook);
    ACTIVE.store(installed, Ordering::SeqCst);

    if installed {
        report.engaged("Windows key blocked");
        report.engaged("Alt+Tab / Alt+Esc app switching blocked");
        report.engaged("Ctrl+Esc Start menu blocked");
        report.engaged("Ctrl+Shift+Esc Task Manager blocked");
        report.engaged("Alt+F4 blocked");
        report.engaged("taskbar hidden");
    } else {
        report.failed("keyboard hook failed to install - Alt+Tab and the Windows key work");
    }

    // Say the quiet part out loud, on every machine, every time.
    report.unavailable("Ctrl+Alt+Del (kernel-protected; use Assigned Access to restrict further)");
}

pub fn reassert<R: Runtime>(_window: &WebviewWindow<R>) {
    // The hook survives focus changes on its own; nothing to re-apply.
    ACTIVE.store(*INSTALLED.get().unwrap_or(&false), Ordering::SeqCst);
}

pub fn force_foreground<R: Runtime>(window: &WebviewWindow<R>) {
    if let Ok(handle) = window.hwnd() {
        // Best-effort: Windows refuses foreground steals from a background
        // process in some cases, which is why the focus-loss event is logged
        // regardless of whether this succeeds.
        let _ = unsafe { SetForegroundWindow(HWND(handle.0 as *mut _)) };
    }
}

pub fn release<R: Runtime>(window: &WebviewWindow<R>) {
    ACTIVE.store(false, Ordering::SeqCst);
    let _ = window.set_skip_taskbar(false);
    let _ = window.set_fullscreen(false);
}
