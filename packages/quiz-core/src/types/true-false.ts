import type { TrueFalseStyle } from "../question"
import { richDocFromText, isRichDocEmpty } from "../rich-text"
import { baseManifest, issue, manifestChoice, type QuestionLogic } from "./logic"

/**
 * True/False needs no "exactly one correct" rule: the authoring model stores a
 * single boolean, so an invalid selection is unrepresentable. The two choices
 * are fixed, which is why the editor does not offer add/rename/reorder.
 *
 * The ids stay "true"/"false" whatever wording is shown. A yes/no question is
 * the same boolean asked in different words, so the answer key, the submitted
 * responses and grading are untouched by the style - only the labels move.
 */
export const TRUE_ID = "true"
export const FALSE_ID = "false"

/** The word pair each style presents, affirmative first. */
export const TRUE_FALSE_LABELS: Record<TrueFalseStyle, readonly [string, string]> = {
  true_false: ["True", "False"],
  yes_no: ["Yes", "No"],
}

export const trueFalseLogic: QuestionLogic<"true_false"> = {
  kind: "true_false",

  validate(q) {
    if (isRichDocEmpty(q.promptDoc)) {
      return [issue(q.id, "promptDoc", "empty_prompt", "This question has no text.")]
    }
    return []
  },

  toManifest(q) {
    const [affirmative, negative] = TRUE_FALSE_LABELS[q.labelStyle]
    return baseManifest(q, [
      manifestChoice(TRUE_ID, richDocFromText(affirmative)),
      manifestChoice(FALSE_ID, richDocFromText(negative)),
    ])
  },

  toAnswerKey(q) {
    return { kind: "true_false", correct: q.correct }
  },
}
