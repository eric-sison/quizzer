import { z } from "zod"

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().min(1),
  /** Baked into every published quiz link. Never derived from a request host. */
  PUBLIC_API_ORIGIN: z.url(),
  /** Shared secret apps/web presents on server-to-server calls. */
  SERVICE_TOKEN: z.string().min(8),
  /** Signs exam session JWTs. Must differ from any teacher credential. */
  EXAM_JWT_SECRET: z.string().min(16),
  /**
   * Garage (S3-compatible) media storage. Only apps/api ever talks to it:
   * browsers and the desktop client receive media through this API.
   */
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default("garage"),
  S3_BUCKET: z.string().min(1).default("quizzer-media"),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
})

export type Env = z.infer<typeof envSchema>

function load(): Env {
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`
    )
    throw new Error(
      `Invalid environment:\n${lines.join("\n")}\n\n` +
        `Copy apps/api/.env.example to apps/api/.env.local.`
    )
  }

  if (parsed.data.SERVICE_TOKEN === parsed.data.EXAM_JWT_SECRET) {
    throw new Error(
      "SERVICE_TOKEN and EXAM_JWT_SECRET must differ: an exam token must never authorize teacher endpoints."
    )
  }

  return parsed.data
}

export const env = load()

export const DESKTOP_DEFAULT_PORT = 3000

/**
 * The desktop client pins its backend origin at compile time and defaults to
 * http://localhost:3000. Serving anywhere else makes every locally generated
 * link fail offline with `untrusted_host`, which is an obscure way to discover
 * a port mismatch - so say so at boot.
 */
export function warnIfPortWillBreakDesktopLinks(): void {
  if (env.NODE_ENV === "production") return
  if (env.PORT === DESKTOP_DEFAULT_PORT) return

  console.warn(
    `[api] listening on :${env.PORT}, but the desktop client expects :${DESKTOP_DEFAULT_PORT}. ` +
      `Quiz links will be rejected offline unless the client was built with ` +
      `QUIZZER_API_ORIGIN pointing here.`
  )
}
