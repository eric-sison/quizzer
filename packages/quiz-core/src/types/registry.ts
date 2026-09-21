import type { AnswerKey } from "../answer-key"
import type { Issue } from "../issue"
import type { ManifestQuestion } from "../manifest"
import type { Question, QuestionKind, QuestionOfKind } from "../question"
import { essayLogic } from "./essay"
import type { QuestionLogic } from "./logic"
import { multipleChoiceLogic } from "./multiple-choice"
import { singleChoiceLogic } from "./single-choice"
import { trueFalseLogic } from "./true-false"

/**
 * Every question kind, in one place. `satisfies` makes a missing or mislabelled
 * entry a compile error rather than a runtime surprise.
 */
export const questionLogic = {
  true_false: trueFalseLogic,
  single_choice: singleChoiceLogic,
  multiple_choice: multipleChoiceLogic,
  essay: essayLogic,
} satisfies { [K in QuestionKind]: QuestionLogic<K> }

/**
 * Dispatch on a question's own kind.
 *
 * The cast is confined to these three helpers: `questionLogic[q.kind]` is a
 * union of logic objects, and TypeScript cannot see that its `kind` matches
 * `q`'s. Callers stay fully typed.
 */
function logicFor<K extends QuestionKind>(kind: K): QuestionLogic<K> {
  return questionLogic[kind] as QuestionLogic<K>
}

export function validateQuestion(q: Question): Issue[] {
  return logicFor(q.kind).validate(q as QuestionOfKind<typeof q.kind>)
}

export function questionToManifest(q: Question): ManifestQuestion {
  return logicFor(q.kind).toManifest(q as QuestionOfKind<typeof q.kind>)
}

export function questionToAnswerKey(q: Question): AnswerKey | null {
  return logicFor(q.kind).toAnswerKey(q as QuestionOfKind<typeof q.kind>)
}
