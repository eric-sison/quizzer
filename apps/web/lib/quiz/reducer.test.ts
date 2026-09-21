import { createQuestion, createQuizDoc, type Question, type QuizDoc } from "@workspace/quiz-core"
import { describe, expect, it } from "vitest"

import { cloneQuestion } from "./clone"
import { editorReducer, initialEditorState, type EditorState } from "./reducer"

function docWith(...kinds: Parameters<typeof createQuestion>[0][]): QuizDoc {
  const doc = createQuizDoc("Midterm")
  return { ...doc, questions: kinds.map((kind) => createQuestion(kind)) }
}

function stateOf(doc: QuizDoc): EditorState {
  return initialEditorState(doc)
}

describe("initialEditorState", () => {
  it("selects the first question", () => {
    const doc = docWith("true_false", "essay")
    expect(initialEditorState(doc).selectedId).toBe(doc.questions[0]!.id)
  })

  it("selects nothing in an empty quiz", () => {
    expect(initialEditorState(createQuizDoc("")).selectedId).toBeNull()
  })
})

/**
 * Autosave watches `state.doc` by identity, so these are not micro-optimisations:
 * a new object for a change that did not happen is a save request that did not
 * need to happen, and on a flaky connection it is a save that can fail.
 */
describe("a change that changes nothing keeps the same doc object", () => {
  it("selecting a question", () => {
    const doc = docWith("true_false", "essay")
    const state = stateOf(doc)
    const next = editorReducer(state, {
      type: "selectQuestion",
      id: doc.questions[1]!.id,
    })

    expect(next.selectedId).toBe(doc.questions[1]!.id)
    expect(next.doc).toBe(state.doc)
  })

  it("setting the title it already has", () => {
    const state = stateOf(createQuizDoc("Midterm"))
    expect(editorReducer(state, { type: "setTitle", title: "Midterm" })).toBe(state)
  })

  it("re-emitting the question it was handed", () => {
    const doc = docWith("essay")
    const state = stateOf(doc)
    const same = editorReducer(state, {
      type: "updateQuestion",
      question: doc.questions[0]!,
    })
    expect(same).toBe(state)
  })

  it("moving a question onto its own index", () => {
    const doc = docWith("true_false", "essay")
    const state = stateOf(doc)
    const same = editorReducer(state, {
      type: "moveQuestion",
      id: doc.questions[0]!.id,
      toIndex: 0,
    })
    expect(same).toBe(state)
  })

  it("selecting a question that is not in the quiz", () => {
    const state = stateOf(docWith("essay"))
    expect(editorReducer(state, { type: "selectQuestion", id: "gone" })).toBe(state)
  })
})

describe("insertQuestion", () => {
  it("appends and selects when no anchor is given", () => {
    const doc = docWith("true_false")
    const added = createQuestion("essay")
    const next = editorReducer(stateOf(doc), { type: "insertQuestion", question: added })

    expect(next.doc.questions.map((q) => q.id)).toEqual([doc.questions[0]!.id, added.id])
    expect(next.selectedId).toBe(added.id)
  })

  it("inserts directly after the anchor, not at the end", () => {
    const doc = docWith("true_false", "essay", "single_choice")
    const added = createQuestion("essay")
    const next = editorReducer(stateOf(doc), {
      type: "insertQuestion",
      question: added,
      afterId: doc.questions[0]!.id,
    })

    expect(next.doc.questions[1]!.id).toBe(added.id)
    expect(next.doc.questions).toHaveLength(4)
  })
})

describe("deleteQuestion", () => {
  it("lands on the question that took the deleted one's place", () => {
    const doc = docWith("true_false", "essay", "single_choice")
    const state = { doc, selectedId: doc.questions[1]!.id }
    const next = editorReducer(state, { type: "deleteQuestion", id: doc.questions[1]!.id })

    expect(next.selectedId).toBe(doc.questions[2]!.id)
  })

  it("falls back to the previous question when the last one goes", () => {
    const doc = docWith("true_false", "essay")
    const state = { doc, selectedId: doc.questions[1]!.id }
    const next = editorReducer(state, { type: "deleteQuestion", id: doc.questions[1]!.id })

    expect(next.selectedId).toBe(doc.questions[0]!.id)
  })

  it("selects nothing once the quiz is empty", () => {
    const doc = docWith("essay")
    const next = editorReducer(stateOf(doc), {
      type: "deleteQuestion",
      id: doc.questions[0]!.id,
    })
    expect(next.selectedId).toBeNull()
    expect(next.doc.questions).toEqual([])
  })

  it("leaves the selection alone when a different question is deleted", () => {
    const doc = docWith("true_false", "essay")
    const state = { doc, selectedId: doc.questions[0]!.id }
    const next = editorReducer(state, { type: "deleteQuestion", id: doc.questions[1]!.id })

    expect(next.selectedId).toBe(doc.questions[0]!.id)
  })
})

describe("moveQuestion", () => {
  it("moves down without disturbing the others", () => {
    const doc = docWith("true_false", "essay", "single_choice")
    const [a, b, c] = doc.questions as [Question, Question, Question]
    const next = editorReducer(stateOf(doc), {
      type: "moveQuestion",
      id: a.id,
      toIndex: 2,
    })

    expect(next.doc.questions.map((q) => q.id)).toEqual([b.id, c.id, a.id])
  })

  it("moves up", () => {
    const doc = docWith("true_false", "essay", "single_choice")
    const [a, b, c] = doc.questions as [Question, Question, Question]
    const next = editorReducer(stateOf(doc), {
      type: "moveQuestion",
      id: c.id,
      toIndex: 0,
    })

    expect(next.doc.questions.map((q) => q.id)).toEqual([c.id, a.id, b.id])
  })

  it("clamps an index past the end rather than dropping the question", () => {
    const doc = docWith("true_false", "essay")
    const [a, b] = doc.questions as [Question, Question]
    const next = editorReducer(stateOf(doc), {
      type: "moveQuestion",
      id: a.id,
      toIndex: 99,
    })

    expect(next.doc.questions.map((q) => q.id)).toEqual([b.id, a.id])
  })

  it("keeps the selected question selected as it moves", () => {
    const doc = docWith("true_false", "essay", "single_choice")
    const state = { doc, selectedId: doc.questions[0]!.id }
    const next = editorReducer(state, {
      type: "moveQuestion",
      id: doc.questions[0]!.id,
      toIndex: 2,
    })

    expect(next.selectedId).toBe(doc.questions[0]!.id)
  })
})

describe("replaceDoc", () => {
  it("keeps the teacher on the same question when it survives", () => {
    const doc = docWith("true_false", "essay")
    const state = { doc, selectedId: doc.questions[1]!.id }
    const next = editorReducer(state, {
      type: "replaceDoc",
      doc: { ...doc, title: "From the server" },
    })

    expect(next.selectedId).toBe(doc.questions[1]!.id)
    expect(next.doc.title).toBe("From the server")
  })

  it("falls back to the first question when it does not", () => {
    const doc = docWith("true_false", "essay")
    const replacement = docWith("single_choice")
    const state = { doc, selectedId: doc.questions[1]!.id }

    expect(
      editorReducer(state, { type: "replaceDoc", doc: replacement }).selectedId
    ).toBe(replacement.questions[0]!.id)
  })
})

describe("cloneQuestion", () => {
  it("gives the copy a new id and new option ids", () => {
    const source = createQuestion("multiple_choice")
    const copy = cloneQuestion(source)

    expect(copy.id).not.toBe(source.id)
    expect(copy.kind).toBe("multiple_choice")

    // Two questions sharing an option id would make the answer key ambiguous.
    const sourceIds = "options" in source ? source.options.map((o) => o.id) : []
    const copyIds = "options" in copy ? copy.options.map((o) => o.id) : []
    expect(copyIds).toHaveLength(sourceIds.length)
    expect(copyIds.some((id) => sourceIds.includes(id))).toBe(false)
  })

  it("carries the prompt and scoring across", () => {
    const source = { ...createQuestion("essay"), points: 7, required: false }
    const copy = cloneQuestion(source)

    expect(copy.points).toBe(7)
    expect(copy.required).toBe(false)
    expect(copy.promptDoc).toEqual(source.promptDoc)
  })
})
