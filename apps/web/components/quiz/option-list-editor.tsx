"use client"

import * as React from "react"
import { arrayMove } from "@dnd-kit/sortable"
import {
  createOption,
  isRichDocEmpty,
  richDocFromText,
  toPlainText,
  type ChoiceOption,
  type RichDoc,
} from "@workspace/quiz-core"
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  ImagePlus,
  Images,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { toast } from "@workspace/ui/components/toast"
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

import { PointsInput } from "@/components/quiz/scoring-editor"
import { useQuestionMedia } from "@/components/quiz/question-media-context"
import { SectionHeader } from "@/components/quiz/section-header"
import { SortableList, useSortableRow } from "@/components/quiz/sortable"

/**
 * Shared by both multiple-choice variants. They differ only in how many options
 * may be correct, so that is a prop rather than a second copy of this file.
 *
 * Option labels are edited as plain text even though the model stores a
 * `RichDoc` - a one-line answer does not need a formatting toolbar. The richer
 * type carries one thing beyond text: an optional image, kept as an `image`
 * node in the label document, which is exactly how the exam client receives it.
 */

/** The one image an option may carry. */
function imageOf(doc: RichDoc): { mediaId: string; alt: string } | undefined {
  for (const block of doc.content) {
    if (block.type === "image") return block.attrs
  }
  return undefined
}

/** New text, same picture: retyping the caption must not drop the image. */
function withText(doc: RichDoc, text: string): RichDoc {
  const images = doc.content.filter((block) => block.type === "image")
  return { type: "doc", content: [...richDocFromText(text).content, ...images] }
}

function withImage(doc: RichDoc, mediaId: string): RichDoc {
  const rest = doc.content.filter((block) => block.type !== "image")
  return {
    type: "doc",
    content: [...rest, { type: "image", attrs: { mediaId, alt: "" } }],
  }
}

function withImageAlt(doc: RichDoc, alt: string): RichDoc {
  return {
    type: "doc",
    content: doc.content.map((block) =>
      block.type === "image" ? { ...block, attrs: { ...block.attrs, alt } } : block
    ),
  }
}

/**
 * Alt text for option images is positional ("Option 3"), not authored - no
 * field to fill in, and a screen reader still gets something that identifies
 * the choice. Re-derived on every change so reordering cannot leave an image
 * announcing the wrong position.
 */
function withSyncedAlts(options: ChoiceOption[]): ChoiceOption[] {
  return options.map((option, index) => {
    const image = imageOf(option.labelDoc)
    const alt = `Option ${index + 1}`
    if (!image || image.alt === alt) return option
    return { ...option, labelDoc: withImageAlt(option.labelDoc, alt) }
  })
}

function withoutImage(doc: RichDoc): RichDoc {
  const content = doc.content.filter((block) => block.type !== "image")
  // A document must hold at least one block for the editor and schema alike.
  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] }
}
export type OptionListEditorProps = {
  options: ChoiceOption[]
  /**
   * How correctness is marked: radio, checkboxes, or - for the ordering
   * editor, which reuses this list for its items - not at all.
   */
  selection: "one" | "many" | "none"
  onChange: (options: ChoiceOption[]) => void
  /** Rendered in the section header, e.g. the one/many switch. */
  action?: React.ReactNode
  /** Section heading; the ordering editor says "Items". */
  title?: string
  /** Placeholder stem for each row ("Option" -> "Option 3"). */
  itemNoun?: string
  /** Overrides the footer hint, e.g. ordering's shuffle note. */
  footerHint?: string
  /** Extra footer content, e.g. the shuffle-options switch. */
  footerExtra?: React.ReactNode
  /**
   * Show a point value on each correct row - multiple choice under per-answer
   * scoring, and nothing else. Incorrect rows never show one: an option that
   * earns nothing has no award to type.
   */
  optionPoints?: boolean
}

export function OptionListEditor({
  options,
  selection,
  onChange,
  action,
  title = "Answer options",
  itemNoun = "Option",
  footerHint,
  footerExtra,
  optionPoints = false,
}: OptionListEditorProps) {
  const correctCount = options.filter((option) => option.correct).length

  /** Every change funnels through here so image alts track their position. */
  function emit(next: ChoiceOption[]) {
    onChange(withSyncedAlts(next))
  }

  function setCorrect(id: string, correct: boolean) {
    emit(
      options.map((option) => {
        if (option.id === id) return { ...option, correct }
        // Radio semantics: marking one correct clears the rest.
        if (selection === "one" && correct) return { ...option, correct: false }
        return option
      })
    )
  }

  /** `undefined` clears the key rather than storing an explicit undefined. */
  function setPoints(id: string, points: number | undefined) {
    emit(
      options.map((option) => {
        if (option.id !== id) return option
        const next = { ...option }
        if (points === undefined) delete next.points
        else next.points = points
        return next
      })
    )
  }

  function updateDoc(id: string, transform: (doc: RichDoc) => RichDoc) {
    emit(
      options.map((option) =>
        option.id === id
          ? { ...option, labelDoc: transform(option.labelDoc) }
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
    emit(next)
  }

  function remove(id: string) {
    emit(options.filter((option) => option.id !== id))
  }

  /**
   * Multi-line paste turns into one option per line: the fastest way to enter
   * options is pasting a list from wherever it already exists. Returns true
   * when it handled the paste (so the input suppresses the default insert).
   */
  function pasteInto(index: number, text: string): boolean {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (lines.length < 2) return false

    const current = options[index]
    if (!current) return false
    const currentEmpty = isRichDocEmpty(current.labelDoc)

    // Never clobber typed text: a non-empty option keeps its label and the
    // pasted lines all become new options after it.
    const [first, ...rest] = lines
    const fills = currentEmpty ? rest : lines
    const next = currentEmpty
      ? options.map((option) =>
          option.id === current.id
            ? { ...option, labelDoc: withText(option.labelDoc, first ?? "") }
            : option
        )
      : [...options]

    // choiceOptionSchema caps options at 50.
    const room = Math.max(0, 50 - next.length)
    const added = fills.slice(0, room).map((line) => createOption(line))
    next.splice(index + 1, 0, ...added)
    emit(next)

    toast.add({
      title: `Added ${added.length + (currentEmpty ? 1 : 0)} options`,
      ...(fills.length > room
        ? { description: "Options are limited to 50; the rest were dropped." }
        : {}),
    })
    return true
  }

  return (
    <div className="flex flex-col gap-2.5">
      <SectionHeader title={title} action={action} />

      <SortableList
        ids={options.map((option) => option.id)}
        onReorder={(id, toIndex) => {
          const from = options.findIndex((option) => option.id === id)
          if (from >= 0 && from !== toIndex) emit(arrayMove(options, from, toIndex))
        }}
      >
        <ul className="flex flex-col gap-2">
          {options.map((option, index) => (
            <OptionRow
              key={option.id}
              option={option}
              index={index}
              selection={selection}
              itemNoun={itemNoun}
              canDelete={options.length > 2}
              atStart={index === 0}
              atEnd={index === options.length - 1}
              showPoints={optionPoints}
              onSetCorrect={(correct) => setCorrect(option.id, correct)}
              onSetPoints={(points) => setPoints(option.id, points)}
              onUpdateDoc={(transform) => updateDoc(option.id, transform)}
              onPaste={(text) => pasteInto(index, text)}
              onMove={(delta) => move(index, delta)}
              onRemove={() => remove(option.id)}
            />
          ))}
        </ul>
      </SortableList>

      {/* The footer wears an option row's box and repeats the columns that
          lead it as empty space, so Add sits under the option text rather than
          under the grip, and still does when there is no selection control to
          clear. A fixed indent would have to guess one of the two. */}
      <div className="flex items-center gap-2 border border-transparent px-1">
        <span aria-hidden className="w-3.5 shrink-0" />
        {selection === "none" ? null : <span aria-hidden className="w-4 shrink-0" />}

        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => emit([...options, createOption()])}
          >
            <Plus />
            Add {itemNoun.toLowerCase()}
          </Button>
          <div className="flex-1" />
          {footerExtra}
          <span className="text-xs text-muted-foreground">
            {footerHint ??
              (selection === "one"
                ? "Exactly one must be correct"
                : `${correctCount} of ${options.length} marked correct`)}
          </span>
        </div>
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
  showPoints,
  onSetCorrect,
  onSetPoints,
  onUpdateDoc,
  onPaste,
  onMove,
  onRemove,
  itemNoun,
}: {
  option: ChoiceOption
  index: number
  selection: "one" | "many" | "none"
  canDelete: boolean
  atStart: boolean
  atEnd: boolean
  showPoints: boolean
  onSetCorrect: (correct: boolean) => void
  onSetPoints: (points: number | undefined) => void
  onUpdateDoc: (transform: (doc: RichDoc) => RichDoc) => void
  /** Returns true when the list handled a multi-line paste. */
  onPaste: (text: string) => boolean
  onMove: (delta: number) => void
  onRemove: () => void
  itemNoun: string
}) {
  const { isDragging, rowProps, handleProps } = useSortableRow(option.id)
  const media = useQuestionMedia()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [pending, setPending] = React.useState(false)
  const [uploadError, setUploadError] = React.useState<string | null>(null)

  const label = toPlainText(option.labelDoc)
  const image = imageOf(option.labelDoc)
  const name = label || `${itemNoun.toLowerCase()} ${index + 1}`

  async function upload(file: File) {
    if (!media) return
    setPending(true)
    setUploadError(null)
    try {
      const result = await media.uploadImage(file)
      if ("mediaId" in result) {
        onUpdateDoc((doc) => withImage(doc, result.mediaId))
      } else {
        setUploadError(result.error)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <li
      {...rowProps}
      data-correct={option.correct || undefined}
      className={`flex items-start gap-2 rounded-lg border border-transparent px-1 py-1.5 transition-colors data-correct:border-primary/40 data-correct:bg-primary/5 ${
        isDragging ? "bg-background shadow-md" : ""
      }`}
    >
      {/* Focusable so the list can also be reordered without a pointer. The
          menu below stays regardless: it is faster for a single step.
          Everything beside the input column pins to h-9 so it stays centred
          on the text row even when an image grows the row downward. */}
      <button
        {...handleProps}
        type="button"
        aria-label={`Reorder ${name}`}
        className="flex h-9 cursor-grab items-center text-muted-foreground/40 outline-none hover:text-muted-foreground focus-visible:text-foreground"
      >
        <GripVertical className="size-3.5" />
      </button>

      {selection === "none" ? null : (
        <span className="flex h-9 shrink-0 items-center">
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
      )}

      {/* One column for everything the option says: the text field and, under
          it, its image - so the picture lines up with the text it belongs to
          instead of hanging at an unrelated indent. */}
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        {/* The badge sits inside the field so every row's input is the same
            width whether or not it is marked correct. InputGroup is what
            reserves room for it, rather than padding the input from out here. */}
        <InputGroup>
          <InputGroupInput
            value={label}
            onChange={(event) => {
              const text = event.currentTarget.value
              onUpdateDoc((doc) => withText(doc, text))
            }}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text/plain")
              if (onPaste(text)) event.preventDefault()
            }}
            placeholder={`${itemNoun} ${index + 1}`}
            aria-label={`${itemNoun} ${index + 1} text`}
          />
          {option.correct ? (
            <InputGroupAddon align="inline-end">
              <span className="text-[10px] font-semibold tracking-wide text-primary">
                CORRECT
              </span>
            </InputGroupAddon>
          ) : null}
        </InputGroup>

        {image && media ? (
          <span className="relative w-fit">
            {/* The thumbnail is itself the replace control; the corner badge
                removes. One compact chip instead of scattered buttons. */}
            <button
              type="button"
              aria-label={`Replace the image on ${name}`}
              title="Replace image"
              disabled={pending}
              onClick={() => inputRef.current?.click()}
              className="block overflow-hidden rounded-lg border bg-muted/30 outline-none hover:opacity-85 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- same-origin
                  proxy; next/image's optimizer buys nothing here */}
              <img
                src={media.resolveImageSrc(image.mediaId)}
                alt={image.alt}
                className="h-20 w-fit max-w-52 object-contain"
              />
            </button>
            {pending ? (
              <span className="absolute inset-0 grid place-items-center rounded-lg bg-background/60">
                <Loader2 className="size-4 animate-spin" aria-hidden />
              </span>
            ) : null}
            <button
              type="button"
              aria-label={`Remove the image from ${name}`}
              disabled={pending}
              onClick={() => onUpdateDoc(withoutImage)}
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ) : null}

        {uploadError ? (
          <p role="alert" className="text-xs text-destructive">
            {uploadError}
          </p>
        ) : null}
      </span>

      {/* Only on correct rows, and only under per-answer scoring. A blank box
          is not a zero: the validator refuses to publish until it is filled,
          and the field says so rather than waiting for the publish dialog. */}
      {showPoints && option.correct ? (
        <span className="flex h-9 shrink-0 items-center gap-1.5">
          <span className="w-14">
            <PointsInput
              value={option.points}
              ariaLabel={`Points for ${name}`}
              placeholder=""
              invalid={option.points === undefined}
              onChange={onSetPoints}
            />
          </span>
          <span className="text-[11px] text-muted-foreground">pts</span>
        </span>
      ) : null}

      {media ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              // Reset so the same file picked again still fires a change.
              event.currentTarget.value = ""
              if (file) void upload(file)
            }}
          />
          {/* Only before an image exists: once there is one, the thumbnail
              replaces and its corner badge removes. */}
          {!image ? (
            <span className="flex h-9 items-center">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Add an image to ${name}`}
                disabled={pending}
                onClick={() => inputRef.current?.click()}
              >
                {pending ? <Loader2 className="animate-spin" /> : <ImagePlus />}
              </Button>
              {media.pickImage ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Choose an existing image for ${name}`}
                  disabled={pending}
                  onClick={() => {
                    void media.pickImage!().then((picked) => {
                      if (picked) onUpdateDoc((doc) => withImage(doc, picked.mediaId))
                    })
                  }}
                >
                  <Images />
                </Button>
              ) : null}
            </span>
          ) : null}
        </>
      ) : null}

      <span className="flex h-9 items-center">
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
      </span>
    </li>
  )
}
