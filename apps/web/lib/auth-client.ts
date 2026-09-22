"use client"

import { createAuthClient } from "better-auth/react"
import { deviceAuthorizationClient } from "better-auth/client/plugins"

/**
 * The browser's view of auth. `/api/auth` is same-origin here: next.config.ts
 * rewrites it to apps/api, which is where Better Auth actually runs. Keeping
 * it same-origin is what scopes the session cookie to this app.
 *
 * No `baseURL`: the client would reject a relative one (`new URL` throws) and
 * an absolute one would hardcode an origin. Left out, it uses the page's own
 * origin with the default base path - which is exactly `/api/auth`.
 */
export const authClient = createAuthClient({
  plugins: [deviceAuthorizationClient()],
})
