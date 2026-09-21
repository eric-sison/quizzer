/**
 * Question-image routes, against the real database AND the real Garage from
 * docker-compose - a mocked S3 would pass while the actual bucket, key or
 * path-style setting was wrong.
 */
import {
  createQuestion,
  createQuizDoc,
  richDocFromText,
  type QuizDetail,
} from "@workspace/quiz-core"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createApp } from "../../app"
import { db, sqlClient, teachers } from "../../db"
import { env } from "../../env"

const app = createApp()

let owner: string
let stranger: string

/** Smallest valid PNG: 1x1 transparent pixel. */
const PIXEL_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg=="
  ),
  (c) => c.charCodeAt(0)
)

function headers(teacherId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${env.SERVICE_TOKEN}`,
    "X-Teacher-Id": teacherId,
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

async function newQuiz(teacherId: string): Promise<QuizDetail> {
  const res = await app.request("/api/quizzes", {
    method: "POST",
    headers: { ...headers(teacherId), "Content-Type": "application/json" },
    body: JSON.stringify({ title: "With pictures" }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as QuizDetail
}

async function upload(
  teacherId: string,
  quizId: string,
  body: Uint8Array = PIXEL_PNG,
  contentType = "image/png"
): Promise<Response> {
  return app.request(`/api/quizzes/${quizId}/media`, {
    method: "POST",
    headers: { ...headers(teacherId), "Content-Type": contentType },
    body,
  })
}

beforeAll(async () => {
  owner = await makeTeacher("media-owner")
  stranger = await makeTeacher("media-stranger")
})

afterAll(async () => {
  await db.delete(teachers).where(eq(teachers.id, owner))
  await db.delete(teachers).where(eq(teachers.id, stranger))
  await sqlClient.end()
})

describe("teacher media", () => {
  it("round-trips an image byte for byte", async () => {
    const quiz = await newQuiz(owner)

    const uploaded = await upload(owner, quiz.id)
    expect(uploaded.status).toBe(201)
    const { id } = (await uploaded.json()) as { id: string }

    const res = await app.request(`/api/media/${id}`, { headers: headers(owner) })
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("image/png")
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PIXEL_PNG)
  })

  it("refuses anything that is not an image", async () => {
    const quiz = await newQuiz(owner)
    const res = await upload(owner, quiz.id, PIXEL_PNG, "text/html")

    expect(res.status).toBe(415)
    expect(await res.json()).toMatchObject({
      error: { code: "unsupported_media_type" },
    })
  })

  it("refuses an oversized image before it reaches storage", async () => {
    const quiz = await newQuiz(owner)
    const res = await upload(owner, quiz.id, new Uint8Array(5 * 1024 * 1024 + 1))

    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({ error: { code: "payload_too_large" } })
  })

  it("hides another teacher's media entirely", async () => {
    const quiz = await newQuiz(owner)
    const uploaded = await upload(owner, quiz.id)
    const { id } = (await uploaded.json()) as { id: string }

    const res = await app.request(`/api/media/${id}`, { headers: headers(stranger) })
    expect(res.status).toBe(404)
  })

  it("refuses an upload to a quiz the teacher does not own", async () => {
    const quiz = await newQuiz(owner)
    const res = await upload(stranger, quiz.id)
    expect(res.status).toBe(404)
  })
})

describe("exam media", () => {
  /** Publish a one-question quiz whose question carries the uploaded image. */
  async function publishedWithImage(teacherId: string) {
    const quiz = await newQuiz(teacherId)
    const uploaded = await upload(teacherId, quiz.id)
    const { id: mediaId } = (await uploaded.json()) as { id: string }

    const base = createQuizDoc("With pictures")
    const doc = {
      ...base,
      questions: [
        {
          ...createQuestion("true_false"),
          correct: true,
          promptDoc: {
            type: "doc" as const,
            content: [
              ...richDocFromText("Is this a picture?").content,
              {
                type: "image" as const,
                attrs: { mediaId, alt: "One transparent pixel" },
              },
            ],
          },
        },
      ],
    }

    await app.request(`/api/quizzes/${quiz.id}/draft`, {
      method: "PUT",
      headers: { ...headers(teacherId), "Content-Type": "application/json" },
      body: JSON.stringify({ doc, docVersion: quiz.docVersion }),
    })

    const res = await app.request(`/api/quizzes/${quiz.id}/publish`, {
      method: "POST",
      headers: headers(teacherId),
    })
    expect(res.status).toBe(200)
    const { token } = (await res.json()) as { token: string }
    return { mediaId, token }
  }

  async function claim(token: string): Promise<string> {
    const res = await app.request("/api/exam/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, client_version: "0.1.0", platform: "macos" }),
    })
    expect(res.status).toBe(200)
    const { session_jwt } = (await res.json()) as { session_jwt: string }
    return session_jwt
  }

  it("publishes the image reference and serves the bytes to the session", async () => {
    const { mediaId, token } = await publishedWithImage(owner)

    const jwt = await claim(token)
    const session = await app.request("/api/exam/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, client_version: "0.1.0", platform: "macos" }),
    })
    const manifest = ((await session.json()) as { exam: { questions: unknown[] } }).exam
    // The image travels inside prompt_doc as an opaque media id, never a URL.
    expect(manifest.questions[0]).toMatchObject({
      prompt_doc: {
        content: [
          {},
          { type: "image", attrs: { mediaId, alt: "One transparent pixel" } },
        ],
      },
    })
    expect(JSON.stringify(manifest)).not.toContain("http")

    const res = await app.request(`/api/exam/media/${mediaId}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PIXEL_PNG)
  })

  it("refuses media without a session credential", async () => {
    const { mediaId } = await publishedWithImage(owner)

    const res = await app.request(`/api/exam/media/${mediaId}`)
    expect(res.status).toBe(401)
  })

  it("scopes a session to its own quiz's media", async () => {
    const { mediaId } = await publishedWithImage(owner)
    // A second, unrelated exam tries to read the first exam's image.
    const other = await publishedWithImage(stranger)
    const jwt = await claim(other.token)

    const res = await app.request(`/api/exam/media/${mediaId}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    expect(res.status).toBe(404)
  })
})

describe("media library listing", () => {
  it("lists the quiz's media newest first, and only its own", async () => {
    const quiz = await newQuiz(owner)
    const other = await newQuiz(owner)
    const { id: mine } = (await (await upload(owner, quiz.id)).json()) as { id: string }
    await upload(owner, other.id)

    const res = await app.request(`/api/quizzes/${quiz.id}/media`, {
      headers: headers(owner),
    })
    expect(res.status).toBe(200)
    const items = (await res.json()) as { id: string; contentType: string }[]

    expect(items.map((i) => i.id)).toEqual([mine])
    expect(items[0]).toMatchObject({ contentType: "image/png", sizeBytes: PIXEL_PNG.length })
  })

  it("is empty for a quiz with no uploads and hidden from strangers", async () => {
    const quiz = await newQuiz(owner)

    const empty = await app.request(`/api/quizzes/${quiz.id}/media`, {
      headers: headers(owner),
    })
    expect(await empty.json()).toEqual([])

    const res = await app.request(`/api/quizzes/${quiz.id}/media`, {
      headers: headers(stranger),
    })
    expect(res.status).toBe(404)
  })
})

describe("duplicating a quiz", () => {
  /** A draft whose prompt carries the uploaded image. */
  async function quizWithImage() {
    const quiz = await newQuiz(owner)
    const uploaded = await upload(owner, quiz.id)
    const { id: mediaId } = (await uploaded.json()) as { id: string }

    const base = createQuizDoc("With pictures")
    const doc = {
      ...base,
      questions: [
        {
          ...createQuestion("true_false"),
          correct: true,
          promptDoc: {
            type: "doc" as const,
            content: [
              ...richDocFromText("Look:").content,
              { type: "image" as const, attrs: { mediaId, alt: "Pixel" } },
            ],
          },
        },
      ],
    }
    await app.request(`/api/quizzes/${quiz.id}/draft`, {
      method: "PUT",
      headers: { ...headers(owner), "Content-Type": "application/json" },
      body: JSON.stringify({ doc, docVersion: quiz.docVersion }),
    })
    return { quiz, mediaId, doc }
  }

  it("re-mints ids and duplicates the media, surviving the source's deletion", async () => {
    const { quiz, mediaId, doc } = await quizWithImage()

    const res = await app.request(`/api/quizzes/${quiz.id}/duplicate`, {
      method: "POST",
      headers: headers(owner),
    })
    expect(res.status).toBe(201)
    const copy = (await res.json()) as {
      id: string
      doc: { title: string; questions: { id: string; promptDoc: unknown }[] }
    }

    expect(copy.id).not.toBe(quiz.id)
    expect(copy.doc.title).toBe("With pictures (copy)")
    expect(copy.doc.questions[0]!.id).not.toBe(doc.questions[0]!.id)

    // The copy references a NEW media id...
    const serialised = JSON.stringify(copy.doc)
    expect(serialised).not.toContain(mediaId)
    const match = /"mediaId":"([0-9a-f-]{36})"/.exec(serialised)
    expect(match).not.toBeNull()
    const newMediaId = match![1]!

    // ...whose bytes are identical...
    const img = await app.request(`/api/media/${newMediaId}`, { headers: headers(owner) })
    expect(img.status).toBe(200)
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PIXEL_PNG)

    // ...and which keeps serving after the source quiz (and its media) is gone.
    await app.request(`/api/quizzes/${quiz.id}`, {
      method: "DELETE",
      headers: headers(owner),
    })
    const after = await app.request(`/api/media/${newMediaId}`, { headers: headers(owner) })
    expect(after.status).toBe(200)
  })

  it("is owner-scoped", async () => {
    const { quiz } = await quizWithImage()
    const res = await app.request(`/api/quizzes/${quiz.id}/duplicate`, {
      method: "POST",
      headers: headers(stranger),
    })
    expect(res.status).toBe(404)
  })
})
