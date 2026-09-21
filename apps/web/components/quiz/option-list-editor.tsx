"use client"

import { arrayMove } from "@dnd-kit/sortable"
import {
  createOption,
  richDocFromText,
  toPlainText,
  type ChoiceOption,
} from "@workspace/quiz-core"
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { RadioGroupItem } from "@workspace/ui/components/radio-group"

import { SectionHeader } from "@/components/quiz/section-header"
import { SortableList, useSortableRow } from "@/components/quiz/sortable"

/**
 * Shared by both multiple-choice variants. They differ only in how many options
 * may be correct, so that is a prop rather than a second copy of this file.
 *
 * Option labels are edited as plain text even though the model stores a
 * `RichDoc`. A one-line answer does not need a formatting toolbar, and the
 * richer type is already there if that ever changes.
 */
export type OptionListEditorProps = {
  options: ChoiceOption[]
  selection: "one" | "many"
  onChange: (options: ChoiceOption[]) => void
  /** Rendered in the section header, e.g. the one/many switch. */
  action?: React.ReactNode
}

export function OptionListEditor({
  options,
  selection,
  onChange,
  action,
}: OptionListEditorProps) {
  const correctCount = options.filter((option) => option.correct).length

  function setCorrect(id: string, correct: boolean) {
    onChange(
      options.map((option) => {
        if (option.id === id) return { ...option, correct }
        // Radio semantics: marking one correct clears the rest.
        if (selection === "one" && correct) return { ...option, correct: false }
        return option
      })
    )
  }

  function setLabel(id: string, label: string) {
    onChange(
      options.map((option) =>
        option.id === id
          ? { ...option, labelDoc: richDocFromText(label) }
          : option
      )
    )
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= options.length) return
    const next = [...options]
    const [moved] = next.splice(index, 1)
    if (moved) next.splice(target, 0, moved)
    onChange(next)
  }

  function remove(id: string) {
    onChange(options.filter((option) => option.id !== id))
  }

  return (
    <div className="flex flex-col gap-2.5">
      <SectionHeader title="Answer options" action={action} />

      <SortableList
        ids={options.map((option) => option.id)}
        onReorder={(id, toIndex) => {
          const from = options.findIndex((option) => option.id === id)
          if (from >= 0 && from !== toIndex) onChange(arrayMove(options, from, toIndex))
        }}
      >
        <ul className="flex flex-col gap-2">
          {options.map((option, index) => (
            <OptionRow
              key={option.id}
              option={option}
              index={index}
              selection={selection}
              canDelete={options.length > 2}
              atStart={index === 0}
              atEnd={index === options.length - 1}
              onSetCorrect={(correct) => setCorrect(option.id, correct)}
              onSetLabel={(label) => setLabel(option.id, label)}
              onMove={(delta) => move(index, delta)}
              onRemove={() => remove(option.id)}
            />
          ))}
        </ul>
      </SortableList>

      <div className="flex items-center gap-3 pl-6">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onChange([...options, createOption()])}
        >
          <Plus />
          Add option
        </Button>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {selection === "one"
            ? "Exactly one must be correct"
            : `${correctCount} of ${options.length} marked correct`}
        </span>
      </div>
    </div>
  )
}

function OptionRow({
  option,
  index,
  selection,
  canDelete,
  atStart,
  atEnd,
  onSetCorrect,
  onSetLabel,
  onMove,
  onRemove,
}: {
  option: ChoiceOption
  index: number
  selection: "one" | "many"
  canDelete: boolean
  atStart: boolean
  atEnd: boolean
  onSetCorrect: (correct: boolean) => void
  onSetLabel: (label: string) => void
  onMove: (delta: number) => void
  onRemove: () => void
}) {
  const { isDragging, rowProps, handleProps } = useSortableRow(option.id)
  const label = toPlainText(option.labelDoc)
  const name = label || `option ${index + 1}`

  return (
    <li
      {...rowProps}
      data-correct={option.correct || undefined}
      className={`flex items-center gap-2 rounded-lg border border-transparent px-1 transition-colors data-correct:border-primary/40 data-correct:bg-primary/5 ${
        isDragging ? "bg-background shadow-md" : ""
      }`}
    >
      {/* Focusable so the list can also be reordered without a pointer. The
          menu below stays regardless: it is faster for a single step. */}
      <button
        {...handleProps}
        type="button"
        aria-label={`Reorder ${name}`}
        className="flex cursor-grab items-center py-2 text-muted-foreground/40 outline-none hover:text-muted-foreground focus-visible:text-foreground"
      >
        <GripVertical className="size-3.5" />
      </button>

      <span className="flex shrink-0">
        {selection === "one" ? (
          <RadioGroupItem value={option.id} aria-label={`Mark "${name}" as correct`} />
        ) : (
          <Checkbox
            checked={option.correct}
            onCheckedChange={(checked) => onSetCorrect(checked === true)}
            aria-label={`Mark "${name}" as correct`}
          />
        )}
      </span>

      {/* The badge sits inside the field so every row's input is the same
          width whether or not it is marked correct. InputGroup is what reserves
          room for it, rather than padding the input from out here. */}
      <span className="flex-1">
        <InputGroup>
          <InputGroupInput
            value={label}
            onChange={(event) => onSetLabel(event.currentTarget.value)}
            placeholder={`Option ${index + 1}`}
            aria-label={`Option ${index + 1} text`}
          />
          {option.correct ? (
            <InputGroupAddon align="inline-end">
              <span className="text-[10px] font-semibold tracking-wide text-primary">
                CORRECT
              </span>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for option ${index + 1}`}
            />
          }
        >
          <span aria-hidden>⋯</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" width="content">
          <DropdownMenuItem disabled={atStart} onClick={() => onMove(-1)}>
            <ChevronUp />
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={atEnd} onClick={() => onMove(1)}>
            <ChevronDown />
            Move down
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={!canDelete}
            onClick={onRemove}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
