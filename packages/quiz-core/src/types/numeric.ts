import { baseManifest, issue, promptIssues, type QuestionLogic } from "./logic"

export const numericLogic: QuestionLogic<"numeric"> = {
  kind: "numeric",

  validate(q) {
    const issues = promptIssues(q)

    if (q.correctValue === undefined) {
      issues.push(issue(q.id, "correctValue", "no_correct_value", "Enter the correct value."))
    }

    return issues
  },

  toManifest(q) {
    const question = baseManifest(q, [])
    // The unit is presentation, not grading data; correctValue and tolerance
    // are grading data and never leave the server.
    const unit = q.unit?.trim()
    if (unit) question.unit = unit
    return question
  },

  toAnswerKey(q) {
    // Unreachable null after the publish gate; total so drafts can be keyed.
    if (q.correctValue === undefined) return null
    return { kind: "numeric", correctValue: q.correctValue, tolerance: q.tolerance }
  },
}
