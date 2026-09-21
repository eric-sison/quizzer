// Injected before any page script runs.
//
// This is the weakest layer of the lockdown and is treated as such: anything
// here is reachable from the devtools console on a build that has them. It
// exists to stop the incidental route out - a right-click, a stray F12, a
// dragged file - not the determined one. The measures that actually hold are
// in the Rust layer and in the OS.
(() => {
  "use strict";

  const swallow = (event) => {
    event.preventDefault();
    event.stopPropagation();
    return false;
  };

  // Right-click menu: on Windows WebView2 this is the route to "Inspect".
  window.addEventListener("contextmenu", swallow, { capture: true });

  // Text selection and drag are disabled globally; the exam UI re-enables
  // selection on inputs and textareas via CSS so answering still works.
  window.addEventListener("selectstart", (e) => {
    const el = e.target;
    const editable =
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable);
    if (!editable) swallow(e);
  }, { capture: true });

  window.addEventListener("dragstart", swallow, { capture: true });
  window.addEventListener("drop", swallow, { capture: true });
  window.addEventListener("dragover", swallow, { capture: true });

  // Keystrokes that open a debugging or escape surface inside the webview.
  // The OS-level keys (Alt+Tab, Cmd+Tab, the Windows key) are NOT handled here
  // - the webview never sees them; that is the platform layer's job.
  const BLOCKED = [
    { key: "F12" },
    { key: "F11" },
    { key: "F5" },
    { key: "I", ctrl: true, shift: true },
    { key: "J", ctrl: true, shift: true },
    { key: "C", ctrl: true, shift: true },
    { key: "U", ctrl: true },
    { key: "P", ctrl: true },
    { key: "S", ctrl: true },
    { key: "R", ctrl: true },
    { key: "F", ctrl: true },
    { key: "I", meta: true, alt: true },  // macOS devtools
    { key: "J", meta: true, alt: true },
    { key: "C", meta: true, alt: true },
    { key: "U", meta: true, alt: true },
    { key: "P", meta: true },
    { key: "S", meta: true },
    { key: "R", meta: true },
    { key: "F", meta: true },
  ];

  const matches = (e, rule) =>
    e.key.toLowerCase() === rule.key.toLowerCase() &&
    Boolean(rule.ctrl) === e.ctrlKey &&
    Boolean(rule.shift) === e.shiftKey &&
    Boolean(rule.meta) === e.metaKey &&
    Boolean(rule.alt) === e.altKey;

  window.addEventListener(
    "keydown",
    (e) => {
      const rule = BLOCKED.find((r) => matches(e, r));
      if (!rule) return;
      swallow(e);
      // Report through the same IPC surface everything else uses. Best-effort:
      // if the bridge isn't up yet, the Rust-side signals still cover us.
      try {
        window.__QUIZZER_REPORT__?.("blocked_shortcut", describe(e));
      } catch {
        /* nothing useful to do here */
      }
    },
    { capture: true }
  );

  const describe = (e) =>
    [e.ctrlKey && "Ctrl", e.metaKey && "Cmd", e.altKey && "Alt", e.shiftKey && "Shift", e.key]
      .filter(Boolean)
      .join("+");

  // Nothing in an exam should ever open a new window or navigate away; the
  // Rust navigation handler blocks it too, but failing here is quieter and
  // keeps the audit log cleaner.
  window.open = () => null;

  // Print-to-PDF is an exfiltration route for the question paper.
  window.print = () => undefined;
})();
