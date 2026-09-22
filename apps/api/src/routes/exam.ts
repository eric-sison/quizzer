/**
 * The exam surface, called only by the desktop client's Rust process.
 *
 * Its webview has no network permission at all, so nothing in a student's
 * browser context reaches these routes; the credential lives in Rust and is not
 * in the IPC snapshot.
 *
 * Failures must carry codes `AppError::from_server_code` recognises
 * (apps/desktop/src-tauri/src/error.rs). Anything it cannot place collapses to
 * `server_error`, and the student is told "the exam server returned an
 * unexpected response" when the real problem was that their time ran out.
 */
import {
  eventBatchRequestSchema,
  heartbeatRequestSchema,
  previewExamRequestSchema,
  saveAnswerRequestSchema,
  startSessionRequestSchema,
  submitRequestSchema,
} from "@workspace/quiz-core"
import { Hono } from "hono"

import type { ExamEnv } from "../lib/hono"
import { validate } from "../lib/validate"
import { assertWritable, requireExamSession } from "../middleware/exam-auth"
import { requireStudent } from "../middleware/student-auth"
import { z } from "zod"

import {
  heartbeat,
  previewExam,
  recordEvents,
  saveAnswer,
  startSession,
  submit,
} from "../services/exam"
import { readImageForSession } from "../services/media"

export const examRoutes = new Hono<ExamEnv>()

/**
 * Pre-flight configuration for the link-entry screen: title, time limit,
 * backtracking, shuffle, question count. Token-authorised like the session
 * claim, but claims nothing - no session row, no credential, and above all no
 * questions.
 */
examRoutes.post(
  "/api/exam/preview",
  validate("json", previewExamRequestSchema),
  async (c) => c.json(await previewExam(c.req.valid("json").token))
)

/**
 * The claim: link token in, exam JWT out. The link token authorises the exam;
 * the student's signed-in session (checked by requireStudent, presented as a
 * bearer token by the desktop's Rust process) supplies who is sitting it.
 * Identity is written server-side from that session - no field in this request
 * body names the student, so no client can claim to be someone else.
 */
examRoutes.use("/api/exam/session", requireStudent)
examRoutes.post(
  "/api/exam/session",
  validate("json", startSessionRequestSchema),
  async (c) => {
    const body = c.req.valid("json")
    return c.json(
      await startSession(
        body.token,
        body.client_version,
        body.platform,
        c.get("student")
      )
    )
  }
)

examRoutes.use("/api/exam/answer", requireExamSession)
examRoutes.use("/api/exam/heartbeat", requireExamSession)
examRoutes.use("/api/exam/events", requireExamSession)
examRoutes.use("/api/exam/submit", requireExamSession)
examRoutes.use("/api/exam/media/*", requireExamSession)

/**
 * Question images, for the desktop's Rust process - the webview has no network
 * access, so Rust fetches these at session start and hands the UI data URIs.
 * Scoped to the session's pinned version: one exam cannot read another's media.
 */
examRoutes.get(
  "/api/exam/media/:id",
  validate("param", z.object({ id: z.uuid() })),
  async (c) => {
    const { id } = c.req.valid("param")
    const media = await readImageForSession(c.get("session").versionId, id)

    c.header("Cache-Control", "private, max-age=3600")
    c.header("Content-Type", media.contentType)
    return c.body(new Uint8Array(media.body).buffer as ArrayBuffer)
  }
)

examRoutes.post(
  "/api/exam/answer",
  validate("json", saveAnswerRequestSchema),
  async (c) => {
    const session = c.get("session")
    assertWritable(session)

    const body = c.req.valid("json")
    return c.json(
      await saveAnswer(session, body.question_id, body.value, body.client_seq)
    )
  }
)

/**
 * Deliberately not behind `assertWritable`. A client that has been offline past
 * its deadline needs this call to answer so it can find out and stop, and a
 * revoked exam is reported here rather than by refusing the request.
 */
examRoutes.post(
  "/api/exam/heartbeat",
  validate("json", heartbeatRequestSchema),
  async (c) => c.json(await heartbeat(c.get("session")))
)

/**
 * Also not behind `assertWritable`. The events that matter most are the ones
 * around the end of an exam, and refusing them would mean losing exactly the
 * record a teacher would want to look at.
 */
examRoutes.post(
  "/api/exam/events",
  validate("json", eventBatchRequestSchema),
  async (c) => c.json(await recordEvents(c.get("session"), c.req.valid("json").events))
)

examRoutes.post(
  "/api/exam/submit",
  validate("json", submitRequestSchema),
  async (c) => {
    const session = c.get("session")
    // Submitting *at* the deadline is the normal case for an auto-submit, so
    // expiry is not checked here. `submit` still refuses a second attempt.
    return c.json(await submit(session, c.req.valid("json").idempotency_key))
  }
)
