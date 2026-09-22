/**
 * Session-minting helpers for route tests.
 *
 * These write the same rows Better Auth would - user, membership, session -
 * directly, so a test can act as a signed-in student/teacher/admin without
 * driving a browser through Google. The bearer plugin accepts a raw session
 * token and verifies it against the session table, which is exactly what the
 * desktop client presents, so `Authorization: Bearer <token>` here exercises
 * the real production path from the middleware down.
 */
import { randomBytes, randomUUID } from "node:crypto"

import { eq } from "drizzle-orm"

import {
  db,
  institutionDomains,
  institutionMembers,
  institutions,
  session as sessions,
  teachers,
  user as users,
} from "../../../db"

export type TestInstitution = {
  id: string
  domain: string
  cleanup: () => Promise<void>
}

/** An institution with one allowed domain, unique per call. */
export async function seedInstitution(
  options: { autoProvisionStudents?: boolean } = {}
): Promise<TestInstitution> {
  const nonce = randomBytes(6).toString("hex")
  const domain = `inst-${nonce}.test.invalid`

  const [institution] = await db
    .insert(institutions)
    .values({
      name: `Test Institution ${nonce}`,
      slug: `test-${nonce}`,
      autoProvisionStudents: options.autoProvisionStudents ?? true,
    })
    .returning({ id: institutions.id })
  if (!institution) throw new Error("could not seed institution")

  await db
    .insert(institutionDomains)
    .values({ institutionId: institution.id, domain })

  return {
    id: institution.id,
    domain,
    cleanup: async () => {
      // Members and domains cascade; users are deleted by their own actor.
      await db.delete(institutions).where(eq(institutions.id, institution.id))
    },
  }
}

export type TestActor = {
  userId: string
  email: string
  /** Raw Better Auth session token; present it as `Authorization: Bearer`. */
  sessionToken: string
  /** The authoring-profile id, for teacher/admin actors only. */
  teacherId: string | null
  cleanup: () => Promise<void>
}

/** A signed-in member of the given institution, session row and all. */
export async function seedActor(
  institution: TestInstitution,
  role: "admin" | "teacher" | "student",
  options: { status?: "active" | "suspended" } = {}
): Promise<TestActor> {
  const userId = randomUUID()
  const email = `${role}-${randomUUID()}@${institution.domain}`
  const now = new Date()

  await db.insert(users).values({
    id: userId,
    name: `Test ${role}`,
    email,
    emailVerified: true,
  })

  await db.insert(institutionMembers).values({
    institutionId: institution.id,
    userId,
    role,
    status: options.status ?? "active",
  })

  let teacherId: string | null = null
  if (role !== "student") {
    const [profile] = await db
      .insert(teachers)
      .values({ name: `Test ${role}`, email, userId })
      .returning({ id: teachers.id })
    teacherId = profile?.id ?? null
  }

  const sessionToken = randomBytes(32).toString("base64url")
  await db.insert(sessions).values({
    id: randomUUID(),
    userId,
    token: sessionToken,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
  })

  return {
    userId,
    email,
    sessionToken,
    teacherId,
    cleanup: async () => {
      // Sessions and memberships cascade from the user row; the teacher
      // profile only nulls its user_id, so remove it explicitly.
      await db.delete(teachers).where(eq(teachers.userId, userId))
      await db.delete(users).where(eq(users.id, userId))
    },
  }
}

export function bearerHeaders(actor: TestActor): Record<string, string> {
  return {
    Authorization: `Bearer ${actor.sessionToken}`,
    "Content-Type": "application/json",
  }
}
