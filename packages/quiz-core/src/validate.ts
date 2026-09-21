/**
 * Publish-gate validation.
 *
 * Runs twice on purpose: in `apps/web` for instant feedback in the question
 * rail, and again in `apps/api` at publish as the authoritative gate. The
 * client's verdict is a UX affordance, never a control.
 *
 * Drafts are allowed to be invalid - autosave must never be blocked by a
 * half-built question.
 */
import { hasErrors, type Issue } from "./issue"
import type { QuizDoc } from "./question"
import { issue } from "./types/logic"
import { validateQuestion } from "./types/registry"

export const MAX_TITLE_LENGTH = 200

export function validateQuiz(doc: QuizDoc): Issue[] {
  const issues: Issue[] = []

  if (doc.title.trim().length === 0) {
    issues.push(issue(null, "title", "empty_title", "Give the quiz a title."))
  } else if (doc.title.length > MAX_TITLE_LENGTH) {
    issues.push(
      issue(
        null,
        "title",
        "title_too_long",
        `Titles are limited to ${MAX_TITLE_LENGTH} characters.`
      )
    )
  }

  if (doc.questions.length === 0) {
    issues.push(issue(null, "questions", "no_questions", "Add at least one question."))
  }

  if (doc.settings.durationS <= 0) {
    issues.push(
      issue(null, "settings.durationS", "invalid_duration", "Set a time limit above zero.")
    )
  }

  for (const question of doc.questions) {
    issues.push(...validateQuestion(question))
  }

  return issues
}

/** True when the quiz is publishable. Warnings do not block. */
export function canPublish(doc: QuizDoc): boolean {
  return !hasErrors(validateQuiz(doc))
}
