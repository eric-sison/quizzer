import { describe, expect, it } from "vitest"

import { cloneQuestion, cloneQuizDoc, collectMediaIds, mapRichDocMediaIds } from "../clone"
import type { Question, QuizDoc } from "../question"
import { richDocFromText, type RichDoc } from "../rich-text"
import { fullSampleQuiz, matching, singleChoice } from "./fixtures"

const MEDIA_A = "0198c5a4-2f6f-4b58-9f5a-1c2d3e4f5a01"
const MEDIA_B = "0198c5a4-2f6f-4b58-9f5a-1c2d3e4f5a02"

function docWithImage(text: string, mediaId: string): RichDoc {
  return {
    type: "doc",
    content: [
      ...richDocFromText(text).content,
      { type: "image", attrs: { mediaId, alt: "" } },
    ],
  }
}

/** Every id that grading or answering keys off, per question. */
function nestedIds(q: Question): string[] {
  switch (q.kind) {
    case "single_choice":
    case "multiple_choice":
      return q.options.map((o) => o.id)
    case "fill_in_blank":
      return q.blanks.map((b) => b.id)
    case "matching":
      return [
        ...q.pairs.flatMap((p) => [p.leftId, p.rightId]),
        ...q.distractors.map((d) => d.id),
      ]
    case "ordering":
      return q.items.map((i) => i.id)
    default:
      return []
  }
}

describe("cloneQuestion", () => {
  it("re-mints every id every kind keys off", () => {
    for (const source of fullSampleQuiz().questions) {
      const copy = cloneQuestion(source)

      expect(copy.id).not.toBe(source.id)
      expect(copy.kind).toBe(source.kind)

      const sourceIds = new Set([source.id, ...nestedIds(source)])
      for (const id of [copy.id, ...nestedIds(copy)]) {
        expect(sourceIds.has(id)).toBe(false)
      }
      // Same number of nested ids: nothing dropped, nothing invented.
      expect(nestedIds(copy)).toHaveLength(nestedIds(source).length)
    }
  })

  it("keeps the content", () => {
    const source = matching("Match these.", [["L", "R"]], ["D"])
    const copy = cloneQuestion(source)
    if (copy.kind !== "matching") throw new Error("kind changed")

    expect(copy.pairs[0]).toMatchObject({ leftText: "L", rightText: "R" })
    expect(copy.distractors[0]!.text).toBe("D")
    expect(copy.promptDoc).toEqual(source.promptDoc)
  })
})

describe("media id mapping", () => {
  it("collects ids from prompts, labels, rubrics and explanations", () => {
    const question = singleChoice("Pick.", [["a", true], ["b", false]])
    question.promptDoc = docWithImage("Pick.", MEDIA_A)
    question.options[0]!.labelDoc = docWithImage("a", MEDIA_B)
    question.explanationDoc = docWithImage("why", MEDIA_A)

    const doc: QuizDoc = { ...fullSampleQuiz(), questions: [question] }
    expect(collectMediaIds(doc).sort()).toEqual([MEDIA_A, MEDIA_B])
  })

  it("rewrites mapped ids and leaves unmapped ones untouched", () => {
    const rewritten = mapRichDocMediaIds(docWithImage("x", MEDIA_A), (id) =>
      id === MEDIA_A ? "new-id" : id
    )
    const image = rewritten.content.find((b) => b.type === "image")
    expect(image).toMatchObject({ attrs: { mediaId: "new-id" } })

    const untouched = mapRichDocMediaIds(docWithImage("x", MEDIA_B), (id) => id)
    expect(untouched.content.find((b) => b.type === "image")).toMatchObject({
      attrs: { mediaId: MEDIA_B },
    })
  })

  it("cloneQuizDoc re-points every referenced image through the map", () => {
    const question = singleChoice("Pick.", [["a", true], ["b", false]])
    question.promptDoc = docWithImage("Pick.", MEDIA_A)
    question.options[1]!.labelDoc = docWithImage("b", MEDIA_B)

    const doc: QuizDoc = { ...fullSampleQuiz(), questions: [question] }
    const copy = cloneQuizDoc(doc, { [MEDIA_A]: "copy-a" })

    const serialised = JSON.stringify(copy)
    expect(serialised).toContain("copy-a")
    expect(serialised).not.toContain(MEDIA_A)
    // Unmapped id stays as-is - it was already dangling or handled elsewhere.
    expect(serialised).toContain(MEDIA_B)
  })
})
