import {
  withDerivedPoints,
  type MultipleChoiceQuestion,
  type Question,
  type SingleChoiceQuestion,
} from "@workspace/quiz-core"

export type ChoiceQuestion = SingleChoiceQuestion | MultipleChoiceQuestion

/**
 * Switch a choice question between one and many correct answers.
 *
 * The two kinds are structurally identical apart from scoring, so this is
 * mostly a relabel - except in one direction. Going many -> one with several
 * marked correct has to discard all but the first, because "exactly one
 * correct" is the whole difference between them. The caller warns before
 * calling when `willDiscard` is true.
 */
export function willDiscardCorrectAnswers(question: ChoiceQuestion): number {
  const correct = question.options.filter((option) => option.correct).length
  return question.kind === "multiple_choice" && correct > 1 ? correct - 1 : 0
}

export function toSingleChoice(question: ChoiceQuestion): SingleChoiceQuestion {
  let kept = false
  const options = question.options.map((option) => {
    if (!option.correct) return option
    if (kept) return { ...option, correct: false }
    kept = true
    return option
  })

  if (question.kind === "single_choice") return { ...question, options }

  // The per-answer scoring keys are dropped, not merely ignored: the schema is
  // strict, and a single_choice question carrying them would fail to save. Its
  // points stop being derived, so it keeps the total it arrived with.
  const next: Omit<MultipleChoiceQuestion, "kind" | "scoring" | "pointsPerCorrect"> &
    Partial<Pick<MultipleChoiceQuestion, "scoring" | "pointsPerCorrect">> = {
    ...question,
    options,
  }
  delete next.scoring
  delete next.pointsPerCorrect
  return { ...next, kind: "single_choice" }
}

/**
 * The reverse. A question arriving from single_choice has no per-answer
 * scoring, so it starts on the flat rate at whatever it was already worth -
 * one correct answer keeps its total rather than silently dropping to 1.
 */
export function toMultipleChoice(question: ChoiceQuestion): MultipleChoiceQuestion {
  if (question.kind === "multiple_choice") return question
  return withDerivedPoints({
    ...question,
    kind: "multiple_choice",
    scoring: "uniform",
    pointsPerCorrect: question.points,
  })
}

export function isChoiceQuestion(question: Question): question is ChoiceQuestion {
  return question.kind === "single_choice" || question.kind === "multiple_choice"
}
