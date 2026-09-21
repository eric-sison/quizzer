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
import { questionPoints, type QuestionKind, type QuestionOfKind } from "../question"
import { hasFormatting, isRichDocEmpty, toPlainText, type RichDoc } from "../rich-text"

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

/** The one rule every kind shares: a question needs words. */
export function promptIssues(q: { id: string; promptDoc: RichDoc }): Issue[] {
  if (!isRichDocEmpty(q.promptDoc)) return []
  return [issue(q.id, "promptDoc", "empty_prompt", "This question has no text.")]
}

/**
 * De-correlate presented order from authored order.
 *
 * Matching right-columns and ordering choices are authored in an order that IS
 * the answer, so the manifest presents them sorted by id instead. Ids are
 * random, so the result is uncorrelated with correctness - and the comparison
 * is bytewise (never localeCompare), so apps/web's local preview projection
 * and apps/api's published one stay byte-identical.
 */
export function sortById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
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
    // Derived for multiple_choice, authored for everything else - see
    // `questionPoints`. The manifest must carry the total the teacher sees.
    points: questionPoints(q),
    required: q.required,
    // Choice kinds override from their own flag; the rest have nothing to shuffle.
    shuffle_options: false,
  }
  if (hasFormatting(q.promptDoc)) {
    question.prompt_doc = q.promptDoc
  }
  // explanationDoc is deliberately not projected: like the essay rubric, it is
  // teacher-only commentary, and handing it to the student gives away the answer.
  return question
}

export function manifestChoice(id: string, labelDoc: RichDoc): ManifestChoice {
  const choice: ManifestChoice = { id, label: toPlainText(labelDoc) }
  if (hasFormatting(labelDoc)) {
    choice.label_doc = labelDoc
  }
  return choice
}
