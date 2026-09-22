/**
 * The teacher/admin auth seam - now reading real sessions.
 *
 * A request proves who it is with a Better Auth session: the cookie apps/web
 * forwards from the browser, or a bearer token. From the session we resolve an
 * active membership (the role lives in institution_members, nowhere a client
 * can write) and the authoring profile row. Everything downstream still only
 * ever sees `c.get("teacher")`.
 *
 * This is deliberately NOT the same credential as an exam session JWT. An exam
 * token reaching a teacher route must fail here - it does, because it is not a
 * Better Auth session at all.
 *
 * The old SERVICE_TOKEN + X-Teacher-Id bridge survives outside production so
 * the existing tests and local tooling keep working while they migrate; the
 * production build refuses it.
 */
import { timingSafeEqual } from "node:crypto"

import { eq } from "drizzle-orm"
import { createMiddleware } from "hono/factory"
import type { Context } from "hono"

import { db, teachers } from "../db"
import { env } from "../env"
import { auth } from "../lib/auth"
import { forbidden, unauthorized } from "../lib/errors"
import type { AppEnv } from "../lib/hono"

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** The session as `getSession` returns it, with the customSession extras. */
export type SessionActor = {
  userId: string
  name: string
  email: string
  role: "admin" | "teacher" | "student" | null
  institutionId: string | null
  teacherProfileId: string | null
}

export async function resolveSession(c: Context): Promise<SessionActor | null> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return null

  const user = session.user as typeof session.user & {
    role: SessionActor["role"]
    institutionId: string | null
    teacherProfileId: string | null
  }

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role ?? null,
    institutionId: user.institutionId ?? null,
    teacherProfileId: user.teacherProfileId ?? null,
  }
}

/** Dev/test bridge only. Production never honours the service token. */
async function legacyServiceTokenTeacher(c: Context) {
  if (env.NODE_ENV === "production") return null

  const header = c.req.header("Authorization") ?? ""
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : ""
  if (!token || !secretsMatch(token, env.SERVICE_TOKEN)) return null

  const teacherId = c.req.header("X-Teacher-Id")
  if (!teacherId) return null

  const [teacher] = await db
    .select()
    .from(teachers)
    .where(eq(teachers.id, teacherId))
    .limit(1)

  return teacher ?? null
}

export const requireTeacher = createMiddleware<AppEnv>(async (c, next) => {
  const actor = await resolveSession(c)

  if (actor) {
    // Role check first: a student holds a perfectly valid session and must
    // still be turned away from every authoring surface.
    if (actor.role !== "teacher" && actor.role !== "admin") {
      throw forbidden("Not a teacher.")
    }

    const [teacher] = await db
      .select()
      .from(teachers)
      .where(eq(teachers.userId, actor.userId))
      .limit(1)
    if (!teacher) {
      throw forbidden("No authoring profile for this account.")
    }

    c.set("teacher", teacher)
    return next()
  }

  const legacy = await legacyServiceTokenTeacher(c)
  if (legacy) {
    c.set("teacher", legacy)
    return next()
  }

  throw unauthorized("Sign in to continue.")
})

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const actor = await resolveSession(c)
  if (!actor) throw unauthorized("Sign in to continue.")
  if (actor.role !== "admin") throw forbidden("Not an administrator.")
  if (!actor.institutionId) throw forbidden("Not an administrator.")

  c.set("admin", {
    userId: actor.userId,
    email: actor.email,
    institutionId: actor.institutionId,
  })
  await next()
})
