/**
 * The sign-in state machine, as seen from the webview.
 *
 * Everything here is an echo of the Rust `AuthStore`: the initial state is
 * fetched, every later change arrives on `auth://status`, and the commands
 * below merely ask Rust to move. The one piece of state owned locally is the
 * countdown - `expires_in_s` is a duration, so it is anchored to this
 * machine's clock on arrival and ticked down for display. Rust enforces the
 * real expiry on its own clock; a fiddled system clock changes what the
 * student reads, not what happens.
 */

import * as React from "react"

import {
  beginSignIn as beginSignInIpc,
  cancelSignIn as cancelSignInIpc,
  getAuthState,
  onAuthStatus,
  signOut as signOutIpc,
} from "@/lib/ipc"
import { toAppError, type AppError, type AuthSnapshot } from "@/lib/types"

export type StudentAuth = {
  /** Null only before the first read of Rust's state lands. */
  snapshot: AuthSnapshot | null
  /** Seconds left on a pending code, for display. Null outside `pending`. */
  countdown: number | null
  /** A command that was refused - begin or sign-out. Cleared on the next try. */
  error: AppError | null
  /** A begin/cancel/sign-out call is in flight. */
  busy: boolean
  beginSignIn: () => void
  cancelSignIn: () => void
  signOut: () => void
}

export function useStudentAuth(): StudentAuth {
  const [snapshot, setSnapshot] = React.useState<AuthSnapshot | null>(null)
  const [error, setError] = React.useState<AppError | null>(null)
  const [busy, setBusy] = React.useState(false)

  // Initial state plus the subscription, in one effect so a status event can
  // never be dropped in the gap between the two. If the event wins the race
  // against the initial fetch, the fetch must not clobber it - hence the
  // fetched value only fills an absence.
  React.useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | null = null

    void onAuthStatus((next) => {
      if (!cancelled) setSnapshot(next)
    }).then((un) => {
      if (cancelled) un()
      else unlisten = un
    })

    void getAuthState()
      .then((initial) => {
        if (!cancelled) setSnapshot((current) => current ?? initial)
      })
      .catch(() => {
        // Unreachable IPC means far worse than a missing chip; the next
        // command will surface it.
      })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  const countdown = useCountdown(snapshot)

  const beginSignIn = React.useCallback(() => {
    setError(null)
    setBusy(true)
    beginSignInIpc()
      .then(setSnapshot)
      .catch((raw) => setError(toAppError(raw)))
      .finally(() => setBusy(false))
  }, [])

  const cancelSignIn = React.useCallback(() => {
    setError(null)
    setBusy(true)
    cancelSignInIpc()
      .then(setSnapshot)
      .catch((raw) => setError(toAppError(raw)))
      .finally(() => setBusy(false))
  }, [])

  const signOut = React.useCallback(() => {
    setError(null)
    setBusy(true)
    signOutIpc()
      .then(setSnapshot)
      .catch((raw) => setError(toAppError(raw)))
      .finally(() => setBusy(false))
  }, [])

  return { snapshot, countdown, error, busy, beginSignIn, cancelSignIn, signOut }
}

/**
 * Seconds left on the pending code, or null outside a pending attempt.
 *
 * `expires_in_s` is anchored to `Date.now()` when the snapshot arrives - the
 * same shape as `useOpensIn` on the link-entry screen - so the display only
 * drifts by the ticks, never by the clock being wrong. When it reaches zero
 * the Rust poll task is the one that actually ends the attempt and says so.
 */
function useCountdown(snapshot: AuthSnapshot | null): number | null {
  const pending = snapshot?.status === "pending"
  const expiresIn = pending ? snapshot?.expires_in_s : undefined
  const [seconds, setSeconds] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (expiresIn === undefined) return

    // Reading the clock belongs in an effect; the first tick is scheduled
    // rather than assigned during render for the same reason.
    const deadline = Date.now() + expiresIn * 1_000
    const tick = () =>
      setSeconds(Math.max(0, Math.round((deadline - Date.now()) / 1_000)))

    const first = window.setTimeout(tick, 0)
    const timer = window.setInterval(tick, 1_000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [expiresIn])

  // Gated rather than cleared, so a stale count from an earlier attempt can
  // never be read as this one's.
  return pending ? seconds : null
}
