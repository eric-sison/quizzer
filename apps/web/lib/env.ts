import "server-only"

import { z } from "zod"

/**
 * Server-only configuration.
 *
 * Deliberately NOT prefixed `NEXT_PUBLIC_`: SERVICE_TOKEN is the credential
 * apps/web presents to apps/api, and a `NEXT_PUBLIC_` name would inline it
 * into the browser bundle. The `server-only` import above turns an accidental
 * client import into a build error rather than a leak.
 */
const envSchema = z.object({
  /** Where apps/api listens. Must be the origin the desktop client pins. */
  API_ORIGIN: z.url().default("http://localhost:3000"),
  SERVICE_TOKEN: z.string().min(8),
})

function load() {
  const parsed = envSchema.safeParse({
    API_ORIGIN: process.env.API_ORIGIN,
    SERVICE_TOKEN: process.env.SERVICE_TOKEN,
  })

  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`
    )
    throw new Error(
      `Invalid environment:\n${lines.join("\n")}\n\n` +
        `Copy apps/web/.env.example to apps/web/.env.local.`
    )
  }

  return parsed.data
}

export const env = load()
