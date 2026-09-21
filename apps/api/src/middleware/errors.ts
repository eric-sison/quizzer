import type { Hono } from "hono"

import { ApiError } from "../lib/errors"
import type { AppEnv } from "../lib/hono"

/**
 * Every failure leaves through here as `{"error":{"code":...}}`.
 *
 * An unexpected exception is logged in full but reported as a bare
 * `server_error`: stack traces and driver messages are exactly the sort of
 * internals that must not reach a student's screen.
 */
export function registerErrorHandling(app: Hono<AppEnv>): void {
  app.notFound((c) =>
    c.json({ error: { code: "not_found" as const, message: "No such route." } }, 404)
  )

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(
        {
          error: {
            code: err.code,
            message: err.message,
            ...(err.issues ? { issues: err.issues } : {}),
          },
        },
        err.status
      )
    }

    console.error("[api] unhandled error", err)
    return c.json(
      {
        error: {
          code: "server_error" as const,
          message: "Something went wrong. Try again.",
        },
      },
      500
    )
  })
}
