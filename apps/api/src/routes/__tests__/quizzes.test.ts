/**
 * Route tests against a real database.
 *
 * Requires `docker compose up -d` and `pnpm --filter api db:migrate`. They run
 * through `app.request()` rather than a live socket, so the whole middleware
 * chain - auth, validation, the error envelope - is exercised without a port.
 */
import { createQuizDoc, type QuizDetail, type QuizSummary } from "@workspace/quiz-core"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createApp } from "../../app"
import { db, sqlClient, teachers } from "../../db"
import { env } from "../../env"

const app = createApp()

let owner: string
let stranger: string

function headers(teacherId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${env.SERVICE_TOKEN}`,
    "X-Teacher-Id": teacherId,
    "Content-Type": "application/json",
  }
}

async function makeTeacher(label: string): Promise<string> {
  const [row] = await db
    .insert(teachers)
    .values({ name: label, email: `${label}-${Date.now()}-${Math.random()}@test.invalid` })
    .returning({ id: teachers.id })
  if (!row) throw new Error("could not seed teacher")
  return row.id
}

async function newQuiz(teacherId: string, title = "Untitled"): Promise<QuizDetail> {
  const res = await app.request("/api/quizzes", {
    method: "POST",
    headers: headers(teacherId),
    body: JSON.stringify({ title }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as QuizDetail
}

beforeAll(async () => {
  owner = await makeTeacher("owner")
  stranger = await makeTeacher("stranger")
})

afterAll(async () => {
  // Quizzes cascade from the teacher row.
  await db.delete(teachers).where(eq(teachers.id, owner))
  await db.delete(teachers).where(eq(teachers.id, stranger))
  await sqlClient.end()
})

describe("auth", () => {
  it("refuses an unauthenticated request", async () => {
    const res = await app.request("/api/quizzes")
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { code: "unauthorized" } })
  })

  it("refuses a bad service token", async () => {
    const res = await app.request("/api/quizzes", {
      headers: { Authorization: "Bearer not-the-token", "X-Teacher-Id": owner },
    })
    expect(res.status).toBe(401)
  })
})

describe("POST /api/quizzes", () => {
  it("creates a draft with a usable empty document", async () => {
    const quiz = await newQuiz(owner, "Biology Midterm")

    expect(quiz.status).toBe("draft")
    expect(quiz.docVersion).toBe(0)
    expect(quiz.doc.title).toBe("Biology Midterm")
    expect(quiz.doc.questions).toEqual([])
    expect(quiz.doc.settings.durationS).toBeGreaterThan(0)
    expect(quiz.token).toBeNull()
    expect(quiz.hasUnpublishedChanges).toBe(false)
  })
})

describe("GET /api/quizzes", () => {
  it("lists only the acting teacher's quizzes", async () => {
    const mine = await newQuiz(owner, "Mine")
    await newQuiz(stranger, "Theirs")

    const res = await app.request("/api/quizzes", { headers: headers(owner) })
    const list = (await res.json()) as QuizSummary[]

    expect(list.some((q) => q.id === mine.id)).toBe(true)
    expect(list.every((q) => q.title !== "Theirs")).toBe(true)
  })

  it("summarises without shipping the draft document", async () => {
    const quiz = await newQuiz(owner, "Counted")
    const doc = createQuizDoc("Counted")
    doc.questions = [
      {
        id: "q1",
        kind: "true_false",
        promptDoc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] },
        points: 1,
        required: true,
        correct: true,
      },
    ]
    await app.request(`/api/quizzes/${quiz.id}/draft`, {
      method: "PUT",
      headers: headers(owner),
      body: JSON.stringify({ doc, docVersion: 0 }),
    })

    const res = await app.request("/api/quizzes", { headers: headers(owner) })
    const row = ((await res.json()) as QuizSummary[]).find((q) => q.id === quiz.id)

    expect(row?.questionCount).toBe(1)
    expect(row?.durationS).toBe(doc.settings.durationS)
    expect(row).not.toHaveProperty("doc")
  })
})

describe("GET /api/quizzes/:id", () => {
  it("hides another teacher's quiz behind a 404, not a 403", async () => {
    const quiz = await newQuiz(owner)

    const res = await app.request(`/api/quizzes/${quiz.id}`, {
      headers: headers(stranger),
    })

    // 403 would confirm the id exists. 404 discloses nothing.
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: "not_found" } })
  })

  it("rejects an id that is not a uuid", async () => {
    const res = await app.request("/api/quizzes/not-a-uuid", { headers: headers(owner) })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: "validation_failed" } })
  })

  it("404s an unknown id", async () => {
    const res = await app.request(
      "/api/quizzes/00000000-0000-4000-8000-0000000000ff",
      { headers: headers(owner) }
    )
    expect(res.status).toBe(404)
  })
})

describe("PUT /api/quizzes/:id/draft", () => {
  it("saves and bumps the version", async () => {
    const quiz = await newQuiz(owner)
    const doc = { ...quiz.doc, title: "Renamed" }

    const res = await app.request(`/api/quizzes/${quiz.id}/draft`, {
      method: "PUT",
      headers: headers(owner),
      body: JSON.stringify({ doc, docVersion: quiz.docVersion }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ docVersion: 1 })

    const after = await app.request(`/api/quizzes/${quiz.id}`, { headers: headers(owner) })
    expect(((await after.json()) as QuizDetail).doc.title).toBe("Renamed")
  })

  it("rejects a write based on a stale version instead of clobbering", async () => {
    const quiz = await newQuiz(owner)

    const first = await app.request(`/api/quizzes/${quiz.id}/draft`, {
      method: "PUT",
      headers: headers(owner),
      body: JSON.stringify({ doc: { ...quiz.doc, title: "Tab A" }, docVersion: 0 }),
    })
    expect(first.status).toBe(200)

    // Second tab still believes it is on version 0.
    const second = await app.request(`/api/quizzes/${quiz.id}/draft`, {
      method: "PUT",
      headers: headers(owner),
      body: JSON.stringify({ doc: { ...quiz.doc, title: "Tab B" }, docVersion: 0 }),
    })

    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ error: { code: "conflict" } })

    // Tab A's write survived.
    const after = await app.request(`/api/quizzes/${quiz.id}`, { headers: headers(owner) })
    expect(((await after.json()) as QuizDetail).doc.title).toBe("Tab A")
  })

  it("rejects a document with a disallowed rich-text node", async () => {
    const quiz = await newQuiz(owner)
    const doc = {
      ...quiz.doc,
      questions: [
        {
          id: "q1",
          kind: "true_false",
          promptDoc: { type: "doc", content: [{ type: "image", src: "https://evil.test/x.png" }] },
          points: 1,
          required: true,
          correct: true,
        },
      ],
    }

    const res = await app.request(`/api/quizzes/${quiz.id}/draft`, {
      method: "PUT",
      headers: headers(owner),
      body: JSON.stringify({ doc, docVersion: quiz.docVersion }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: "validation_failed" } })
  })

  it("will not let a stranger write", async () => {
    const quiz = await newQuiz(owner)

    const res = await app.request(`/api/quizzes/${quiz.id}/draft`, {
      method: "PUT",
      headers: headers(stranger),
      body: JSON.stringify({ doc: quiz.doc, docVersion: 0 }),
    })

    expect(res.status).toBe(404)
  })
})

describe("DELETE /api/quizzes/:id", () => {
  it("archives rather than deleting, and drops it from the list", async () => {
    const quiz = await newQuiz(owner, "Doomed")

    const res = await app.request(`/api/quizzes/${quiz.id}`, {
      method: "DELETE",
      headers: headers(owner),
    })
    expect(res.status).toBe(204)

    const list = (await (
      await app.request("/api/quizzes", { headers: headers(owner) })
    ).json()) as QuizSummary[]
    expect(list.some((q) => q.id === quiz.id)).toBe(false)

    // Archived, not gone: the row survives for versions and receipts.
    const still = await db.query.quizzes.findFirst({
      where: (q, { eq: e }) => e(q.id, quiz.id),
    })
    expect(still?.archivedAt).not.toBeNull()
  })

  it("is idempotent enough to 404 on a second delete", async () => {
    const quiz = await newQuiz(owner)
    await app.request(`/api/quizzes/${quiz.id}`, { method: "DELETE", headers: headers(owner) })

    const again = await app.request(`/api/quizzes/${quiz.id}`, {
      method: "DELETE",
      headers: headers(owner),
    })
    expect(again.status).toBe(404)
  })
})
