/**
 * The institutional gate, running inside Better Auth's pipeline.
 *
 * There is no code path to a session that skips these: `validateUserInfo` runs
 * on every OAuth sign-in and sign-up, and the session hook runs on every
 * session Better Auth creates, including the device-flow redemption the
 * desktop client polls for. Nothing here ever reads a domain or an email from
 * a request body - only from Google's verified profile or from our own rows.
 */
import { and, eq } from "drizzle-orm"

import { db } from "../db"
import {
  institutionDomains,
  institutionMembers,
  institutions,
  pendingRoleGrants,
  teachers,
  user as users,
} from "../db"

/**
 * The domain of an email address: everything after the last "@", lowercased.
 * The whole domain is compared with equality, never `includes`/`endsWith`, so
 * neither `x@allowed.edu.evil.com` nor `x@evil-allowed.edu` can pass as
 * `allowed.edu`.
 */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@")
  if (at <= 0 || at === email.length - 1) return null
  return email.slice(at + 1).toLowerCase()
}

async function institutionForEmail(email: string) {
  const domain = emailDomain(email)
  if (!domain) return null

  const [row] = await db
    .select({
      institutionId: institutionDomains.institutionId,
      autoProvisionStudents: institutions.autoProvisionStudents,
    })
    .from(institutionDomains)
    .innerJoin(institutions, eq(institutionDomains.institutionId, institutions.id))
    .where(eq(institutionDomains.domain, domain))
    .limit(1)

  return row ?? null
}

export async function activeMembership(userId: string) {
  const [row] = await db
    .select({
      institutionId: institutionMembers.institutionId,
      role: institutionMembers.role,
    })
    .from(institutionMembers)
    .where(
      and(
        eq(institutionMembers.userId, userId),
        eq(institutionMembers.status, "active")
      )
    )
    .limit(1)

  return row ?? null
}

type ValidateResult = { error: string; errorDescription?: string } | undefined

/**
 * `user.validateUserInfo`: runs before any OAuth sign-up, sign-in or account
 * link is honoured, with Google's raw profile in hand. This is the allowlist
 * check itself - the email Google verified, nothing the client sent.
 */
export async function validateUserInfo(data: {
  user: { email?: string | null | undefined } & Record<string, unknown>
  source: {
    method: string
    oauth?: { providerId: string; profile?: Record<string, unknown> | undefined }
  }
}): Promise<ValidateResult> {
  const email = data.user.email
  if (!email) {
    return { error: "domain_not_allowed", errorDescription: "No email on this account." }
  }

  // Google reports verification in its profile. An unverified address could be
  // anyone's; it never enters.
  const profile = data.source.oauth?.profile
  if (profile && profile["email_verified"] !== true) {
    return {
      error: "email_not_verified",
      errorDescription: "This Google account's email address is not verified.",
    }
  }

  if (!(await institutionForEmail(email))) {
    return {
      error: "domain_not_allowed",
      errorDescription: "This email address does not belong to an allowed institution.",
    }
  }

  return undefined
}

/**
 * `databaseHooks.session.create.before`: the gate on every session, including
 * the ones minted for the desktop's device flow. Re-checks the domain (a
 * delisted domain kills returning users, not just new ones) and requires an
 * active membership. Returning false makes Better Auth refuse the sign-in.
 */
export async function sessionCreateGuard(session: {
  userId: string
}): Promise<boolean | void> {
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)
  if (!row) return false

  if (!(await institutionForEmail(row.email))) return false
  if (!(await activeMembership(session.userId))) return false
}

/**
 * `databaseHooks.user.create.after`: provisioning, on first sign-in only.
 *
 * A pending grant (written by the bootstrap script for the initial admin)
 * outranks auto-provisioning and is consumed exactly once. Otherwise, if the
 * institution auto-provisions students, the user becomes an active student.
 * No other automatic path to any role exists - in particular, nothing here or
 * anywhere else promotes on domain alone.
 */
export async function provisionOnFirstSignIn(user: {
  id: string
  name: string
  email: string
}): Promise<void> {
  const email = user.email.toLowerCase()
  const institution = await institutionForEmail(email)
  if (!institution) return // refused later by sessionCreateGuard

  await db.transaction(async (tx) => {
    const [grant] = await tx
      .select()
      .from(pendingRoleGrants)
      .where(eq(pendingRoleGrants.email, email))
      .limit(1)

    if (grant) {
      await tx
        .insert(institutionMembers)
        .values({
          institutionId: grant.institutionId,
          userId: user.id,
          role: grant.role,
          status: "active",
        })
        .onConflictDoNothing()

      // Teachers and admins author quizzes, so they need a profile row for
      // quizzes.owner_id to point at.
      if (grant.role !== "student") {
        await tx
          .insert(teachers)
          .values({ name: user.name, email: user.email, userId: user.id })
          .onConflictDoNothing({ target: teachers.userId })
      }

      await tx.delete(pendingRoleGrants).where(eq(pendingRoleGrants.email, email))
      return
    }

    if (institution.autoProvisionStudents) {
      await tx
        .insert(institutionMembers)
        .values({
          institutionId: institution.institutionId,
          userId: user.id,
          role: "student",
          status: "active",
        })
        .onConflictDoNothing()
    }
  })
}

/** What `customSession` adds so clients can render without a second lookup. */
export async function sessionExtras(userId: string): Promise<{
  role: "admin" | "teacher" | "student" | null
  institutionId: string | null
  teacherProfileId: string | null
}> {
  const membership = await activeMembership(userId)
  if (!membership) return { role: null, institutionId: null, teacherProfileId: null }

  let teacherProfileId: string | null = null
  if (membership.role !== "student") {
    const [profile] = await db
      .select({ id: teachers.id })
      .from(teachers)
      .where(eq(teachers.userId, userId))
      .limit(1)
    teacherProfileId = profile?.id ?? null
  }

  return {
    role: membership.role,
    institutionId: membership.institutionId,
    teacherProfileId,
  }
}
