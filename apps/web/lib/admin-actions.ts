"use server"

import { revalidatePath } from "next/cache"
import { addDomainRequestSchema, type MemberRole, type MemberStatus } from "@workspace/quiz-core"

import { adminApi, ApiClientError } from "./api-client"
import { requireAdmin } from "./auth"

/**
 * Server Actions are reachable by direct POST, not only through the UI, so
 * each one starts with `requireAdmin()`. apps/api enforces role=admin again on
 * every endpoint - the check here exists so a non-admin gets a redirect rather
 * than a raw API error, never as the actual gate.
 */

export type AdminActionResult = { ok: true } | { ok: false; message: string }

function describe(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.code === "network_unavailable"
      ? "Could not reach the quiz service. Is apps/api running on port 3000?"
      : error.message
  }
  return "Something went wrong."
}

export async function updateInstitutionAction(update: {
  name?: string
  autoProvisionStudents?: boolean
}): Promise<AdminActionResult> {
  await requireAdmin()
  try {
    await adminApi.updateInstitution(update)
  } catch (error) {
    return { ok: false, message: describe(error) }
  }

  revalidatePath("/admin/domains")
  return { ok: true }
}

export async function addDomainAction(domain: string): Promise<AdminActionResult> {
  await requireAdmin()

  // Validated here too for a fast, well-worded refusal; apps/api re-checks.
  const parsed = addDomainRequestSchema.safeParse({ domain: domain.trim().toLowerCase() })
  if (!parsed.success) {
    return { ok: false, message: "That doesn't look like a domain name (e.g. school.edu)." }
  }

  try {
    await adminApi.addDomain(parsed.data.domain)
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 409) {
      return { ok: false, message: "That domain is already on the list." }
    }
    return { ok: false, message: describe(error) }
  }

  revalidatePath("/admin/domains")
  return { ok: true }
}

export async function removeDomainAction(id: string): Promise<AdminActionResult> {
  await requireAdmin()
  try {
    await adminApi.removeDomain(id)
  } catch (error) {
    return { ok: false, message: describe(error) }
  }

  // Removing a domain suspends its members, so the members page is stale too.
  revalidatePath("/admin/domains")
  revalidatePath("/admin/members")
  return { ok: true }
}

export async function setMemberRoleAction(userId: string, role: MemberRole): Promise<AdminActionResult> {
  await requireAdmin()
  try {
    await adminApi.setMemberRole(userId, role)
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 403) {
      return { ok: false, message: "An institution needs at least one admin." }
    }
    return { ok: false, message: describe(error) }
  }

  revalidatePath("/admin/members")
  return { ok: true }
}

export async function setMemberStatusAction(userId: string, status: MemberStatus): Promise<AdminActionResult> {
  await requireAdmin()
  try {
    await adminApi.setMemberStatus(userId, status)
  } catch (error) {
    return { ok: false, message: describe(error) }
  }

  revalidatePath("/admin/members")
  return { ok: true }
}

export async function revokeMemberSessionsAction(userId: string): Promise<AdminActionResult> {
  await requireAdmin()
  try {
    await adminApi.revokeMemberSessions(userId)
  } catch (error) {
    return { ok: false, message: describe(error) }
  }

  revalidatePath("/admin/members")
  return { ok: true }
}
