/**
 * The admin surface. Every route acts as an administrator of exactly one
 * institution - the one their membership names - and requireAdmin is the only
 * door in. There is no cross-institution view, and no route here (or anywhere)
 * accepts a role for the *acting* user: who you are comes from the session,
 * full stop.
 */
import {
  addDomainRequestSchema,
  setMemberRoleRequestSchema,
  setMemberStatusRequestSchema,
  updateInstitutionRequestSchema,
} from "@workspace/quiz-core"
import { Hono } from "hono"
import { z } from "zod"

import type { AppEnv } from "../lib/hono"
import { validate } from "../lib/validate"
import { requireAdmin } from "../middleware/auth"
import {
  addDomain,
  getInstitutionConfig,
  listMembers,
  removeDomain,
  revokeMemberSessions,
  setMemberRole,
  setMemberStatus,
  updateInstitution,
} from "../services/admin"

const domainIdParam = z.object({ id: z.uuid() })
const memberUserParam = z.object({ userId: z.string().min(1).max(128) })

export const adminRoutes = new Hono<AppEnv>()

adminRoutes.use("/api/admin/*", requireAdmin)

adminRoutes.get("/api/admin/institution", async (c) =>
  c.json(await getInstitutionConfig(c.get("admin").institutionId))
)

adminRoutes.put(
  "/api/admin/institution",
  validate("json", updateInstitutionRequestSchema),
  async (c) =>
    c.json(await updateInstitution(c.get("admin").institutionId, c.req.valid("json")))
)

adminRoutes.post(
  "/api/admin/domains",
  validate("json", addDomainRequestSchema),
  async (c) => {
    const admin = c.get("admin")
    const { domain } = c.req.valid("json")
    return c.json(await addDomain(admin.institutionId, domain, admin.userId), 201)
  }
)

adminRoutes.delete(
  "/api/admin/domains/:id",
  validate("param", domainIdParam),
  async (c) => {
    await removeDomain(c.get("admin").institutionId, c.req.valid("param").id)
    return c.body(null, 204)
  }
)

adminRoutes.get("/api/admin/members", async (c) =>
  c.json({ members: await listMembers(c.get("admin").institutionId) })
)

adminRoutes.put(
  "/api/admin/members/:userId/role",
  validate("param", memberUserParam),
  validate("json", setMemberRoleRequestSchema),
  async (c) => {
    const admin = c.get("admin")
    const { userId } = c.req.valid("param")
    const { role } = c.req.valid("json")
    return c.json(await setMemberRole(admin.institutionId, userId, role, admin.userId))
  }
)

adminRoutes.put(
  "/api/admin/members/:userId/status",
  validate("param", memberUserParam),
  validate("json", setMemberStatusRequestSchema),
  async (c) => {
    const admin = c.get("admin")
    const { userId } = c.req.valid("param")
    const { status } = c.req.valid("json")
    return c.json(await setMemberStatus(admin.institutionId, userId, status))
  }
)

adminRoutes.post(
  "/api/admin/members/:userId/revoke-sessions",
  validate("param", memberUserParam),
  async (c) => {
    await revokeMemberSessions(
      c.get("admin").institutionId,
      c.req.valid("param").userId
    )
    return c.body(null, 204)
  }
)
