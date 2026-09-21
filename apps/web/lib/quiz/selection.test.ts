import { createOption, createQuestion, type MultipleChoiceQuestion } from "@workspace/quiz-core"
import { describe, expect, it } from "vitest"

import {
  isChoiceQuestion,
  toMultipleChoice,
  toSingleChoice,
  willDiscardCorrectAnswers,
} from "./selection"

function manyWith(correct: boolean[]): MultipleChoiceQuestion {
  return {
    ...createQuestion("multiple_choice"),
    options: correct.map((isCorrect, i) => ({
      ...createOption(`option ${i + 1}`),
      correct: isCorrect,
    })),
  }
}

describe("willDiscardCorrectAnswers", () => {
  it("counts only the answers beyond the first", () => {
    expect(willDiscardCorrectAnswers(manyWith([true, true, true]))).toBe(2)
    expect(willDiscardCorrectAnswers(manyWith([true, false]))).toBe(0)
    expect(willDiscardCorrectAnswers(manyWith([false, false]))).toBe(0)
  })

  it("reports nothing for a question already limited to one answer", () => {
    expect(willDiscardCorrectAnswers(toSingleChoice(manyWith([true, true])))).toBe(0)
  })
})

describe("toSingleChoice", () => {
  it("keeps the first correct answer and unmarks the rest", () => {
    const converted = toSingleChoice(manyWith([false, true, true, true]))

    expect(converted.kind).toBe("single_choice")
    expect(converted.options.map((o) => o.correct)).toEqual([false, true, false, false])
  })

  it("leaves option text and ids untouched", () => {
    const source = manyWith([true, true])
    const converted = toSingleChoice(source)

    expect(converted.options.map((o) => o.id)).toEqual(source.options.map((o) => o.id))
    expect(converted.options.map((o) => o.labelDoc)).toEqual(
      source.options.map((o) => o.labelDoc)
    )
  })

  it("does not invent a correct answer when none was marked", () => {
    const converted = toSingleChoice(manyWith([false, false]))
    expect(converted.options.every((o) => !o.correct)).toBe(true)
  })
})

describe("toMultipleChoice", () => {
  it("is a pure relabel, losing nothing", () => {
    const single = toSingleChoice(manyWith([true, false, false]))
    const back = toMultipleChoice(single)

    expect(back.kind).toBe("multiple_choice")
    expect(back.options).toEqual(single.options)
    expect(back.promptDoc).toEqual(single.promptDoc)
    expect(back.points).toBe(single.points)
  })
})

describe("isChoiceQuestion", () => {
  it("accepts both choice kinds and nothing else", () => {
    expect(isChoiceQuestion(createQuestion("single_choice"))).toBe(true)
    expect(isChoiceQuestion(createQuestion("multiple_choice"))).toBe(true)
    expect(isChoiceQuestion(createQuestion("true_false"))).toBe(false)
    expect(isChoiceQuestion(createQuestion("essay"))).toBe(false)
  })
})
