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
   * Better Auth's signing/encryption secret - the third credential class.
   * Must differ from both of the above; see the pairwise check below.
   */
  BETTER_AUTH_SECRET: z.string().min(32),
  /**
   * Where apps/web is served. Better Auth's baseURL: Google's redirect URI
   * lives on this origin and browsers reach /api/auth/* through the web app's
   * rewrite, so this API never has to accept a browser connection itself.
   */
  PUBLIC_WEB_ORIGIN: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
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

  // Three credential classes, three secrets. Any two matching would let one
  // audience's token authorize another audience's endpoints.
  const secrets: [string, string][] = [
    ["SERVICE_TOKEN", parsed.data.SERVICE_TOKEN],
    ["EXAM_JWT_SECRET", parsed.data.EXAM_JWT_SECRET],
    ["BETTER_AUTH_SECRET", parsed.data.BETTER_AUTH_SECRET],
  ]
  for (let i = 0; i < secrets.length; i++) {
    for (let j = i + 1; j < secrets.length; j++) {
      if (secrets[i]![1] === secrets[j]![1]) {
        throw new Error(
          `${secrets[i]![0]} and ${secrets[j]![0]} must differ: a token from one ` +
            `credential class must never authorize another's endpoints.`
        )
      }
    }
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
