import { describe, expect, it } from "vitest"

import { answerAsRichDoc } from "../manifest"
import { AnswerLeakError, assertNoAnswerLeak, extractKey, project } from "../project"
import { emptyRichDoc, richDocSchema } from "../rich-text"
import { FALSE_ID, TRUE_ID } from "../types/true-false"
import {
  fillInBlank,
  fullSampleQuiz,
  matching,
  multipleChoice,
  numeric,
  ordering,
  sampleQuiz,
  singleChoice,
} from "./fixtures"

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
      "shuffle_questions",
      "title",
    ])
  })

  it("ships a prompt's image node, carrying only the opaque media id", () => {
    const doc = sampleQuiz()
    const first = doc.questions[0]!
    doc.questions[0] = {
      ...first,
      promptDoc: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "What is this?" }] },
          {
            type: "image",
            attrs: {
              mediaId: "0198c5a4-2f6f-4b58-9f5a-1c2d3e4f5a6b",
              alt: "A mitochondrion, labelled",
            },
          },
        ],
      },
    }

    const manifest = project("quiz-1", doc)
    const prompt = manifest.questions[0]!.prompt_doc
    expect(prompt).toBeDefined()
    expect(prompt!.content[1]).toEqual({
      type: "image",
      attrs: {
        mediaId: "0198c5a4-2f6f-4b58-9f5a-1c2d3e4f5a6b",
        alt: "A mitochondrion, labelled",
      },
    })
    // The plain-text fallback carries the words, not the picture.
    expect(manifest.questions[0]!.prompt).toBe("What is this?")
  })

  it("rejects an image node that smuggles a URL instead of a media id", () => {
    const parsed = richDocSchema.safeParse({
      type: "doc",
      content: [
        { type: "image", attrs: { src: "https://evil.example/x.png", alt: "" } },
      ],
    })
    expect(parsed.success).toBe(false)
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

describe("the new kinds project without their answers", () => {
  it("a fully-populated eight-kind quiz leaks nothing, explanations included", () => {
    const manifest = project("quiz-1", fullSampleQuiz())
    const serialised = JSON.stringify(manifest)

    for (const forbidden of [
      "correct",
      "tolerance",
      "accepted",
      "pairs",
      "distractor",
      "blanks",
      "rubric",
      "explanation",
      "caseSensitive",
      "case_sensitive",
    ]) {
      expect(serialised).not.toContain(forbidden)
    }
  })

  it("projects twice to byte-identical output", () => {
    const doc = fullSampleQuiz()
    expect(JSON.stringify(project("quiz-1", doc))).toBe(
      JSON.stringify(project("quiz-1", doc))
    )
  })

  it("numeric ships the unit and only the unit", () => {
    const q = numeric("Boiling point?", { correctValue: 100, tolerance: 1, unit: "°C" })
    const projected = project("quiz-1", { ...sampleQuiz(), questions: [q] }).questions[0]!

    expect(projected.unit).toBe("°C")
    expect(Object.keys(projected).sort()).toEqual([
      "choices",
      "id",
      "kind",
      "points",
      "prompt",
      "required",
      "shuffle_options",
      "unit",
    ])
  })

  it("numeric omits a blank unit", () => {
    const q = numeric("q", { unit: "  " })
    const projected = project("quiz-1", { ...sampleQuiz(), questions: [q] }).questions[0]!
    expect(projected).not.toHaveProperty("unit")
  })

  it("fill-in-the-blank ships only the count of blanks", () => {
    const q = fillInBlank("q ___ ___ ___", [["a"], ["b"], ["c"]])
    const projected = project("quiz-1", { ...sampleQuiz(), questions: [q] }).questions[0]!
    expect(projected.blank_count).toBe(3)
  })

  it("keeps the ordering rule off the wire, in both settings", () => {
    for (const blankOrder of ["in_order", "any_order"] as const) {
      const q = fillInBlank("q ___ ___", [["a"], ["b"]], { blankOrder })
      const projected = project("quiz-1", { ...sampleQuiz(), questions: [q] })
        .questions[0]!

      // Grading policy, not presentation: the client submits positionally
      // either way, so the manifest has no reason to carry it.
      expect(projected).not.toHaveProperty("blankOrder")
      expect(projected).not.toHaveProperty("blank_order")
    }
  })

  it("carries the ordering rule into the answer key", () => {
    const q = fillInBlank("q ___ ___", [["a"], ["b"]], { blankOrder: "any_order" })
    const key = extractKey({ ...sampleQuiz(), questions: [q] })

    expect(key.keys[q.id]).toEqual({
      kind: "fill_in_blank",
      acceptedAnswers: [["a"], ["b"]],
      caseSensitive: false,
      blankOrder: "any_order",
    })
  })

  it("matching presents right items in id order, distractors indistinguishable", () => {
    const q = matching(
      "q",
      [["L1", "R1"], ["L2", "R2"], ["L3", "R3"]],
      ["D1"]
    )
    const projected = project("quiz-1", { ...sampleQuiz(), questions: [q] }).questions[0]!

    // Left items keep authored order.
    expect(projected.left_items!.map((c) => c.id)).toEqual(q.pairs.map((p) => p.leftId))
    expect(projected.left_items!.map((c) => c.label)).toEqual(["L1", "L2", "L3"])

    // Right items are pairs + distractors sorted by id, not authored order.
    const expectedIds = [...q.pairs.map((p) => p.rightId), q.distractors[0]!.id].sort()
    expect(projected.right_items!.map((c) => c.id)).toEqual(expectedIds)

    // Nothing marks the distractor, and every right item looks the same shape.
    for (const item of projected.right_items!) {
      expect(Object.keys(item).sort()).toEqual(["id", "label"])
    }
  })

  it("ordering presents choices in id order, never the authored (correct) order", () => {
    const q = ordering("q", ["First", "Second", "Third", "Fourth"])
    const projected = project("quiz-1", { ...sampleQuiz(), questions: [q] }).questions[0]!

    const authored = q.items.map((i) => i.id)
    expect(projected.choices.map((c) => c.id)).toEqual([...authored].sort())
    // The labels are all present; the key is the only place the order lives.
    expect(projected.choices.map((c) => c.label).sort()).toEqual(
      ["First", "Fourth", "Second", "Third"]
    )
  })

  it("extracts the four new key shapes", () => {
    const doc = fullSampleQuiz()
    const key = extractKey(doc)
    const byKind = Object.fromEntries(
      doc.questions.map((q) => [q.kind, key.keys[q.id]])
    )

    expect(byKind.numeric).toEqual({ kind: "numeric", correctValue: 100, tolerance: 0.5 })
    expect(byKind.fill_in_blank).toEqual({
      kind: "fill_in_blank",
      acceptedAnswers: [["hydrogen", "H"], ["oxygen", "O"]],
      caseSensitive: false,
      blankOrder: "in_order",
    })
    const matchingDoc = doc.questions.find((q) => q.kind === "matching")!
    if (matchingDoc.kind !== "matching") throw new Error("unreachable")
    expect(byKind.matching).toEqual({
      kind: "matching",
      correctPairs: Object.fromEntries(
        matchingDoc.pairs.map((p) => [p.leftId, p.rightId])
      ),
    })
    const orderingDoc = doc.questions.find((q) => q.kind === "ordering")!
    if (orderingDoc.kind !== "ordering") throw new Error("unreachable")
    expect(byKind.ordering).toEqual({
      kind: "ordering",
      correctOrder: orderingDoc.items.map((i) => i.id),
    })
  })

  it("projects the quiz description when set, omits it when blank", () => {
    const withDescription = { ...sampleQuiz(), description: "  Bring a calculator.  " }
    expect(project("quiz-1", withDescription).description).toBe("Bring a calculator.")

    const blank = { ...sampleQuiz(), description: "   " }
    expect(project("quiz-1", blank)).not.toHaveProperty("description")
    expect(project("quiz-1", sampleQuiz())).not.toHaveProperty("description")
  })

  it("projects per-question shuffle_options from the choice kinds only", () => {
    const doc = fullSampleQuiz()
    const single = doc.questions.find((q) => q.kind === "single_choice")!
    if (single.kind !== "single_choice") throw new Error("unreachable")
    single.shuffleOptions = true

    const manifest = project("quiz-1", doc)
    const byKind = Object.fromEntries(manifest.questions.map((q) => [q.kind, q]))
    expect(byKind.single_choice!.shuffle_options).toBe(true)
    expect(byKind.multiple_choice!.shuffle_options).toBe(false)
    expect(byKind.true_false!.shuffle_options).toBe(false)
    expect(byKind.ordering!.shuffle_options).toBe(false)
  })
})

describe("answerAsRichDoc with a matching record", () => {
  it("degrades a stale matching answer to an empty document", () => {
    expect(answerAsRichDoc({ "left-1": "right-2" })).toEqual(emptyRichDoc())
  })
})
