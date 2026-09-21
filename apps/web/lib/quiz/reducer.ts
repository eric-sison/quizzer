/**
 * The editor's single source of truth.
 *
 * One reducer holds both the document and which question is on screen, because
 * almost every structural edit moves the selection too: adding selects the new
 * question, deleting lands on a neighbour. Splitting them would mean two
 * setStates that can interleave and leave the pane pointing at a question that
 * is no longer there.
 *
 * Two properties this file must keep:
 *
 *  1. It is pure. Ids are minted by the caller and arrive inside the action, so
 *     a reducer replayed by React's strict mode produces the same state twice.
 *  2. It returns the *same* `doc` object when a change touches nothing. Autosave
 *     watches `state.doc` by identity, so selecting a question must not look
 *     like an edit, and neither must a no-op edit.
 */
import type { Question, QuizDoc } from "@workspace/quiz-core"

export type EditorState = {
  doc: QuizDoc
  selectedId: string | null
}

export type EditorAction =
  | { type: "selectQuestion"; id: string }
  | { type: "setTitle"; title: string }
  /** Appends, or inserts directly after `afterId`. Selects the new question. */
  | { type: "insertQuestion"; question: Question; afterId?: string }
  | { type: "updateQuestion"; question: Question }
  | { type: "deleteQuestion"; id: string }
  | { type: "moveQuestion"; id: string; toIndex: number }
  /** Adopt a document from the server, e.g. after a conflict is resolved. */
  | { type: "replaceDoc"; doc: QuizDoc }

export function initialEditorState(doc: QuizDoc): EditorState {
  return { doc, selectedId: doc.questions[0]?.id ?? null }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "selectQuestion": {
      if (action.id === state.selectedId) return state
      // Selecting something that is not there would blank the pane.
      if (!state.doc.questions.some((q) => q.id === action.id)) return state
      return { ...state, selectedId: action.id }
    }

    case "setTitle": {
      if (action.title === state.doc.title) return state
      return { ...state, doc: { ...state.doc, title: action.title } }
    }

    case "insertQuestion": {
      const at =
        action.afterId === undefined
          ? state.doc.questions.length
          : indexOf(state.doc, action.afterId) + 1

      const questions = [...state.doc.questions]
      questions.splice(at, 0, action.question)

      return {
        doc: { ...state.doc, questions },
        selectedId: action.question.id,
      }
    }

    case "updateQuestion": {
      const at = indexOf(state.doc, action.question.id)
      if (at < 0) return state
      // A component that re-emits the object it was handed is not an edit.
      if (state.doc.questions[at] === action.question) return state

      const questions = [...state.doc.questions]
      questions[at] = action.question
      return { ...state, doc: { ...state.doc, questions } }
    }

    case "deleteQuestion": {
      const at = indexOf(state.doc, action.id)
      if (at < 0) return state

      const questions = state.doc.questions.filter((q) => q.id !== action.id)
      const selectedId =
        state.selectedId === action.id
          ? // The one that slid into this slot, else the one before it.
            (questions[at]?.id ?? questions[at - 1]?.id ?? null)
          : state.selectedId

      return { doc: { ...state.doc, questions }, selectedId }
    }

    case "moveQuestion": {
      const from = indexOf(state.doc, action.id)
      if (from < 0) return state

      const to = clamp(action.toIndex, 0, state.doc.questions.length - 1)
      if (to === from) return state

      const questions = [...state.doc.questions]
      const [moved] = questions.splice(from, 1)
      if (!moved) return state
      questions.splice(to, 0, moved)

      return { ...state, doc: { ...state.doc, questions } }
    }

    case "replaceDoc": {
      // Keep the teacher where they were if that question still exists.
      const keep =
        state.selectedId !== null &&
        action.doc.questions.some((q) => q.id === state.selectedId)

      return {
        doc: action.doc,
        selectedId: keep ? state.selectedId : (action.doc.questions[0]?.id ?? null),
      }
    }
  }
}

function indexOf(doc: QuizDoc, id: string): number {
  return doc.questions.findIndex((q) => q.id === id)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
