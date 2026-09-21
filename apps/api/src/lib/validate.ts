import { zValidator } from "@hono/zod-validator"
import type { ZodType } from "zod"

import { ApiError } from "./errors"

/**
 * zValidator with our error envelope.
 *
 * Its default failure response is its own shape; every failure in this service
 * must leave as `{"error":{"code":...}}` so both clients can switch on `code`.
 */
export function validate<T extends ZodType>(
  target: "json" | "param" | "query",
  schema: T
) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      const [first] = result.error.issues
      const where = first?.path.join(".")
      throw new ApiError(
        "validation_failed",
        400,
        where ? `Malformed request at "${where}".` : "Malformed request."
      )
    }
    return undefined
  })
}
