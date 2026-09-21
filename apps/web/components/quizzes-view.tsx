"use client"

import * as React from "react"
import Link from "next/link"
import type { QuizSummary } from "@workspace/quiz-core"
import { ClipboardCheck, Search, TriangleAlert } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import { NewQuizButton } from "@/components/new-quiz-button"
import { QuizRowActions } from "@/components/quiz-row-actions"
import { formatDuration, relativeTime, shortenToken } from "@/lib/format"

type Filter = "all" | "draft" | "published"

export function QuizzesView({ quizzes }: { quizzes: QuizSummary[] }) {
  const [filter, setFilter] = React.useState<Filter>("all")
  const [query, setQuery] = React.useState("")

  const counts = React.useMemo(
    () => ({
      all: quizzes.length,
      draft: quizzes.filter((q) => q.status === "draft").length,
      published: quizzes.filter((q) => q.status === "published").length,
    }),
    [quizzes]
  )

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    return quizzes.filter((quiz) => {
      if (filter !== "all" && quiz.status !== filter) return false
      if (!needle) return true
      return quiz.title.toLowerCase().includes(needle)
    })
  }, [quizzes, filter, query])

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-xl font-semibold tracking-tight">Quizzes</h1>
          <p className="text-sm text-muted-foreground">
            Create a quiz, then publish it to get a link for the exam app.
          </p>
        </div>
        <NewQuizButton />
      </div>

      <div className="flex items-center gap-3">
        <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
          <TabsList>
            <TabsTrigger value="all">All {counts.all}</TabsTrigger>
            <TabsTrigger value="draft">Drafts {counts.draft}</TabsTrigger>
            <TabsTrigger value="published">Published {counts.published}</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex-1" />

        <div className="w-56">
          <label htmlFor="quiz-search" className="sr-only">
            Search quizzes
          </label>
          <InputGroup>
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              id="quiz-search"
              type="search"
              placeholder="Search quizzes"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </InputGroup>
        </div>
      </div>

      {quizzes.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardCheck />
            </EmptyMedia>
            <EmptyTitle>No quizzes yet</EmptyTitle>
            <EmptyDescription>
              Start one, add questions, then publish it to get a link students can
              open in the exam app.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <NewQuizButton label="Create your first quiz" />
          </EmptyContent>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            {/* Column widths belong to the table, not to each header cell. */}
            <colgroup>
              <col />
              <col width={96} />
              <col width={80} />
              <col width={128} />
              <col width={176} />
              <col width={48} />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>Quiz</TableHead>
                <TableHead>
                  <div className="text-right">Questions</div>
                </TableHead>
                <TableHead>
                  <div className="text-right">Length</div>
                </TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Link</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((quiz) => (
                <QuizRow key={quiz.id} quiz={quiz} />
              ))}
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <div className="flex h-24 items-center justify-center text-muted-foreground">
                      Nothing matches that filter.
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Links resolve to a quiz&apos;s active version. Republishing keeps the same
        link, and exams already in progress finish on the version they started.
      </p>
    </div>
  )
}

function QuizRow({ quiz }: { quiz: QuizSummary }) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <Link
            href={`/quizzes/${quiz.id}/edit`}
            className="font-medium text-foreground hover:underline"
          >
            {quiz.title || "Untitled quiz"}
          </Link>
          {quiz.hasUnpublishedChanges ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <TriangleAlert className="size-3" />
              Unpublished changes
            </span>
          ) : (
            <span
              className="text-xs text-muted-foreground"
              suppressHydrationWarning
            >
              Edited {relativeTime(quiz.updatedAt)}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="text-right font-mono text-xs">{quiz.questionCount}</div>
      </TableCell>
      <TableCell>
        <div className="text-right font-mono text-xs">
          {formatDuration(quiz.durationS)}
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge status={quiz.status} versionNo={quiz.versionNo} />
      </TableCell>
      <TableCell>
        {quiz.token ? (
          <code className="font-mono text-xs text-muted-foreground">
            /e/{shortenToken(quiz.token)}
          </code>
        ) : (
          <span className="text-xs text-muted-foreground/70">Not published</span>
        )}
      </TableCell>
      <TableCell>
        <QuizRowActions id={quiz.id} title={quiz.title} url={quiz.url} />
      </TableCell>
    </TableRow>
  )
}

function StatusBadge({
  status,
  versionNo,
}: {
  status: QuizSummary["status"]
  versionNo: number | null
}) {
  if (status === "published") {
    return (
      <Badge>Published{versionNo === null ? "" : ` v${versionNo}`}</Badge>
    )
  }
  if (status === "archived") {
    return <Badge variant="outline">Archived</Badge>
  }
  return <Badge variant="outline">Draft</Badge>
}
