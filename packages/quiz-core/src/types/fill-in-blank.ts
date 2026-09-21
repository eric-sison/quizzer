import { baseManifest, issue, promptIssues, type QuestionLogic } from "./logic"
import { scoringIssues } from "./scoring"

export const fillInBlankLogic: QuestionLogic<"fill_in_blank"> = {
  kind: "fill_in_blank",

  validate(q) {
    const issues = promptIssues(q)

    if (q.blanks.length === 0) {
      issues.push(issue(q.id, "blanks", "no_blanks", "Add at least one blank."))
    }

    q.blanks.forEach((blank, index) => {
      const hasAnswer = blank.acceptedAnswers.some((a) => a.trim().length > 0)
      if (!hasAnswer) {
        issues.push(
          issue(
            q.id,
            `blanks.${index}.acceptedAnswers`,
            "empty_blank",
            `Blank ${index + 1} has no accepted responses.`
          )
        )
      }
    })

    issues.push(...scoringIssues(q))

    return issues
  },

  toManifest(q) {
    const question = baseManifest(q, [])
    // Students see how many blanks there are and SUBMIT positionally
    // (answer[i] is the i-th box) whatever `blankOrder` says - that flag
    // changes how the server lays the submission against the key, not how the
    // client sends it. Safe: a manifest is immutable per published version, so
    // the positions cannot shift under a session. The blanks themselves - ids
    // and accepted responses - never leave the server, and neither does
    // `blankOrder`, which is grading policy.
    question.blank_count = Math.max(1, q.blanks.length)
    return question
  },

  toAnswerKey(q) {
    return {
      kind: "fill_in_blank",
      acceptedAnswers: q.blanks.map((b) => b.acceptedAnswers),
      caseSensitive: q.caseSensitive,
      blankOrder: q.blankOrder,
    }
  },
}
