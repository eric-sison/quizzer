import { Hono } from "hono"
import { logger } from "hono/logger"

import { auth } from "./lib/auth"
import type { AppEnv } from "./lib/hono"
import { registerErrorHandling } from "./middleware/errors"
import { adminRoutes } from "./routes/admin"
import { examRoutes } from "./routes/exam"
import { health } from "./routes/health"
import { linkRoutes } from "./routes/link"
import { me } from "./routes/me"
import { quizRoutes } from "./routes/quizzes"

export function createApp() {
  const app = new Hono<AppEnv>()

  app.use("*", logger())

  // No CORS on purpose. apps/web calls this from its server and the desktop
  // client calls it from Rust; nothing reaches it from a browser. Adding CORS
  // "just in case" would open a surface that currently does not exist.

  // Better Auth. Browser traffic arrives through the apps/web rewrite (its
  // origin is the trusted one); the desktop's Rust client calls it directly.
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))

  app.route("/", health)
  app.route("/", adminRoutes)
  // Public and unauthenticated, unlike everything else here: this is the page a
  // student lands on when they open a quiz link in a browser.
  app.route("/", linkRoutes)
  app.route("/", me)
  app.route("/", quizRoutes)
  // A different audience with a different credential. An exam session token is
  // rejected by the teacher middleware and vice versa.
  app.route("/", examRoutes)

  registerErrorHandling(app)
  return app
}
