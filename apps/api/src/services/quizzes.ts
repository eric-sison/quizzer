/**
 * Data access for the teacher surface.
 *
 * Every function takes the acting teacher's id and scopes its query by it.
 * A quiz belonging to someone else reports as *not found* rather than
 * forbidden: answering 403 would confirm the id exists, which is a small
 * disclosure with no upside.
 */
import { createQuizDoc, type QuizDetail, type QuizDoc, type QuizSummary } from "@workspace/quiz-core"
import { and, desc, eq, isNull, sql } from "drizzle-orm"

import { db } from "../db"
import { examLinks, quizVersions, quizzes } from "../db/schema"
import { env } from "../env"
import { conflict, notFound } from "../lib/errors"

function linkUrl(token: string | null): string | null {
  return token ? `${env.PUBLIC_API_ORIGIN}/e/${token}` : null
}

/**
 * A published quiz whose draft has moved on since. Null `publishedDocVersion`
 * with a live version means it was published before this column existed, so
 * treat it as up to date rather than permanently dirty.
 */
function computeHasUnpublishedChanges(
  activeVersionId: string | null,
  docVersion: number,
  publishedDocVersion: number | null
): boolean {
  if (!activeVersionId) return false
  if (publishedDocVersion === null) return false
  return docVersion > publishedDocVersion
}

export async function listQuizzes(teacherId: string): Promise<QuizSummary[]> {
  const rows = await db
    .select({
      id: quizzes.id,
      title: quizzes.title,
      status: quizzes.status,
      // Counted in SQL so the list response never carries the draft document.
      questionCount: sql<number>`coalesce(jsonb_array_length(${quizzes.draftDoc} -> 'questions'), 0)`,
      durationS: sql<number>`coalesce((${quizzes.draftDoc} -> 'settings' ->> 'durationS')::int, 0)`,
      updatedAt: quizzes.updatedAt,
      docVersion: quizzes.docVersion,
      publishedDocVersion: quizzes.publishedDocVersion,
      activeVersionId: quizzes.activeVersionId,
      publishedAt: quizVersions.publishedAt,
      versionNo: quizVersions.versionNo,
      token: examLinks.token,
      revokedAt: examLinks.revokedAt,
    })
    .from(quizzes)
    .leftJoin(quizVersions, eq(quizzes.activeVersionId, quizVersions.id))
    .leftJoin(examLinks, eq(examLinks.quizId, quizzes.id))
    .where(and(eq(quizzes.ownerId, teacherId), isNull(quizzes.archivedAt)))
    .orderBy(desc(quizzes.updatedAt))

  return rows.map((row) => {
    const token = row.revokedAt ? null : row.token
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      questionCount: Number(row.questionCount),
      durationS: Number(row.durationS),
      updatedAt: row.updatedAt.toISOString(),
      publishedAt: row.publishedAt?.toISOString() ?? null,
      versionNo: row.versionNo,
      hasUnpublishedChanges: computeHasUnpublishedChanges(
        row.activeVersionId,
        row.docVersion,
        row.publishedDocVersion
      ),
      token,
      url: linkUrl(token),
    }
  })
}

export async function createQuiz(teacherId: string, title?: string): Promise<QuizDetail> {
  const doc = createQuizDoc(title ?? "")

  const [row] = await db
    .insert(quizzes)
    .values({ ownerId: teacherId, title: doc.title, draftDoc: doc })
    .returning()

  if (!row) throw new Error("insert returned no row")

  return {
    id: row.id,
    status: row.status,
    doc: row.draftDoc,
    docVersion: row.docVersion,
    hasUnpublishedChanges: false,
    token: null,
    url: null,
  }
}

export async function getQuiz(teacherId: string, quizId: string): Promise<QuizDetail> {
  const [row] = await db
    .select({
      id: quizzes.id,
      status: quizzes.status,
      draftDoc: quizzes.draftDoc,
      docVersion: quizzes.docVersion,
      publishedDocVersion: quizzes.publishedDocVersion,
      activeVersionId: quizzes.activeVersionId,
      token: examLinks.token,
      revokedAt: examLinks.revokedAt,
    })
    .from(quizzes)
    .leftJoin(examLinks, eq(examLinks.quizId, quizzes.id))
    .where(
      and(
        eq(quizzes.id, quizId),
        eq(quizzes.ownerId, teacherId),
        isNull(quizzes.archivedAt)
      )
    )
    .limit(1)

  if (!row) throw notFound("No such quiz.")

  const token = row.revokedAt ? null : row.token

  return {
    id: row.id,
    status: row.status,
    doc: row.draftDoc,
    docVersion: row.docVersion,
    hasUnpublishedChanges: computeHasUnpublishedChanges(
      row.activeVersionId,
      row.docVersion,
      row.publishedDocVersion
    ),
    token,
    url: linkUrl(token),
  }
}

/**
 * Autosave. The update is conditional on `expectedVersion`, so a write based on
 * a stale read touches nothing and reports 409 instead of silently discarding
 * whatever the other tab saved.
 */
export async function saveDraft(
  teacherId: string,
  quizId: string,
  doc: QuizDoc,
  expectedVersion: number
): Promise<{ docVersion: number; updatedAt: string }> {
  const [row] = await db
    .update(quizzes)
    .set({
      draftDoc: doc,
      // Denormalised so the quiz list never has to read the document.
      title: doc.title,
      docVersion: sql`${quizzes.docVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(quizzes.id, quizId),
        eq(quizzes.ownerId, teacherId),
        isNull(quizzes.archivedAt),
        eq(quizzes.docVersion, expectedVersion)
      )
    )
    .returning({ docVersion: quizzes.docVersion, updatedAt: quizzes.updatedAt })

  if (row) {
    return { docVersion: row.docVersion, updatedAt: row.updatedAt.toISOString() }
  }

  // Nothing matched: either the quiz is gone, or the version moved on. Tell
  // them apart so the editor can show the right message.
  const [current] = await db
    .select({ docVersion: quizzes.docVersion })
    .from(quizzes)
    .where(
      and(
        eq(quizzes.id, quizId),
        eq(quizzes.ownerId, teacherId),
        isNull(quizzes.archivedAt)
      )
    )
    .limit(1)

  if (!current) throw notFound("No such quiz.")

  throw conflict(
    `This quiz was edited somewhere else (now at version ${current.docVersion}).`
  )
}

/**
 * Soft delete. Published versions, sessions and receipts must outlive the quiz,
 * so the row is archived rather than removed.
 */
export async function archiveQuiz(teacherId: string, quizId: string): Promise<void> {
  const archived = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(quizzes)
      .set({ archivedAt: new Date(), status: "archived", updatedAt: new Date() })
      .where(
        and(
          eq(quizzes.id, quizId),
          eq(quizzes.ownerId, teacherId),
          isNull(quizzes.archivedAt)
        )
      )
      .returning({ id: quizzes.id })

    if (!row) return false

    // Revoked explicitly, not left to the `archivedAt` filter in whatever query
    // happens to read the link next. A deleted quiz whose link still resolves
    // because one join forgot a WHERE clause is not a failure anyone would
    // notice until a student sat the exam.
    await tx
      .update(examLinks)
      .set({ revokedAt: new Date() })
      .where(and(eq(examLinks.quizId, quizId), isNull(examLinks.revokedAt)))

    return true
  })

  if (!archived) throw notFound("No such quiz.")
}
