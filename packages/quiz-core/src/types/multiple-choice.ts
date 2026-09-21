import { isRichDocEmpty } from "../rich-text"
import { correctOptions, optionChoices, validateOptions } from "./choice"
import { baseManifest, issue, type QuestionLogic } from "./logic"

export const multipleChoiceLogic: QuestionLogic<"multiple_choice"> = {
  kind: "multiple_choice",

  validate(q) {
    const issues = []

    if (isRichDocEmpty(q.promptDoc)) {
      issues.push(issue(q.id, "promptDoc", "empty_prompt", "This question has no text."))
    }

    issues.push(...validateOptions(q.id, q.options))

    const correct = correctOptions(q.options)
    if (correct.length === 0) {
      issues.push(
        issue(q.id, "options", "no_correct_option", "Mark at least one option as correct.")
      )
    } else if (correct.length === q.options.length && q.options.length > 0) {
      // Legitimate, but almost always a mis-click. Warn, never block.
      issues.push(
        issue(
          q.id,
          "options",
          "all_options_correct",
          "Every option is marked correct.",
          "warning"
        )
      )
    }

    return issues
  },

  toManifest(q) {
    return baseManifest(q, optionChoices(q.options))
  },

  toAnswerKey(q) {
    return {
      kind: "multiple_choice",
      correctOptionIds: correctOptions(q.options).map((o) => o.id),
    }
  },
}
