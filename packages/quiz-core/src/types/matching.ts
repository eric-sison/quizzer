import { richDocFromText } from "../rich-text"
import { issue, promptIssues, baseManifest, manifestChoice, sortById, type QuestionLogic } from "./logic"

export const matchingLogic: QuestionLogic<"matching"> = {
  kind: "matching",

  validate(q) {
    const issues = promptIssues(q)

    if (q.pairs.length < 2) {
      issues.push(issue(q.id, "pairs", "too_few_pairs", "Add at least 2 pairs."))
    }

    q.pairs.forEach((pair, index) => {
      if (pair.leftText.trim().length === 0) {
        issues.push(
          issue(
            q.id,
            `pairs.${index}.leftText`,
            "empty_pair_side",
            `Pair ${index + 1} has an empty left side.`
          )
        )
      }
      if (pair.rightText.trim().length === 0) {
        issues.push(
          issue(
            q.id,
            `pairs.${index}.rightText`,
            "empty_pair_side",
            `Pair ${index + 1} has an empty right side.`
          )
        )
      }
    })

    q.distractors.forEach((distractor, index) => {
      if (distractor.text.trim().length === 0) {
        issues.push(
          issue(
            q.id,
            `distractors.${index}.text`,
            "empty_distractor",
            `Extra item ${index + 1} is empty.`
          )
        )
      }
    })

    // Duplicate LEFT items make the question ambiguous to read; duplicate
    // RIGHT items (across pairs and distractors) make it unfair to grade -
    // two identical-looking choices where only one id is "the" match.
    const leftSeen = new Map<string, number>()
    q.pairs.forEach((pair, index) => {
      const key = pair.leftText.trim().toLowerCase()
      if (!key) return
      const first = leftSeen.get(key)
      if (first === undefined) {
        leftSeen.set(key, index)
      } else {
        issues.push(
          issue(
            q.id,
            `pairs.${index}.leftText`,
            "duplicate_left_item",
            `This repeats the left side of pair ${first + 1}.`
          )
        )
      }
    })

    const rightSeen = new Map<string, string>()
    const rights = [
      ...q.pairs.map((pair, index) => ({
        field: `pairs.${index}.rightText`,
        text: pair.rightText,
        name: `pair ${index + 1}`,
      })),
      ...q.distractors.map((distractor, index) => ({
        field: `distractors.${index}.text`,
        text: distractor.text,
        name: `extra item ${index + 1}`,
      })),
    ]
    for (const right of rights) {
      const key = right.text.trim().toLowerCase()
      if (!key) continue
      const first = rightSeen.get(key)
      if (first === undefined) {
        rightSeen.set(key, right.name)
      } else {
        issues.push(
          issue(
            q.id,
            right.field,
            "duplicate_right_item",
            `This repeats the right side of ${first}.`
          )
        )
      }
    }

    return issues
  },

  toManifest(q) {
    const question = baseManifest(q, [])
    // Left items keep their authored order - it carries no secret. Right items
    // are pairs' rights plus distractors, sorted by their random ids so their
    // order says nothing about which left item they belong to, and nothing
    // marks which of them are distractors.
    question.left_items = q.pairs.map((pair) =>
      manifestChoice(pair.leftId, richDocFromText(pair.leftText))
    )
    question.right_items = sortById([
      ...q.pairs.map((pair) => ({
        id: pair.rightId,
        doc: richDocFromText(pair.rightText),
      })),
      ...q.distractors.map((distractor) => ({
        id: distractor.id,
        doc: richDocFromText(distractor.text),
      })),
    ]).map((entry) => manifestChoice(entry.id, entry.doc))
    return question
  },

  toAnswerKey(q) {
    const correctPairs: Record<string, string> = {}
    for (const pair of q.pairs) correctPairs[pair.leftId] = pair.rightId
    return { kind: "matching", correctPairs }
  },
}
