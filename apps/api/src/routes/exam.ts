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
  saveAnswerRequestSchema,
  startSessionRequestSchema,
  submitRequestSchema,
} from "@workspace/quiz-core"
import { Hono } from "hono"

import type { ExamEnv } from "../lib/hono"
import { validate } from "../lib/validate"
import { assertWritable, requireExamSession } from "../middleware/exam-auth"
import { heartbeat, recordEvents, saveAnswer, startSession, submit } from "../services/exam"

export const examRoutes = new Hono<ExamEnv>()

/**
 * The one exam route without a credential: it is where the credential comes
 * from. The link token is what authorises it.
 */
examRoutes.post(
  "/api/exam/session",
  validate("json", startSessionRequestSchema),
  async (c) => {
    const body = c.req.valid("json")
    return c.json(
      await startSession(body.token, body.client_version, body.platform)
    )
  }
)

examRoutes.use("/api/exam/answer", requireExamSession)
examRoutes.use("/api/exam/heartbeat", requireExamSession)
examRoutes.use("/api/exam/events", requireExamSession)
examRoutes.use("/api/exam/submit", requireExamSession)

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
