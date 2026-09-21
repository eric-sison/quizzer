/**
 * Authenticates an exam session and loads its row.
 *
 * Every check here is one the client cannot be trusted to make. The desktop
 * mirrors `expires_at` to drive a countdown, but the deadline that counts is
 * this one, measured against the server clock on every request.
 */
import { createMiddleware } from "hono/factory"
import { eq } from "drizzle-orm"

import { db } from "../db"
import { examLinks, examSessions, quizVersions } from "../db/schema"
import { ApiError } from "../lib/errors"
import { readExamToken } from "../lib/exam-token"
import type { ExamEnv } from "../lib/hono"

const expired = () => new ApiError("expired", 410, "This exam has ended.")
const revoked = () => new ApiError("revoked", 403, "This exam was closed by your teacher.")
const invalidToken = () => new ApiError("invalid_token", 401, "This session is not valid.")

export const requireExamSession = createMiddleware<ExamEnv>(async (c, next) => {
  const header = c.req.header("Authorization") ?? ""
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : ""
  if (!token) throw invalidToken()

  const sessionId = await readExamToken(token)
  if (!sessionId) throw invalidToken()

  const [row] = await db
    .select({
      id: examSessions.id,
      token: examSessions.token,
      versionId: examSessions.versionId,
      expiresAt: examSessions.expiresAt,
      submittedAt: examSessions.submittedAt,
      receiptId: examSessions.receiptId,
      idempotencyKey: examSessions.idempotencyKey,
      sessionRevokedAt: examSessions.revokedAt,
      linkRevokedAt: examLinks.revokedAt,
      manifest: quizVersions.manifest,
    })
    .from(examSessions)
    .innerJoin(examLinks, eq(examSessions.token, examLinks.token))
    .innerJoin(quizVersions, eq(examSessions.versionId, quizVersions.id))
    .where(eq(examSessions.id, sessionId))
    .limit(1)

  // A signed token for a session that no longer exists is not an expiry and
  // not a revocation; it is a token we cannot place.
  if (!row) throw invalidToken()

  if (row.sessionRevokedAt || row.linkRevokedAt) throw revoked()

  c.set("session", row)
  await next()
})

/**
 * Refuses a session that is over.
 *
 * Separate from the middleware above because heartbeat must still answer for an
 * expired session: that is how the client learns it is over and auto-submits.
 */
export function assertWritable(session: { expiresAt: Date; submittedAt: Date | null }): void {
  if (session.submittedAt) {
    throw new ApiError("already_submitted", 409, "This exam was already submitted.")
  }
  if (session.expiresAt.getTime() <= Date.now()) throw expired()
}

/** Kept beside the checks they pair with. */
export { expired, revoked, invalidToken }
