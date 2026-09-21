import {
  createQuizRequestSchema,
  saveDraftRequestSchema,
} from "@workspace/quiz-core"
import { Hono } from "hono"
import { z } from "zod"

import type { AppEnv } from "../lib/hono"
import { validate } from "../lib/validate"
import { requireTeacher } from "../middleware/auth"
import { publishQuiz, unpublishQuiz } from "../services/publish"
import {
  archiveQuiz,
  createQuiz,
  getQuiz,
  listQuizzes,
  saveDraft,
} from "../services/quizzes"

const quizIdParam = z.object({ id: z.uuid() })

export const quizRoutes = new Hono<AppEnv>()

// Every route below acts as a teacher; none of them is reachable by the exam
// client, whose session JWT is a different credential entirely.
quizRoutes.use("/api/quizzes/*", requireTeacher)
quizRoutes.use("/api/quizzes", requireTeacher)

quizRoutes.get("/api/quizzes", async (c) => {
  return c.json(await listQuizzes(c.get("teacher").id))
})

quizRoutes.post("/api/quizzes", validate("json", createQuizRequestSchema), async (c) => {
  const { title } = c.req.valid("json")
  return c.json(await createQuiz(c.get("teacher").id, title), 201)
})

quizRoutes.get("/api/quizzes/:id", validate("param", quizIdParam), async (c) => {
  const { id } = c.req.valid("param")
  return c.json(await getQuiz(c.get("teacher").id, id))
})

quizRoutes.put(
  "/api/quizzes/:id/draft",
  validate("param", quizIdParam),
  validate("json", saveDraftRequestSchema),
  async (c) => {
    const { id } = c.req.valid("param")
    const { doc, docVersion } = c.req.valid("json")
    return c.json(await saveDraft(c.get("teacher").id, id, doc, docVersion))
  }
)

quizRoutes.post(
  "/api/quizzes/:id/publish",
  validate("param", quizIdParam),
  async (c) => {
    const { id } = c.req.valid("param")
    return c.json(await publishQuiz(c.get("teacher").id, id))
  }
)

quizRoutes.post(
  "/api/quizzes/:id/unpublish",
  validate("param", quizIdParam),
  async (c) => {
    const { id } = c.req.valid("param")
    await unpublishQuiz(c.get("teacher").id, id)
    return c.body(null, 204)
  }
)

quizRoutes.delete("/api/quizzes/:id", validate("param", quizIdParam), async (c) => {
  const { id } = c.req.valid("param")
  await archiveQuiz(c.get("teacher").id, id)
  return c.body(null, 204)
})
