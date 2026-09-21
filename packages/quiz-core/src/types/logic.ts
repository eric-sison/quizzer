/**
 * The per-kind contract.
 *
 * Adding a question type means writing one of these and adding one registry
 * key. Nothing generic - not the validator, not the projector, not the
 * publisher - needs to learn about the new kind.
 */
import type { AnswerKey } from "../answer-key"
import type { Issue, IssueSeverity } from "../issue"
import type { ManifestQuestion, ManifestChoice } from "../manifest"
import type { QuestionKind, QuestionOfKind } from "../question"
import { hasFormatting, toPlainText, type RichDoc } from "../rich-text"

export type QuestionLogic<K extends QuestionKind> = {
  kind: K
  /** Publish-gate rules. Drafts are allowed to be invalid. */
  validate(q: QuestionOfKind<K>): Issue[]
  /** MUST NOT emit a correct answer. The return type gives it nowhere to go. */
  toManifest(q: QuestionOfKind<K>): ManifestQuestion
  /** `null` means the question is graded by a human. */
  toAnswerKey(q: QuestionOfKind<K>): AnswerKey | null
}

export function issue(
  questionId: string | null,
  field: string,
  code: string,
  message: string,
  severity: IssueSeverity = "error"
): Issue {
  return { questionId, field, code, message, severity }
}

/** Fields every kind projects identically. */
export function baseManifest(
  q: QuestionOfKind<QuestionKind>,
  choices: ManifestChoice[]
): ManifestQuestion {
  const question: ManifestQuestion = {
    id: q.id,
    kind: q.kind,
    prompt: toPlainText(q.promptDoc),
    choices,
    points: q.points,
    required: q.required,
  }
  if (hasFormatting(q.promptDoc)) {
    question.prompt_doc = q.promptDoc
  }
  return question
}

export function manifestChoice(id: string, labelDoc: RichDoc): ManifestChoice {
  const choice: ManifestChoice = { id, label: toPlainText(labelDoc) }
  if (hasFormatting(labelDoc)) {
    choice.label_doc = labelDoc
  }
  return choice
}
