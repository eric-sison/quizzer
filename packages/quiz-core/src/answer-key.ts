/**
 * The grading model. Server-only: stored beside the manifest in
 * `quiz_versions.answer_key` and never returned by any endpoint the exam
 * client can reach.
 */
export type AnswerKey =
  | { kind: "true_false"; correct: boolean }
  | { kind: "single_choice"; correctOptionId: string | null }
  | { kind: "multiple_choice"; correctOptionIds: string[] }
  | { kind: "numeric"; correctValue: number; tolerance: number }
  /** Positional: `acceptedAnswers[i]` grades the answer to blank i. */
  | { kind: "fill_in_blank"; acceptedAnswers: string[][]; caseSensitive: boolean }
  /** leftId → the rightId that matches it. Distractors appear in no value. */
  | { kind: "matching"; correctPairs: Record<string, string> }
  /** Item ids in the correct sequence. */
  | { kind: "ordering"; correctOrder: string[] }

export type QuizAnswerKey = {
  version: 1
  /** Keyed by question id. `null` means the question is graded by a human. */
  keys: Record<string, AnswerKey | null>
}
