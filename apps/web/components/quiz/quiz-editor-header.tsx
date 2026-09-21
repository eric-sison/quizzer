"use client"

import Link from "next/link"
import { ChevronLeft, Eye, Redo2, Undo2 } from "lucide-react"
import type { QuizDoc, QuizSettings, QuizStatus } from "@workspace/quiz-core"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import { PublishDialog } from "@/components/quiz/publish-dialog"
import { QuizSettingsSheet } from "@/components/quiz/quiz-settings-sheet"
import { SaveIndicator } from "@/components/quiz/save-indicator"
import type { SaveStatus } from "@/lib/quiz/use-autosave"

const STATUS_LABEL: Record<QuizStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
}

/**
 * The title is edited here rather than in a settings panel because it is the
 * one quiz-level field a teacher changes while writing questions. It rides the
 * same autosave as everything else: there is no separate save button, so there
 * is no second way for the document to reach the server.
 */
export function QuizEditorHeader({
  quizId,
  doc,
  status,
  url,
  hasUnpublishedChanges,
  saveStatus,
  selectedId,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onTitleChange,
  onDescriptionChange,
  onSettingsChange,
  onRetry,
  onReload,
  onSelectQuestion,
  onPublished,
}: {
  quizId: string
  doc: QuizDoc
  status: QuizStatus
  url: string | null
  hasUnpublishedChanges: boolean
  saveStatus: SaveStatus
  /** For "preview from here": the question currently open in the editor. */
  selectedId: string | null
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onTitleChange: (title: string) => void
  onDescriptionChange: (description: string) => void
  onSettingsChange: (settings: QuizSettings) => void
  onRetry: () => void
  onReload: () => void
  onSelectQuestion: (id: string) => void
  /** The server accepted this document; the editor resets its dirty tracking. */
  onPublished: (doc: QuizDoc) => void
}) {
  const title = doc.title
  const totalPoints = doc.questions.reduce((sum, q) => sum + q.points, 0)

  // Id, not index: the preview may display questions in shuffled order, and an
  // id lands on the right question regardless.
  const previewHref = selectedId
    ? `/quizzes/${quizId}/preview?q=${encodeURIComponent(selectedId)}`
    : `/quizzes/${quizId}/preview`

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
      <Button
        variant="ghost"
        size="icon-sm"
        // Rendering an <a>, so Base UI must not assume native button semantics.
        nativeButton={false}
        render={<Link href="/quizzes" aria-label="Back to quizzes" />}
      >
        <ChevronLeft />
      </Button>

      <div className="max-w-xl min-w-0">
        <Input
          variant="ghost"
          value={title}
          onChange={(event) => onTitleChange(event.currentTarget.value)}
          placeholder="Untitled quiz"
          aria-label="Quiz title"
        />
      </div>

      <Badge variant="outline">{STATUS_LABEL[status]}</Badge>
      {hasUnpublishedChanges ? (
        <Badge variant="secondary">Changes not published</Badge>
      ) : null}

      <span className="text-xs text-muted-foreground tabular-nums">
        {totalPoints} {totalPoints === 1 ? "pt" : "pts"}
      </span>

      <div className="flex-1" />

      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Undo"
        title="Undo (⌘Z)"
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Undo2 />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Redo"
        title="Redo (⇧⌘Z)"
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Redo2 />
      </Button>

      <SaveIndicator
        status={saveStatus}
        onRetry={onRetry}
        onReload={onReload}
      />

      <QuizSettingsSheet
        settings={doc.settings}
        description={doc.description ?? ""}
        onChange={onSettingsChange}
        onDescriptionChange={onDescriptionChange}
      />

      <Button
        variant="outline"
        nativeButton={false}
        render={<Link href={previewHref} />}
      >
        <Eye />
        Preview
      </Button>

      <PublishDialog
        quizId={quizId}
        doc={doc}
        status={status}
        url={url}
        hasUnpublishedChanges={hasUnpublishedChanges}
        onSelectQuestion={onSelectQuestion}
        onPublished={onPublished}
      />
    </header>
  )
}
