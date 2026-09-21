import { isRichDocEmpty, richDocHasImage, toPlainText } from "../rich-text"
import { issue, promptIssues, baseManifest, manifestChoice, sortById, type QuestionLogic } from "./logic"

export const orderingLogic: QuestionLogic<"ordering"> = {
  kind: "ordering",

  validate(q) {
    const issues = promptIssues(q)

    if (q.items.length < 2) {
      issues.push(issue(q.id, "items", "too_few_items", "Add at least 2 items to order."))
    }

    const seen = new Map<string, number>()
    q.items.forEach((item, index) => {
      const noText = isRichDocEmpty(item.labelDoc)

      // An image-only item is visible; it also opts out of duplicate
      // detection, which compares text (same rule as choice options).
      if (noText) {
        if (!richDocHasImage(item.labelDoc)) {
          issues.push(
            issue(
              q.id,
              `items.${index}.labelDoc`,
              "empty_item",
              "An empty item is invisible to students."
            )
          )
        }
        return
      }

      const key = toPlainText(item.labelDoc).trim().toLowerCase()
      const first = seen.get(key)
      if (first === undefined) {
        seen.set(key, index)
      } else {
        issues.push(
          issue(
            q.id,
            `items.${index}.labelDoc`,
            "duplicate_item",
            `This repeats item ${first + 1}.`
          )
        )
      }
    })

    return issues
  },

  toManifest(q) {
    // The authored order IS the answer, so the choices are presented sorted by
    // their random ids instead - stable, pure, and uncorrelated with the key.
    return baseManifest(
      q,
      sortById(q.items).map((item) => manifestChoice(item.id, item.labelDoc))
    )
  },

  toAnswerKey(q) {
    return { kind: "ordering", correctOrder: q.items.map((item) => item.id) }
  },
}
