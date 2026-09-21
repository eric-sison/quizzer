/**
 * The only channel this app has to the outside world.
 *
 * There is no `fetch` anywhere in the frontend and the CSP forbids one: every
 * byte that reaches the exam backend goes through these commands, which run in
 * the Rust process holding the session credential.
 */

import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

import type {
  AnswerValue,
  AppError,
  LinkInfo,
  LinkPreview,
  LockdownReport,
  Receipt,
  SessionSnapshot,
  StartPayload,
  StrikePayload,
} from "./types"

/** Offline sanity-check of a pasted link. Never touches the network. */
export function validateLink(raw: string): Promise<LinkInfo> {
  return invoke<LinkInfo>("validate_link", { raw })
}

/**
 * Fetch a valid link's exam configuration (time limit, backtracking, shuffle,
 * question count) without claiming a session. Rust validates the link offline
 * before anything is sent.
 */
export function previewLink(raw: string): Promise<LinkPreview> {
  return invoke<LinkPreview>("preview_link", { raw })
}

/** Claim the session and enter lockdown. */
export function startSession(raw: string): Promise<StartPayload> {
  return invoke<StartPayload>("start_session", { raw })
}

/** Relay one answer. The server's copy is authoritative. */
export function saveAnswer(
  questionId: string,
  value: AnswerValue
): Promise<void> {
  return invoke<void>("save_answer", { questionId, value })
}

/** Idempotent: calling twice replays the same receipt. */
export function submitExam(): Promise<Receipt> {
  return invoke<Receipt>("submit_exam")
}

export function getSessionState(): Promise<SessionSnapshot> {
  return invoke<SessionSnapshot>("get_session_state")
}

export function getLockdownReport(): Promise<LockdownReport> {
  return invoke<LockdownReport>("get_lockdown_report")
}

/** Refused by Rust while an exam is active. */
export function quitApp(): Promise<void> {
  return invoke<void>("quit_app")
}

/**
 * Report something the UI noticed. Advisory only - Rust does not trust these,
 * it merely records them alongside its own observations.
 */
export function reportEvent(kind: string, detail?: string): void {
  void invoke<void>("report_event", { kind, detail: detail ?? null }).catch(
    () => {
      // A failed audit report must never interrupt the exam.
    }
  )
}

/**
 * Bridge for `guard.js`, which is injected before the bundle loads and so
 * cannot import from here.
 */
declare global {
  interface Window {
    __QUIZZER_REPORT__?: (kind: string, detail?: string) => void
  }
}

export function installGuardBridge(): void {
  window.__QUIZZER_REPORT__ = reportEvent
}

// --- events emitted by Rust -------------------------------------------------

export const EXAM_EVENT = {
  strike: "exam://strike",
  submitted: "exam://submitted",
  timeUp: "exam://time-up",
  lockdown: "exam://lockdown",
  revoked: "exam://revoked",
} as const

export function onStrike(
  handler: (payload: StrikePayload) => void
): Promise<UnlistenFn> {
  return listen<StrikePayload>(EXAM_EVENT.strike, (e) => handler(e.payload))
}

export function onSubmitted(
  handler: (receipt: Receipt) => void
): Promise<UnlistenFn> {
  return listen<Receipt>(EXAM_EVENT.submitted, (e) => handler(e.payload))
}

export function onTimeUp(handler: () => void): Promise<UnlistenFn> {
  return listen(EXAM_EVENT.timeUp, () => handler())
}

export function onLockdown(
  handler: (report: LockdownReport) => void
): Promise<UnlistenFn> {
  return listen<LockdownReport>(EXAM_EVENT.lockdown, (e) => handler(e.payload))
}

/** The proctor revoked the link mid-exam; Rust has already ended the session. */
export function onRevoked(
  handler: (error: AppError) => void
): Promise<UnlistenFn> {
  return listen<AppError>(EXAM_EVENT.revoked, (e) => handler(e.payload))
}
