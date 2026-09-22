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
  onRevoked,
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

/**
 * What ended the sitting. The results screen says so, because "you submitted"
 * and "the clock ran out" are different things to read after an exam, and a
 * student whose time expired needs to know their work went in anyway.
 */
export type EndedBy = "student" | "time_up"

type State = {
  screen: Screen
  snapshot: SessionSnapshot | null
  lockdown: LockdownReport | null
  error: AppError | null
  strikes: number
  strikeNotice: string | null
  remaining: number
  submitting: boolean
  /** Set once the deadline passes, which freezes the exam behind it. */
  timeUp: boolean
  /** When the freeze began, so a submit that never lands can say so. */
  timeUpAt: number | null
  endedBy: EndedBy
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
  timeUp: false,
  timeUpAt: null,
  endedBy: "student",
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
    setState((s) => ({
      ...s,
      screen: "starting",
      error: null,
      timeUp: false,
      timeUpAt: null,
      endedBy: "student",
    }))

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

  /**
   * `submit` is defined below and `answer` needs to call it when the server
   * says time is up. A ref keeps that one-way reference from forcing the two
   * callbacks into a dependency cycle, and from re-creating `answer` - which
   * every question's onChange is bound to - on each render.
   */
  const submitRef = React.useRef<() => Promise<void>>(async () => {})

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

        // The server refuses writes past the deadline. That is not a failure
        // the student should read as one: their exam is over and everything
        // they saved is already on the server, so freeze the paper and let the
        // submit that is already coming take them to their results.
        if (error.code === "expired") {
          setState((s) => ({
            ...s,
            timeUp: true,
            timeUpAt: s.timeUpAt ?? Date.now(),
            endedBy: "time_up",
            remaining: 0,
          }))
          void submitRef.current()
          return
        }

        // The other two are genuine ends-of-session with nothing to submit:
        // one is already in, the other was withdrawn by a teacher.
        if (error.code === "already_submitted" || error.code === "revoked") {
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
      setState((s) => {
        // Past the deadline, Rust is retrying this on its own cadence and will
        // emit `submitted` when it lands. Replacing the frozen paper with a
        // network error would be a dead end shown seconds before it resolves,
        // so stay put and keep saying the answers are going in.
        if (s.timeUp) return { ...s, submitting: false }
        return { ...s, submitting: false, screen: "error", error }
      })
    }
  }, [])

  // Refreshed in an effect rather than during render: `answer` only reads this
  // from an async callback, long after commit, so there is nothing to gain by
  // writing it earlier and a discarded render to lose by it.
  React.useEffect(() => {
    submitRef.current = submit
  }, [submit])

  // --- countdown -----------------------------------------------------------

  React.useEffect(() => {
    if (state.screen !== "exam") return

    const tick = window.setInterval(() => {
      setState((s) => ({ ...s, remaining: Math.max(0, s.remaining - 1) }))
    }, 1000)

    // Re-sync against Rust periodically. The local tick is only for a smooth
    // display; this is what keeps it honest across sleep, drift and any
    // deadline change a proctor makes.
    //
    // It is also the backstop for the results screen. Rust emits `submitted`
    // when the auto-submit lands, but an event is a one-shot: if it fires
    // before this window is listening, or is lost on the way, nothing else
    // would ever move the student off the exam - they would sit at "finishing
    // your exam" forever with a submitted paper. The snapshot carries the
    // phase, so reading it here means the screen cannot disagree with the
    // session for longer than one tick.
    const resync = window.setInterval(async () => {
      try {
        const snapshot = await getSessionState()
        setState((s) => ({
          ...s,
          snapshot,
          remaining: snapshot.remaining_s,
          strikes: snapshot.strikes,
          screen: snapshot.phase === "submitted" ? "submitted" : s.screen,
          submitting: snapshot.phase === "submitted" ? false : s.submitting,
        }))
      } catch {
        // Transient; the next tick will try again.
      }
      // Once the deadline has passed the student is watching a spinner, so
      // check often enough that landing on their results feels immediate.
    }, state.timeUp ? 1_000 : 15_000)

    return () => {
      window.clearInterval(tick)
      window.clearInterval(resync)
    }
  }, [state.screen, state.timeUp])

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

    // Rust reached the deadline. It is submitting on our behalf; this freezes
    // the paper in the meantime so nothing is typed into a form that can no
    // longer be saved.
    track(
      onTimeUp(() =>
        setState((s) => ({
          ...s,
          remaining: 0,
          timeUp: true,
          timeUpAt: s.timeUpAt ?? Date.now(),
          endedBy: "time_up",
        }))
      )
    )

    track(onLockdown((lockdown) => setState((s) => ({ ...s, lockdown }))))

    track(
      onRevoked((error) => {
        // Rust has already released the lockdown and dropped the session;
        // all that is left is telling the student why the exam ended.
        setState((s) => ({ ...s, screen: "error", error }))
      })
    )

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
