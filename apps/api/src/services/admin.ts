/**
 * Institution configuration and membership management.
 *
 * Everything here runs behind requireAdmin, and everything here is scoped to
 * the acting admin's institution: an admin of one institution can never see or
 * touch another's rows, which is what keeps the single-institution v1 honest
 * about becoming multi-institution later.
 *
 * The invariant this file owns: an institution can never lose its last active
 * admin. Every demotion and suspension checks it.
 */
import { and, eq, ne, sql } from "drizzle-orm"

import type {
  InstitutionConfig,
  Member,
  MemberRole,
  MemberStatus,
} from "@workspace/quiz-core"

import { db } from "../db"
import {
  institutionDomains,
  institutionMembers,
  institutions,
  session as sessions,
  teachers,
  user as users,
} from "../db"
import { conflict, forbidden, notFound } from "../lib/errors"

export async function getInstitutionConfig(
  institutionId: string
): Promise<InstitutionConfig> {
  const [institution] = await db
    .select()
    .from(institutions)
    .where(eq(institutions.id, institutionId))
    .limit(1)
  if (!institution) throw notFound("No such institution.")

  const domains = await db
    .select()
    .from(institutionDomains)
    .where(eq(institutionDomains.institutionId, institutionId))
    .orderBy(institutionDomains.domain)

  return {
    institution: {
      id: institution.id,
      name: institution.name,
      slug: institution.slug,
      autoProvisionStudents: institution.autoProvisionStudents,
    },
    domains: domains.map((d) => ({
      id: d.id,
      domain: d.domain,
      createdAt: d.createdAt.toISOString(),
    })),
  }
}

export async function updateInstitution(
  institutionId: string,
  patch: { name?: string; autoProvisionStudents?: boolean }
): Promise<InstitutionConfig> {
  if (patch.name !== undefined || patch.autoProvisionStudents !== undefined) {
    await db
      .update(institutions)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.autoProvisionStudents !== undefined
          ? { autoProvisionStudents: patch.autoProvisionStudents }
          : {}),
      })
      .where(eq(institutions.id, institutionId))
  }
  return getInstitutionConfig(institutionId)
}

export async function addDomain(
  institutionId: string,
  domain: string,
  createdBy: string
): Promise<{ id: string; domain: string; createdAt: string }> {
  const normalized = domain.toLowerCase()

  const [row] = await db
    .insert(institutionDomains)
    .values({ institutionId, domain: normalized, createdBy })
    .onConflictDoNothing({ target: institutionDomains.domain })
    .returning()

  // The domain is globally unique: taken here or by another institution, the
  // answer is the same.
  if (!row) throw conflict("That domain is already configured.")

  return { id: row.id, domain: row.domain, createdAt: row.createdAt.toISOString() }
}

/**
 * Removing a domain revokes it *now*, not at session expiry: members whose
 * email lives on it are suspended and their sessions deleted in the same
 * transaction. Their user rows survive - re-adding the domain and reactivating
 * the memberships restores them without data loss.
 *
 * Admins on the removed domain are deliberately exempt from the automatic
 * suspension: a typo'd removal must not lock every admin out of the tool that
 * undoes it. (New sign-ins from the domain still stop immediately - that gate
 * is the allowlist itself.)
 */
export async function removeDomain(
  institutionId: string,
  domainId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(institutionDomains)
      .where(
        and(
          eq(institutionDomains.id, domainId),
          eq(institutionDomains.institutionId, institutionId)
        )
      )
      .returning({ domain: institutionDomains.domain })
    if (!removed) throw notFound("No such domain.")

    // Members of this institution whose email is on the removed domain.
    // LIKE has no wildcard risk here: the pattern is `%@` + the stored domain,
    // which our validation limits to [a-z0-9.-].
    const affected = await tx
      .select({ userId: institutionMembers.userId })
      .from(institutionMembers)
      .innerJoin(users, eq(institutionMembers.userId, users.id))
      .where(
        and(
          eq(institutionMembers.institutionId, institutionId),
          ne(institutionMembers.role, "admin"),
          sql`lower(${users.email}) like ${"%@" + removed.domain}`
        )
      )

    for (const { userId } of affected) {
      await tx
        .update(institutionMembers)
        .set({ status: "suspended", updatedAt: new Date() })
        .where(
          and(
            eq(institutionMembers.institutionId, institutionId),
            eq(institutionMembers.userId, userId)
          )
        )
      await tx.delete(sessions).where(eq(sessions.userId, userId))
    }
  })
}

export async function listMembers(institutionId: string): Promise<Member[]> {
  const rows = await db
    .select({
      userId: institutionMembers.userId,
      name: users.name,
      email: users.email,
      role: institutionMembers.role,
      status: institutionMembers.status,
      createdAt: institutionMembers.createdAt,
    })
    .from(institutionMembers)
    .innerJoin(users, eq(institutionMembers.userId, users.id))
    .where(eq(institutionMembers.institutionId, institutionId))
    .orderBy(users.email)

  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
}

async function activeAdminCountExcluding(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  institutionId: string,
  excludedUserId: string
): Promise<number> {
  const rows = await tx
    .select({ userId: institutionMembers.userId })
    .from(institutionMembers)
    .where(
      and(
        eq(institutionMembers.institutionId, institutionId),
        eq(institutionMembers.role, "admin"),
        eq(institutionMembers.status, "active"),
        ne(institutionMembers.userId, excludedUserId)
      )
    )
  return rows.length
}

export async function setMemberRole(
  institutionId: string,
  targetUserId: string,
  role: MemberRole,
  grantedBy: string
): Promise<Member> {
  await db.transaction(async (tx) => {
    const [member] = await tx
      .select({ role: institutionMembers.role })
      .from(institutionMembers)
      .where(
        and(
          eq(institutionMembers.institutionId, institutionId),
          eq(institutionMembers.userId, targetUserId)
        )
      )
      .limit(1)
    if (!member) throw notFound("No such member.")

    if (member.role === "admin" && role !== "admin") {
      if ((await activeAdminCountExcluding(tx, institutionId, targetUserId)) === 0) {
        throw forbidden("An institution cannot lose its last administrator.")
      }
    }

    await tx
      .update(institutionMembers)
      .set({ role, grantedBy, updatedAt: new Date() })
      .where(
        and(
          eq(institutionMembers.institutionId, institutionId),
          eq(institutionMembers.userId, targetUserId)
        )
      )

    // Teachers and admins author quizzes; make sure the profile row their
    // quizzes will hang off exists.
    if (role !== "student") {
      const [target] = await tx
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1)
      if (target) {
        await tx
          .insert(teachers)
          .values({ name: target.name, email: target.email, userId: targetUserId })
          .onConflictDoNothing({ target: teachers.userId })
      }
    }
  })

  return memberByUserId(institutionId, targetUserId)
}

export async function setMemberStatus(
  institutionId: string,
  targetUserId: string,
  status: MemberStatus
): Promise<Member> {
  await db.transaction(async (tx) => {
    const [member] = await tx
      .select({
        role: institutionMembers.role,
        status: institutionMembers.status,
      })
      .from(institutionMembers)
      .where(
        and(
          eq(institutionMembers.institutionId, institutionId),
          eq(institutionMembers.userId, targetUserId)
        )
      )
      .limit(1)
    if (!member) throw notFound("No such member.")

    if (status === "suspended" && member.role === "admin") {
      if ((await activeAdminCountExcluding(tx, institutionId, targetUserId)) === 0) {
        throw forbidden("An institution cannot lose its last administrator.")
      }
    }

    await tx
      .update(institutionMembers)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(institutionMembers.institutionId, institutionId),
          eq(institutionMembers.userId, targetUserId)
        )
      )

    // Suspension bites immediately, not at cookie expiry.
    if (status === "suspended") {
      await tx.delete(sessions).where(eq(sessions.userId, targetUserId))
    }
  })

  return memberByUserId(institutionId, targetUserId)
}

export async function revokeMemberSessions(
  institutionId: string,
  targetUserId: string
): Promise<void> {
  const [member] = await db
    .select({ userId: institutionMembers.userId })
    .from(institutionMembers)
    .where(
      and(
        eq(institutionMembers.institutionId, institutionId),
        eq(institutionMembers.userId, targetUserId)
      )
    )
    .limit(1)
  if (!member) throw notFound("No such member.")

  await db.delete(sessions).where(eq(sessions.userId, targetUserId))
}

async function memberByUserId(
  institutionId: string,
  userId: string
): Promise<Member> {
  const [row] = await db
    .select({
      userId: institutionMembers.userId,
      name: users.name,
      email: users.email,
      role: institutionMembers.role,
      status: institutionMembers.status,
      createdAt: institutionMembers.createdAt,
    })
    .from(institutionMembers)
    .innerJoin(users, eq(institutionMembers.userId, users.id))
    .where(
      and(
        eq(institutionMembers.institutionId, institutionId),
        eq(institutionMembers.userId, userId)
      )
    )
    .limit(1)
  if (!row) throw notFound("No such member.")

  return { ...row, createdAt: row.createdAt.toISOString() }
}
