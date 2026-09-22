import type { ExamManifest } from "@workspace/quiz-core"

import type { TeacherRow } from "../db/schema"

/** Context values set by middleware and read by route handlers. */
export type AppEnv = {
  Variables: {
    teacher: TeacherRow
    /** Set by requireAdmin. Only the admin routes read it. */
    admin: {
      userId: string
      email: string
      institutionId: string
    }
  }
}

/** The signed-in identity claiming an exam session. Set by requireStudent. */
export type StudentContext = {
  userId: string
  email: string
  name: string
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
    /** Present only on the claim route, set by requireStudent. */
    student: StudentContext
  }
}
