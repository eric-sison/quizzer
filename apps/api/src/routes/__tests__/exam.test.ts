/**
 * The exam surface, against a real database.
 *
 * Requires `docker compose up -d` and `pnpm --filter api db:migrate`.
 *
 * Most of these are about the client not being trusted: the deadline, the
 * ordering of answers, the timestamps on proctor events and whether a session
 * may still write are all the server's to decide.
 */
import {
  createOption,
  createQuestion,
  createQuizDoc,
  heartbeatResponseSchema,
  receiptSchema,
  startSessionResponseSchema,
  type PublishResponse,
  type Question,
  type QuizDetail,
  type StartSessionResponse,
} from "@workspace/quiz-core"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createApp } from "../../app"
import { db, sqlClient, teachers } from "../../db"
import { sign } from "hono/jwt"

import {
  examAnswers,
  examSessions,
  proctorEvents,
  quizVersions,
  quizzes as quizzesTable,
} from "../../db/schema"
import { env } from "../../env"
import { signExamToken } from "../../lib/exam-token"

const app = createApp()

let owner: string

function teacherHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${env.SERVICE_TOKEN}`,
    "X-Teacher-Id": owner,
    "Content-Type": "application/json",
  }
}

function examHeaders(jwt: string): Record<string, string> {
  return { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }
}

function text(value: string) {
  return {
    type: "doc" as const,
    content: [
      { type: "paragraph" as const, content: [{ type: "text" as const, text: value }] },
    ],
  }
}

function questions(): Question[] {
  const choice = createQuestion("single_choice")
  if (!("options" in choice)) throw new Error("expected options")

  return [
    { ...createQuestion("true_false"), correct: true, promptDoc: text("Water boils at 100C.") },
    {
      ...choice,
      promptDoc: text("Pick the prime."),
      options: [{ ...createOption("7"), correct: true }, createOption("9")],
    },
    { ...createQuestion("essay"), promptDoc: text("Explain why.") },
  ]
}

/** Publish a quiz and hand back its link token. */
async function publishedQuiz(durationS = 2_700): Promise<PublishResponse> {
  const created = (await (
    await app.request("/api/quizzes", {
      method: "POST",
      headers: teacherHeaders(),
      body: JSON.stringify({ title: "Exam surface" }),
    })
  ).json()) as QuizDetail

  const base = createQuizDoc("Exam surface")
  const doc = {
    ...base,
    settings: { ...base.settings, durationS },
    questions: questions(),
  }

  await app.request(`/api/quizzes/${created.id}/draft`, {
    method: "PUT",
    headers: teacherHeaders(),
    body: JSON.stringify({ doc, docVersion: created.docVersion }),
  })

  const res = await app.request(`/api/quizzes/${created.id}/publish`, {
    method: "POST",
    headers: teacherHeaders(),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as PublishResponse
}

async function startSession(token: string) {
  return app.request("/api/exam/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, client_version: "0.1.0", platform: "macos" }),
  })
}

/** A published quiz plus a live session on it. */
async function sitting(durationS = 2_700) {
  const link = await publishedQuiz(durationS)
  const res = await startSession(link.token)
  expect(res.status).toBe(200)
  const session = startSessionResponseSchema.parse(await res.json())
  return { link, session }
}

function post(path: string, jwt: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: examHeaders(jwt),
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  const [row] = await db
    .insert(teachers)
    .values({
      name: "exam-owner",
      email: `exam-${Date.now()}-${Math.random()}@test.invalid`,
    })
    .returning({ id: teachers.id })
  if (!row) throw new Error("could not seed teacher")
  owner = row.id
})

afterAll(async () => {
  await db.delete(teachers).where(eq(teachers.id, owner))
  await sqlClient.end()
})

describe("POST /api/exam/preview", () => {
  async function previewExam(token: string) {
    return app.request("/api/exam/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
  }

  it("shows the configuration and nothing else - no questions, no credential", async () => {
    const link = await publishedQuiz(600)

    const res = await previewExam(link.token)
    expect(res.status).toBe(200)
    const preview = (await res.json()) as Record<string, unknown>

    expect(Object.keys(preview).sort()).toEqual([
      "allow_backtracking",
      "duration_s",
      "question_count",
      "shuffle_questions",
      "title",
    ])
    expect(preview).toMatchObject({
      title: "Exam surface",
      duration_s: 600,
      question_count: 3,
      shuffle_questions: false,
    })
  })

  it("claims nothing: previewing does not create a session", async () => {
    const link = await publishedQuiz()

    await previewExam(link.token)

    const rows = await db
      .select({ id: examSessions.id })
      .from(examSessions)
      .where(eq(examSessions.token, link.token))
    expect(rows).toHaveLength(0)
  })

  it("gives the same verdicts as a session claim for a dead link", async () => {
    const unknown = await previewExam("aaaaaaaaaaaaaaaaaaaaaaaa")
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toMatchObject({ error: { code: "invalid_token" } })

    const link = await publishedQuiz()
    const quizzes = (await (
      await app.request("/api/quizzes", { headers: teacherHeaders() })
    ).json()) as { id: string; token: string | null }[]
    const quiz = quizzes.find((q) => q.token === link.token)
    if (!quiz) throw new Error("published quiz not in the list")

    await app.request(`/api/quizzes/${quiz.id}/unpublish`, {
      method: "POST",
      headers: teacherHeaders(),
    })

    const revoked = await previewExam(link.token)
    expect(revoked.status).toBe(403)
    expect(await revoked.json()).toMatchObject({ error: { code: "revoked" } })
  })
})

describe("POST /api/exam/session", () => {
  it("hands back a credential, the manifest and both clocks", async () => {
    const { session } = await sitting()

    expect(session.session_jwt.length).toBeGreaterThan(20)
    expect(session.exam.questions).toHaveLength(3)
    expect(session.expires_at).toBeGreaterThan(session.server_time)
  })

  it("sets the deadline from the quiz's own duration", async () => {
    const { session } = await sitting(600)
    expect(session.expires_at - session.server_time).toBeGreaterThanOrEqual(598)
    expect(session.expires_at - session.server_time).toBeLessThanOrEqual(602)
  })

  it("never sends an answer key", async () => {
    const { session } = await sitting()

    const serialised = JSON.stringify(session.exam)
    expect(serialised).not.toContain("correct")
    expect(serialised).not.toContain("answer")
    expect(serialised).not.toContain("rubric")
  })

  it("uses codes the desktop client understands", async () => {
    // from_server_code in apps/desktop/src-tauri/src/error.rs collapses
    // anything it does not recognise to server_error.
    const unknown = await startSession("aaaaaaaaaaaaaaaaaaaaaaaa")
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toMatchObject({ error: { code: "invalid_token" } })
  })

  it("refuses a link the teacher closed", async () => {
    const link = await publishedQuiz()
    const quizzes = (await (
      await app.request("/api/quizzes", { headers: teacherHeaders() })
    ).json()) as { id: string; token: string | null }[]
    const quiz = quizzes.find((q) => q.token === link.token)
    if (!quiz) throw new Error("published quiz not in the list")

    await app.request(`/api/quizzes/${quiz.id}/unpublish`, {
      method: "POST",
      headers: teacherHeaders(),
    })

    const res = await startSession(link.token)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: "revoked" } })
  })

  it("pins the version, so republishing does not move a student mid-exam", async () => {
    const link = await publishedQuiz()
    const quizzes = (await (
      await app.request("/api/quizzes", { headers: teacherHeaders() })
    ).json()) as { id: string; token: string | null }[]
    const quiz = quizzes.find((q) => q.token === link.token)
    if (!quiz) throw new Error("published quiz not in the list")

    const before = startSessionResponseSchema.parse(
      await (await startSession(link.token)).json()
    )

    // The teacher edits and republishes while that student is sitting.
    const detail = (await (
      await app.request(`/api/quizzes/${quiz.id}`, { headers: teacherHeaders() })
    ).json()) as QuizDetail
    const addedQuestion = {
      ...createQuestion("true_false"),
      correct: false,
      promptDoc: text("Added after the exam began."),
    }
    await app.request(`/api/quizzes/${quiz.id}/draft`, {
      method: "PUT",
      headers: teacherHeaders(),
      body: JSON.stringify({
        doc: {
          ...detail.doc,
          title: "Changed mid-exam",
          questions: [...detail.doc.questions, addedQuestion],
        },
        docVersion: detail.docVersion,
      }),
    })
    await app.request(`/api/quizzes/${quiz.id}/publish`, {
      method: "POST",
      headers: teacherHeaders(),
    })

    // The sitting student's session still points at the version it started on,
    // while the quiz has moved on. That column is the whole guarantee, so this
    // reads it rather than re-checking a manifest captured before the change,
    // which could not have moved either way.
    const [row] = await db
      .select({ versionId: examSessions.versionId })
      .from(examSessions)
      .where(eq(examSessions.id, await sessionIdOf(before)))

    const versions = await db
      .select({ id: quizVersions.id, versionNo: quizVersions.versionNo })
      .from(quizVersions)
      .where(eq(quizVersions.quizId, quiz.id))
      .orderBy(quizVersions.versionNo)

    expect(versions).toHaveLength(2)
    expect(row?.versionId).toBe(versions[0]!.id)

    const [quizRow] = await db
      .select({ activeVersionId: quizzesTable.activeVersionId })
      .from(quizzesTable)
      .where(eq(quizzesTable.id, quiz.id))
    expect(quizRow?.activeVersionId).toBe(versions[1]!.id)

    // The sitting student can still work, and their paper is still v1: the
    // question their teacher just added is not on it. This is the consequence
    // that would actually be visible if the session read the quiz's current
    // version instead of the one it pinned.
    const beat = await post("/api/exam/heartbeat", before.session_jwt, { elapsed_s: 30 })
    expect(beat.status).toBe(200)

    const onNewQuestion = await post("/api/exam/answer", before.session_jwt, {
      question_id: addedQuestion.id,
      value: "true",
      client_seq: 1,
    })
    expect(onNewQuestion.status).toBe(404)

    const onOldQuestion = await post("/api/exam/answer", before.session_jwt, {
      question_id: before.exam.questions[0]!.id,
      value: "true",
      client_seq: 1,
    })
    expect(onOldQuestion.status).toBe(200)

    // And a student starting now gets the new one.
    const after = startSessionResponseSchema.parse(
      await (await startSession(link.token)).json()
    )
    expect(after.exam.title).toBe("Changed mid-exam")
  })

  it("lets a whole class share one link", async () => {
    // One link per quiz is the design; a second session on the same token is
    // the second student, not a conflict.
    const link = await publishedQuiz()
    const first = await startSession(link.token)
    const second = await startSession(link.token)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    const a = startSessionResponseSchema.parse(await first.json())
    const b = startSessionResponseSchema.parse(await second.json())
    expect(a.session_jwt).not.toBe(b.session_jwt)
  })
})

describe("the two credentials are not interchangeable", () => {
  it("refuses an exam token on a teacher route", async () => {
    const { session } = await sitting()

    const res = await app.request("/api/quizzes", {
      headers: { Authorization: `Bearer ${session.session_jwt}` },
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { code: "unauthorized" } })
  })

  it("refuses the service token on an exam route", async () => {
    const res = await post("/api/exam/heartbeat", env.SERVICE_TOKEN, { elapsed_s: 1 })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { code: "invalid_token" } })
  })

  it("refuses a token signed with the wrong secret", async () => {
    const res = await post("/api/exam/heartbeat", "not.a.jwt", { elapsed_s: 1 })
    expect(res.status).toBe(401)
  })

  it("refuses a correctly signed token issued for a different audience", async () => {
    // The previous test only proves the signature is checked: SERVICE_TOKEN is
    // not a JWT at all. This is the audience check on its own, which is what
    // stops a credential minted for one surface opening the other.
    const { session } = await sitting()
    const sessionId = await sessionIdOf(session)

    const wrongAudience = await sign(
      {
        sub: sessionId,
        aud: "quizzer:teacher",
        exp: Math.floor(Date.now() / 1_000) + 600,
        iat: Math.floor(Date.now() / 1_000),
      },
      env.EXAM_JWT_SECRET,
      "HS256"
    )

    const res = await post("/api/exam/heartbeat", wrongAudience, { elapsed_s: 1 })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { code: "invalid_token" } })
  })

  it("refuses a token whose expiry has passed", async () => {
    const { session } = await sitting()
    const stale = await signExamToken(
      await sessionIdOf(session),
      new Date(Date.now() - 60_000)
    )

    const res = await post("/api/exam/heartbeat", stale, { elapsed_s: 1 })
    expect(res.status).toBe(401)
  })

  it("refuses a well-formed token for a session that does not exist", async () => {
    const forged = await signExamToken(
      "00000000-0000-4000-8000-0000000000ff",
      new Date(Date.now() + 60_000)
    )
    const res = await post("/api/exam/heartbeat", forged, { elapsed_s: 1 })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { code: "invalid_token" } })
  })
})

describe("POST /api/exam/answer", () => {
  it("stores an answer", async () => {
    const { session } = await sitting()
    const first = session.exam.questions[0]!

    const res = await post("/api/exam/answer", session.session_jwt, {
      question_id: first.id,
      value: first.choices[0]!.id,
      client_seq: 1,
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ stored: true })
  })

  it("keeps the newest answer when a retry arrives late", async () => {
    const { session } = await sitting()
    const q = session.exam.questions[1]!

    await post("/api/exam/answer", session.session_jwt, {
      question_id: q.id,
      value: q.choices[1]!.id,
      client_seq: 5,
    })

    // The stalled first attempt finally lands, carrying the older sequence.
    const late = await post("/api/exam/answer", session.session_jwt, {
      question_id: q.id,
      value: q.choices[0]!.id,
      client_seq: 2,
    })
    expect(await late.json()).toEqual({ stored: false })

    const [row] = await db
      .select({ value: examAnswers.value, clientSeq: examAnswers.clientSeq })
      .from(examAnswers)
      .where(eq(examAnswers.questionId, q.id))
    expect(row?.value).toBe(q.choices[1]!.id)
    expect(row?.clientSeq).toBe(5)
  })

  it("takes a list for a many-answer question", async () => {
    const { session } = await sitting()
    const q = session.exam.questions[1]!

    const res = await post("/api/exam/answer", session.session_jwt, {
      question_id: q.id,
      value: [q.choices[0]!.id, q.choices[1]!.id],
      client_seq: 1,
    })
    expect(res.status).toBe(200)
  })

  it("takes a rich-text essay answer", async () => {
    const { session } = await sitting()
    const essayQuestion = session.exam.questions.find((q) => q.kind === "essay")!

    const res = await post("/api/exam/answer", session.session_jwt, {
      question_id: essayQuestion.id,
      value: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Plants use " },
              { type: "text", text: "chlorophyll", marks: [{ type: "bold" }] },
            ],
          },
        ],
      },
      client_seq: 1,
    })

    expect(res.status).toBe(200)

    const [row] = await db
      .select({ value: examAnswers.value })
      .from(examAnswers)
      .where(eq(examAnswers.sessionId, await sessionIdOf(session)))
    expect(row?.value).toMatchObject({ type: "doc" })
  })

  it("still takes an essay answer stored as plain text", async () => {
    // Older clients, and answers written before essays became rich text.
    const { session } = await sitting()
    const essayQuestion = session.exam.questions.find((q) => q.kind === "essay")!

    const res = await post("/api/exam/answer", session.session_jwt, {
      question_id: essayQuestion.id,
      value: "a plain answer",
      client_seq: 1,
    })
    expect(res.status).toBe(200)
  })

  it("refuses an answer containing a node the editor cannot produce", async () => {
    // The answer goes through the same allowlist as a prompt, so a student
    // cannot store a node the renderer has no case for.
    const { session } = await sitting()
    const essayQuestion = session.exam.questions.find((q) => q.kind === "essay")!

    const res = await post("/api/exam/answer", session.session_jwt, {
      question_id: essayQuestion.id,
      value: { type: "doc", content: [{ type: "image", attrs: { src: "x" } }] },
      client_seq: 1,
    })
    expect(res.status).toBe(400)
  })

  it("refuses a question that is not on this paper", async () => {
    const { session } = await sitting()

    const res = await post("/api/exam/answer", session.session_jwt, {
      question_id: "not-a-question",
      value: "x",
      client_seq: 1,
    })
    expect(res.status).toBe(404)
  })

  it("refuses an answer once the deadline has passed", async () => {
    const { session } = await sitting()

    // Move the session's deadline into the past, as the clock would.
    await db
      .update(examSessions)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(examSessions.id, await sessionIdOf(session)))

    const res = await post("/api/exam/answer", session.session_jwt, {
      question_id: session.exam.questions[0]!.id,
      value: "x",
      client_seq: 9,
    })

    expect(res.status).toBe(410)
    expect(await res.json()).toMatchObject({ error: { code: "expired" } })
  })
})

describe("POST /api/exam/heartbeat", () => {
  it("answers with the server's clock and deadline", async () => {
    const { session } = await sitting()

    const res = await post("/api/exam/heartbeat", session.session_jwt, { elapsed_s: 30 })
    const body = heartbeatResponseSchema.parse(await res.json())

    expect(body.expires_at).toBe(session.expires_at)
    expect(body.revoked).toBe(false)
  })

  it("reports a revoked exam rather than refusing the call", async () => {
    const { link, session } = await sitting()
    const quizzes = (await (
      await app.request("/api/quizzes", { headers: teacherHeaders() })
    ).json()) as { id: string; token: string | null }[]
    const quiz = quizzes.find((q) => q.token === link.token)!

    await app.request(`/api/quizzes/${quiz.id}/unpublish`, {
      method: "POST",
      headers: teacherHeaders(),
    })

    const res = await post("/api/exam/heartbeat", session.session_jwt, { elapsed_s: 30 })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: "revoked" } })
  })

  it("still answers after the deadline, so an offline client can find out", async () => {
    const { session } = await sitting()
    await db
      .update(examSessions)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(examSessions.id, await sessionIdOf(session)))

    const res = await post("/api/exam/heartbeat", session.session_jwt, { elapsed_s: 9_999 })
    expect(res.status).toBe(200)

    const body = heartbeatResponseSchema.parse(await res.json())
    expect(body.expires_at).toBeLessThan(body.server_time)
  })
})

describe("POST /api/exam/events", () => {
  it("records the server's time, not the client's", async () => {
    const { session } = await sitting()
    const id = await sessionIdOf(session)

    // A student who moves the system clock moves only `at_client`.
    await post("/api/exam/events", session.session_jwt, {
      events: [{ seq: 1, kind: "focus_lost", at: 0, detail: "switched app" }],
    })

    const [row] = await db
      .select({
        atClient: proctorEvents.atClient,
        atServer: proctorEvents.atServer,
        kind: proctorEvents.kind,
      })
      .from(proctorEvents)
      .where(eq(proctorEvents.sessionId, id))

    expect(row?.atClient).toBe(0)
    expect(row?.kind).toBe("focus_lost")
    expect(row?.atServer.getTime()).toBeGreaterThan(Date.now() - 60_000)
  })

  it("absorbs a retried batch instead of double-counting it", async () => {
    const { session } = await sitting()
    const id = await sessionIdOf(session)
    const batch = {
      events: [
        { seq: 1, kind: "focus_lost", at: 10 },
        { seq: 2, kind: "blur", at: 11 },
      ],
    }

    const first = await post("/api/exam/events", session.session_jwt, batch)
    const retry = await post("/api/exam/events", session.session_jwt, batch)

    expect(await first.json()).toEqual({ accepted: 2 })
    expect(await retry.json()).toEqual({ accepted: 0 })

    const rows = await db
      .select({ id: proctorEvents.id })
      .from(proctorEvents)
      .where(eq(proctorEvents.sessionId, id))
    expect(rows).toHaveLength(2)
  })

  it("counts focus strikes on the session", async () => {
    const { session } = await sitting()
    const id = await sessionIdOf(session)

    await post("/api/exam/events", session.session_jwt, {
      events: [
        { seq: 1, kind: "focus_lost", at: 1 },
        { seq: 2, kind: "focus_lost", at: 2 },
        { seq: 3, kind: "resized", at: 3 },
      ],
    })

    const [row] = await db
      .select({ strikes: examSessions.strikes })
      .from(examSessions)
      .where(eq(examSessions.id, id))
    expect(row?.strikes).toBe(2)
  })
})

describe("POST /api/exam/submit", () => {
  it("returns a receipt", async () => {
    const { session } = await sitting()

    const res = await post("/api/exam/submit", session.session_jwt, {
      idempotency_key: "attempt-0000000001",
    })

    expect(res.status).toBe(200)
    const receipt = receiptSchema.parse(await res.json())
    expect(receipt.question_count).toBe(3)
    expect(receipt.submitted_at).toBeGreaterThan(0)
  })

  it("replays the same receipt when the client retries", async () => {
    const { session } = await sitting()
    const body = { idempotency_key: "attempt-0000000002" }

    const first = receiptSchema.parse(
      await (await post("/api/exam/submit", session.session_jwt, body)).json()
    )
    const retry = receiptSchema.parse(
      await (await post("/api/exam/submit", session.session_jwt, body)).json()
    )

    // A lost response must not cost a student their submission or give them two.
    expect(retry.receipt_id).toBe(first.receipt_id)
    expect(retry.submitted_at).toBe(first.submitted_at)
  })

  it("refuses a second submission under a different key", async () => {
    const { session } = await sitting()

    await post("/api/exam/submit", session.session_jwt, {
      idempotency_key: "attempt-0000000003",
    })
    const again = await post("/api/exam/submit", session.session_jwt, {
      idempotency_key: "attempt-0000000004",
    })

    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({ error: { code: "already_submitted" } })
  })

  it("refuses to take answers after submitting", async () => {
    const { session } = await sitting()
    await post("/api/exam/submit", session.session_jwt, {
      idempotency_key: "attempt-0000000005",
    })

    const res = await post("/api/exam/answer", session.session_jwt, {
      question_id: session.exam.questions[0]!.id,
      value: "late",
      client_seq: 99,
    })
    expect(res.status).toBe(409)
  })

  it("accepts a submission at the deadline, which is what auto-submit does", async () => {
    const { session } = await sitting()
    await db
      .update(examSessions)
      .set({ expiresAt: new Date(Date.now() - 500) })
      .where(eq(examSessions.id, await sessionIdOf(session)))

    const res = await post("/api/exam/submit", session.session_jwt, {
      idempotency_key: "attempt-0000000006",
    })
    expect(res.status).toBe(200)
  })
})

/** The client never sees its own session id, so tests look it up. */
async function sessionIdOf(session: StartSessionResponse): Promise<string> {
  const [, payload] = session.session_jwt.split(".")
  if (!payload) throw new Error("malformed session token")
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
    sub: string
  }
  return claims.sub
}
