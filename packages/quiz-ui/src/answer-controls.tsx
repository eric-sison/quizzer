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
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Label } from "@workspace/ui/components/label"
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group"

import { RichText } from "./rich-text"
import { RichTextEditor } from "./rich-text-editor"

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
}: {
  question: ManifestQuestion
  answer: AnswerControls
}) {
  switch (question.kind) {
    case "true_false":
    case "single_choice":
      return <ChoiceAnswer question={question} answer={answer} selection="one" />

    case "multiple_choice":
      return <ChoiceAnswer question={question} answer={answer} selection="many" />

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
}: {
  question: ManifestQuestion
  answer: AnswerControls
  selection: "one" | "many"
}) {
  const readOnly = answer.readOnly === true || answer.onChange === undefined

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
        {question.choices.map((choice) => (
          <ChoiceRow key={choice.id} choice={choice} selected={choice.id === value}>
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
      {question.choices.map((choice) => {
        const checked = selected.includes(choice.id)
        return (
          <ChoiceRow key={choice.id} choice={choice} selected={checked}>
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

/**
 * The row is a `<label>`, so the whole thing is a hit target rather than just
 * the 16px control. On a locked-down exam machine a student cannot zoom, which
 * makes that the difference between answerable and fiddly.
 */
function ChoiceRow({
  choice,
  selected,
  children,
}: {
  choice: ManifestChoice
  selected: boolean
  children: React.ReactNode
}) {
  return (
    <Label>
      <span
        data-selected={selected || undefined}
        className="flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-muted data-selected:border-primary/40 data-selected:bg-primary/5"
      >
        {children}
        <span className="min-w-0 flex-1 font-normal">
          <RichText doc={choice.label_doc} fallback={choice.label} />
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
