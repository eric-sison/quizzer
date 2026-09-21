/**
 * The grading model. Server-only: stored beside the manifest in
 * `quiz_versions.answer_key` and never returned by any endpoint the exam
 * client can reach.
 */
import type { BlankOrder } from "./question"

export type AnswerKey =
  | { kind: "true_false"; correct: boolean }
  | { kind: "single_choice"; correctOptionId: string | null }
  | { kind: "multiple_choice"; correctOptionIds: string[] }
  | { kind: "numeric"; correctValue: number; tolerance: number }
  /**
   * `acceptedAnswers[i]` holds what blank i will take.
   *
   * `blankOrder` decides how a submission is laid against that list:
   *
   * - `in_order` is positional. Response i is graded against
   *   `acceptedAnswers[i]` and nothing else.
   * - `any_order` treats the blanks as a set. A response counts if it matches
   *   any blank's list, but each blank may be satisfied only ONCE - otherwise
   *   a student could type the same right answer into every box and score
   *   full marks. Marking is therefore a one-to-one assignment of responses
   *   to blanks, and a partial-credit grader must choose the assignment that
   *   satisfies the most blanks rather than the first one it stumbles on.
   */
  | {
      kind: "fill_in_blank"
      acceptedAnswers: string[][]
      caseSensitive: boolean
      blankOrder: BlankOrder
    }
  /** leftId → the rightId that matches it. Distractors appear in no value. */
  | { kind: "matching"; correctPairs: Record<string, string> }
  /** Item ids in the correct sequence. */
  | { kind: "ordering"; correctOrder: string[] }

export type QuizAnswerKey = {
  version: 1
  /** Keyed by question id. `null` means the question is graded by a human. */
  keys: Record<string, AnswerKey | null>
}
