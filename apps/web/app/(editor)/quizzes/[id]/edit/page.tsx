import { notFound } from "next/navigation"

import { QuizEditor } from "@/components/quiz/quiz-editor"
import { ApiClientError, quizApi } from "@/lib/api-client"

export default async function EditQuizPage({
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

  // The header lives inside the editor because the title is part of the
  // document and the save indicator reflects client state. Rendering it here
  // would mean two places that know what is on screen.
  return <QuizEditor quiz={quiz} />
}
