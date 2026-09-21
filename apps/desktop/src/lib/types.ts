/**
 * Mirrors the Rust contract in `src-tauri/src/session.rs` and
 * `src-tauri/src/commands.rs`.
 *
 * Note what is absent: there is no correct-answer field anywhere in these
 * types, because the backend never sends one. Grading happens server-side.
 */

export type QuestionKind =
  | "single_choice"
  | "multiple_choice"
  | "short_text"
  | "true_false"

export type Choice = {
  id: string
  label: string
}

export type Question = {
  id: string
  kind: QuestionKind
  prompt: string
  choices: Choice[]
  points: number
}

export type ExamManifest = {
  id: string
  title: string
  duration_s: number
  questions: Question[]
  allow_backtracking: boolean
}

export type Receipt = {
  receipt_id: string
  submitted_at: number
  question_count: number
}

export type Phase = "idle" | "active" | "submitted"

/** An answer value: a choice id, a list of them, or free text. */
export type AnswerValue = string | string[]

export type SessionSnapshot = {
  phase: Phase
  manifest: ExamManifest | null
  answers: Record<string, AnswerValue>
  remaining_s: number
  strikes: number
  receipt: Receipt | null
}

export type LinkInfo = {
  host: string
  token_preview: string
}

export type LockdownReport = {
  engaged: string[]
  unavailable: string[]
  bypassed: boolean
}

export type StartPayload = {
  snapshot: SessionSnapshot
  lockdown: LockdownReport
}

export type StrikePayload = {
  strikes: number
  reason: string
  warn: boolean
}

/** Stable discriminants from `AppError::code` on the Rust side. */
export type ErrorCode =
  | "invalid_link"
  | "untrusted_host"
  | "expired"
  | "already_submitted"
  | "not_yet_open"
  | "revoked"
  | "session_conflict"
  | "network_unavailable"
  | "no_session"
  | "server_error"

export type AppError = {
  code: ErrorCode
  message: string
  retryable: boolean
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value
  )
}

/** Normalise anything thrown across the IPC boundary into an AppError. */
export function toAppError(value: unknown): AppError {
  if (isAppError(value)) {
    return value
  }

  return {
    code: "server_error",
    message:
      value instanceof Error
        ? value.message
        : "Something went wrong. Ask your teacher for help.",
    retryable: true,
  }
}
