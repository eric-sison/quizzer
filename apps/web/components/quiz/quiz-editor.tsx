"use client"

import * as React from "react"
import {
  validateQuiz,
  type QuestionKind,
  type QuizDetail,
  type QuizDoc,
} from "@workspace/quiz-core"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { ListChecks } from "lucide-react"

import { QuestionEditor } from "@/components/quiz/question-editor"
import { QuestionRail } from "@/components/quiz/question-rail"
import { QuizEditorHeader } from "@/components/quiz/quiz-editor-header"
import { isTypingTarget } from "@/lib/is-typing-target"
import { cloneQuestion } from "@/lib/quiz/clone"
import { historyReducer, initialHistoryState } from "@/lib/quiz/history"
import { typeDef } from "@/lib/quiz/types/registry"
import { useAutosave, type SaveResult } from "@/lib/quiz/use-autosave"
import { saveDraftAction } from "@/lib/quiz-actions"

/**
 * The authoring surface.
 *
 * Everything below it is presentational: the rail, the question editor and the
 * type editors all take values and call back. State, persistence and ordering
 * live here, which is why adding a question type touches none of them.
 */
export function QuizEditor({ quiz }: { quiz: QuizDetail }) {
  const [history, dispatch] = React.useReducer(
    historyReducer,
    quiz.doc,
    initialHistoryState
  )
  const state = history.present

  // Global undo/redo, standing down wherever something owns its own keystrokes
  // (inputs have native undo; Tiptap ships its own history for prompt text).
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || isTypingTarget(event.target)) return
      const key = event.key.toLowerCase()
      if (key === "z") {
        event.preventDefault()
        dispatch({ type: event.shiftKey ? "redo" : "undo" })
      } else if (key === "y" && event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        dispatch({ type: "redo" })
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const save = React.useCallback(
    (doc: QuizDoc, docVersion: number): Promise<SaveResult> =>
      // A Server Action rather than a fetch from the browser: the service
      // credential for apps/api stays on the server, and the acting teacher is
      // read there instead of being taken from the request body.
      saveDraftAction(quiz.id, doc, docVersion),
    [quiz.id]
  )

  const { status, retryNow } = useAutosave({
    doc: state.doc,
    docVersion: quiz.docVersion,
    save,
  })

  const issues = React.useMemo(() => validateQuiz(state.doc), [state.doc])
  const index = state.doc.questions.findIndex((q) => q.id === state.selectedId)
  const selected = index >= 0 ? state.doc.questions[index] : undefined

  // The server's hasUnpublishedChanges is a snapshot from page load; the
  // reducer knows about every keystroke since. Comparing by identity works
  // because the reducer returns the same doc object for a no-op change, and
  // publishing moves the baseline to whatever document was submitted. Gated on
  // status like the server's own derivation: a draft's edits are not
  // "unpublished changes", they are just the draft.
  const [publishedDoc, setPublishedDoc] = React.useState(quiz.doc)
  const hasUnpublishedChanges =
    quiz.status === "published" &&
    (quiz.hasUnpublishedChanges || state.doc !== publishedDoc)

  function addQuestion(kind: QuestionKind) {
    dispatch({ type: "insertQuestion", question: typeDef(kind).createDefault() })
  }

  function duplicateQuestion() {
    if (!selected) return
    dispatch({
      type: "insertQuestion",
      question: cloneQuestion(selected),
      afterId: selected.id,
    })
  }

  return (
    <div className="flex h-svh flex-col">
      <QuizEditorHeader
        quizId={quiz.id}
        doc={state.doc}
        status={quiz.status}
        url={quiz.url}
        hasUnpublishedChanges={hasUnpublishedChanges}
        saveStatus={status}
        onTitleChange={(title) => dispatch({ type: "setTitle", title })}
        onDescriptionChange={(description) => dispatch({ type: "setDescription", description })}
        onSettingsChange={(settings) => dispatch({ type: "updateSettings", settings })}
        onRetry={retryNow}
        onReload={() => window.location.reload()}
        onSelectQuestion={(id) => dispatch({ type: "selectQuestion", id })}
        onPublished={setPublishedDoc}
        selectedId={state.selectedId}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onUndo={() => dispatch({ type: "undo" })}
        onRedo={() => dispatch({ type: "redo" })}
      />

      <div className="flex min-h-0 flex-1">
        <QuestionRail
          questions={state.doc.questions}
          selectedId={state.selectedId}
          issues={issues}
          onSelect={(id) => dispatch({ type: "selectQuestion", id })}
          onAdd={addQuestion}
          onReorder={(id, toIndex) => dispatch({ type: "moveQuestion", id, toIndex })}
        />

        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          {selected ? (
            <QuestionEditor
              key={selected.id}
              quizId={quiz.id}
              question={selected}
              index={index}
              total={state.doc.questions.length}
              onChange={(question) => dispatch({ type: "updateQuestion", question })}
              onDuplicate={duplicateQuestion}
              onMove={(delta) =>
                dispatch({
                  type: "moveQuestion",
                  id: selected.id,
                  toIndex: index + delta,
                })
              }
              onDelete={() => dispatch({ type: "deleteQuestion", id: selected.id })}
            />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ListChecks />
                </EmptyMedia>
                <EmptyTitle>No questions yet</EmptyTitle>
                <EmptyDescription>
                  Add one from the panel on the left. You can change a question&apos;s
                  type later without losing its text.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </main>
      </div>
    </div>
  )
}
