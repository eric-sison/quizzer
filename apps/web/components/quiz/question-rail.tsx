"use client"

import * as React from "react"
import {
  toPlainText,
  type Issue,
  type Question,
  type QuestionKind,
} from "@workspace/quiz-core"
import { GripVertical, Plus, Search } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { cn } from "@workspace/ui/lib/utils"

import { SortableList, useSortableRow } from "@/components/quiz/sortable"
import { questionTypes, TYPE_MENU_ORDER, typeDef } from "@/lib/quiz/types/registry"

export function QuestionRail({
  questions,
  selectedId,
  issues,
  onSelect,
  onAdd,
  onReorder,
}: {
  questions: Question[]
  selectedId: string | null
  issues: Issue[]
  onSelect: (id: string) => void
  onAdd: (kind: QuestionKind) => void
  onReorder: (id: string, toIndex: number) => void
}) {
  const errorIds = new Set(
    issues.filter((i) => i.severity === "error" && i.questionId).map((i) => i.questionId)
  )

  const [query, setQuery] = React.useState("")
  const needle = query.trim().toLowerCase()
  const filtering = needle.length > 0

  // Pair each question with its ORIGINAL index: a filtered list must keep
  // showing the numbers a teacher knows the questions by.
  const visible = questions
    .map((question, index) => ({ question, index }))
    .filter(
      (entry) =>
        !filtering ||
        toPlainText(entry.question.promptDoc).toLowerCase().includes(needle)
    )

  // Past ~100 questions, stop laying out and painting offscreen rows. Browser
  // virtualization via content-visibility rather than a windowing library:
  // rows keep their real DOM nodes, so dnd-kit's sortable measurements and the
  // keyboard sensor keep working, and the fixed row height (h-9 + mb-0.5 =
  // 38px) makes the intrinsic-size hint exact rather than an estimate.
  const virtualize = visible.length > 100

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r bg-sidebar">
      <div className="flex h-10 shrink-0 items-center gap-2 px-3.5">
        <span className="text-[10.5px] font-semibold tracking-[0.07em] text-muted-foreground">
          QUESTIONS
        </span>
        <span className="rounded-full bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
          {filtering ? `${visible.length}/${questions.length}` : questions.length}
        </span>
        <div className="flex-1" />
        {errorIds.size > 0 ? (
          <span className="flex items-center gap-1 text-[10.5px] text-destructive">
            <span className="size-1.5 rounded-full bg-destructive" />
            {errorIds.size} {errorIds.size === 1 ? "issue" : "issues"}
          </span>
        ) : null}
      </div>

      <div className="shrink-0 px-2.5 pb-1.5">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("")
            }}
            placeholder="Search questions…"
            aria-label="Search questions"
          />
        </InputGroup>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5">
        <SortableList
          ids={visible.map((entry) => entry.question.id)}
          // Reordering a filtered view would splice against the wrong indices,
          // so dragging stands down until the search is cleared.
          onReorder={filtering ? () => {} : onReorder}
        >
          <ul>
            {visible.map(({ question, index }) => (
              <QuestionRailItem
                key={question.id}
                question={question}
                index={index}
                selected={question.id === selectedId}
                hasError={errorIds.has(question.id)}
                virtualize={virtualize}
                sortable={!filtering}
                onSelect={() => onSelect(question.id)}
              />
            ))}
            {filtering && visible.length === 0 ? (
              <li className="px-2 py-3 text-xs text-muted-foreground">
                No questions match
              </li>
            ) : null}
          </ul>
        </SortableList>
      </div>

      {/* grid stretches its child, so the button fills the rail without
          needing a width class of its own */}
      <div className="grid shrink-0 border-t p-2.5">
        <AddQuestionMenu onAdd={onAdd} />
      </div>
    </aside>
  )
}

function QuestionRailItem({
  question,
  index,
  selected,
  hasError,
  virtualize,
  sortable,
  onSelect,
}: {
  question: Question
  index: number
  selected: boolean
  hasError: boolean
  virtualize: boolean
  /** False while the list is filtered - reordering a subset would misplace rows. */
  sortable: boolean
  onSelect: () => void
}) {
  const { isDragging, rowProps, handleProps } = useSortableRow(question.id)
  const Icon = typeDef(question.kind).icon
  const text = toPlainText(question.promptDoc).trim()

  return (
    <li
      {...rowProps}
      className={cn(
        "mb-0.5 flex h-9 items-center gap-1 rounded-lg border pr-2 transition-colors",
        selected
          ? "border-border bg-background shadow-xs"
          : "border-transparent hover:bg-background/60",
        isDragging && "shadow-md",
        virtualize && "[contain-intrinsic-block-size:36px] [content-visibility:auto]"
      )}
    >
      {/* A real button, not a decorative icon: this is how the list is
          reordered from the keyboard. While filtering it becomes an inert
          spacer of the same width, so rows don't shift sideways. */}
      {sortable ? (
        <button
          {...handleProps}
          type="button"
          aria-label={`Reorder question ${index + 1}`}
          className="flex h-full cursor-grab items-center pl-1.5 text-muted-foreground/40 outline-none hover:text-muted-foreground focus-visible:text-foreground"
        >
          <GripVertical className="size-3.5" />
        </button>
      ) : (
        <span aria-hidden className="flex h-full items-center pl-1.5 text-transparent">
          <GripVertical className="size-3.5" />
        </span>
      )}

      <button
        type="button"
        aria-current={selected}
        onClick={onSelect}
        className="flex h-full min-w-0 flex-1 items-center gap-2.5 text-left outline-none"
      >
        <span
          className={cn(
            "w-4 shrink-0 text-right font-mono text-[10.5px]",
            selected ? "text-primary" : "text-muted-foreground"
          )}
        >
          {index + 1}
        </span>
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            selected ? "text-primary" : "text-muted-foreground"
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs",
            selected ? "font-medium text-foreground" : "text-muted-foreground"
          )}
        >
          {text || "Untitled question"}
        </span>
      </button>

      {hasError ? (
        <span
          title="Needs attention before publishing"
          className="size-1.5 shrink-0 rounded-full bg-destructive"
        />
      ) : null}
    </li>
  )
}

function AddQuestionMenu({ onAdd }: { onAdd: (kind: QuestionKind) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="dashed">
            <Plus />
            Add question
          </Button>
        }
      />
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Question type</DropdownMenuLabel>
          {TYPE_MENU_ORDER.map((kind: QuestionKind) => {
            const def = questionTypes[kind]
            const Icon = def.icon
            return (
              <DropdownMenuItem key={kind} size="lg" onClick={() => onAdd(kind)}>
                <Icon />
                <span className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium">{def.label}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {def.description}
                  </span>
                </span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
