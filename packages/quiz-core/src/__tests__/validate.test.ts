import { describe, expect, it } from "vitest"

import { hasErrors } from "../issue"
import { createQuizDoc } from "../question"
import { canPublish, validateQuiz } from "../validate"
import {
  essay,
  fillInBlank,
  fullSampleQuiz,
  matching,
  multipleChoice,
  numeric,
  ordering,
  sampleQuiz,
  singleChoice,
  trueFalse,
} from "./fixtures"

function codesFor(doc: Parameters<typeof validateQuiz>[0]) {
  return validateQuiz(doc).map((i) => i.code)
}

describe("validateQuiz", () => {
  it("passes a well-formed quiz", () => {
    const issues = validateQuiz(sampleQuiz())
    expect(issues).toEqual([])
    expect(canPublish(sampleQuiz())).toBe(true)
  })

  it("requires a title and at least one question", () => {
    expect(codesFor(createQuizDoc())).toEqual(
      expect.arrayContaining(["empty_title", "no_questions"])
    )
  })

  it("flags an empty prompt", () => {
    const doc = { ...sampleQuiz(), questions: [trueFalse("", true)] }
    expect(codesFor(doc)).toContain("empty_prompt")
  })

  it("flags negative points, which the schema alone cannot catch in-memory", () => {
    const doc = {
      ...sampleQuiz(),
      questions: [{ ...trueFalse("Sky is blue?", true), points: -1 }],
    }
    expect(codesFor(doc)).toContain("negative_points")
    expect(canPublish(doc)).toBe(false)
  })

  describe("single choice", () => {
    it("requires exactly one correct option", () => {
      const none = {
        ...sampleQuiz(),
        questions: [singleChoice("q", [["a", false], ["b", false]])],
      }
      expect(codesFor(none)).toContain("no_correct_option")

      const two = {
        ...sampleQuiz(),
        questions: [singleChoice("q", [["a", true], ["b", true]])],
      }
      expect(codesFor(two)).toContain("too_many_correct")
    })

    it("requires at least two options", () => {
      const doc = { ...sampleQuiz(), questions: [singleChoice("q", [["a", true]])] }
      expect(codesFor(doc)).toContain("too_few_options")
    })

    it("accepts image-only options, and never calls two of them duplicates", () => {
      const question = singleChoice("Which diagram shows mitosis?", [
        ["", true],
        ["", false],
      ])
      question.options = question.options.map((option, i) => ({
        ...option,
        labelDoc: {
          type: "doc" as const,
          content: [
            {
              type: "image" as const,
              attrs: { mediaId: `0198c5a4-2f6f-4b58-9f5a-1c2d3e4f5a6${i}`, alt: "" },
            },
          ],
        },
      }))

      const codes = codesFor({ ...sampleQuiz(), questions: [question] })
      expect(codes).not.toContain("empty_option")
      expect(codes).not.toContain("duplicate_option")
    })
  })

  describe("multiple choice", () => {
    it("requires at least one correct option", () => {
      const doc = {
        ...sampleQuiz(),
        questions: [multipleChoice("q", [["a", false], ["b", false]])],
      }
      expect(codesFor(doc)).toContain("no_correct_option")
    })

    it("warns but does not block when every option is correct", () => {
      const doc = {
        ...sampleQuiz(),
        questions: [multipleChoice("q", [["a", true], ["b", true]])],
      }
      const issues = validateQuiz(doc)

      expect(issues.map((i) => i.code)).toContain("all_options_correct")
      expect(hasErrors(issues)).toBe(false)
      expect(canPublish(doc)).toBe(true)
    })
  })

  describe("options", () => {
    it("rejects an empty label", () => {
      const doc = {
        ...sampleQuiz(),
        questions: [singleChoice("q", [["", true], ["b", false]])],
      }
      expect(codesFor(doc)).toContain("empty_option")
    })

    it("rejects duplicates, ignoring case and surrounding space", () => {
      const doc = {
        ...sampleQuiz(),
        questions: [singleChoice("q", [["Cell wall", true], [" cell WALL ", false]])],
      }
      expect(codesFor(doc)).toContain("duplicate_option")
    })
  })

  describe("essay", () => {
    it("rejects an inverted word range", () => {
      const doc = {
        ...sampleQuiz(),
        questions: [essay("q", { minWords: 300, maxWords: 80 })],
      }
      expect(codesFor(doc)).toContain("word_range_inverted")
    })

    it("allows either bound alone", () => {
      const doc = { ...sampleQuiz(), questions: [essay("q", { minWords: 50 })] }
      expect(validateQuiz(doc)).toEqual([])
    })
  })

  it("reports issues against the question that owns them", () => {
    const bad = singleChoice("q", [["a", false], ["b", false]])
    const doc = { ...sampleQuiz(), questions: [bad] }

    for (const issue of validateQuiz(doc)) {
      expect(issue.questionId).toBe(bad.id)
    }
  })

  it("passes a quiz exercising every kind", () => {
    expect(validateQuiz(fullSampleQuiz())).toEqual([])
    expect(canPublish(fullSampleQuiz())).toBe(true)
  })

  describe("numeric", () => {
    it("requires the correct value", () => {
      const question = numeric("q")
      delete question.correctValue
      const doc = { ...sampleQuiz(), questions: [question] }
      expect(codesFor(doc)).toContain("no_correct_value")
      expect(canPublish(doc)).toBe(false)
    })

    it("accepts an exact-match question (tolerance 0)", () => {
      const doc = { ...sampleQuiz(), questions: [numeric("q", { tolerance: 0 })] }
      expect(validateQuiz(doc)).toEqual([])
    })
  })

  describe("fill in the blank", () => {
    it("requires at least one blank", () => {
      const doc = { ...sampleQuiz(), questions: [fillInBlank("q", [])] }
      expect(codesFor(doc)).toContain("no_blanks")
    })

    it("requires each blank to accept at least one non-empty response", () => {
      const doc = {
        ...sampleQuiz(),
        questions: [fillInBlank("q", [["hydrogen"], ["  "]])],
      }
      const issues = validateQuiz(doc)
      expect(issues.map((i) => i.code)).toContain("empty_blank")
      expect(issues.find((i) => i.code === "empty_blank")?.field).toBe(
        "blanks.1.acceptedAnswers"
      )
    })
  })

  describe("matching", () => {
    it("requires at least two pairs", () => {
      const doc = { ...sampleQuiz(), questions: [matching("q", [["a", "b"]])] }
      expect(codesFor(doc)).toContain("too_few_pairs")
    })

    it("flags empty pair sides and empty distractors", () => {
      const doc = {
        ...sampleQuiz(),
        questions: [matching("q", [["a", ""], ["", "d"]], ["  "])],
      }
      const codes = codesFor(doc)
      expect(codes.filter((c) => c === "empty_pair_side")).toHaveLength(2)
      expect(codes).toContain("empty_distractor")
    })

    it("rejects a right column made ambiguous by duplicates, distractors included", () => {
      const doc = {
        ...sampleQuiz(),
        questions: [matching("q", [["a", "ATP"], ["b", "DNA"]], [" atp "])],
      }
      expect(codesFor(doc)).toContain("duplicate_right_item")
    })

    it("rejects duplicate left items", () => {
      const doc = {
        ...sampleQuiz(),
        questions: [matching("q", [["Cell", "x"], [" cell ", "y"]])],
      }
      expect(codesFor(doc)).toContain("duplicate_left_item")
    })
  })

  describe("ordering", () => {
    it("requires at least two items", () => {
      const doc = { ...sampleQuiz(), questions: [ordering("q", ["only one"])] }
      expect(codesFor(doc)).toContain("too_few_items")
    })

    it("flags empty and duplicate items", () => {
      const doc = {
        ...sampleQuiz(),
        questions: [ordering("q", ["First", "", "first "])],
      }
      const codes = codesFor(doc)
      expect(codes).toContain("empty_item")
      expect(codes).toContain("duplicate_item")
    })
  })
})
