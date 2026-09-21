/**
 * Publishing: the one path that turns a teacher's draft into something a
 * student can receive.
 *
 * Order matters here. Validation gates first, the projection strips the answer
 * key second, and the leak check runs before anything is written, so a manifest
 * that should not exist never reaches a row, let alone a student.
 */
import { randomBytes } from "node:crypto"

import {
  extractKey,
  hasErrors,
  project,
  validateQuiz,
  type PublishResponse,
  type QuizDoc,
} from "@workspace/quiz-core"
import { and, eq, isNull, sql } from "drizzle-orm"

import { db } from "../db"
import { examLinks, quizVersions, quizzes } from "../db/schema"
import { env } from "../env"
import { conflict, notFound, validationFailed } from "../lib/errors"

/**
 * 24 random bytes as base64url: 32 characters of `[A-Za-z0-9_-]`.
 *
 * The alphabet and length are not arbitrary. The desktop client validates a
 * pasted token offline against exactly that character set and a 16 to 128
 * length window (`is_valid_token` in apps/desktop/src-tauri/src/session.rs);
 * anything else is rejected before a request is ever made, which would look to
 * a student like a broken link rather than a server they cannot reach.
 */
export function mintToken(): string {
  return randomBytes(24).toString("base64url")
}

/** How many times to re-roll on the (vanishingly unlikely) duplicate token. */
const TOKEN_ATTEMPTS = 5

export function linkUrl(token: string): string {
  return `${env.PUBLIC_API_ORIGIN}/e/${token}`
}

type PublishableQuiz = {
  id: string
  draftDoc: QuizDoc
  docVersion: number
}

async function loadForPublish(
  teacherId: string,
  quizId: string
): Promise<PublishableQuiz> {
  const [row] = await db
    .select({
      id: quizzes.id,
      draftDoc: quizzes.draftDoc,
      docVersion: quizzes.docVersion,
    })
    .from(quizzes)
    .where(
      and(
        eq(quizzes.id, quizId),
        eq(quizzes.ownerId, teacherId),
        isNull(quizzes.archivedAt)
      )
    )
    .limit(1)

  if (!row) throw notFound("No such quiz.")
  return row
}

export async function publishQuiz(
  teacherId: string,
  quizId: string
): Promise<PublishResponse> {
  const quiz = await loadForPublish(teacherId, quizId)

  // The authoritative gate. apps/web runs the same function for live feedback,
  // but its verdict is a convenience and is never trusted here.
  const issues = validateQuiz(quiz.draftDoc)
  if (hasErrors(issues)) throw validationFailed(issues)

  // `project` runs `assertNoAnswerLeak` itself and throws rather than return a
  // manifest carrying an answer.
  const manifest = project(quizId, quiz.draftDoc)
  const answerKey = extractKey(quiz.draftDoc)

  return db.transaction(async (tx) => {
    // Append-only: a new row every publish, so an exam already in progress is
    // unaffected by this one.
    const [{ next } = { next: 1 }] = await tx
      .select({
        next: sql<number>`coalesce(max(${quizVersions.versionNo}), 0) + 1`,
      })
      .from(quizVersions)
      .where(eq(quizVersions.quizId, quizId))

    const versionNo = Number(next)

    const [version] = await tx
      .insert(quizVersions)
      .values({
        quizId,
        versionNo,
        manifest,
        answerKey,
        publishedBy: teacherId,
      })
      .returning({ id: quizVersions.id, publishedAt: quizVersions.publishedAt })

    if (!version) throw new Error("publish inserted no version")

    const token = await ensureToken(tx, quizId)

    await tx
      .update(quizzes)
      .set({
        status: "published",
        activeVersionId: version.id,
        // What "has unpublished changes" is measured against from now on.
        publishedDocVersion: quiz.docVersion,
        updatedAt: new Date(),
      })
      .where(eq(quizzes.id, quizId))

    return {
      versionNo,
      token,
      url: linkUrl(token),
      publishedAt: version.publishedAt.toISOString(),
    }
  })
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * One token per quiz, for the life of the quiz.
 *
 * Republishing deliberately keeps it, so a link already written on a whiteboard
 * or pasted into a class group keeps working and simply resolves to the new
 * active version. Re-publishing also lifts a previous revocation: that is what
 * publishing again means.
 */
async function ensureToken(tx: Tx, quizId: string): Promise<string> {
  const [existing] = await tx
    .select({ token: examLinks.token })
    .from(examLinks)
    .where(eq(examLinks.quizId, quizId))
    .limit(1)

  if (existing) {
    await tx
      .update(examLinks)
      .set({ revokedAt: null })
      .where(eq(examLinks.token, existing.token))
    return existing.token
  }

  for (let attempt = 0; attempt < TOKEN_ATTEMPTS; attempt++) {
    const token = mintToken()
    const [row] = await tx
      .insert(examLinks)
      .values({ token, quizId })
      .onConflictDoNothing({ target: examLinks.token })
      .returning({ token: examLinks.token })

    if (row) return row.token
  }

  throw new Error(`could not mint a unique token in ${TOKEN_ATTEMPTS} attempts`)
}

/**
 * Take the link out of service.
 *
 * The version rows stay: they are immutable, sessions reference them, and a
 * receipt has to remain explainable long after a quiz is closed. Only the link
 * is revoked, which is what stops new sessions starting.
 */
export async function unpublishQuiz(teacherId: string, quizId: string): Promise<void> {
  const [quiz] = await db
    .select({ activeVersionId: quizzes.activeVersionId })
    .from(quizzes)
    .where(
      and(
        eq(quizzes.id, quizId),
        eq(quizzes.ownerId, teacherId),
        isNull(quizzes.archivedAt)
      )
    )
    .limit(1)

  if (!quiz) throw notFound("No such quiz.")
  if (!quiz.activeVersionId) throw conflict("This quiz is not published.")

  await db.transaction(async (tx) => {
    await tx
      .update(examLinks)
      .set({ revokedAt: new Date() })
      .where(and(eq(examLinks.quizId, quizId), isNull(examLinks.revokedAt)))

    await tx
      .update(quizzes)
      .set({ status: "draft", updatedAt: new Date() })
      .where(eq(quizzes.id, quizId))
  })
}
