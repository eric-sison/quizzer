import "server-only"

import { cache } from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import { env } from "./env"

/**
 * The authentication seam.
 *
 * Sign-in is real now: Better Auth runs inside apps/api and this file reads
 * the session it minted by forwarding the browser's cookie. Callers still
 * only ever see a `Teacher`, so nothing outside this file changed when the
 * mock went away.
 */
export type Teacher = {
  id: string
  name: string
  email: string
}

const sessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullish(),
  role: z.enum(["admin", "teacher", "student"]).nullable(),
  institutionId: z.string().nullable(),
  teacherProfileId: z.string().nullable(),
})

/**
 * Loose on purpose: Better Auth owns this payload and adds fields freely.
 * Only what apps/web actually reads is pinned down.
 */
const sessionSchema = z.object({
  user: sessionUserSchema.loose(),
  session: z.looseObject({}),
})

export type SessionUser = z.infer<typeof sessionUserSchema>
export type Session = { user: SessionUser; session: Record<string, unknown> }

/**
 * The current session, or null when signed out.
 *
 * Wrapped in React `cache()` so a layout, its pages and the sidebar asking in
 * the same render pay for one round-trip, not three. The fetch goes straight
 * to apps/api (not through the rewrite) with the incoming cookie forwarded -
 * server components have no cookie jar of their own.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  let response: Response
  try {
    response = await fetch(`${env.API_ORIGIN}/api/auth/get-session`, {
      headers: { cookie: (await cookies()).toString() },
      cache: "no-store",
    })
  } catch {
    // The API being down reads the same as being signed out: the login page.
    return null
  }

  if (!response.ok) return null

  // Better Auth answers a missing session with the literal `null`.
  const body: unknown = await response.json().catch(() => null)
  if (body === null) return null

  const parsed = sessionSchema.safeParse(body)
  return parsed.success ? (parsed.data as Session) : null
})

export async function getCurrentTeacher(): Promise<Teacher> {
  const session = await getSession()
  if (!session) redirect("/login")

  const { user } = session
  const isTeacher = user.role === "teacher" || user.role === "admin"
  if (!isTeacher || !user.teacherProfileId) {
    // Signed in, but not someone this app is for - a student, or a Google
    // account with no membership. Say so instead of looping them back.
    redirect("/login?error=not_authorized")
  }

  return { id: user.teacherProfileId, name: user.name, email: user.email }
}

export type Admin = {
  userId: string
  name: string
  email: string
}

export async function requireAdmin(): Promise<Admin> {
  const session = await getSession()
  if (!session) redirect("/login")

  const { user } = session
  if (user.role !== "admin") {
    redirect("/login?error=not_authorized")
  }

  return { userId: user.id, name: user.name, email: user.email }
}
