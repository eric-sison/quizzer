import { isRichDocEmpty } from "../rich-text"
import { baseManifest, issue, type QuestionLogic } from "./logic"

export const essayLogic: QuestionLogic<"essay"> = {
  kind: "essay",

  validate(q) {
    const issues = []

    if (isRichDocEmpty(q.promptDoc)) {
      issues.push(issue(q.id, "promptDoc", "empty_prompt", "This question has no text."))
    }

    if (q.minWords !== undefined && q.maxWords !== undefined && q.minWords > q.maxWords) {
      issues.push(
        issue(
          q.id,
          "minWords",
          "word_range_inverted",
          "The minimum word count is above the maximum."
        )
      )
    }

    return issues
  },

  toManifest(q) {
    const question = baseManifest(q, [])
    if (q.minWords !== undefined) question.min_words = q.minWords
    if (q.maxWords !== undefined) question.max_words = q.maxWords
    // rubricDoc is deliberately not projected: it is marking guidance for the
    // teacher, and handing it to the student would give away the answer.
    return question
  },

  toAnswerKey() {
    // No machine key. Scoring happens in the (future) manual grading queue.
    return null
  },
}
