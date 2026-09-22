/**
 * The one-time initial-admin bootstrap, as a callable so it can be tested.
 * The CLI entry point is src/db/bootstrap.ts; there is deliberately no HTTP
 * route to this - it is operator tooling, not an endpoint.
 */
import { eq } from "drizzle-orm"

import { addDomainRequestSchema } from "@workspace/quiz-core"

import { db } from "../db"
import {
  institutionDomains,
  institutionMembers,
  institutions,
  pendingRoleGrants,
} from "../db"

export class BootstrapError extends Error {}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "institution"
}

export async function bootstrapInitialAdmin(input: {
  email: string
  institutionName: string
  domain: string
}): Promise<{ institutionId: string; email: string; domain: string }> {
  const email = input.email.trim().toLowerCase()
  const institutionName = input.institutionName.trim()

  const domainParsed = addDomainRequestSchema.safeParse({
    domain: input.domain.trim().toLowerCase(),
  })
  if (!domainParsed.success) {
    throw new BootstrapError(`"${input.domain}" is not a valid domain name.`)
  }
  const domain = domainParsed.data.domain.toLowerCase()

  if (!institutionName) throw new BootstrapError("The institution needs a name.")

  const at = email.lastIndexOf("@")
  if (at <= 0 || at === email.length - 1) {
    throw new BootstrapError(`"${email}" is not an email address.`)
  }

  // An admin whose own email cannot pass the allowlist could never sign in to
  // use the role - that is a mis-bootstrap, so refuse it here.
  const emailDomain = email.slice(at + 1)
  if (emailDomain !== domain) {
    throw new BootstrapError(
      `The admin email is on "${emailDomain}" but the allowed domain is "${domain}". ` +
        `The initial admin must be able to sign in through the domain being allowed.`
    )
  }

  return db.transaction(async (tx) => {
    const [existingAdmin] = await tx
      .select({ userId: institutionMembers.userId })
      .from(institutionMembers)
      .where(eq(institutionMembers.role, "admin"))
      .limit(1)
    if (existingAdmin) {
      throw new BootstrapError(
        "An administrator already exists. Bootstrap runs once; use an existing " +
          "admin's member management to grant further roles."
      )
    }

    const [pendingAdmin] = await tx
      .select({ email: pendingRoleGrants.email })
      .from(pendingRoleGrants)
      .where(eq(pendingRoleGrants.role, "admin"))
      .limit(1)
    if (pendingAdmin) {
      throw new BootstrapError(
        `A bootstrap is already waiting for ${pendingAdmin.email} to sign in. ` +
          "Bootstrap runs once."
      )
    }

    const [institution] = await tx
      .insert(institutions)
      .values({ name: institutionName, slug: slugify(institutionName) })
      .returning({ id: institutions.id })
    if (!institution) throw new Error("institution insert returned no row")

    await tx
      .insert(institutionDomains)
      .values({ institutionId: institution.id, domain })
      .onConflictDoNothing({ target: institutionDomains.domain })

    await tx.insert(pendingRoleGrants).values({
      email,
      institutionId: institution.id,
      role: "admin",
    })

    return { institutionId: institution.id, email, domain }
  })
}
