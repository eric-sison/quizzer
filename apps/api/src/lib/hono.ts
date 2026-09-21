import type { ExamManifest } from "@workspace/quiz-core"

import type { TeacherRow } from "../db/schema"

/** Context values set by middleware and read by route handlers. */
export type AppEnv = {
  Variables: {
    teacher: TeacherRow
  }
}

/** What an authenticated exam request carries. Never a teacher. */
export type ExamSessionContext = {
  id: string
  token: string
  versionId: string
  expiresAt: Date
  submittedAt: Date | null
  receiptId: string | null
  idempotencyKey: string | null
  sessionRevokedAt: Date | null
  linkRevokedAt: Date | null
  /** The version pinned at session start, not whatever is active now. */
  manifest: ExamManifest
}

export type ExamEnv = {
  Variables: {
    session: ExamSessionContext
  }
}
