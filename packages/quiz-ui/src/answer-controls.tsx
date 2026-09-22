// See question-view.tsx: this is where the Base UI controls and the change
// handlers actually live.
"use client"

import * as React from "react"
import {
  answerAsRichDoc,
  countWords,
  type AnswerValue,
  type ManifestChoice,
  type ManifestQuestion,
} from "@workspace/quiz-core"
import { ArrowDown, ArrowUp } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import { RichText } from "./rich-text"
import { RichTextEditor } from "./rich-text-editor"
import { seededShuffle } from "./shuffle"

/**
 * How a student answers, and the only part of a question that differs between
 * the two apps. The desktop wires `onChange` to IPC; the teacher's preview
 * passes `readOnly` and no handler.
 *
 * Note what is *not* here: which control to show. That is derived from
 * `question.kind`, not passed in. A caller-supplied mode would be a second
 * source of truth that can disagree with the manifest, and there is no case
 * where a multiple-choice question should render as anything else.
 */
export type AnswerControls = {
  /** The student's current answer, if they have given one. */
  value?: AnswerValue
  onChange?: (value: AnswerValue) => void
  /**
   * Shows the answer state but refuses input. Not `disabled`: a preview should
   * look like the exam, not like a form that is switched off.
   */
  readOnly?: boolean
}

export function AnswerSection({
  question,
  answer,
  resolveImageSrc,
  shuffleSeed,
}: {
  question: ManifestQuestion
  answer: AnswerControls
  /** For image nodes inside choice labels; see QuestionView. */
  resolveImageSrc?: (mediaId: string) => string | undefined
  /**
   * Per-sitting seed for shuffle_options. Deterministic on purpose: the shell
   * holds one seed for the whole sitting, so the order survives navigation and
   * remounts instead of reshuffling every time the student goes Back.
   */
  shuffleSeed?: string
}) {
  switch (question.kind) {
    case "true_false":
    case "single_choice":
      return (
        <ChoiceAnswer
          question={question}
          answer={answer}
          selection="one"
          resolveImageSrc={resolveImageSrc}
          shuffleSeed={shuffleSeed}
        />
      )

    case "multiple_choice":
      return (
        <ChoiceAnswer
          question={question}
          answer={answer}
          selection="many"
          resolveImageSrc={resolveImageSrc}
          shuffleSeed={shuffleSeed}
        />
      )

    case "numeric":
      return <NumericAnswer question={question} answer={answer} />

    case "fill_in_blank":
      return <FillInBlankAnswer question={question} answer={answer} />

    case "matching":
      return <MatchingAnswer question={question} answer={answer} />

    case "ordering":
      return (
        <OrderingAnswer
          question={question}
          answer={answer}
          resolveImageSrc={resolveImageSrc}
        />
      )

    case "essay":
      return <EssayAnswer question={question} answer={answer} />

    default:
      // Mirrors `#[serde(other)] Unsupported` on the Rust side. A quiz
      // published with a kind this build predates costs the student one
      // question, not the whole paper.
      return (
        <p className="text-sm text-muted-foreground">
          This question needs a newer version of the exam app. Tell your teacher
          you could not answer it.
        </p>
      )
  }
}

function ChoiceAnswer({
  question,
  answer,
  selection,
  resolveImageSrc,
  shuffleSeed,
}: {
  question: ManifestQuestion
  answer: AnswerControls
  selection: "one" | "many"
  resolveImageSrc?: (mediaId: string) => string | undefined
  shuffleSeed?: string
}) {
  const readOnly = answer.readOnly === true || answer.onChange === undefined

  // Seeded per sitting AND per question, so two shuffled questions don't get
  // the same permutation just because they have the same option count.
  const choices = React.useMemo(
    () =>
      question.shuffle_options
        ? seededShuffle(question.choices, `${shuffleSeed ?? ""}:${question.id}`)
        : question.choices,
    [question, shuffleSeed]
  )

  if (selection === "one") {
    // Narrowing, not a runtime defence: an array here would simply match no
    // option, which is already the right outcome. The multi-answer branch
    // below is the one where a wrong shape would show a false selection.
    const value = typeof answer.value === "string" ? answer.value : null

    return (
      <RadioGroup
        value={value}
        readOnly={readOnly}
        onValueChange={(next) => answer.onChange?.(String(next))}
        aria-label="Select one answer"
      >
        {choices.map((choice) => (
          <ChoiceRow
            key={choice.id}
            choice={choice}
            selected={choice.id === value}
            resolveImageSrc={resolveImageSrc}
          >
            <RadioGroupItem value={choice.id} />
          </ChoiceRow>
        ))}
      </RadioGroup>
    )
  }

  // This check is load-bearing. A single-choice answer stored before the
  // question changed kind is a bare id string, and `"opt-7".includes("opt-7")`
  // is true, so reading it without the guard would tick a box the student
  // never ticked.
  const selected = Array.isArray(answer.value) ? answer.value : []

  return (
    <div role="group" aria-label="Select all that apply" className="grid w-full gap-2">
      {choices.map((choice) => {
        const checked = selected.includes(choice.id)
        return (
          <ChoiceRow
            key={choice.id}
            choice={choice}
            selected={checked}
            resolveImageSrc={resolveImageSrc}
          >
            <Checkbox
              checked={checked}
              readOnly={readOnly}
              onCheckedChange={(next) =>
                answer.onChange?.(
                  next === true
                    ? [...selected, choice.id]
                    : selected.filter((id) => id !== choice.id)
                )
              }
            />
          </ChoiceRow>
        )
      })}
    </div>
  )
}

function NumericAnswer({
  question,
  answer,
}: {
  question: ManifestQuestion
  answer: AnswerControls
}) {
  const readOnly = answer.readOnly === true || answer.onChange === undefined
  // The raw string the student typed, never parsed here: "0.50" and "0.5" are
  // the same number but not the same answer sheet, and grading is server work.
  const value = typeof answer.value === "string" ? answer.value : ""

  return (
    <div className="max-w-56">
      <InputGroup>
        <InputGroupInput
          type="text"
          inputMode="decimal"
          value={value}
          readOnly={readOnly}
          onChange={(event) => answer.onChange?.(event.currentTarget.value)}
          placeholder="Your answer"
          aria-label={question.unit ? `Answer in ${question.unit}` : "Numeric answer"}
        />
        {question.unit ? (
          <InputGroupAddon align="inline-end">
            <span className="text-xs text-muted-foreground">{question.unit}</span>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </div>
  )
}

function FillInBlankAnswer({
  question,
  answer,
}: {
  question: ManifestQuestion
  answer: AnswerControls
}) {
  const readOnly = answer.readOnly === true || answer.onChange === undefined
  const count = question.blank_count ?? 0
  // A stale answer from before a kind switch may be a string or a record;
  // anything but an array simply pre-fills nothing.
  const current = Array.isArray(answer.value) ? answer.value : []

  function setBlank(index: number, text: string) {
    // Emit a dense array so blank i always lands at index i.
    answer.onChange?.(
      Array.from({ length: count }, (_, i) => (i === index ? text : (current[i] ?? "")))
    )
  }

  return (
    // Full width, unlike the numeric box above: a blank takes a phrase, and
    // how much room it is given is a hint about how much is wanted. A box that
    // stops halfway across the column suggests a short answer whether or not
    // one was asked for, and a long response scrolling inside a narrow field
    // is the version a student cannot read back before submitting.
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: count }, (_, index) => {
        /**
         * A single blank needs no heading: the prompt already says what goes
         * in it, and a label over a lone box is furniture. Several do, because
         * a student has to see which box is which - `in_order` grading marks
         * response i against blank i, so putting the right word in the wrong
         * row costs marks.
         *
         * "Answer", not "Blank": the student is filling in answers. The
         * teacher's editor says "Blank" because that is the thing being
         * authored there.
         */
        const label = count > 1 ? `Answer ${index + 1}` : null

        return (
          <Label key={index} className="flex-col items-start gap-1.5">
            {label ? (
              <span className="text-xs text-muted-foreground">{label}</span>
            ) : null}
            <Input
              value={current[index] ?? ""}
              readOnly={readOnly}
              onChange={(event) => setBlank(index, event.currentTarget.value)}
              placeholder="Your answer"
              // With no visible text in the label, the field would otherwise
              // reach a screen reader unnamed.
              aria-label={label === null ? "Your answer" : undefined}
            />
          </Label>
        )
      })}
    </div>
  )
}

/** A stored matching answer, or {} for any stale non-record shape. */
function asMatchRecord(value: AnswerValue | undefined): Record<string, string> {
  if (
    value === undefined ||
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ("type" in value && (value as { type?: unknown }).type === "doc")
  ) {
    return {}
  }
  return value as Record<string, string>
}

function MatchingAnswer({
  question,
  answer,
}: {
  question: ManifestQuestion
  answer: AnswerControls
}) {
  const readOnly = answer.readOnly === true || answer.onChange === undefined
  const record = asMatchRecord(answer.value)
  const rightItems = question.right_items ?? []
  const labelOf = (id: string | undefined) =>
    rightItems.find((item) => item.id === id)?.label

  /**
   * Base UI needs this to put a LABEL on the closed trigger. Without it
   * `Select.Value` renders the raw value, and the value here is an opaque
   * right-item id - so the student would pick "Mammal" and be shown
   * "74a969f18a874c4a". The ids cannot be swapped for labels instead: they are
   * what the answer is stored as, and two right items may read the same.
   */
  const rightLabels = React.useMemo(
    () =>
      Object.fromEntries(
        (question.right_items ?? []).map((item) => [item.id, item.label])
      ),
    [question.right_items]
  )

  return (
    <div className="flex flex-col gap-2">
      {(question.left_items ?? []).map((left) => {
        const chosen = record[left.id]
        return (
          <div
            key={left.id}
            data-selected={chosen !== undefined || undefined}
            className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors data-selected:border-primary/40 data-selected:bg-primary/5"
          >
            <span className="min-w-0 flex-1">
              <RichText doc={left.label_doc} fallback={left.label} />
            </span>
            {readOnly ? (
              // Like the exam, not a switched-off form: the choice reads as text.
              <span className="text-sm text-muted-foreground">
                {labelOf(chosen) ?? "—"}
              </span>
            ) : (
              <div className="w-64">
                <Select
                  items={rightLabels}
                  value={chosen ?? null}
                  onValueChange={(next) => {
                    if (typeof next !== "string") return
                    answer.onChange?.({ ...record, [left.id]: next })
                  }}
                >
                  {/* The trigger is `w-fit` by default, which left it floating
                      short of the row's edge. Fill the column instead, so every
                      row's control lines up on the right. */}
                  <SelectTrigger
                    className="w-full"
                    aria-label={`Match for "${left.label}"`}
                  >
                    <SelectValue placeholder="Choose a match…" />
                  </SelectTrigger>
                  <SelectContent>
                    {rightItems.map((right) => (
                      <SelectItem key={right.id} value={right.id}>
                        {right.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function OrderingAnswer({
  question,
  answer,
  resolveImageSrc,
}: {
  question: ManifestQuestion
  answer: AnswerControls
  resolveImageSrc?: (mediaId: string) => string | undefined
}) {
  const readOnly = answer.readOnly === true || answer.onChange === undefined

  // Display order: the student's stored order first (dropping ids that are no
  // longer in the manifest), then anything they have not touched yet, in
  // manifest order. Tolerates stale answers from a republished item set.
  const stored = Array.isArray(answer.value) ? answer.value : []
  const byId = new Map(question.choices.map((choice) => [choice.id, choice]))
  const ordered = [
    ...stored.filter((id) => byId.has(id)),
    ...question.choices.map((c) => c.id).filter((id) => !stored.includes(id)),
  ]

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= ordered.length) return
    const next = [...ordered]
    const [moved] = next.splice(index, 1)
    if (moved) next.splice(target, 0, moved)
    answer.onChange?.(next)
  }

  return (
    <ol aria-label="Arrange in order" className="flex flex-col gap-2">
      {ordered.map((id, index) => {
        const choice = byId.get(id)
        if (!choice) return null
        const name = choice.label || `item ${index + 1}`
        return (
          <li
            key={id}
            className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm"
          >
            <span className="w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">
              {index + 1}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1.5 [&_img]:max-h-40">
              <RichText
                doc={choice.label_doc}
                fallback={choice.label}
                resolveImageSrc={resolveImageSrc}
              />
            </span>
            {readOnly ? null : (
              <span className="flex shrink-0 gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move "${name}" up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move "${name}" down`}
                  disabled={index === ordered.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown />
                </Button>
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * The row is a `<label>`, so the whole thing is a hit target rather than just
 * the 16px control. On a locked-down exam machine a student cannot zoom, which
 * makes that the difference between answerable and fiddly.
 */
function ChoiceRow({
  choice,
  selected,
  resolveImageSrc,
  children,
}: {
  choice: ManifestChoice
  selected: boolean
  resolveImageSrc?: (mediaId: string) => string | undefined
  children: React.ReactNode
}) {
  return (
    <Label>
      <span
        data-selected={selected || undefined}
        className="flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-muted data-selected:border-primary/40 data-selected:bg-primary/5"
      >
        {children}
        {/* [&_img] out-specifies the renderer's own max-h: an illustration
            that suits a prompt would swamp an answer row. */}
        <span className="flex min-w-0 flex-1 flex-col gap-1.5 font-normal [&_img]:max-h-40">
          <RichText
            doc={choice.label_doc}
            fallback={choice.label}
            resolveImageSrc={resolveImageSrc}
          />
        </span>
      </span>
    </Label>
  )
}

/**
 * Essays are written in the same constrained editor the teacher wrote the
 * prompt in, so a student can lay out a structured answer instead of one
 * undifferentiated block. One allowlist for both means an answer can never
 * contain a node a prompt could not.
 *
 * The word count drives off the document, through the same `countWords` the
 * server uses, so a limit satisfied on screen is satisfied on submit.
 */
function EssayAnswer({
  question,
  answer,
}: {
  question: ManifestQuestion
  answer: AnswerControls
}) {
  const readOnly = answer.readOnly === true || answer.onChange === undefined
  // Older answers are plain strings. They become a document here rather than in
  // a migration, which nobody would want to run against an exam in progress.
  const doc = answerAsRichDoc(answer.value)
  const words = countWords(doc)
  const started = words > 0

  return (
    <RichTextEditor
      // Read-only rather than hidden: a preview should look like the exam, and
      // a submitted paper should read the way it was written.
      editable={!readOnly}
      value={doc}
      onChange={(next) => answer.onChange?.(next)}
      placeholder={readOnly ? "" : "Write your answer here"}
      meta={
        <WordCount
          words={words}
          min={question.min_words}
          max={question.max_words}
          started={started}
        />
      }
    />
  )
}

/**
 * The limits are worth stating even before anyone types: a student who writes
 * 400 words and only then learns the cap was 200 has wasted exam time.
 */
function WordCount({
  words,
  min,
  max,
  started,
}: {
  words: number
  min: number | undefined
  max: number | undefined
  started: boolean
}) {
  const under = min !== undefined && words < min
  const over = max !== undefined && words > max
  const outOfRange = started && (under || over)

  return (
    <p
      aria-live="polite"
      className={
        outOfRange
          ? "text-xs text-destructive"
          : "text-xs text-muted-foreground"
      }
    >
      <span className="font-mono tabular-nums">{words}</span>{" "}
      {words === 1 ? "word" : "words"}
      {describeLimits(min, max)}
    </p>
  )
}

function describeLimits(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) return `, ${min} to ${max} expected`
  if (min !== undefined) return `, at least ${min} expected`
  if (max !== undefined) return `, at most ${max} expected`
  return ""
}
