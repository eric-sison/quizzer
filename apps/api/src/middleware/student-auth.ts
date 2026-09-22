/**
 * The student gate on the exam-session claim - and only there.
 *
 * The desktop's Rust process presents its Better Auth session token as
 * `Authorization: Bearer` on POST /api/exam/session. This middleware resolves
 * it and re-checks, at claim time, everything the sign-in hooks checked at
 * sign-in time: the account still exists and still holds an active membership.
 * Defense in depth - an account suspended between sign-in and Begin is refused
 * here even though its session row still exists.
 *
 * Teachers and admins pass too, so staff can sit their own exams. Everything
 * *after* the claim runs on the exam JWT, exactly as before; this credential
 * buys identity, not exam access.
 */
import { createMiddleware } from "hono/factory"

import { ApiError } from "../lib/errors"
import type { ExamEnv } from "../lib/hono"
import { resolveSession } from "./auth"

export const requireStudent = createMiddleware<ExamEnv>(async (c, next) => {
  const actor = await resolveSession(c)

  if (!actor) {
    throw new ApiError("auth_required", 401, "Sign in with your school account first.")
  }

  // A null role means no active membership: suspended, or their domain was
  // delisted after they signed in.
  if (!actor.role) {
    throw new ApiError(
      "student_not_allowed",
      403,
      "This account can't sit exams here. Use your school Google account."
    )
  }

  c.set("student", {
    userId: actor.userId,
    email: actor.email,
    name: actor.name,
  })
  await next()
})
