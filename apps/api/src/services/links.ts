/**
 * Resolving a pasted quiz link, for the landing page only.
 *
 * Deliberately returns almost nothing: a title and a state. The manifest lives
 * behind `POST /api/exam/session`, which the desktop client calls with its own
 * credential. Anything this function returned would be readable by anyone with
 * the link, in any browser, without an exam session.
 */
import { and, eq, isNull, sql } from "drizzle-orm"

import { db } from "../db"
import { examLinks, quizVersions, quizzes } from "../db/schema"

/** Mirrors `is_valid_token` in apps/desktop/src-tauri/src/session.rs. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

export function isWellFormedToken(token: string): boolean {
  return TOKEN_PATTERN.test(token)
}

export type LinkState =
  | { state: "open"; title: string; description?: string }
  /** The teacher took it out of service. */
  | { state: "revoked"; title: string; description?: string }
  /** No such token, or the quiz behind it is gone. */
  | { state: "unknown" }

export async function resolveLink(token: string): Promise<LinkState> {
  if (!isWellFormedToken(token)) return { state: "unknown" }

  const [row] = await db
    .select({
      title: quizzes.title,
      revokedAt: examLinks.revokedAt,
      activeVersionId: quizzes.activeVersionId,
      // The PUBLISHED description, from the active version's manifest - the
      // draft may have moved on and stays private until republished.
      description: sql<string | null>`${quizVersions.manifest} ->> 'description'`,
    })
    .from(examLinks)
    .innerJoin(quizzes, eq(examLinks.quizId, quizzes.id))
    .leftJoin(quizVersions, eq(quizzes.activeVersionId, quizVersions.id))
    .where(and(eq(examLinks.token, token), isNull(quizzes.archivedAt)))
    .limit(1)

  if (!row || !row.activeVersionId) return { state: "unknown" }

  const title = row.title.trim() || "Untitled quiz"
  const description = row.description?.trim() || undefined
  // "Closed" and "never existed" are different things to a student standing in
  // front of it, and a 192-bit token is not something anyone enumerates, so
  // telling them apart costs nothing and saves a support conversation.
  return row.revokedAt
    ? { state: "revoked", title, description }
    : { state: "open", title, description }
}
