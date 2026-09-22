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
  AuthSnapshot,
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

/** Claim the session and enter lockdown. Requires a signed-in student. */
export function startSession(raw: string): Promise<StartPayload> {
  return invoke<StartPayload>("start_session", { raw })
}

// --- student sign-in (device flow) -------------------------------------------

/**
 * Start a device-flow sign-in. Resolves with the pending snapshot - the code
 * to show - and the outcome arrives later on `auth://status`, because the
 * waiting happens on a Rust task's clock, not this call's.
 */
export function beginSignIn(): Promise<AuthSnapshot> {
  return invoke<AuthSnapshot>("begin_sign_in")
}

/** Abandon a pending sign-in. Safe to call when there isn't one. */
export function cancelSignIn(): Promise<AuthSnapshot> {
  return invoke<AuthSnapshot>("cancel_sign_in")
}

export function getAuthState(): Promise<AuthSnapshot> {
  return invoke<AuthSnapshot>("get_auth_state")
}

/** Refused by Rust while an exam is active - the sitting is bound to them. */
export function signOut(): Promise<AuthSnapshot> {
  return invoke<AuthSnapshot>("sign_out")
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

/**
 * Suspend or restore lockdown at an invigilator's request. Resolves with the
 * state lockdown was left in: true for released.
 *
 * Rejects when no exam is running, so the chord that reaches this gives
 * nothing away to someone trying keystrokes on the link-entry screen.
 */
export function toggleProctorUnlock(): Promise<boolean> {
  return invoke<boolean>("toggle_proctor_unlock")
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

export const AUTH_EVENT = {
  status: "auth://status",
} as const

/**
 * Sign-in state changed on the Rust side. The case the frontend cannot see
 * coming any other way is the poll task resolving - approval, expiry, denial.
 */
export function onAuthStatus(
  handler: (snapshot: AuthSnapshot) => void
): Promise<UnlistenFn> {
  return listen<AuthSnapshot>(AUTH_EVENT.status, (e) => handler(e.payload))
}

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
