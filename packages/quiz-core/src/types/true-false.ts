import { richDocFromText, isRichDocEmpty } from "../rich-text"
import { baseManifest, issue, manifestChoice, type QuestionLogic } from "./logic"

/**
 * True/False needs no "exactly one correct" rule: the authoring model stores a
 * single boolean, so an invalid selection is unrepresentable. The two choices
 * are fixed, which is why the editor does not offer add/rename/reorder.
 */
export const TRUE_ID = "true"
export const FALSE_ID = "false"

export const trueFalseLogic: QuestionLogic<"true_false"> = {
  kind: "true_false",

  validate(q) {
    if (isRichDocEmpty(q.promptDoc)) {
      return [issue(q.id, "promptDoc", "empty_prompt", "This question has no text.")]
    }
    return []
  },

  toManifest(q) {
    return baseManifest(q, [
      manifestChoice(TRUE_ID, richDocFromText("True")),
      manifestChoice(FALSE_ID, richDocFromText("False")),
    ])
  },

  toAnswerKey(q) {
    return { kind: "true_false", correct: q.correct }
  },
}
