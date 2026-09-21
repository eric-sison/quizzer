import { describe, expect, it } from "vitest"

import { hasErrors } from "../issue"
import { createQuizDoc } from "../question"
import { canPublish, validateQuiz } from "../validate"
import { essay, multipleChoice, sampleQuiz, singleChoice, trueFalse } from "./fixtures"

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
})
