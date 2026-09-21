/**
 * Publish rules for the kinds whose award is split across their parts.
 *
 * Multiple choice splits across the options marked correct; fill in the blank
 * splits across the blanks. The rules are identical - every scored part must
 * carry a value, and a question worth nothing is worth a second look - so they
 * live here once and the two kinds supply only their own vocabulary.
 */
import type { Issue } from "../issue"
import { questionPoints, scoredParts, type SplitScoredQuestion } from "../question"
import { issue } from "./logic"

/** What each kind calls its parts, for the message and the field path. */
function wordsFor(kind: SplitScoredQuestion["kind"]) {
  return kind === "multiple_choice"
    ? { noun: "Option", field: "options", code: "missing_option_points" }
    : { noun: "Blank", field: "blanks", code: "missing_blank_points" }
}

export function scoringIssues(q: SplitScoredQuestion): Issue[] {
  const issues: Issue[] = []
  const parts = scoredParts(q)
  if (parts.length === 0) return issues

  const words = wordsFor(q.kind)

  // Under per-part scoring every scored part must carry a value. An empty box
  // is not a deliberate zero - it is a part the teacher has not got to yet,
  // and publishing it would quietly mark that part as worthless.
  const unpriced =
    q.scoring === "per_option" ? parts.filter((part) => part.points === undefined) : []

  for (const part of unpriced) {
    issues.push(
      issue(
        q.id,
        `${words.field}.${part.index}.points`,
        words.code,
        `${words.noun} ${part.index + 1} has no point value.`
      )
    )
  }

  // Deliberate zeros throughout are legitimate - a survey question can be
  // worth nothing - so this only warns, and only when it is not already the
  // errors above saying the same thing more precisely.
  if (unpriced.length === 0 && questionPoints(q) === 0) {
    issues.push(
      issue(
        q.id,
        "points",
        "no_points_awarded",
        `Every scored ${words.noun.toLowerCase()} is worth 0 points.`,
        "warning"
      )
    )
  }

  return issues
}
