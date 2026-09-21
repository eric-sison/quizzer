/**
 * Typed failures.
 *
 * `code` is the stable discriminant both clients switch on. The exam-surface
 * codes must match `AppError::from_server_code` in
 * apps/desktop/src-tauri/src/error.rs, which collapses anything it does not
 * recognise to `server_error` - so a wrong code leaves the student staring at a
 * useless message.
 */
import type { ApiErrorCode, Issue } from "@workspace/quiz-core"
import type { ContentfulStatusCode } from "hono/utils/http-status"

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: ContentfulStatusCode
  readonly issues: Issue[] | undefined

  constructor(
    code: ApiErrorCode,
    status: ContentfulStatusCode,
    message?: string,
    issues?: Issue[]
  ) {
    super(message ?? code)
    this.name = "ApiError"
    this.code = code
    this.status = status
    this.issues = issues
  }
}

export const unauthorized = (message?: string) =>
  new ApiError("unauthorized", 401, message)

export const forbidden = (message?: string) => new ApiError("forbidden", 403, message)

export const notFound = (message?: string) => new ApiError("not_found", 404, message)

export const conflict = (message?: string) => new ApiError("conflict", 409, message)

export const validationFailed = (issues: Issue[]) =>
  new ApiError("validation_failed", 422, "This quiz has problems to fix.", issues)

/** Bad or unknown quiz token. Note the code: NOT `invalid_link`. */
export const invalidToken = (message?: string) =>
  new ApiError("invalid_token", 404, message)
