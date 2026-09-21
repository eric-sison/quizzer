import { createQuestion, createQuizDoc, type QuizDoc } from "@workspace/quiz-core"
import { describe, expect, it } from "vitest"

import {
  HISTORY_LIMIT,
  historyReducer,
  initialHistoryState,
  type HistoryAction,
  type HistoryState,
} from "./history"

function docWith(count: number): QuizDoc {
  return {
    ...createQuizDoc("Midterm"),
    questions: Array.from({ length: count }, () => createQuestion("essay")),
  }
}

function run(state: HistoryState, ...actions: HistoryAction[]): HistoryState {
  return actions.reduce(historyReducer, state)
}

describe("historyReducer", () => {
  it("undo restores the exact previous doc object, and redo returns", () => {
    const start = initialHistoryState(docWith(1))
    const originalDoc = start.present.doc

    const edited = run(start, { type: "setTitle", title: "Final" })
    expect(edited.past).toHaveLength(1)

    const undone = run(edited, { type: "undo" })
    // Identity, not equality: autosave and the publish flag compare by object.
    expect(undone.present.doc).toBe(originalDoc)

    const redone = run(undone, { type: "redo" })
    expect(redone.present.doc).toBe(edited.present.doc)
  })

  it("returns the same state object for an inner no-op", () => {
    const start = initialHistoryState(docWith(1))
    const same = historyReducer(start, { type: "setTitle", title: "Midterm" })
    expect(same).toBe(start)
  })

  it("undo and redo at the ends are silent no-ops", () => {
    const start = initialHistoryState(docWith(1))
    expect(historyReducer(start, { type: "undo" })).toBe(start)
    expect(historyReducer(start, { type: "redo" })).toBe(start)
  })

  it("selection changes create no history entry", () => {
    const doc = docWith(3)
    const start = initialHistoryState(doc)
    const selected = run(start, { type: "selectQuestion", id: doc.questions[2]!.id })

    expect(selected.present.selectedId).toBe(doc.questions[2]!.id)
    expect(selected.past).toHaveLength(0)
    expect(historyReducer(selected, { type: "undo" })).toBe(selected)
  })

  it("undoing a delete restores the question AND the selection that rode it", () => {
    const doc = docWith(3)
    const target = doc.questions[1]!.id
    const start = run(initialHistoryState(doc), { type: "selectQuestion", id: target })

    const deleted = run(start, { type: "deleteQuestion", id: target })
    expect(deleted.present.doc.questions).toHaveLength(2)
    expect(deleted.present.selectedId).not.toBe(target)

    const undone = run(deleted, { type: "undo" })
    expect(undone.present.doc.questions).toHaveLength(3)
    expect(undone.present.selectedId).toBe(target)
  })

  it("a fresh edit clears the redo stack", () => {
    const start = initialHistoryState(docWith(1))
    const state = run(
      start,
      { type: "setTitle", title: "A" },
      { type: "undo" },
      { type: "insertQuestion", question: createQuestion("numeric") }
    )
    expect(state.future).toHaveLength(0)
  })

  it("replaceDoc clears both stacks - undo must not resurrect a superseded doc", () => {
    const start = initialHistoryState(docWith(1))
    const state = run(
      start,
      { type: "setTitle", title: "A" },
      { type: "setDescription", description: "B" },
      { type: "undo" },
      { type: "replaceDoc", doc: docWith(2) }
    )
    expect(state.past).toHaveLength(0)
    expect(state.future).toHaveLength(0)
    expect(historyReducer(state, { type: "undo" })).toBe(state)
  })

  it("coalesces a typing run into one undo step, broken by selection", () => {
    const doc = docWith(2)
    const start = initialHistoryState(doc)

    const typed = run(
      start,
      { type: "setTitle", title: "F" },
      { type: "setTitle", title: "Fi" },
      { type: "setTitle", title: "Fin" }
    )
    expect(typed.past).toHaveLength(1)
    expect(run(typed, { type: "undo" }).present.doc.title).toBe("Midterm")

    // Clicking elsewhere ends the run; the next keystroke starts a new step.
    const resumed = run(
      typed,
      { type: "selectQuestion", id: doc.questions[1]!.id },
      { type: "setTitle", title: "Final" }
    )
    expect(resumed.past).toHaveLength(2)
  })

  it("coalesces per question, not across questions", () => {
    const doc = docWith(2)
    const [first, second] = doc.questions
    const start = initialHistoryState(doc)

    const state = run(
      start,
      { type: "updateQuestion", question: { ...first!, points: 2 } },
      { type: "updateQuestion", question: { ...first!, points: 3 } },
      { type: "updateQuestion", question: { ...second!, points: 4 } }
    )
    expect(state.past).toHaveLength(2)
  })

  it("caps the stack and evicts the oldest entry", () => {
    let state = initialHistoryState(docWith(1))
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      // Alternating keys so no two consecutive edits coalesce.
      state = historyReducer(
        state,
        i % 2 === 0
          ? { type: "setTitle", title: `T${i}` }
          : { type: "setDescription", description: `D${i}` }
      )
    }
    expect(state.past).toHaveLength(HISTORY_LIMIT)
  })
})
