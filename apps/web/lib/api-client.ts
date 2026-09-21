import "server-only"

import {
  apiErrorSchema,
  publishResponseSchema,
  quizDetailSchema,
  quizSummarySchema,
  saveDraftResponseSchema,
  uploadMediaResponseSchema,
  type ApiErrorCode,
  type Issue,
  type PublishResponse,
  type QuizDetail,
  type QuizDoc,
  type QuizSummary,
  type SaveDraftResponse,
  type UploadMediaResponse,
} from "@workspace/quiz-core"
import { z } from "zod"

import { getCurrentTeacher } from "./auth"
import { env } from "./env"

/** A fetch that never reached apps/api gets its own code. */
export type ClientErrorCode = ApiErrorCode | "network_unavailable"

export class ApiClientError extends Error {
  readonly code: ClientErrorCode
  readonly status: number
  readonly issues: Issue[] | undefined

  constructor(code: ClientErrorCode, status: number, message: string, issues?: Issue[]) {
    super(message)
    this.name = "ApiClientError"
    this.code = code
    this.status = status
    this.issues = issues
  }

  /** A stale-version conflict, which the editor surfaces rather than retries. */
  get isConflict(): boolean {
    return this.code === "conflict"
  }
}

type RequestOptions<T> = {
  method?: "GET" | "POST" | "PUT" | "DELETE"
  body?: unknown
  /** Response shape. Validating here catches api/web drift at the boundary. */
  schema?: z.ZodType<T>
}

async function request<T>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const { method = "GET", body, schema } = options
  const teacher = await getCurrentTeacher()

  let response: Response
  try {
    response = await fetch(`${env.API_ORIGIN}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.SERVICE_TOKEN}`,
        "X-Teacher-Id": teacher.id,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Quiz data is per-teacher and changes constantly; caching it would show
      // a teacher someone else's stale list.
      cache: "no-store",
    })
  } catch {
    // The reason a socket refused is not actionable for a teacher; what is
    // actionable is that apps/api is not answering.
    throw new ApiClientError(
      "network_unavailable",
      0,
      "Could not reach the quiz service.",
      undefined
    )
  }

  if (!response.ok) {
    throw await toClientError(response)
  }

  if (response.status === 204 || !schema) {
    return undefined as T
  }

  const parsed = schema.safeParse(await response.json())
  if (!parsed.success) {
    throw new ApiClientError(
      "server_error",
      response.status,
      `The quiz service returned an unexpected shape for ${path}.`
    )
  }

  return parsed.data
}

async function toClientError(response: Response): Promise<ApiClientError> {
  const envelope = apiErrorSchema.safeParse(await response.json().catch(() => null))

  if (!envelope.success) {
    return new ApiClientError(
      "server_error",
      response.status,
      "The quiz service returned an unreadable error."
    )
  }

  const { code, message, issues } = envelope.data.error
  return new ApiClientError(
    code,
    response.status,
    message ?? code,
    issues as Issue[] | undefined
  )
}

export const quizApi = {
  list(): Promise<QuizSummary[]> {
    return request("/api/quizzes", { schema: z.array(quizSummarySchema) })
  },

  create(title?: string): Promise<QuizDetail> {
    return request("/api/quizzes", {
      method: "POST",
      body: { ...(title === undefined ? {} : { title }) },
      schema: quizDetailSchema,
    })
  },

  get(id: string): Promise<QuizDetail> {
    return request(`/api/quizzes/${id}`, { schema: quizDetailSchema })
  },

  saveDraft(id: string, doc: QuizDoc, docVersion: number): Promise<SaveDraftResponse> {
    return request(`/api/quizzes/${id}/draft`, {
      method: "PUT",
      body: { doc, docVersion },
      schema: saveDraftResponseSchema,
    })
  },

  remove(id: string): Promise<void> {
    return request(`/api/quizzes/${id}`, { method: "DELETE" })
  },

  publish(id: string): Promise<PublishResponse> {
    return request(`/api/quizzes/${id}/publish`, {
      method: "POST",
      schema: publishResponseSchema,
    })
  },

  unpublish(id: string): Promise<void> {
    return request(`/api/quizzes/${id}/unpublish`, { method: "POST" })
  },

  /** Raw bytes, not JSON: an image has no business being base64'd. */
  async uploadImage(
    quizId: string,
    contentType: string,
    body: Uint8Array
  ): Promise<UploadMediaResponse> {
    const teacher = await getCurrentTeacher()

    let response: Response
    try {
      response = await fetch(`${env.API_ORIGIN}/api/quizzes/${quizId}/media`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.SERVICE_TOKEN}`,
          "X-Teacher-Id": teacher.id,
          "Content-Type": contentType,
        },
        body: body as BodyInit,
        cache: "no-store",
      })
    } catch {
      throw new ApiClientError(
        "network_unavailable",
        0,
        "Could not reach the quiz service.",
        undefined
      )
    }

    if (!response.ok) throw await toClientError(response)

    const parsed = uploadMediaResponseSchema.safeParse(await response.json())
    if (!parsed.success) {
      throw new ApiClientError(
        "server_error",
        response.status,
        "The quiz service returned an unexpected shape for the upload."
      )
    }
    return parsed.data
  },

  /**
   * The raw upstream response for an image, for the media proxy route to
   * stream on - never parsed here, because the body is not ours to interpret.
   */
  async imageResponse(mediaId: string): Promise<Response> {
    const teacher = await getCurrentTeacher()
    return fetch(`${env.API_ORIGIN}/api/media/${mediaId}`, {
      headers: {
        Authorization: `Bearer ${env.SERVICE_TOKEN}`,
        "X-Teacher-Id": teacher.id,
      },
      cache: "no-store",
    })
  },
}
