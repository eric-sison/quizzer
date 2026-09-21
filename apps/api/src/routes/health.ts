import { sql } from "drizzle-orm"
import { Hono } from "hono"

import { db } from "../db"
import type { AppEnv } from "../lib/hono"

export const health = new Hono<AppEnv>()

health.get("/health", async (c) => {
  try {
    await db.execute(sql`select 1`)
    return c.json({ ok: true, database: "up" })
  } catch (err) {
    console.error("[api] health check failed", err)
    return c.json({ ok: false, database: "down" }, 503)
  }
})
