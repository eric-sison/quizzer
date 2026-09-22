import * as React from "react"

import { toggleProctorUnlock } from "@/lib/ipc"

/**
 * The invigilator's chord: Cmd+Shift+X on macOS, Ctrl+Shift+X elsewhere.
 *
 * Deliberately undocumented in the UI, and deliberately not a secret that does
 * any security work. It is typed into the exam window, so anyone who sees it
 * used has it; what keeps it honest is on the other side, in Rust, where every
 * release and restore is written to the proctor log and the student's own
 * screen is made to say that exam mode is off.
 *
 * Not in `guard.js` with the blocked shortcuts: that file's job is to swallow
 * keystrokes, and a list there of what to swallow is also a list of what is
 * interesting.
 */
export function useProctorUnlock(active: boolean): void {
  React.useEffect(() => {
    if (!active) return

    function onKeyDown(event: KeyboardEvent) {
      // `metaKey` covers macOS, `ctrlKey` Windows and Linux. Accepting either
      // on either platform costs nothing and spares the student's machine
      // being the thing that decides whether an invigilator can help them.
      const chord =
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "x"

      if (!chord) return

      event.preventDefault()
      event.stopPropagation()
      // The result reaches the UI through the lockdown event Rust emits, so
      // there is nothing to do with the promise but ignore a refusal.
      void toggleProctorUnlock().catch(() => {})
    }

    // Capture, so a focused input cannot eat it.
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [active])
}
