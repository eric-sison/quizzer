/**
 * The exam session credential.
 *
 * This is a different credential from the teacher's, signed with a different
 * secret and carrying a different audience, and `env.ts` refuses to boot if the
 * two secrets match. That separation is the main new attack surface the split
 * introduced: an exam token that could authorize a teacher endpoint would let
 * any student read the answer key of every quiz they own.
 *
 * The token never leaves the Rust process on the desktop side. It is not in the
 * IPC snapshot and there is a `cargo test` that says so.
 */
import { sign, verify } from "hono/jwt"

import { env } from "../env"

/** Anything without this audience is not an exam session, whatever it signed. */
export const EXAM_AUDIENCE = "quizzer:exam"

export type ExamClaims = {
  /** The session id. */
  sub: string
  aud: typeof EXAM_AUDIENCE
  /** Expiry, epoch seconds. Checked by `verify`, and again against the row. */
  exp: number
  iat: number
}

/**
 * Pinned on both sides, never read from the token's own header. A verifier that
 * accepts whatever `alg` the token names is the classic JWT hole: `none`, or an
 * asymmetric key swapped for a symmetric one.
 */
const ALGORITHM = "HS256"

export async function signExamToken(sessionId: string, expiresAt: Date): Promise<string> {
  const claims: ExamClaims = {
    sub: sessionId,
    aud: EXAM_AUDIENCE,
    exp: Math.floor(expiresAt.getTime() / 1_000),
    iat: Math.floor(Date.now() / 1_000),
  }
  return sign(claims, env.EXAM_JWT_SECRET, ALGORITHM)
}

/**
 * Returns the session id, or null for anything that is not a live exam token.
 *
 * Deliberately total: a malformed token, a wrong signature, a teacher token and
 * an expired one all come back the same way, so no caller can accidentally
 * treat one of them as a different kind of failure.
 */
export async function readExamToken(token: string): Promise<string | null> {
  try {
    const claims = (await verify(token, env.EXAM_JWT_SECRET, {
      alg: ALGORITHM,
      // A teacher credential must never open an exam route, and vice versa.
      aud: EXAM_AUDIENCE,
    })) as Partial<ExamClaims>

    if (typeof claims.sub !== "string" || claims.sub.length === 0) return null

    return claims.sub
  } catch {
    return null
  }
}

/** Epoch seconds, the unit the exam surface speaks. */
export function epochSeconds(at: Date = new Date()): number {
  return Math.floor(at.getTime() / 1_000)
}
