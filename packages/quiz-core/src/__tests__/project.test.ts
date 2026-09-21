import { describe, expect, it } from "vitest"

import { AnswerLeakError, assertNoAnswerLeak, extractKey, project } from "../project"
import { FALSE_ID, TRUE_ID } from "../types/true-false"
import { multipleChoice, sampleQuiz, singleChoice } from "./fixtures"

describe("project", () => {
  it("emits no answer-bearing key anywhere in the manifest", () => {
    const manifest = project("quiz-1", sampleQuiz())
    const json = JSON.stringify(manifest)

    for (const forbidden of ["correct", "answer", "rubric"]) {
      expect(json).not.toContain(forbidden)
    }
  })

  it("keeps option ids but drops which of them is right", () => {
    const doc = sampleQuiz()
    const source = doc.questions[1]
    if (source?.kind !== "single_choice") throw new Error("bad fixture")

    const manifest = project("quiz-1", doc)
    const projected = manifest.questions[1]

    expect(projected?.choices.map((c) => c.id)).toEqual(source.options.map((o) => o.id))
    for (const choice of projected?.choices ?? []) {
      expect(Object.keys(choice)).not.toContain("correct")
    }
  })

  it("never projects the essay rubric", () => {
    const manifest = project("quiz-1", sampleQuiz())
    expect(JSON.stringify(manifest)).not.toContain("Award marks")
  })

  it("gives true/false a fixed pair of choices", () => {
    const manifest = project("quiz-1", sampleQuiz())
    expect(manifest.questions[0]?.choices).toEqual([
      { id: TRUE_ID, label: "True" },
      { id: FALSE_ID, label: "False" },
    ])
  })

  it("projects essay word limits to the wire format", () => {
    const manifest = project("quiz-1", sampleQuiz())
    expect(manifest.questions[3]).toMatchObject({ min_words: 80, max_words: 300 })
  })

  it("uses snake_case at the top level, matching the Rust contract", () => {
    const manifest = project("quiz-1", sampleQuiz())
    expect(Object.keys(manifest).sort()).toEqual([
      "allow_backtracking",
      "duration_s",
      "id",
      "questions",
      "title",
    ])
  })

  it("omits prompt_doc when plain text loses nothing", () => {
    const manifest = project("quiz-1", sampleQuiz())
    expect(manifest.questions[0]).not.toHaveProperty("prompt_doc")
  })
})

describe("assertNoAnswerLeak", () => {
  it("rejects a manifest carrying a correctness flag", () => {
    const manifest = project("quiz-1", sampleQuiz())
    const tampered = JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>
    const questions = tampered.questions as { choices: Record<string, unknown>[] }[]
    const choice = questions[1]?.choices[0]
    if (!choice) throw new Error("bad fixture")
    choice.correct = true

    expect(() => assertNoAnswerLeak(tampered)).toThrow(AnswerLeakError)
  })

  it("rejects an unknown top-level key", () => {
    const manifest = project("quiz-1", sampleQuiz())
    const tampered = { ...manifest, answer_key: { q1: true } }

    expect(() => assertNoAnswerLeak(tampered)).toThrow(AnswerLeakError)
  })
})

describe("extractKey", () => {
  it("records the right answer for each machine-gradable kind", () => {
    const doc = sampleQuiz()
    const key = extractKey(doc)
    const [tf, sc, mc, es] = doc.questions

    expect(key.keys[tf!.id]).toEqual({ kind: "true_false", correct: false })

    if (sc?.kind !== "single_choice") throw new Error("bad fixture")
    expect(key.keys[sc.id]).toEqual({
      kind: "single_choice",
      correctOptionId: sc.options[1]?.id,
    })

    if (mc?.kind !== "multiple_choice") throw new Error("bad fixture")
    expect(key.keys[mc.id]).toEqual({
      kind: "multiple_choice",
      correctOptionIds: [mc.options[0]?.id, mc.options[2]?.id],
    })

    // Essays are graded by a human, so there is no machine key.
    expect(key.keys[es!.id]).toBeNull()
  })

  it("reports no correct option rather than guessing one", () => {
    const doc = sampleQuiz()
    doc.questions = [singleChoice("Nothing marked", [["a", false], ["b", false]])]
    const key = extractKey(doc)

    expect(key.keys[doc.questions[0]!.id]).toEqual({
      kind: "single_choice",
      correctOptionId: null,
    })
  })

  it("keeps every correct id for a multi-answer question", () => {
    const q = multipleChoice("All of them", [["a", true], ["b", true], ["c", true]])
    const doc = { ...sampleQuiz(), questions: [q] }

    expect(extractKey(doc).keys[q.id]).toEqual({
      kind: "multiple_choice",
      correctOptionIds: q.options.map((o) => o.id),
    })
  })
})
