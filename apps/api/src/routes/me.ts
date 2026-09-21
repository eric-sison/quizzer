import { Hono } from "hono"

import type { AppEnv } from "../lib/hono"
import { requireTeacher } from "../middleware/auth"

export const me = new Hono<AppEnv>()

/**
 * Who apps/web is acting as. Cheap way for the web app to confirm its service
 * credential and teacher id are wired up before it tries a real mutation.
 */
me.get("/api/me", requireTeacher, (c) => {
  const teacher = c.get("teacher")
  return c.json({ id: teacher.id, name: teacher.name, email: teacher.email })
})
