/**
 * Per-answer scoring for many-answer questions: what a question is worth stops
 * being a number someone typed and becomes a function of the answers marked
 * correct. These prove the derivation, that it survives the document round
 * trip, and that quizzes authored before it existed still parse.
 */
import { describe, expect, it } from "vitest"

import {
  createOption,
  createQuestion,
  createQuizDoc,
  MAX_QUESTION_POINTS,
  questionPoints,
  quizDocSchema,
  withDerivedPoints,
  type MultipleChoiceQuestion,
} from "../question"
import { questionToManifest, validateQuestion } from "../types/registry"
import { fillInBlank, multipleChoice } from "./fixtures"

function scored(
  correct: boolean[],
  extra: Partial<MultipleChoiceQuestion> = {}
): MultipleChoiceQuestion {
  return {
    ...createQuestion("multiple_choice"),
    options: correct.map((isCorrect, i) => ({
      ...createOption(`option ${i + 1}`),
      correct: isCorrect,
    })),
    ...extra,
  }
}

/** A per-answer-scored question with nothing filled in yet. */
function perOption(
  prompt: string,
  labels: [string, boolean][]
): MultipleChoiceQuestion {
  return { ...multipleChoice(prompt, labels), scoring: "per_option" }
}

function docWith(question: MultipleChoiceQuestion) {
  return { ...createQuizDoc("Quiz"), questions: [question] }
}

describe("questionPoints, for a many-answer question", () => {
  it("multiplies the flat rate by the answers marked correct", () => {
    expect(questionPoints(scored([true, true, false], { pointsPerCorrect: 3 }))).toBe(6)
  })

  it("is nothing when nothing is marked correct", () => {
    expect(questionPoints(scored([false, false], { pointsPerCorrect: 5 }))).toBe(0)
  })

  it("sums the values typed on the correct answers under per-option scoring", () => {
    const question = scored([true, true, true], { scoring: "per_option" })
    question.options[0]!.points = 4
    question.options[1]!.points = 1
    // The third is left unset, which is worth nothing rather than NaN.
    expect(questionPoints(question)).toBe(5)
  })

  it("ignores values left on answers that are not correct", () => {
    const question = scored([true, false], { scoring: "per_option" })
    question.options[0]!.points = 2
    question.options[1]!.points = 90
    expect(questionPoints(question)).toBe(2)
  })

  it("keeps the flat rate while per-option scoring is showing, and vice versa", () => {
    const question = scored([true, true], { scoring: "per_option", pointsPerCorrect: 7 })
    question.options[0]!.points = 1

    expect(questionPoints(question)).toBe(1)
    expect(questionPoints({ ...question, scoring: "uniform" })).toBe(14)
  })

  it("clamps at the ceiling rather than producing an unsavable total", () => {
    const question = scored(Array.from({ length: 50 }, () => true), {
      pointsPerCorrect: MAX_QUESTION_POINTS,
    })

    expect(questionPoints(question)).toBe(MAX_QUESTION_POINTS)
    expect(() => quizDocSchema.parse(docWith(withDerivedPoints(question)))).not.toThrow()
  })
})

describe("questionPoints, for a fill-in-the-blank question", () => {
  it("multiplies the flat rate by the number of blanks", () => {
    // Unlike multiple choice, every blank is scored: there is no correct
    // subset to filter, so the count is simply how many blanks there are.
    const q = fillInBlank("a ___ ___ ___", [["a"], ["b"], ["c"]], {
      pointsPerCorrect: 2,
    })
    expect(questionPoints(q)).toBe(6)
  })

  it("sums the values typed on the blanks under per-blank scoring", () => {
    const q = fillInBlank("a ___ ___", [["a"], ["b"]], { scoring: "per_option" })
    q.blanks[0]!.points = 5
    q.blanks[1]!.points = 1
    expect(questionPoints(q)).toBe(6)
  })

  it("counts an unpriced blank as nothing rather than as NaN", () => {
    const q = fillInBlank("a ___ ___", [["a"], ["b"]], { scoring: "per_option" })
    q.blanks[0]!.points = 4
    expect(questionPoints(q)).toBe(4)
  })

  it("keeps the flat rate while per-blank scoring is showing, and vice versa", () => {
    const q = fillInBlank("a ___ ___", [["a"], ["b"]], {
      scoring: "per_option",
      pointsPerCorrect: 9,
    })
    q.blanks[0]!.points = 1

    expect(questionPoints(q)).toBe(1)
    expect(questionPoints({ ...q, scoring: "uniform" })).toBe(18)
  })

  it("follows the blank count as blanks come and go", () => {
    const q = fillInBlank("a ___ ___", [["a"], ["b"]], { pointsPerCorrect: 3 })
    expect(questionPoints(q)).toBe(6)
    expect(questionPoints({ ...q, blanks: q.blanks.slice(0, 1) })).toBe(3)
  })
})

describe("questionPoints", () => {
  it("derives for many-answer questions and reads the field for every other kind", () => {
    expect(questionPoints(scored([true, true], { pointsPerCorrect: 2 }))).toBe(4)
    expect(questionPoints({ ...createQuestion("essay"), points: 9 })).toBe(9)
    expect(questionPoints({ ...createQuestion("single_choice"), points: 3 })).toBe(3)
  })

  it("ignores a stored total that its own answers no longer produce", () => {
    // What a quiz authored before per-answer scoring looks like once loaded.
    const legacy = { ...scored([true, false]), points: 25 }
    expect(legacy.points).toBe(25)
    expect(questionPoints(legacy)).toBe(1)
  })
})

describe("withDerivedPoints", () => {
  it("writes the derived total into the stored field", () => {
    expect(withDerivedPoints(scored([true, true], { pointsPerCorrect: 4 })).points).toBe(8)
  })

  it("returns the same object when nothing moved, so a clean draft stays clean", () => {
    const question = withDerivedPoints(scored([true], { pointsPerCorrect: 2 }))
    expect(withDerivedPoints(question)).toBe(question)
  })
})

describe("documents authored before per-answer scoring", () => {
  it("parse, defaulting to the flat rate they effectively had", () => {
    const legacy = scored([true, false])
    delete (legacy as Partial<MultipleChoiceQuestion>).scoring
    delete (legacy as Partial<MultipleChoiceQuestion>).pointsPerCorrect

    const parsed = quizDocSchema.parse(docWith(legacy as MultipleChoiceQuestion))
    const question = parsed.questions[0]!

    expect(question.kind).toBe("multiple_choice")
    if (question.kind !== "multiple_choice") throw new Error("wrong kind")
    expect(question.scoring).toBe("uniform")
    expect(question.pointsPerCorrect).toBe(1)
  })

  it("still reject an unknown key, so the schema stays strict", () => {
    const rogue = { ...scored([true, false]), bonusPoints: 3 }
    expect(() => quizDocSchema.parse(docWith(rogue as MultipleChoiceQuestion))).toThrow()
  })
})

describe("blank ordering on documents authored before it existed", () => {
  it("parses as positional, which is how they were written", () => {
    const legacy: Record<string, unknown> = { ...createQuestion("fill_in_blank") }
    delete legacy.blankOrder

    const parsed = quizDocSchema.parse({
      ...createQuizDoc("Quiz"),
      questions: [legacy],
    })
    const question = parsed.questions[0]!
    if (question.kind !== "fill_in_blank") throw new Error("wrong kind")

    expect(question.blankOrder).toBe("in_order")
  })
})

describe("projection", () => {
  it("sends the derived total to the exam, not the stored one", () => {
    const question = { ...multipleChoice("Pick two", [["a", true], ["b", true], ["c", false]]), points: 99, pointsPerCorrect: 2 }

    expect(questionToManifest(question).points).toBe(4)
  })

  it("carries no per-answer values into the manifest", () => {
    // Which option is worth what is the answer key in another form: an option
    // worth 6 while its neighbours are worth 0 names the correct one.
    const question = multipleChoice("Pick two", [["a", true], ["b", false]])
    question.scoring = "per_option"
    question.options[0] = { ...question.options[0]!, points: 6 }

    for (const choice of questionToManifest(question).choices) {
      expect(Object.keys(choice)).toEqual(["id", "label"])
    }
  })
})

describe("validation, for fill in the blank", () => {
  it("blocks publishing a blank with no value typed on it", () => {
    const q = fillInBlank("a ___ ___ ___", [["a"], ["b"], ["c"]], {
      scoring: "per_option",
    })
    q.blanks[1]!.points = 2

    const issues = validateQuestion(q).filter((i) => i.code === "missing_blank_points")

    expect(issues.map((i) => i.field)).toEqual(["blanks.0.points", "blanks.2.points"])
    expect(issues.every((i) => i.severity === "error")).toBe(true)
    expect(issues[0]!.message).toContain("Blank 1")
  })

  it("accepts a zero that was actually typed", () => {
    const q = fillInBlank("a ___", [["a"]], { scoring: "per_option" })
    q.blanks[0]!.points = 0

    expect(validateQuestion(q).map((i) => i.code)).not.toContain("missing_blank_points")
  })

  it("asks nothing of the flat rate, which cannot be unfilled", () => {
    const q = fillInBlank("a ___ ___", [["a"], ["b"]], { pointsPerCorrect: 2 })
    expect(validateQuestion(q).map((i) => i.code)).not.toContain("missing_blank_points")
  })

  it("warns when every blank is worth nothing", () => {
    const q = fillInBlank("a ___", [["a"]], { pointsPerCorrect: 0 })

    const issues = validateQuestion(q)
    expect(issues.map((i) => i.code)).toContain("no_points_awarded")
    expect(issues.every((i) => i.severity !== "error")).toBe(true)
  })
})

describe("validation", () => {
  it("warns when every correct answer is worth nothing", () => {
    const question = {
      ...multipleChoice("Pick two", [["a", true], ["b", false]]),
      pointsPerCorrect: 0,
    }

    const issues = validateQuestion(question)
    expect(issues.map((i) => i.code)).toContain("no_points_awarded")
    // A deliberate zero is odd, not wrong: it must not block the publish.
    expect(issues.every((i) => i.severity !== "error")).toBe(true)
  })

  it("stays quiet once a value is set", () => {
    const question = {
      ...multipleChoice("Pick two", [["a", true], ["b", false]]),
      pointsPerCorrect: 2,
    }
    expect(validateQuestion(question).map((i) => i.code)).not.toContain("no_points_awarded")
  })

  it("blocks publishing a correct answer with no value typed on it", () => {
    const question = perOption("Pick two", [["a", true], ["b", true], ["c", false]])
    question.options[0]!.points = 3
    // The second is correct but left blank; the third is blank and incorrect.

    const issues = validateQuestion(question).filter(
      (i) => i.code === "missing_option_points"
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe("error")
    expect(issues[0]!.field).toBe("options.1.points")
    expect(issues[0]!.message).toContain("Option 2")
  })

  it("names every unfilled answer, not just the first", () => {
    const question = perOption("Pick three", [["a", true], ["b", true], ["c", true]])

    expect(
      validateQuestion(question)
        .filter((i) => i.code === "missing_option_points")
        .map((i) => i.field)
    ).toEqual(["options.0.points", "options.1.points", "options.2.points"])
  })

  it("accepts a zero that was actually typed", () => {
    const question = perOption("Pick one", [["a", true], ["b", false]])
    question.options[0]!.points = 0

    expect(validateQuestion(question).map((i) => i.code)).not.toContain(
      "missing_option_points"
    )
  })

  it("says it once: the blank answers, not also the zero total", () => {
    const question = perOption("Pick one", [["a", true], ["b", false]])

    const codes = validateQuestion(question).map((i) => i.code)
    expect(codes).toContain("missing_option_points")
    expect(codes).not.toContain("no_points_awarded")
  })

  it("asks nothing of the flat rate, which cannot be unfilled", () => {
    const question = {
      ...multipleChoice("Pick two", [["a", true], ["b", true]]),
      pointsPerCorrect: 2,
    }
    // Values left on the options are ignored while the flat rate is showing.
    expect(validateQuestion(question).map((i) => i.code)).not.toContain(
      "missing_option_points"
    )
  })
})
