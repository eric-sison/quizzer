/**
 * Publishing, against a real database.
 *
 * Requires `docker compose up -d` and `pnpm --filter api db:migrate`.
 *
 * The test that matters most is the last one: what a student can read off the
 * link route. Everything else here is about keeping that one honest.
 */
import {
  createOption,
  createQuestion,
  createQuizDoc,
  type PublishResponse,
  type Question,
  type QuizDetail,
} from "@workspace/quiz-core"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createApp } from "../../app"
import { db, sqlClient, teachers } from "../../db"
import { examLinks, quizVersions } from "../../db/schema"
import { env } from "../../env"
import { mintToken } from "../../services/publish"

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
    .values({
      name: label,
      email: `${label}-${Date.now()}-${Math.random()}@test.invalid`,
    })
    .returning({ id: teachers.id })
  if (!row) throw new Error("could not seed teacher")
  return row.id
}

function answerableQuestions(): Question[] {
  const tf = { ...createQuestion("true_false"), correct: true }
  const choice = createQuestion("single_choice")
  if (!("options" in choice)) throw new Error("expected options")

  return [
    { ...tf, promptDoc: text("Water boils at 100C.") },
    {
      ...choice,
      promptDoc: text("Pick the prime."),
      options: [
        { ...createOption("7"), correct: true },
        createOption("9"),
      ],
    },
  ]
}

function text(value: string) {
  return {
    type: "doc" as const,
    content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: value }] }],
  }
}

/** A quiz that passes validation, saved as the draft, ready to publish. */
async function publishableQuiz(title = "Biology Midterm"): Promise<QuizDetail> {
  const res = await app.request("/api/quizzes", {
    method: "POST",
    headers: headers(owner),
    body: JSON.stringify({ title }),
  })
  const quiz = (await res.json()) as QuizDetail

  const doc = { ...createQuizDoc(title), questions: answerableQuestions() }
  const saved = await app.request(`/api/quizzes/${quiz.id}/draft`, {
    method: "PUT",
    headers: headers(owner),
    body: JSON.stringify({ doc, docVersion: quiz.docVersion }),
  })
  expect(saved.status).toBe(200)

  const after = await app.request(`/api/quizzes/${quiz.id}`, { headers: headers(owner) })
  return (await after.json()) as QuizDetail
}

/** Re-save the draft with an opening time (or clear it), then read it back. */
async function setOpensAt(quiz: QuizDetail, opensAt: string | undefined) {
  const settings = { ...quiz.doc.settings }
  if (opensAt) settings.opensAt = opensAt
  else delete settings.opensAt

  const res = await app.request(`/api/quizzes/${quiz.id}/draft`, {
    method: "PUT",
    headers: headers(owner),
    body: JSON.stringify({
      doc: { ...quiz.doc, settings },
      docVersion: quiz.docVersion,
    }),
  })
  expect(res.status).toBe(200)

  const after = await app.request(`/api/quizzes/${quiz.id}`, { headers: headers(owner) })
  return (await after.json()) as QuizDetail
}

async function linkRow(token: string) {
  const [row] = await db
    .select({ opensAt: examLinks.opensAt })
    .from(examLinks)
    .where(eq(examLinks.token, token))
  if (!row) throw new Error("no link row")
  return row
}

async function publish(quizId: string, teacherId = owner) {
  return app.request(`/api/quizzes/${quizId}/publish`, {
    method: "POST",
    headers: headers(teacherId),
  })
}

beforeAll(async () => {
  owner = await makeTeacher("pub-owner")
  stranger = await makeTeacher("pub-stranger")
})

afterAll(async () => {
  await db.delete(teachers).where(eq(teachers.id, owner))
  await db.delete(teachers).where(eq(teachers.id, stranger))
  await sqlClient.end()
})

describe("mintToken", () => {
  it("produces a token the desktop client will accept offline", () => {
    // apps/desktop/src-tauri/src/session.rs rejects anything outside this
    // alphabet or length window before it makes a request, which a student
    // experiences as a broken link rather than a server error.
    for (let i = 0; i < 50; i++) {
      const token = mintToken()
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(token.length).toBeGreaterThanOrEqual(16)
      expect(token.length).toBeLessThanOrEqual(128)
    }
  })

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 200 }, mintToken))
    expect(seen.size).toBe(200)
  })
})

describe("POST /api/quizzes/:id/publish", () => {
  it("mints a version, a token and a link", async () => {
    const quiz = await publishableQuiz()
    const res = await publish(quiz.id)

    expect(res.status).toBe(200)
    const published = (await res.json()) as PublishResponse

    expect(published.versionNo).toBe(1)
    expect(published.url).toBe(`${env.PUBLIC_API_ORIGIN}/e/${published.token}`)
    expect(Date.parse(published.publishedAt)).not.toBeNaN()
  })

  it("marks the quiz published and stops reporting unpublished changes", async () => {
    const quiz = await publishableQuiz()
    await publish(quiz.id)

    const res = await app.request(`/api/quizzes/${quiz.id}`, { headers: headers(owner) })
    const after = (await res.json()) as QuizDetail

    expect(after.status).toBe("published")
    expect(after.hasUnpublishedChanges).toBe(false)
    expect(after.token).not.toBeNull()
  })

  it("reports unpublished changes again after the next edit", async () => {
    const quiz = await publishableQuiz()
    await publish(quiz.id)

    const current = (await (
      await app.request(`/api/quizzes/${quiz.id}`, { headers: headers(owner) })
    ).json()) as QuizDetail

    await app.request(`/api/quizzes/${quiz.id}/draft`, {
      method: "PUT",
      headers: headers(owner),
      body: JSON.stringify({
        doc: { ...current.doc, title: "Edited after publishing" },
        docVersion: current.docVersion,
      }),
    })

    const res = await app.request(`/api/quizzes/${quiz.id}`, { headers: headers(owner) })
    expect(((await res.json()) as QuizDetail).hasUnpublishedChanges).toBe(true)
  })

  it("refuses a quiz that would fail its own rules, and says what is wrong", async () => {
    const res = await app.request("/api/quizzes", {
      method: "POST",
      headers: headers(owner),
      body: JSON.stringify({ title: "" }),
    })
    const empty = (await res.json()) as QuizDetail

    const attempt = await publish(empty.id)

    expect(attempt.status).toBe(422)
    const body = (await attempt.json()) as {
      error: { code: string; issues?: { code: string }[] }
    }
    expect(body.error.code).toBe("validation_failed")
    expect(body.error.issues?.map((i) => i.code)).toEqual(
      expect.arrayContaining(["empty_title", "no_questions"])
    )
  })

  it("writes no version when validation fails", async () => {
    const res = await app.request("/api/quizzes", {
      method: "POST",
      headers: headers(owner),
      body: JSON.stringify({ title: "" }),
    })
    const empty = (await res.json()) as QuizDetail
    await publish(empty.id)

    const versions = await db
      .select()
      .from(quizVersions)
      .where(eq(quizVersions.quizId, empty.id))
    expect(versions).toHaveLength(0)
  })

  it("hides another teacher's quiz behind a 404", async () => {
    const quiz = await publishableQuiz()
    const res = await publish(quiz.id, stranger)
    expect(res.status).toBe(404)
  })
})

describe("republishing", () => {
  it("appends a version and keeps the token, so links already handed out survive", async () => {
    const quiz = await publishableQuiz()

    const first = (await (await publish(quiz.id)).json()) as PublishResponse
    const second = (await (await publish(quiz.id)).json()) as PublishResponse

    expect(second.versionNo).toBe(2)
    expect(second.token).toBe(first.token)
  })

  it("leaves the earlier version untouched", async () => {
    const quiz = await publishableQuiz("First title")
    await publish(quiz.id)

    const current = (await (
      await app.request(`/api/quizzes/${quiz.id}`, { headers: headers(owner) })
    ).json()) as QuizDetail
    await app.request(`/api/quizzes/${quiz.id}/draft`, {
      method: "PUT",
      headers: headers(owner),
      body: JSON.stringify({
        doc: { ...current.doc, title: "Second title" },
        docVersion: current.docVersion,
      }),
    })
    await publish(quiz.id)

    const versions = await db
      .select()
      .from(quizVersions)
      .where(eq(quizVersions.quizId, quiz.id))
      .orderBy(quizVersions.versionNo)

    // This is what protects an exam already in progress from a teacher's edit.
    expect(versions.map((v) => v.manifest.title)).toEqual([
      "First title",
      "Second title",
    ])
  })
})

describe("POST /api/quizzes/:id/unpublish", () => {
  it("takes the link out of service", async () => {
    const quiz = await publishableQuiz()
    const published = (await (await publish(quiz.id)).json()) as PublishResponse

    const res = await app.request(`/api/quizzes/${quiz.id}/unpublish`, {
      method: "POST",
      headers: headers(owner),
    })
    expect(res.status).toBe(204)

    const after = (await (
      await app.request(`/api/quizzes/${quiz.id}`, { headers: headers(owner) })
    ).json()) as QuizDetail
    expect(after.status).toBe("draft")
    expect(after.token).toBeNull()

    const landing = await app.request(`/e/${published.token}`)
    expect(landing.status).toBe(410)
  })

  it("keeps the versions, because receipts have to stay explainable", async () => {
    const quiz = await publishableQuiz()
    await publish(quiz.id)
    await app.request(`/api/quizzes/${quiz.id}/unpublish`, {
      method: "POST",
      headers: headers(owner),
    })

    const versions = await db
      .select()
      .from(quizVersions)
      .where(eq(quizVersions.quizId, quiz.id))
    expect(versions).toHaveLength(1)
  })

  it("closes the link when the quiz is deleted, without relying on a join filter", async () => {
    const quiz = await publishableQuiz()
    const published = (await (await publish(quiz.id)).json()) as PublishResponse

    await app.request(`/api/quizzes/${quiz.id}`, {
      method: "DELETE",
      headers: headers(owner),
    })

    const [link] = await db
      .select({ revokedAt: examLinks.revokedAt })
      .from(examLinks)
      .where(eq(examLinks.token, published.token))

    expect(link?.revokedAt).not.toBeNull()
    expect((await app.request(`/e/${published.token}`)).status).toBe(404)
  })

  it("refuses a quiz that was never published", async () => {
    const quiz = await publishableQuiz()
    const res = await app.request(`/api/quizzes/${quiz.id}/unpublish`, {
      method: "POST",
      headers: headers(owner),
    })
    expect(res.status).toBe(409)
  })

  it("restores the same link on republish", async () => {
    const quiz = await publishableQuiz()
    const before = (await (await publish(quiz.id)).json()) as PublishResponse
    await app.request(`/api/quizzes/${quiz.id}/unpublish`, {
      method: "POST",
      headers: headers(owner),
    })

    const again = (await (await publish(quiz.id)).json()) as PublishResponse
    expect(again.token).toBe(before.token)
    expect((await app.request(`/e/${again.token}`)).status).toBe(200)
  })
})

describe("GET /e/:token", () => {
  it("tells a student to open the link in the exam app", async () => {
    const quiz = await publishableQuiz("Biology Midterm")
    const published = (await (await publish(quiz.id)).json()) as PublishResponse

    const res = await app.request(`/e/${published.token}`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/html")

    const body = await res.text()
    expect(body).toContain("Quizzer Exam")
    expect(body).toContain("Biology Midterm")
    expect(body).toContain(published.url)
  })

  it("keeps the link out of caches and search engines", async () => {
    const quiz = await publishableQuiz()
    const published = (await (await publish(quiz.id)).json()) as PublishResponse

    const res = await app.request(`/e/${published.token}`)
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(res.headers.get("x-robots-tag")).toContain("noindex")
  })

  it("shows the address we minted, not one taken from the request", async () => {
    const quiz = await publishableQuiz()
    const published = (await (await publish(quiz.id)).json()) as PublishResponse

    // A forwarded or spoofed Host must not become an address a student trusts.
    const res = await app.request(`/e/${published.token}`, {
      headers: { Host: "evil.example" },
    })

    const body = await res.text()
    expect(body).toContain(`${env.PUBLIC_API_ORIGIN}/e/${published.token}`)
    expect(body).not.toContain("evil.example")
  })

  it("404s an unknown token and 404s a malformed one", async () => {
    expect((await app.request("/e/aaaaaaaaaaaaaaaaaaaaaaaa")).status).toBe(404)
    expect((await app.request("/e/short")).status).toBe(404)
    expect((await app.request("/e/has%20spaces%20in%20it%20here")).status).toBe(404)
  })

  it("renders a title containing markup as text", async () => {
    const quiz = await publishableQuiz("<script>alert(1)</script>")
    const published = (await (await publish(quiz.id)).json()) as PublishResponse

    const body = await (await app.request(`/e/${published.token}`)).text()

    // This page is the one place in the system that builds an HTML string, and
    // the quiz title is teacher-authored.
    expect(body).not.toContain("<script>alert(1)</script>")
    expect(body).toContain("&lt;script&gt;")
  })

  /** The reason this route is allowed to be public at all. */
  it("leaks nothing about the questions", async () => {
    const quiz = await publishableQuiz()
    const published = (await (await publish(quiz.id)).json()) as PublishResponse

    const body = await (await app.request(`/e/${published.token}`)).text()

    expect(body).not.toContain("Water boils")
    expect(body).not.toContain("Pick the prime")
    expect(body).not.toContain("questions")
    expect(body).not.toContain("correct")
    expect(body).not.toContain("true_false")

    // And the summaries the teacher surface returns are not reachable here.
    const list = await app.request("/api/quizzes")
    expect(list.status).toBe(401)
  })
})

describe("the published manifest itself", () => {
  it("carries no answer key, and the key is stored separately", async () => {
    const quiz = await publishableQuiz()
    await publish(quiz.id)

    const [version] = await db
      .select()
      .from(quizVersions)
      .where(eq(quizVersions.quizId, quiz.id))
    if (!version) throw new Error("no version written")

    const serialised = JSON.stringify(version.manifest)
    expect(serialised).not.toContain("correct")
    expect(serialised).not.toContain("answer")

    // The key exists, just not where a student can reach it.
    const keys = Object.values(version.answerKey.keys)
    expect(keys.some((k) => k?.kind === "true_false")).toBe(true)
    expect(keys.some((k) => k?.kind === "single_choice")).toBe(true)
  })
})

describe("the opening time", () => {
  it("reaches the link, so the server can refuse a link nobody may open yet", async () => {
    const quiz = await publishableQuiz("Opens later")
    const opensAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString()
    const withTime = await setOpensAt(quiz, opensAt)

    const res = await publish(withTime.id)
    expect(res.status).toBe(200)
    const published = (await res.json()) as PublishResponse

    // Authored on the draft, enforced on the link: the column the exam surface
    // reads is the one that has to end up carrying it.
    const row = await linkRow(published.token)
    expect(row.opensAt?.toISOString()).toBe(opensAt)
  })

  it("leaves the link open when the quiz opens as soon as it is published", async () => {
    const quiz = await publishableQuiz("Opens now")

    const res = await publish(quiz.id)
    const published = (await res.json()) as PublishResponse

    expect((await linkRow(published.token)).opensAt).toBeNull()
  })

  it("re-applies on republish, in both directions", async () => {
    const quiz = await publishableQuiz("Moves")
    const opensAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString()

    const withTime = await setOpensAt(quiz, opensAt)
    const first = (await (await publish(withTime.id)).json()) as PublishResponse
    expect((await linkRow(first.token)).opensAt).not.toBeNull()

    // Changing your mind is publishing again. The token is the same one
    // students already have, so clearing the time has to clear the column
    // rather than leave a link that stays shut.
    const reopened = await app.request(`/api/quizzes/${quiz.id}`, {
      headers: headers(owner),
    })
    const cleared = await setOpensAt((await reopened.json()) as QuizDetail, undefined)
    const second = (await (await publish(cleared.id)).json()) as PublishResponse

    expect(second.token).toBe(first.token)
    expect((await linkRow(second.token)).opensAt).toBeNull()
  })
})
