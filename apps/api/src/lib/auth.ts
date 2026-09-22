/**
 * The Better Auth instance - the third credential class, next to the teacher
 * SERVICE_TOKEN bridge and the exam session JWT.
 *
 * It runs here because this API owns the database. Browsers never reach this
 * origin: apps/web rewrites /api/auth/* to us, so `baseURL` is the *web*
 * origin - Google's redirect URI lives there and the session cookie is scoped
 * there. The desktop's Rust client calls us directly; it is not a browser, so
 * no CORS or cookie ever enters that path.
 *
 * Google is the only way in. No email/password, no magic links, no OTP - a
 * quiz platform for institutional Google accounts has no business holding
 * passwords.
 */
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { bearer, customSession, deviceAuthorization } from "better-auth/plugins"

import { db } from "../db"
import * as authSchema from "../db/auth-schema"
import { env } from "../env"
import {
  provisionOnFirstSignIn,
  sessionCreateGuard,
  sessionExtras,
  validateUserInfo,
} from "./auth-hooks"

/** The one OAuth client the device flow will mint codes for. */
export const DESKTOP_CLIENT_ID = "quizzer-desktop"

export const auth = betterAuth({
  baseURL: env.PUBLIC_WEB_ORIGIN,
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),

  emailAndPassword: { enabled: false },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      // A student on a shared lab machine must get the account chooser, not
      // whoever Google remembers from the last person in the seat.
      prompt: "select_account",
    },
  },
  account: { accountLinking: { enabled: false } },

  trustedOrigins: [env.PUBLIC_WEB_ORIGIN],
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    // Every session check hits the table, so revoking a session (sign-out,
    // admin action, domain removal) takes effect immediately, not when a
    // cached cookie happens to expire.
    cookieCache: { enabled: false },
  },

  user: { validateUserInfo },
  databaseHooks: {
    user: { create: { after: provisionOnFirstSignIn } },
    session: { create: { before: sessionCreateGuard } },
  },

  plugins: [
    // Lets the desktop present its session token as `Authorization: Bearer`.
    bearer(),
    deviceAuthorization({
      expiresIn: "10m",
      interval: "5s",
      validateClient: (clientId) => clientId === DESKTOP_CLIENT_ID,
      verificationUri: `${env.PUBLIC_WEB_ORIGIN}/device`,
    }),
    // Role and institution ride along on get-session so clients never have to
    // ask twice - but they are computed here, from the membership table, never
    // accepted from a client.
    customSession(async ({ user, session }) => ({
      user: { ...user, ...(await sessionExtras(user.id)) },
      session,
    })),
  ],
})

export type AuthSession = typeof auth.$Infer.Session
