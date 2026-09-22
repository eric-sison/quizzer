"use client"

import Link from "next/link"
import { ChevronLeft, Eye, Redo2, Undo2 } from "lucide-react"
import { questionPoints, type QuizDoc, type QuizSettings, type QuizStatus } from "@workspace/quiz-core"
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
  // Through `questionPoints`, not the stored field: multiple choice and fill
  // in the blank derive their totals, and a question authored before that did
  // would otherwise make this header disagree with the editor below it.
  const totalPoints = doc.questions.reduce((sum, q) => sum + questionPoints(q), 0)

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
        title="Back to quizzes"
        // Rendering an <a>, so Base UI must not assume native button semantics.
        nativeButton={false}
        render={<Link href="/quizzes" aria-label="Back to quizzes" />}
      >
        <ChevronLeft />
      </Button>

      {/* The field is as wide as the name in it, the way a document title is:
          a fixed box left a short name adrift in empty space. An invisible twin
          of the text sizes the one grid cell the input is stretched across, so
          the track runs from a placeholder-width floor up to the name's own
          width and stops at max-w-xs, where a longer name would start crowding
          out the rest of the header. `size={1}` keeps the input's own
          20-character intrinsic width out of that measurement, and the ghost
          variant trims what does not fit while the field is idle, handing the
          browser back its usual scrolling once it has focus, so the whole name
          stays readable and editable. */}
      <div className="grid max-w-xs grid-cols-[minmax(7rem,max-content)] items-center">
        <span
          aria-hidden
          className="invisible col-start-1 row-start-1 px-3 text-base font-medium whitespace-pre md:text-sm"
        >
          {title || "Untitled quiz"}
        </span>
        <div className="col-start-1 row-start-1">
          <Input
            variant="ghost"
            size={1}
            value={title}
            onChange={(event) => onTitleChange(event.currentTarget.value)}
            placeholder="Untitled quiz"
            aria-label="Quiz title"
          />
        </div>
      </div>

      {/* What the quiz IS - its state - kept together and beside the name it
          describes. It used to be split across the header, with the save
          indicator sitting between the undo buttons and Preview, which read as
          another control in the action row rather than as a readout. */}
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant="outline">{STATUS_LABEL[status]}</Badge>
        {hasUnpublishedChanges ? <Badge variant="secondary">Changes not published</Badge> : null}

        <span className="text-xs text-muted-foreground tabular-nums">
          {totalPoints} {totalPoints === 1 ? "pt" : "pts"}
        </span>

        <SaveIndicator status={saveStatus} onRetry={onRetry} onReload={onReload} />
      </div>

      <div className="flex-1" />

      {/* What you can DO, weakest first: the two that undo themselves, then a
          panel, then the two that leave the editor. The pair is tightened and
          fenced off so Undo does not sit in the same undifferentiated run as
          Publish. */}
      <div className="flex items-center gap-0.5">
        <Button variant="ghost" size="icon-sm" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={onUndo}>
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
      </div>

      {/* A plain rule rather than <Separator>: this is one-off header trim, and
          the shared component is not ours to restyle at a call site. */}
      <div aria-hidden className="mx-1 h-5 w-px bg-border" />

      <QuizSettingsSheet
        settings={doc.settings}
        description={doc.description ?? ""}
        onChange={onSettingsChange}
        onDescriptionChange={onDescriptionChange}
      />

      <Button variant="outline" nativeButton={false} render={<Link href={previewHref} />}>
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
