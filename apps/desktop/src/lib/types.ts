/**
 * Mirrors the Rust contract in `src-tauri/src/session.rs` and
 * `src-tauri/src/commands.rs`.
 *
 * Note what is absent: there is no correct-answer field anywhere in these
 * types, because the backend never sends one. Grading happens server-side.
 */

/**
 * The manifest comes straight from @workspace/quiz-core, which is the
 * TypeScript source of truth the Rust structs mirror by hand. Redeclaring it
 * here would give the webview a third copy to drift from.
 *
 * `Question["kind"]` therefore does not include the `unsupported` variant Rust
 * degrades unknown kinds to; quiz-ui renders any kind it does not recognise as
 * a plain notice, which covers the same case without widening the shared type.
 */
export type {
  ExamManifest,
  ManifestChoice as Choice,
  ManifestQuestion as Question,
  QuestionKind,
} from "@workspace/quiz-core"

export type Receipt = {
  receipt_id: string
  submitted_at: number
  question_count: number
}

export type Phase = "idle" | "active" | "submitted"

/** An answer value: a choice id, a list of them, or free text. */
export type { AnswerValue } from "@workspace/quiz-core"

export type SessionSnapshot = {
  phase: Phase
  manifest: import("@workspace/quiz-core").ExamManifest | null
  answers: Record<string, import("@workspace/quiz-core").AnswerValue>
  /** `image_id` → data URI, fetched by Rust; the webview has no network. */
  images: Record<string, string>
  remaining_s: number
  strikes: number
  receipt: Receipt | null
}

export type LinkInfo = {
  host: string
  token_preview: string
}

/** The exam's configuration, fetched before any session is claimed. */
export type LinkPreview = {
  host: string
  token_preview: string
  exam: {
    title: string
    description?: string
    duration_s: number
    allow_backtracking: boolean
    shuffle_questions: boolean
    question_count: number
    /**
     * Epoch seconds. Present only while the link is still shut, so its
     * absence, not a comparison against this machine's clock, is what says
     * the exam may be started.
     */
    opens_at?: number
    /** The server's clock when it answered, to measure the wait against. */
    server_time?: number
  }
}

export type LockdownReport = {
  engaged: string[]
  /** Not in force: inherent platform limits *and* anything that failed. */
  unavailable: string[]
  /** A measure that was expected to apply didn't. Inherent limits don't set this. */
  degraded: boolean
  bypassed: boolean
  /** An invigilator deliberately suspended lockdown for this sitting. */
  released: boolean
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
