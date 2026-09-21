/**
 * The grading model. Server-only: stored beside the manifest in
 * `quiz_versions.answer_key` and never returned by any endpoint the exam
 * client can reach.
 */
export type AnswerKey =
  | { kind: "true_false"; correct: boolean }
  | { kind: "single_choice"; correctOptionId: string | null }
  | { kind: "multiple_choice"; correctOptionIds: string[] }

export type QuizAnswerKey = {
  version: 1
  /** Keyed by question id. `null` means the question is graded by a human. */
  keys: Record<string, AnswerKey | null>
}
