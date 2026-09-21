"use client"

import * as React from "react"
import Link from "next/link"
import { QuestionView, seededShuffle } from "@workspace/quiz-ui"
import {
  type AnswerValue,
  type ExamManifest,
  type QuizStatus,
} from "@workspace/quiz-core"
import { ChevronLeft, ChevronRight, Eye } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { FileQuestion } from "lucide-react"

import { formatDuration } from "@/lib/format"

/**
 * The student's shell around the shared `QuestionView`.
 *
 * One question per page, because that is the only mode the exam client has.
 * The answers live in local state and go nowhere: this is a rehearsal, and a
 * preview that recorded attempts would be a way to pollute real results.
 *
 * What is deliberately *not* faithful: there is no countdown, and Submit does
 * nothing. A timer here would either be a lie or would run a teacher out of
 * time while they read their own questions.
 */
export function PreviewShell({
  quizId,
  manifest,
  hasUnpublishedChanges,
  status,
  initialQuestionId = null,
}: {
  quizId: string
  manifest: ExamManifest
  hasUnpublishedChanges: boolean
  status: QuizStatus
  /** Start on this question - the editor's "preview from here" deep link. */
  initialQuestionId?: string | null
}) {
  // One random seed per preview load, like one seed per exam sitting: the
  // shuffled order is stable while previewing and fresh on the next visit.
  const [seed] = React.useState(() => Math.random().toString(36).slice(2))
  const questions = React.useMemo(
    () =>
      manifest.shuffle_questions
        ? seededShuffle(manifest.questions, seed)
        : manifest.questions,
    [manifest, seed]
  )

  const [at, setAt] = React.useState(() => {
    // By id, not index: the display order above may be shuffled.
    const index = questions.findIndex((q) => q.id === initialQuestionId)
    return index >= 0 ? index : 0
  })
  const [answers, setAnswers] = React.useState<Record<string, AnswerValue>>({})

  const total = questions.length
  const question = questions[at]
  const last = at === total - 1

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={
            <Link href={`/quizzes/${quizId}/edit`} aria-label="Back to the editor" />
          }
        >
          <ChevronLeft />
        </Button>

        <span className="flex items-center gap-2 text-sm font-medium">
          <Eye className="size-4 text-muted-foreground" />
          Preview
        </span>

        <Badge variant="muted">
          {status === "published" && hasUnpublishedChanges
            ? "Your unpublished draft"
            : status === "published"
              ? "Matches what is live"
              : "Draft"}
        </Badge>

        <div className="flex-1" />

        <span className="text-xs text-muted-foreground">
          {formatDuration(manifest.duration_s)} ·{" "}
          {manifest.allow_backtracking
            ? "Students can go back"
            : "Students cannot go back"}
        </span>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-10">
          {question ? (
            <QuestionView
              key={question.id}
              question={question}
              index={at}
              total={total}
              answer={{
                value: answers[question.id],
                onChange: (value) =>
                  setAnswers((current) => ({ ...current, [question.id]: value })),
              }}
              // Same-origin proxy to apps/api; the desktop resolves the same
              // ids to data URIs its Rust process fetched.
              resolveImageSrc={(imageId) => `/api/media/${imageId}`}
              shuffleSeed={seed}
            />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileQuestion />
                </EmptyMedia>
                <EmptyTitle>Nothing to preview</EmptyTitle>
                <EmptyDescription>
                  Add a question in the editor and it will show up here exactly
                  as a student will see it.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </main>

      {total > 0 ? (
        <footer className="flex h-16 shrink-0 items-center gap-3 border-t px-6">
          <div className="mx-auto flex w-full max-w-2xl items-center gap-3">
            <Button
              variant="outline"
              disabled={at === 0 || !manifest.allow_backtracking}
              onClick={() => setAt((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft />
              Previous
            </Button>

            <span className="text-xs text-muted-foreground">
              {at + 1} of {total}
              {manifest.allow_backtracking ? "" : ", no going back"}
            </span>

            <div className="flex-1" />

            {last ? (
              // Inert on purpose. A preview must not be able to file a result.
              <Button disabled>Submit</Button>
            ) : (
              <Button onClick={() => setAt((i) => Math.min(total - 1, i + 1))}>
                Next
                <ChevronRight />
              </Button>
            )}
          </div>
        </footer>
      ) : null}
    </div>
  )
}
