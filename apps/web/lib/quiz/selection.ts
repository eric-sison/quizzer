import type { MultipleChoiceQuestion, Question, SingleChoiceQuestion } from "@workspace/quiz-core"

export type ChoiceQuestion = SingleChoiceQuestion | MultipleChoiceQuestion

/**
 * Switch a choice question between one and many correct answers.
 *
 * The two kinds are structurally identical, so this is a relabel - except in
 * one direction. Going many -> one with several marked correct has to discard
 * all but the first, because "exactly one correct" is the whole difference
 * between them. The caller warns before calling when `willDiscard` is true.
 */
export function willDiscardCorrectAnswers(question: ChoiceQuestion): number {
  const correct = question.options.filter((option) => option.correct).length
  return question.kind === "multiple_choice" && correct > 1 ? correct - 1 : 0
}

export function toSingleChoice(question: ChoiceQuestion): SingleChoiceQuestion {
  let kept = false
  return {
    ...question,
    kind: "single_choice",
    options: question.options.map((option) => {
      if (!option.correct) return option
      if (kept) return { ...option, correct: false }
      kept = true
      return option
    }),
  }
}

export function toMultipleChoice(question: ChoiceQuestion): MultipleChoiceQuestion {
  return { ...question, kind: "multiple_choice" }
}

export function isChoiceQuestion(question: Question): question is ChoiceQuestion {
  return question.kind === "single_choice" || question.kind === "multiple_choice"
}
