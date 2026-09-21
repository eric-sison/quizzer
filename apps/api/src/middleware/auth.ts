/**
 * The teacher auth seam.
 *
 * While sign-in is mocked, apps/web proves it is apps/web with a shared
 * SERVICE_TOKEN and names the acting teacher in `X-Teacher-Id`. When real auth
 * lands, this middleware reads the user's JWT instead and everything
 * downstream - which only ever sees `c.get("teacher")` - is unaffected.
 *
 * This is deliberately NOT the same credential as an exam session JWT. An exam
 * token reaching a teacher route must fail here.
 */
import { timingSafeEqual } from "node:crypto"

import { eq } from "drizzle-orm"
import { createMiddleware } from "hono/factory"

import { db, teachers } from "../db"
import { env } from "../env"
import { forbidden, unauthorized } from "../lib/errors"
import type { AppEnv } from "../lib/hono"

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const requireTeacher = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization") ?? ""
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : ""

  if (!token || !secretsMatch(token, env.SERVICE_TOKEN)) {
    throw unauthorized("Missing or invalid service credential.")
  }

  const teacherId = c.req.header("X-Teacher-Id")
  if (!teacherId) {
    throw unauthorized("No acting teacher named.")
  }

  const [teacher] = await db
    .select()
    .from(teachers)
    .where(eq(teachers.id, teacherId))
    .limit(1)

  if (!teacher) {
    throw forbidden("Unknown teacher.")
  }

  c.set("teacher", teacher)
  await next()
})
