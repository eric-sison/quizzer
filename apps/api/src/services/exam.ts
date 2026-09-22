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
  ExamManifest,
  HeartbeatResponse,
  PreviewExamResponse,
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
import type { ExamSessionContext, StudentContext } from "../lib/hono"

/**
 * Token → the active published version, with every way a link can be dead
 * mapped to its own code. Shared by the session claim and the pre-flight
 * preview so the two can never disagree about whether a link works.
 *
 * `allowUnopened` is the single, deliberate exception. A link whose opening
 * time has not come is not dead, it is early, and the preview's whole job is
 * to say so with the details attached. Only the preview passes it, and it
 * widens nothing else: a revoked, expired, archived or unknown link still
 * throws here, and the claim below calls this without it, so the door itself
 * is unchanged.
 */
async function resolveActiveVersion(
  token: string,
  now: Date,
  { allowUnopened = false }: { allowUnopened?: boolean } = {}
): Promise<{
  token: string
  versionId: string
  manifest: ExamManifest
  /** Set only when the link is still shut, and only for a caller that allows it. */
  opensAt: Date | null
}> {
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

  const unopened = Boolean(link.opensAt && link.opensAt.getTime() > now.getTime())
  if (unopened && !allowUnopened) {
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

  return {
    token: link.token,
    versionId: version.id,
    manifest: version.manifest,
    opensAt: unopened ? link.opensAt : null,
  }
}

/**
 * The exam's configuration, for the link-entry screen. Deliberately not the
 * manifest: no questions, no credential, no session row. A student reading
 * this has committed to nothing.
 *
 * Answers for a link that has not opened yet, with `opens_at` set. The
 * alternative was the door shut on a bare "this exam has not opened yet",
 * which tells a student nothing they can act on: not whether they have the
 * right link, not what they are sitting, not whether to wait five minutes or
 * come back tomorrow. Starting is still refused, by `startSession`.
 */
export async function previewExam(token: string): Promise<PreviewExamResponse> {
  const now = new Date()
  const { manifest, opensAt } = await resolveActiveVersion(token, now, {
    allowUnopened: true,
  })

  return {
    title: manifest.title,
    ...(manifest.description ? { description: manifest.description } : {}),
    duration_s: manifest.duration_s,
    allow_backtracking: manifest.allow_backtracking,
    shuffle_questions: manifest.shuffle_questions ?? false,
    question_count: manifest.questions.length,
    ...(opensAt ? { opens_at: epochSeconds(opensAt) } : {}),
    server_time: epochSeconds(now),
  }
}

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
  platform: string,
  student: StudentContext
): Promise<StartSessionResponse> {
  const now = new Date()
  const version = await resolveActiveVersion(token, now)

  const expiresAt = new Date(now.getTime() + version.manifest.duration_s * 1_000)

  // `versionId` is written once, here, and never updated. This one column is
  // what guarantees a student who started on v1 finishes on v1 even if their
  // teacher republishes mid-exam.
  //
  // `studentRef`/`studentUserId` come from the verified session requireStudent
  // resolved, never from the request body - there is no field there for an
  // identity to arrive in.
  const [session] = await db
    .insert(examSessions)
    .values({
      token: version.token,
      versionId: version.versionId,
      expiresAt,
      clientVersion,
      platform,
      lastSeenAt: now,
      studentRef: student.email.toLowerCase(),
      studentUserId: student.userId,
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
