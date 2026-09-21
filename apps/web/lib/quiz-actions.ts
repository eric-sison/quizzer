"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import {
  isImageContentType,
  MAX_IMAGE_BYTES,
  quizDocSchema,
  type Issue,
  type PublishResponse,
  type QuizDoc,
} from "@workspace/quiz-core"

import { ApiClientError, quizApi } from "./api-client"

/**
 * Server Actions are reachable by direct POST, not only through the UI, so
 * authorization cannot live in the component that renders the button.
 * `quizApi` attaches the acting teacher on every call and apps/api scopes every
 * query by it, which is what actually keeps one teacher out of another's quizzes.
 */

export type ActionResult = { ok: true } | { ok: false; message: string }

function describe(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.code === "network_unavailable"
      ? "Could not reach the quiz service. Is apps/api running on port 3000?"
      : error.message
  }
  return "Something went wrong."
}

export async function createQuizAction(): Promise<void> {
  const quiz = await quizApi.create()
  revalidatePath("/quizzes")
  // redirect() throws to unwind, so it must sit outside any try/catch.
  redirect(`/quizzes/${quiz.id}/edit`)
}

export type UploadImageResult =
  | { ok: true; id: string }
  | { ok: false; message: string }

/**
 * Store one question image and hand back its id; the caller writes the id
 * into the question, where it rides autosave like any other edit. The checks
 * here are a courtesy for a fast refusal - apps/api enforces the same limits.
 */
export async function uploadQuestionImageAction(
  quizId: string,
  formData: FormData
): Promise<UploadImageResult> {
  const file = formData.get("image")
  if (!(file instanceof File)) {
    return { ok: false, message: "Choose an image file to upload." }
  }
  if (!isImageContentType(file.type)) {
    return { ok: false, message: "Images must be PNG, JPEG, WebP or GIF." }
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      message: `Images are limited to ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))} MB.`,
    }
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const { id } = await quizApi.uploadImage(quizId, file.type, bytes)
    return { ok: true, id }
  } catch (error) {
    return { ok: false, message: describe(error) }
  }
}

export async function deleteQuizAction(id: string): Promise<ActionResult> {
  try {
    await quizApi.remove(id)
  } catch (error) {
    return { ok: false, message: describe(error) }
  }

  revalidatePath("/quizzes")
  return { ok: true }
}

export async function renameQuizAction(
  id: string,
  title: string
): Promise<ActionResult> {
  try {
    const quiz = await quizApi.get(id)
    await quizApi.saveDraft(id, { ...quiz.doc, title }, quiz.docVersion)
  } catch (error) {
    return { ok: false, message: describe(error) }
  }

  revalidatePath("/quizzes")
  return { ok: true }
}

/**
 * Autosave. Called from a timer in the editor, not from a form.
 *
 * It reports failure in its return value instead of throwing, because a thrown
 * Server Action reaches the client as an opaque "an error occurred" in
 * production. The editor needs to tell a stale version apart from an API that
 * is merely down: one is terminal, the other retries.
 *
 * The document is validated here even though apps/api validates it again. This
 * endpoint is a public POST, and an unparseable body should stop at the edge.
 *
 * Note: Server Action request bodies are capped at 1MB by default. A quiz large
 * enough to hit that would need `serverActions.bodySizeLimit` in next.config.
 */
export type SaveDraftActionResult =
  | { ok: true; docVersion: number; savedAt: string }
  | { ok: false; reason: "conflict" | "gone" | "transient"; message: string }

export async function saveDraftAction(
  id: string,
  doc: QuizDoc,
  docVersion: number
): Promise<SaveDraftActionResult> {
  const parsed = quizDocSchema.safeParse(doc)
  if (!parsed.success) {
    return {
      ok: false,
      reason: "gone",
      message: "That draft is not a valid quiz document, so it was not saved.",
    }
  }

  try {
    const saved = await quizApi.saveDraft(id, parsed.data, docVersion)
    return { ok: true, docVersion: saved.docVersion, savedAt: saved.updatedAt }
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.isConflict) {
        return { ok: false, reason: "conflict", message: error.message }
      }
      // Gone or not ours. Retrying will never succeed.
      if (error.code === "not_found" || error.code === "forbidden") {
        return { ok: false, reason: "gone", message: error.message }
      }
    }
    return { ok: false, reason: "transient", message: describe(error) }
  }
}

/**
 * Publish.
 *
 * Like autosave, this reports failure in its return value: the one failure a
 * teacher will actually hit is a quiz that does not pass validation, and the
 * issue list is the whole point of that response. Throwing would reduce it to
 * "an error occurred".
 *
 * apps/web runs `validateQuiz` too, for the dots in the question rail, but the
 * gate is apps/api's. This action does not pre-check: a client that decided
 * for itself whether a quiz was publishable would be a control, and it is not
 * one.
 */
export type PublishActionResult =
  | { ok: true; published: PublishResponse }
  | { ok: false; reason: "invalid"; issues: Issue[] }
  | { ok: false; reason: "error"; message: string }

export async function publishQuizAction(id: string): Promise<PublishActionResult> {
  try {
    const published = await quizApi.publish(id)
    revalidatePath("/quizzes")
    revalidatePath(`/quizzes/${id}/edit`)
    return { ok: true, published }
  } catch (error) {
    if (error instanceof ApiClientError && error.code === "validation_failed") {
      return { ok: false, reason: "invalid", issues: error.issues ?? [] }
    }
    return { ok: false, reason: "error", message: describe(error) }
  }
}

export async function unpublishQuizAction(id: string): Promise<ActionResult> {
  try {
    await quizApi.unpublish(id)
  } catch (error) {
    return { ok: false, message: describe(error) }
  }

  revalidatePath("/quizzes")
  revalidatePath(`/quizzes/${id}/edit`)
  return { ok: true }
}
