import { notFound } from "next/navigation"
import { project } from "@workspace/quiz-core"

import { PreviewShell } from "@/components/quiz/preview-shell"
import { ApiClientError, quizApi } from "@/lib/api-client"

export const metadata = { title: "Preview" }

/**
 * What the student will see, from the draft.
 *
 * The projection runs here rather than being fetched, because the point of a
 * preview is to show the draft, which has not been published and so has no
 * manifest on the server yet. `project()` is pure and is the same function
 * apps/api runs at publish, so what a teacher sees here is what gets shipped.
 *
 * It also means every preview exercises `assertNoAnswerLeak`, which runs inside
 * `project()`: an answer that could leak fails during authoring rather than
 * after a class has the link.
 */
export default async function PreviewQuizPage({
  params,
}: {
  // Next 16: params is a Promise and must be awaited.
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let quiz
  try {
    quiz = await quizApi.get(id)
  } catch (error) {
    if (error instanceof ApiClientError && error.code === "not_found") notFound()
    throw error
  }

  return (
    <PreviewShell
      quizId={id}
      manifest={project(id, quiz.doc)}
      hasUnpublishedChanges={quiz.hasUnpublishedChanges}
      status={quiz.status}
    />
  )
}
