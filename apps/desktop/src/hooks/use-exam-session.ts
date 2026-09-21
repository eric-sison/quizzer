/**
 * Owns the app's phase machine and keeps it in step with the Rust session.
 *
 * Every mutation here is an echo of something Rust already did - answers are
 * only mirrored locally after the server accepted them, and the countdown is
 * re-synced from the Rust snapshot rather than being driven purely by a local
 * timer, so fiddling with the system clock doesn't move the deadline.
 */

import * as React from "react"

import {
  getSessionState,
  onLockdown,
  onStrike,
  onSubmitted,
  onTimeUp,
  saveAnswer,
  startSession,
  submitExam,
} from "@/lib/ipc"
import {
  toAppError,
  type AnswerValue,
  type AppError,
  type LockdownReport,
  type SessionSnapshot,
} from "@/lib/types"

export type Screen = "link-entry" | "starting" | "exam" | "submitted" | "error"

type State = {
  screen: Screen
  snapshot: SessionSnapshot | null
  lockdown: LockdownReport | null
  error: AppError | null
  strikes: number
  strikeNotice: string | null
  remaining: number
  submitting: boolean
  /** Questions whose last save failed, so the UI can flag them. */
  unsaved: Set<string>
}

const INITIAL: State = {
  screen: "link-entry",
  snapshot: null,
  lockdown: null,
  error: null,
  strikes: 0,
  strikeNotice: null,
  remaining: 0,
  submitting: false,
  unsaved: new Set(),
}

export function useExamSession() {
  const [state, setState] = React.useState<State>(INITIAL)

  // Keep a ref so event handlers registered once can still read fresh state
  // without re-subscribing on every render.
  const screenRef = React.useRef(state.screen)
  screenRef.current = state.screen

  // --- begin ---------------------------------------------------------------

  const begin = React.useCallback(async (link: string) => {
    setState((s) => ({ ...s, screen: "starting", error: null }))

    try {
      const { snapshot, lockdown } = await startSession(link)
      setState((s) => ({
        ...s,
        screen: "exam",
        snapshot,
        lockdown,
        remaining: snapshot.remaining_s,
        strikes: snapshot.strikes,
        error: null,
      }))
    } catch (raw) {
      const error = toAppError(raw)
      setState((s) => ({
        ...s,
        // A bad link isn't a dead end - send the student back to the field so
        // they can paste a corrected one. Everything else needs a teacher.
        screen:
          error.code === "invalid_link" || error.code === "untrusted_host"
            ? "link-entry"
            : "error",
        error,
      }))
    }
  }, [])

  const dismissError = React.useCallback(() => {
    setState((s) => ({ ...s, error: null, screen: "link-entry" }))
  }, [])

  // --- answering -----------------------------------------------------------

  const answer = React.useCallback(
    async (questionId: string, value: AnswerValue) => {
      // Optimistic: the input stays responsive while the save is in flight.
      setState((s) => ({
        ...s,
        snapshot: s.snapshot
          ? { ...s.snapshot, answers: { ...s.snapshot.answers, [questionId]: value } }
          : s.snapshot,
      }))

      try {
        await saveAnswer(questionId, value)
        setState((s) => {
          if (!s.unsaved.has(questionId)) return s
          const unsaved = new Set(s.unsaved)
          unsaved.delete(questionId)
          return { ...s, unsaved }
        })
      } catch (raw) {
        const error = toAppError(raw)

        // The session ending mid-answer is not a save failure - it's a change
        // of phase, and the student needs the corresponding screen.
        if (error.code === "expired" || error.code === "already_submitted") {
          setState((s) => ({ ...s, screen: "error", error }))
          return
        }

        setState((s) => ({ ...s, unsaved: new Set(s.unsaved).add(questionId) }))
      }
    },
    []
  )

  // --- submitting ----------------------------------------------------------

  const submit = React.useCallback(async () => {
    setState((s) => ({ ...s, submitting: true }))
    try {
      const receipt = await submitExam()
      setState((s) => ({
        ...s,
        screen: "submitted",
        submitting: false,
        snapshot: s.snapshot ? { ...s.snapshot, receipt, phase: "submitted" } : s.snapshot,
      }))
    } catch (raw) {
      const error = toAppError(raw)
      setState((s) => ({ ...s, submitting: false, screen: "error", error }))
    }
  }, [])

  // --- countdown -----------------------------------------------------------

  React.useEffect(() => {
    if (state.screen !== "exam") return

    const tick = window.setInterval(() => {
      setState((s) => ({ ...s, remaining: Math.max(0, s.remaining - 1) }))
    }, 1000)

    // Re-sync against Rust periodically. The local tick is only for a smooth
    // display; this is what keeps it honest across sleep, drift and any
    // deadline change a proctor makes.
    const resync = window.setInterval(async () => {
      try {
        const snapshot = await getSessionState()
        setState((s) => ({
          ...s,
          snapshot,
          remaining: snapshot.remaining_s,
          strikes: snapshot.strikes,
        }))
      } catch {
        // Transient; the next tick will try again.
      }
    }, 15_000)

    return () => {
      window.clearInterval(tick)
      window.clearInterval(resync)
    }
  }, [state.screen])

  // --- Rust-emitted events -------------------------------------------------

  React.useEffect(() => {
    const unlisteners: Array<() => void> = []
    let cancelled = false

    const track = (p: Promise<() => void>) => {
      void p.then((un) => {
        if (cancelled) un()
        else unlisteners.push(un)
      })
    }

    track(
      onStrike((payload) => {
        setState((s) => ({
          ...s,
          strikes: payload.strikes,
          strikeNotice: payload.reason,
        }))
      })
    )

    track(
      onSubmitted((receipt) => {
        // Rust submitted on our behalf (deadline reached). Follow it.
        setState((s) => ({
          ...s,
          screen: "submitted",
          submitting: false,
          snapshot: s.snapshot
            ? { ...s.snapshot, receipt, phase: "submitted" }
            : s.snapshot,
        }))
      })
    )

    track(onTimeUp(() => setState((s) => ({ ...s, remaining: 0 }))))

    track(onLockdown((lockdown) => setState((s) => ({ ...s, lockdown }))))

    return () => {
      cancelled = true
      unlisteners.forEach((un) => un())
    }
  }, [])

  const dismissStrikeNotice = React.useCallback(() => {
    setState((s) => ({ ...s, strikeNotice: null }))
  }, [])

  return { ...state, begin, answer, submit, dismissError, dismissStrikeNotice }
}
