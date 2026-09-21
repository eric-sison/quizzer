import { isRichDocEmpty } from "../rich-text"
import { correctOptions, optionChoices, validateOptions } from "./choice"
import { baseManifest, issue, type QuestionLogic } from "./logic"

export const singleChoiceLogic: QuestionLogic<"single_choice"> = {
  kind: "single_choice",

  validate(q) {
    const issues = []

    if (isRichDocEmpty(q.promptDoc)) {
      issues.push(issue(q.id, "promptDoc", "empty_prompt", "This question has no text."))
    }

    issues.push(...validateOptions(q.id, q.options))

    const correct = correctOptions(q.options)
    if (correct.length === 0) {
      issues.push(
        issue(q.id, "options", "no_correct_option", "Mark one option as correct.")
      )
    } else if (correct.length > 1) {
      issues.push(
        issue(
          q.id,
          "options",
          "too_many_correct",
          "Only one option can be correct. Switch to multiple answers to allow more."
        )
      )
    }

    return issues
  },

  toManifest(q) {
    return baseManifest(q, optionChoices(q.options))
  },

  toAnswerKey(q) {
    const [first] = correctOptions(q.options)
    return { kind: "single_choice", correctOptionId: first?.id ?? null }
  },
}
