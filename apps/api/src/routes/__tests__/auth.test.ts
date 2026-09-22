/**
 * Authentication and authorization, against the real database.
 *
 * Requires `docker compose up -d` and `pnpm --filter api db:migrate`.
 *
 * The theme: the client has no say. Domains are checked against Google's
 * verified email inside Better Auth's pipeline, roles live in a table no
 * Better Auth endpoint can write, and every cross-role request here proves the
 * server refuses it no matter what the caller crafts.
 */
import { randomUUID } from "node:crypto"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createApp } from "../../app"
import {
  db,
  institutionDomains,
  institutionMembers,
  pendingRoleGrants,
  session as sessions,
  sqlClient,
  teachers,
  user as users,
} from "../../db"
import {
  emailDomain,
  provisionOnFirstSignIn,
  sessionCreateGuard,
  validateUserInfo,
} from "../../lib/auth-hooks"
import { BootstrapError, bootstrapInitialAdmin } from "../../services/bootstrap"
import {
  bearerHeaders,
  seedActor,
  seedInstitution,
  type TestActor,
  type TestInstitution,
} from "./helpers/auth"

const app = createApp()

let institution: TestInstitution
let admin: TestActor
let teacher: TestActor
let student: TestActor

beforeAll(async () => {
  institution = await seedInstitution()
  admin = await seedActor(institution, "admin")
  teacher = await seedActor(institution, "teacher")
  student = await seedActor(institution, "student")
})

afterAll(async () => {
  await admin.cleanup()
  await teacher.cleanup()
  await student.cleanup()
  await institution.cleanup()
  await sqlClient.end()
})

function oauthSignIn(email: string, verified = true) {
  return {
    user: { email },
    source: {
      method: "oauth",
      action: "sign-in",
      oauth: { providerId: "google", profile: { email, email_verified: verified } },
    },
  }
}

describe("domain restriction", () => {
  it("takes the domain after the LAST @, compared whole", () => {
    expect(emailDomain("student@msugensan.edu.ph")).toBe("msugensan.edu.ph")
    expect(emailDomain("Student@MSUGENSAN.EDU.PH")).toBe("msugensan.edu.ph")
    expect(emailDomain("no-at-sign")).toBeNull()
    expect(emailDomain("trailing@")).toBeNull()
    expect(emailDomain("@leading.edu")).toBeNull()
  })

  it("admits a verified account on the allowed domain", async () => {
    const result = await validateUserInfo(oauthSignIn(`ok@${institution.domain}`))
    expect(result).toBeUndefined()
  })

  it("refuses lookalike domains - suffix and prefix attacks alike", async () => {
    // attacker@<allowed>.evil.com - the allowed domain as a prefix.
    expect(
      await validateUserInfo(oauthSignIn(`attacker@${institution.domain}.evil.com`))
    ).toMatchObject({ error: "domain_not_allowed" })

    // attacker@evil-<allowed> - the allowed domain as a suffix.
    expect(
      await validateUserInfo(oauthSignIn(`attacker@evil-${institution.domain}`))
    ).toMatchObject({ error: "domain_not_allowed" })
  })

  it("refuses domains that were never allowed", async () => {
    for (const email of ["a@gmail.com", "b@yahoo.com", "c@other-school.edu"]) {
      expect(await validateUserInfo(oauthSignIn(email))).toMatchObject({
        error: "domain_not_allowed",
      })
    }
  })

  it("refuses an unverified Google email even on an allowed domain", async () => {
    expect(
      await validateUserInfo(oauthSignIn(`unverified@${institution.domain}`, false))
    ).toMatchObject({ error: "email_not_verified" })
  })

  it("kills returning users when their domain is delisted, not just new ones", async () => {
    const doomed = await seedInstitution()
    const member = await seedActor(doomed, "student")

    // Signed in fine while the domain is allowed...
    expect(await sessionCreateGuard({ userId: member.userId })).toBeUndefined()

    // ...then the domain goes away.
    await db
      .delete(institutionDomains)
      .where(eq(institutionDomains.institutionId, doomed.id))
    expect(await sessionCreateGuard({ userId: member.userId })).toBe(false)

    await member.cleanup()
    await doomed.cleanup()
  })
})

describe("provisioning on first sign-in", () => {
  async function firstSignIn(inst: TestInstitution) {
    const userId = randomUUID()
    const email = `fresh-${randomUUID()}@${inst.domain}`
    await db
      .insert(users)
      .values({ id: userId, name: "Fresh", email, emailVerified: true })
    await provisionOnFirstSignIn({ id: userId, name: "Fresh", email })
    return { userId, email }
  }

  it("auto-provisions a student, and nothing above a student", async () => {
    const { userId } = await firstSignIn(institution)

    const [membership] = await db
      .select()
      .from(institutionMembers)
      .where(eq(institutionMembers.userId, userId))
    expect(membership).toMatchObject({ role: "student", status: "active" })

    await db.delete(users).where(eq(users.id, userId))
  })

  it("leaves the user role-less when auto-provisioning is off, and the session guard refuses them", async () => {
    const strict = await seedInstitution({ autoProvisionStudents: false })
    const { userId } = await firstSignIn(strict)

    const memberships = await db
      .select()
      .from(institutionMembers)
      .where(eq(institutionMembers.userId, userId))
    expect(memberships).toHaveLength(0)
    expect(await sessionCreateGuard({ userId })).toBe(false)

    await db.delete(users).where(eq(users.id, userId))
    await strict.cleanup()
  })

  it("consumes a pending grant exactly once, profile row and all", async () => {
    const inst = await seedInstitution()
    const email = `granted-${randomUUID()}@${inst.domain}`
    await db
      .insert(pendingRoleGrants)
      .values({ email, institutionId: inst.id, role: "admin" })

    const userId = randomUUID()
    await db
      .insert(users)
      .values({ id: userId, name: "Granted", email, emailVerified: true })
    await provisionOnFirstSignIn({ id: userId, name: "Granted", email })

    const [membership] = await db
      .select()
      .from(institutionMembers)
      .where(eq(institutionMembers.userId, userId))
    expect(membership).toMatchObject({ role: "admin", status: "active" })

    // Admins author quizzes too, so the grant also creates the profile row.
    const [profile] = await db
      .select()
      .from(teachers)
      .where(eq(teachers.userId, userId))
    expect(profile).toBeDefined()

    const grants = await db
      .select()
      .from(pendingRoleGrants)
      .where(eq(pendingRoleGrants.email, email))
    expect(grants).toHaveLength(0)

    await db.delete(teachers).where(eq(teachers.userId, userId))
    await db.delete(users).where(eq(users.id, userId))
    await inst.cleanup()
  })
})

describe("authorization boundaries", () => {
  it("refuses the teacher surface with no session at all", async () => {
    const res = await app.request("/api/quizzes")
    expect(res.status).toBe(401)
  })

  it("lets a teacher author and an admin author, but never a student", async () => {
    expect((await app.request("/api/quizzes", { headers: bearerHeaders(teacher) })).status).toBe(200)
    expect((await app.request("/api/quizzes", { headers: bearerHeaders(admin) })).status).toBe(200)

    const student403 = await app.request("/api/quizzes", {
      headers: bearerHeaders(student),
    })
    expect(student403.status).toBe(403)
    expect(await student403.json()).toMatchObject({ error: { code: "forbidden" } })
  })

  it("keeps the admin surface to admins", async () => {
    expect(
      (await app.request("/api/admin/institution", { headers: bearerHeaders(admin) }))
        .status
    ).toBe(200)
    expect(
      (await app.request("/api/admin/institution", { headers: bearerHeaders(teacher) }))
        .status
    ).toBe(403)
    expect(
      (await app.request("/api/admin/institution", { headers: bearerHeaders(student) }))
        .status
    ).toBe(403)
    expect((await app.request("/api/admin/institution")).status).toBe(401)
  })

  it("tells /api/me who the session's teacher profile is", async () => {
    const res = await app.request("/api/me", { headers: bearerHeaders(teacher) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: teacher.teacherId })
  })

  it("refuses an expired session", async () => {
    const expired = await seedActor(institution, "teacher")
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(sessions.token, expired.sessionToken))

    const res = await app.request("/api/quizzes", { headers: bearerHeaders(expired) })
    expect(res.status).toBe(401)

    await expired.cleanup()
  })

  it("a role edit through the admin surface needs an admin - a crafted student request bounces", async () => {
    const res = await app.request(`/api/admin/members/${student.userId}/role`, {
      method: "PUT",
      headers: bearerHeaders(student),
      body: JSON.stringify({ role: "admin" }),
    })
    expect(res.status).toBe(403)

    const [membership] = await db
      .select()
      .from(institutionMembers)
      .where(eq(institutionMembers.userId, student.userId))
    expect(membership).toMatchObject({ role: "student" })
  })
})

describe("admin management", () => {
  it("adds and removes allowed domains, and removal suspends the domain's members and kills their sessions", async () => {
    const inst = await seedInstitution()
    const localAdmin = await seedActor(inst, "admin")
    const victim = await seedActor(inst, "student")

    // Add a second domain so the institution config lists both.
    const added = await app.request("/api/admin/domains", {
      method: "POST",
      headers: bearerHeaders(localAdmin),
      body: JSON.stringify({ domain: `second-${randomUUID().slice(0, 8)}.test.invalid` }),
    })
    expect(added.status).toBe(201)

    // A duplicate is a conflict, not a second row.
    const dup = await app.request("/api/admin/domains", {
      method: "POST",
      headers: bearerHeaders(localAdmin),
      body: JSON.stringify({ domain: inst.domain }),
    })
    expect(dup.status).toBe(409)

    // Remove the founding domain: the student on it is suspended and signed
    // out everywhere; the admin survives to undo a mistake.
    const [domainRow] = await db
      .select({ id: institutionDomains.id })
      .from(institutionDomains)
      .where(eq(institutionDomains.domain, inst.domain))
    const removed = await app.request(`/api/admin/domains/${domainRow!.id}`, {
      method: "DELETE",
      headers: bearerHeaders(localAdmin),
    })
    expect(removed.status).toBe(204)

    const [victimMembership] = await db
      .select()
      .from(institutionMembers)
      .where(eq(institutionMembers.userId, victim.userId))
    expect(victimMembership).toMatchObject({ status: "suspended" })

    const victimSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, victim.userId))
    expect(victimSessions).toHaveLength(0)

    const [adminMembership] = await db
      .select()
      .from(institutionMembers)
      .where(eq(institutionMembers.userId, localAdmin.userId))
    expect(adminMembership).toMatchObject({ status: "active" })

    await victim.cleanup()
    await localAdmin.cleanup()
    await inst.cleanup()
  })

  it("promotes a student to teacher with a profile row to hang quizzes off", async () => {
    const inst = await seedInstitution()
    const localAdmin = await seedActor(inst, "admin")
    const promoted = await seedActor(inst, "student")

    const res = await app.request(`/api/admin/members/${promoted.userId}/role`, {
      method: "PUT",
      headers: bearerHeaders(localAdmin),
      body: JSON.stringify({ role: "teacher" }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ role: "teacher" })

    const [profile] = await db
      .select()
      .from(teachers)
      .where(eq(teachers.userId, promoted.userId))
    expect(profile).toBeDefined()

    // The promoted account can author now - same session, new role.
    expect(
      (await app.request("/api/quizzes", { headers: bearerHeaders(promoted) })).status
    ).toBe(200)

    await promoted.cleanup()
    await localAdmin.cleanup()
    await inst.cleanup()
  })

  it("never lets an institution lose its last administrator", async () => {
    const inst = await seedInstitution()
    const lastAdmin = await seedActor(inst, "admin")

    const demote = await app.request(`/api/admin/members/${lastAdmin.userId}/role`, {
      method: "PUT",
      headers: bearerHeaders(lastAdmin),
      body: JSON.stringify({ role: "teacher" }),
    })
    expect(demote.status).toBe(403)

    const suspend = await app.request(
      `/api/admin/members/${lastAdmin.userId}/status`,
      {
        method: "PUT",
        headers: bearerHeaders(lastAdmin),
        body: JSON.stringify({ status: "suspended" }),
      }
    )
    expect(suspend.status).toBe(403)

    await lastAdmin.cleanup()
    await inst.cleanup()
  })

  it("suspension and session revocation take effect immediately", async () => {
    const inst = await seedInstitution()
    const localAdmin = await seedActor(inst, "admin")
    const target = await seedActor(inst, "teacher")

    const res = await app.request(`/api/admin/members/${target.userId}/status`, {
      method: "PUT",
      headers: bearerHeaders(localAdmin),
      body: JSON.stringify({ status: "suspended" }),
    })
    expect(res.status).toBe(200)

    // Their session rows are gone, so the very next request is a 401.
    expect(
      (await app.request("/api/quizzes", { headers: bearerHeaders(target) })).status
    ).toBe(401)

    await target.cleanup()
    await localAdmin.cleanup()
    await inst.cleanup()
  })
})

describe("bootstrap", () => {
  it("runs once, and only while no administrator exists anywhere", async () => {
    // The suite (and possibly a developer's own sign-in) may already have
    // created admins in this shared database, in which case bootstrap must
    // refuse outright - that refusal IS the guard under test. On a fresh
    // database the success path runs first, then the re-run must refuse.
    const [preexisting] = await db
      .select({ userId: institutionMembers.userId })
      .from(institutionMembers)
      .where(eq(institutionMembers.role, "admin"))
      .limit(1)

    const args = {
      email: "head@bootstrap-test.invalid",
      institutionName: "Bootstrap Test U",
      domain: "bootstrap-test.invalid",
    }

    if (preexisting) {
      await expect(bootstrapInitialAdmin(args)).rejects.toThrow(BootstrapError)
      return
    }

    const result = await bootstrapInitialAdmin(args)
    expect(result.domain).toBe("bootstrap-test.invalid")

    const [grant] = await db
      .select()
      .from(pendingRoleGrants)
      .where(eq(pendingRoleGrants.email, args.email))
    expect(grant).toMatchObject({ role: "admin" })

    // Second run refuses while the grant is unconsumed.
    await expect(bootstrapInitialAdmin(args)).rejects.toThrow(/already waiting/)

    await db.delete(pendingRoleGrants).where(eq(pendingRoleGrants.email, args.email))
    await db
      .delete(institutionDomains)
      .where(eq(institutionDomains.domain, args.domain))
  })

  it("refuses a configuration whose admin could never sign in", async () => {
    await expect(
      bootstrapInitialAdmin({
        email: "admin@somewhere-else.edu",
        institutionName: "Mismatch U",
        domain: "mismatch.edu",
      })
    ).rejects.toThrow(/must be able to sign in/)
  })

  it("refuses garbage domains", async () => {
    await expect(
      bootstrapInitialAdmin({
        email: "admin@x",
        institutionName: "Garbage U",
        domain: "not a domain",
      })
    ).rejects.toThrow(/not a valid domain/)
  })
})
