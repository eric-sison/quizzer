import "server-only"

import { z } from "zod"

/**
 * Server-only configuration.
 *
 * Deliberately NOT prefixed `NEXT_PUBLIC_`: nothing here belongs in the
 * browser bundle. The `server-only` import above turns an accidental client
 * import into a build error rather than a leak.
 */
const envSchema = z.object({
  /** Where apps/api listens. Must be the origin the desktop client pins. */
  API_ORIGIN: z.url().default("http://localhost:3000"),
})

function load() {
  const parsed = envSchema.safeParse({
    API_ORIGIN: process.env.API_ORIGIN,
  })

  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
    throw new Error(
      `Invalid environment:\n${lines.join("\n")}\n\n` + `Copy apps/web/.env.example to apps/web/.env.local.`
    )
  }

  return parsed.data
}

export const env = load()
