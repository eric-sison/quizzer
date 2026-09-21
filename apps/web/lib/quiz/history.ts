/**
 * Undo/redo over the editor reducer.
 *
 * A pure wrapper: `editorReducer` and its guarantees are untouched, and the
 * stacks store the exact `EditorState` objects it produced. That is what keeps
 * the two identity contracts intact - autosave watches `doc` by identity, and
 * the "Publish changes" flag compares against the published doc by identity -
 * so undoing back to a saved or published state restores the very object those
 * comparisons hold.
 */
import { editorReducer, type EditorAction, type EditorState } from "./reducer"
import type { QuizDoc } from "@workspace/quiz-core"

export type HistoryAction = EditorAction | { type: "undo" } | { type: "redo" }

export type HistoryState = {
  /** Oldest first. */
  past: EditorState[]
  present: EditorState
  /** Nearest redo first. */
  future: EditorState[]
  /**
   * Coalescing marker: a run of keystrokes into the same field collapses into
   * one undo step, so the 100-entry cap covers a session of editing rather
   * than a sentence of typing. Pure - no clocks - so React may replay actions.
   */
  lastEditKey: string | null
}

export const HISTORY_LIMIT = 100

export function initialHistoryState(doc: QuizDoc): HistoryState {
  return {
    past: [],
    present: { doc, selectedId: doc.questions[0]?.id ?? null },
    future: [],
    lastEditKey: null,
  }
}

/** Which continuous-edit run an action belongs to, or null for discrete acts. */
function editKeyOf(action: EditorAction): string | null {
  switch (action.type) {
    case "setTitle":
      return "setTitle"
    case "setDescription":
      return "setDescription"
    case "updateQuestion":
      return `updateQuestion:${action.question.id}`
    default:
      return null
  }
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if (action.type === "undo") {
    const previous = state.past.at(-1)
    if (!previous) return state
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future],
      lastEditKey: null,
    }
  }

  if (action.type === "redo") {
    const [next, ...rest] = state.future
    if (!next) return state
    return {
      past: [...state.past, state.present],
      present: next,
      future: rest,
      lastEditKey: null,
    }
  }

  const next = editorReducer(state.present, action)

  // The inner reducer said nothing changed; say the same, object and all, so
  // autosave's identity watch stays quiet.
  if (next === state.present) return state

  // Adopting server state (conflict resolution, reload) resets history: undo
  // must not resurrect a document the server has already superseded.
  if (action.type === "replaceDoc") {
    return { past: [], present: next, future: [], lastEditKey: null }
  }

  // Selection-only change: not an edit, nothing to undo. It does break a
  // typing run - returning to a field after clicking away starts a new step.
  if (next.doc === state.present.doc) {
    return { ...state, present: next, lastEditKey: null }
  }

  const key = editKeyOf(action)

  // A continuing run replaces the present without pushing: the snapshot under
  // it is the state from before the run began.
  if (key !== null && key === state.lastEditKey) {
    return { ...state, present: next, future: [], lastEditKey: key }
  }

  const past = [...state.past, state.present]
  if (past.length > HISTORY_LIMIT) past.shift()

  return { past, present: next, future: [], lastEditKey: key }
}
