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
  /**
   * Token expiry, epoch seconds. NOT the exam deadline: it runs past it by
   * `SUBMIT_GRACE_S` so the submit at the buzzer can authenticate. What the
   * student may still write is decided by the session row, not by this.
   */
  exp: number
  iat: number
}

/**
 * Pinned on both sides, never read from the token's own header. A verifier that
 * accepts whatever `alg` the token names is the classic JWT hole: `none`, or an
 * asymmetric key swapped for a symmetric one.
 */
const ALGORITHM = "HS256"

/**
 * How long a session credential outlives the exam it belongs to.
 *
 * The token MUST outlast the deadline, because the one call that has to
 * succeed is the one that happens after time runs out: the client submits at
 * the buzzer, and a credential that expired on the same second would make
 * every auto-submit fail authentication and retry forever. The same goes for
 * the heartbeat a client uses to discover it is over, and for the proctor
 * events around the end of a sitting - which is exactly the stretch of the
 * audit trail a teacher cares about.
 *
 * This grace does NOT extend the exam. What a student may still write is
 * decided by `assertWritable` against the session row's own `expiresAt`, so an
 * answer sent one second past the deadline is refused with a live token in
 * hand. The grace buys the end-of-exam calls, nothing else.
 */
export const SUBMIT_GRACE_S = 10 * 60

export async function signExamToken(sessionId: string, expiresAt: Date): Promise<string> {
  const claims: ExamClaims = {
    sub: sessionId,
    aud: EXAM_AUDIENCE,
    exp: Math.floor(expiresAt.getTime() / 1_000) + SUBMIT_GRACE_S,
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
