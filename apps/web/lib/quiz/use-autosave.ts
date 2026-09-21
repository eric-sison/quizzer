"use client"

import * as React from "react"
import type { QuizDoc } from "@workspace/quiz-core"

/**
 * Autosave for the quiz editor.
 *
 * The draft now lives behind an HTTP hop to apps/api, which an in-process write
 * never had to think about. Three things follow from that:
 *
 *  - A failed save cannot be silent. The teacher has to see that their work is
 *    not on the server, or they will close the tab believing it is.
 *  - Transient failures retry on their own, with a backoff, so a restarted API
 *    or a dropped connection heals without anyone clicking anything.
 *  - A 409 does not retry. The version moved on somewhere else, and sending the
 *    same body again would either fail forever or overwrite the other edit.
 *
 * The hook keeps the document in a ref and watches it by identity. The reducer
 * returns the same object when nothing changed, so selecting a question or
 * re-emitting an unchanged value does not schedule a save.
 */

export type SaveResult =
  | { ok: true; docVersion: number; savedAt: string }
  | { ok: false; reason: "conflict" | "gone" | "transient"; message: string }

export type SaveStatus =
  /** Everything on screen is on the server. */
  | { kind: "saved"; at: number | null }
  /** Edited, waiting for the debounce to expire. */
  | { kind: "dirty" }
  | { kind: "saving" }
  /** Will retry by itself unless `canRetry`, which means it gave up. */
  | { kind: "failed"; message: string; canRetry: boolean }
  /** Terminal until the teacher reloads. */
  | { kind: "conflict"; message: string }

export const AUTOSAVE_DELAY_MS = 800
// Five attempts total: the initial save plus retries at 1s, 2s, 4s and 8s.
const MAX_AUTO_ATTEMPTS = 5
const BACKOFF_BASE_MS = 1_000
const BACKOFF_CEILING_MS = 20_000

/** 1s, 2s, 4s, 8s, capped. */
export function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_CEILING_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1))
}

export function useAutosave({
  doc,
  docVersion,
  save,
  delayMs = AUTOSAVE_DELAY_MS,
}: {
  doc: QuizDoc
  /** The version the initial `doc` was read at. */
  docVersion: number
  save: (doc: QuizDoc, docVersion: number) => Promise<SaveResult>
  delayMs?: number
}): {
  status: SaveStatus
  /** True while anything on screen is not yet on the server. */
  hasUnsavedChanges: boolean
  /** Save now, resetting the backoff. For the Retry affordance. */
  retryNow: () => void
} {
  const [status, setStatus] = React.useState<SaveStatus>({ kind: "saved", at: null })

  const docRef = React.useRef(doc)
  const savedDocRef = React.useRef(doc)
  const versionRef = React.useRef(docVersion)
  const saveRef = React.useRef(save)
  const attemptRef = React.useRef(0)
  const inFlightRef = React.useRef(false)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const stoppedRef = React.useRef(false)
  // `flush` reschedules itself, and a function cannot reference itself inside
  // its own definition. The indirection is a ref, refreshed below.
  const scheduleRef = React.useRef<(ms: number) => void>(() => {})

  // Refreshed in an effect rather than during render: a render that concurrent
  // React discards must not leave these refs pointing at state that was never
  // committed. Declared first so it runs before the scheduling effect below.
  React.useEffect(() => {
    docRef.current = doc
    saveRef.current = save
  })

  const clearTimer = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const flush = React.useCallback(async () => {
    timerRef.current = null
    if (stoppedRef.current || inFlightRef.current) return

    const pending = docRef.current
    if (pending === savedDocRef.current) {
      setStatus((current) =>
        current.kind === "dirty" || current.kind === "saving"
          ? { kind: "saved", at: Date.now() }
          : current
      )
      return
    }

    inFlightRef.current = true
    setStatus({ kind: "saving" })

    let result: SaveResult
    try {
      result = await saveRef.current(pending, versionRef.current)
    } catch (error) {
      // A Server Action that throws reaches the client as an opaque error, so
      // treat anything unexpected as transient rather than guessing.
      result = {
        ok: false,
        reason: "transient",
        message: error instanceof Error ? error.message : "The save did not go through.",
      }
    } finally {
      inFlightRef.current = false
    }

    if (stoppedRef.current) return

    if (result.ok) {
      versionRef.current = result.docVersion
      savedDocRef.current = pending
      attemptRef.current = 0

      if (docRef.current !== pending) {
        // Edited while that save was in flight. Fold the newer state into the
        // next debounce instead of racing a second request behind the first.
        setStatus({ kind: "dirty" })
        scheduleRef.current(delayMs)
      } else {
        setStatus({ kind: "saved", at: Date.now() })
      }
      return
    }

    if (result.reason === "conflict" || result.reason === "gone") {
      // Retrying cannot help: the version this edit was based on is gone.
      stoppedRef.current = true
      setStatus({ kind: "conflict", message: result.message })
      return
    }

    attemptRef.current += 1
    const willRetry = attemptRef.current < MAX_AUTO_ATTEMPTS
    setStatus({ kind: "failed", message: result.message, canRetry: !willRetry })

    if (willRetry) {
      scheduleRef.current(backoffMs(attemptRef.current))
    }
  }, [delayMs])

  const schedule = React.useCallback(
    (ms: number) => {
      clearTimer()
      timerRef.current = setTimeout(() => void flush(), ms)
    },
    [clearTimer, flush]
  )

  React.useEffect(() => {
    scheduleRef.current = schedule
  })

  // Schedule a save whenever the document changes. `doc` is compared by
  // identity, which is why the reducer is careful to reuse it.
  React.useEffect(() => {
    if (doc === savedDocRef.current || stoppedRef.current) return

    setStatus((current) => (current.kind === "saving" ? current : { kind: "dirty" }))
    schedule(delayMs)
  }, [doc, delayMs, schedule])

  React.useEffect(() => () => clearTimer(), [clearTimer])

  const hasUnsavedChanges = status.kind !== "saved"

  // The browser only honours this from a real user gesture, so it is a warning
  // and not a guarantee. It is still the difference between losing an unsaved
  // question and being asked about it.
  React.useEffect(() => {
    if (!hasUnsavedChanges) return

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [hasUnsavedChanges])

  const retryNow = React.useCallback(() => {
    if (stoppedRef.current) return
    attemptRef.current = 0
    clearTimer()
    void flush()
  }, [clearTimer, flush])


  return { status, hasUnsavedChanges, retryNow }
}
