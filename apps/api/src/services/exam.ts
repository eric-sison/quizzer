/**
 * The exam surface: everything a student's client does between pasting a link
 * and getting a receipt.
 *
 * The rule running through this file is that the client is not a security
 * boundary. It mirrors the deadline to draw a countdown, it numbers its own
 * answers, it timestamps its own proctor events, and none of that is trusted.
 * The server re-checks the clock on every write, keeps its own event times, and
 * decides what a session may still do.
 */
import { randomUUID } from "node:crypto"

import type {
  AnswerValue,
  HeartbeatResponse,
  ProctorEventPayload,
  Receipt,
  StartSessionResponse,
} from "@workspace/quiz-core"
import { and, eq, isNull, lt, sql } from "drizzle-orm"

import { db } from "../db"
import {
  examAnswers,
  examLinks,
  examSessions,
  proctorEvents,
  quizVersions,
  quizzes,
} from "../db/schema"
import { ApiError } from "../lib/errors"
import { epochSeconds, signExamToken } from "../lib/exam-token"
import type { ExamSessionContext } from "../lib/hono"

/**
 * Claim a session from a pasted link.
 *
 * Unauthenticated by necessity: this call is how a client gets its credential.
 * The token is the only thing standing in front of it, which is why it is 192
 * bits of randomness and why nothing here reveals whether a given token exists
 * beyond the one code it returns.
 */
export async function startSession(
  token: string,
  clientVersion: string,
  platform: string
): Promise<StartSessionResponse> {
  const [link] = await db
    .select({
      token: examLinks.token,
      opensAt: examLinks.opensAt,
      closesAt: examLinks.closesAt,
      revokedAt: examLinks.revokedAt,
      activeVersionId: quizzes.activeVersionId,
    })
    .from(examLinks)
    .innerJoin(quizzes, eq(examLinks.quizId, quizzes.id))
    .where(and(eq(examLinks.token, token), isNull(quizzes.archivedAt)))
    .limit(1)

  if (!link || !link.activeVersionId) {
    throw new ApiError("invalid_token", 404, "This link does not work.")
  }
  if (link.revokedAt) {
    throw new ApiError("revoked", 403, "This exam was closed by your teacher.")
  }

  const now = new Date()
  if (link.opensAt && link.opensAt.getTime() > now.getTime()) {
    throw new ApiError("not_yet_open", 403, "This exam has not opened yet.")
  }
  if (link.closesAt && link.closesAt.getTime() <= now.getTime()) {
    throw new ApiError("expired", 410, "This exam has closed.")
  }

  // Read the manifest from the version, not by projecting the draft. The draft
  // may have moved on since publishing, and a student must never see it.
  const [version] = await db
    .select({ id: quizVersions.id, manifest: quizVersions.manifest })
    .from(quizVersions)
    .where(eq(quizVersions.id, link.activeVersionId))
    .limit(1)

  if (!version) {
    throw new ApiError("invalid_token", 404, "This link does not work.")
  }

  const expiresAt = new Date(now.getTime() + version.manifest.duration_s * 1_000)

  // `versionId` is written once, here, and never updated. This one column is
  // what guarantees a student who started on v1 finishes on v1 even if their
  // teacher republishes mid-exam.
  const [session] = await db
    .insert(examSessions)
    .values({
      token: link.token,
      versionId: version.id,
      expiresAt,
      clientVersion,
      platform,
      lastSeenAt: now,
    })
    .returning({ id: examSessions.id })

  if (!session) throw new Error("session insert returned no row")

  return {
    session_jwt: await signExamToken(session.id, expiresAt),
    exam: version.manifest,
    server_time: epochSeconds(now),
    expires_at: epochSeconds(expiresAt),
  }
}

/**
 * Record one answer.
 *
 * `client_seq` exists because a retry can arrive after the answer that replaced
 * it: the student types "7", the request stalls, they change it to "9", the
 * retry of "7" lands last. Keeping the highest sequence is what stops the
 * network deciding their answer.
 */
export async function saveAnswer(
  session: ExamSessionContext,
  questionId: string,
  value: AnswerValue,
  clientSeq: number
): Promise<{ stored: boolean }> {
  // An answer to a question that is not on this student's paper is either a
  // bug or someone probing, and either way it should not become a row.
  const known = session.manifest.questions.some((q) => q.id === questionId)
  if (!known) {
    throw new ApiError("invalid_token", 404, "No such question in this exam.")
  }

  const updated = await db
    .insert(examAnswers)
    .values({ sessionId: session.id, questionId, value, clientSeq })
    .onConflictDoUpdate({
      target: [examAnswers.sessionId, examAnswers.questionId],
      set: { value, clientSeq, updatedAt: new Date() },
      // Only if this one is newer than what is already stored.
      setWhere: lt(examAnswers.clientSeq, clientSeq),
    })
    .returning({ questionId: examAnswers.questionId })

  return { stored: updated.length > 0 }
}

/**
 * Keep-alive, and the channel the client learns bad news on.
 *
 * Answers for an expired or revoked session are refused, but the heartbeat
 * still answers: it is how a client that has been running offline finds out
 * that it is over.
 */
export async function heartbeat(session: ExamSessionContext): Promise<HeartbeatResponse> {
  await db
    .update(examSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(examSessions.id, session.id))

  return {
    expires_at: epochSeconds(session.expiresAt),
    server_time: epochSeconds(),
    revoked: session.sessionRevokedAt !== null || session.linkRevokedAt !== null,
  }
}

/**
 * Append proctor events.
 *
 * Each row carries the client's timestamp and the server's. The client's is
 * advisory: a student who moves the system clock changes `at_client` and
 * nothing else. `seq` is unique per session, so a retried batch is absorbed
 * rather than duplicated, and a gap in the sequence tells a teacher the client
 * dropped events rather than that nothing happened.
 */
export async function recordEvents(
  session: ExamSessionContext,
  events: ProctorEventPayload[]
): Promise<{ accepted: number }> {
  if (events.length === 0) return { accepted: 0 }

  const rows = await db
    .insert(proctorEvents)
    .values(
      events.map((event) => ({
        sessionId: session.id,
        seq: event.seq,
        kind: event.kind,
        atClient: event.at,
        detail: event.detail ?? null,
      }))
    )
    .onConflictDoNothing({
      target: [proctorEvents.sessionId, proctorEvents.seq],
    })
    .returning({ id: proctorEvents.id })

  // Focus strikes are what a teacher actually looks at, so keep a running count
  // on the session rather than making every read aggregate the event table.
  const strikes = events.filter((e) => e.kind === "focus_lost").length
  if (strikes > 0) {
    await db
      .update(examSessions)
      .set({ strikes: sql`${examSessions.strikes} + ${strikes}` })
      .where(eq(examSessions.id, session.id))
  }

  return { accepted: rows.length }
}

/**
 * Finish the exam.
 *
 * Idempotent on `idempotency_key`: a client that submits, loses the response
 * and retries gets the same receipt rather than a second submission or a
 * refusal. A retry with a *different* key after submitting is a different
 * matter, and is refused.
 */
export async function submit(
  session: ExamSessionContext,
  idempotencyKey: string
): Promise<Receipt> {
  if (session.submittedAt && session.receiptId) {
    if (session.idempotencyKey === idempotencyKey) {
      return receiptFor(session, session.receiptId, session.submittedAt)
    }
    throw new ApiError("already_submitted", 409, "This exam was already submitted.")
  }

  const now = new Date()
  const receiptId = randomUUID()

  // Conditional on still being unsubmitted, so two submissions racing each
  // other cannot both write a receipt.
  const [row] = await db
    .update(examSessions)
    .set({ submittedAt: now, receiptId, idempotencyKey })
    .where(and(eq(examSessions.id, session.id), isNull(examSessions.submittedAt)))
    .returning({
      receiptId: examSessions.receiptId,
      submittedAt: examSessions.submittedAt,
    })

  if (row?.receiptId && row.submittedAt) {
    return receiptFor(session, row.receiptId, row.submittedAt)
  }

  // Someone else won the race. Replay theirs if it was the same attempt.
  const [current] = await db
    .select({
      receiptId: examSessions.receiptId,
      submittedAt: examSessions.submittedAt,
      idempotencyKey: examSessions.idempotencyKey,
    })
    .from(examSessions)
    .where(eq(examSessions.id, session.id))
    .limit(1)

  if (
    current?.receiptId &&
    current.submittedAt &&
    current.idempotencyKey === idempotencyKey
  ) {
    return receiptFor(session, current.receiptId, current.submittedAt)
  }

  throw new ApiError("already_submitted", 409, "This exam was already submitted.")
}

function receiptFor(
  session: ExamSessionContext,
  receiptId: string,
  submittedAt: Date
): Receipt {
  return {
    receipt_id: receiptId,
    submitted_at: epochSeconds(submittedAt),
    question_count: session.manifest.questions.length,
  }
}
