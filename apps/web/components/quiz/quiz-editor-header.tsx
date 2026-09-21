"use client"

import Link from "next/link"
import { ChevronLeft, Eye } from "lucide-react"
import type { QuizDoc, QuizStatus } from "@workspace/quiz-core"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import { PublishDialog } from "@/components/quiz/publish-dialog"
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
  onTitleChange,
  onRetry,
  onReload,
  onSelectQuestion,
}: {
  quizId: string
  doc: QuizDoc
  status: QuizStatus
  url: string | null
  hasUnpublishedChanges: boolean
  saveStatus: SaveStatus
  onTitleChange: (title: string) => void
  onRetry: () => void
  onReload: () => void
  onSelectQuestion: (id: string) => void
}) {
  const title = doc.title
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

      {/* <Badge variant="outline">{STATUS_LABEL[status]}</Badge>
      {hasUnpublishedChanges ? (
        <Badge variant="secondary">Changes not published</Badge>
      ) : null} */}

      <div className="flex-1" />

      <SaveIndicator
        status={saveStatus}
        onRetry={onRetry}
        onReload={onReload}
      />

      <Button
        variant="outline"
        nativeButton={false}
        render={<Link href={`/quizzes/${quizId}/preview`} />}
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
      />
    </header>
  )
}
