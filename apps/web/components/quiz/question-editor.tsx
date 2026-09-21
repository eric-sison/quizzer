"use client"

import {
  countWords,
  type Question,
  type QuestionKind,
  type QuestionOfKind,
} from "@workspace/quiz-core"
import { Minus, Plus } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Label } from "@workspace/ui/components/label"
import { RichTextEditor } from "@workspace/quiz-ui"

import { QuestionActions } from "@/components/quiz/question-actions"
import { QuestionTypeSelect } from "@/components/quiz/question-type-select"
import { SectionHeader } from "@/components/quiz/section-header"
import { typeDef } from "@/lib/quiz/types/registry"

const MAX_POINTS = 1000

/**
 * The shell around one question.
 *
 * Prompt, points and required are identical for every kind and live here; the
 * registry contributes only the answer-configuration block. That split is what
 * keeps a new question type down to one file.
 */
export function QuestionEditor({
  question,
  index,
  total,
  onChange,
  onDuplicate,
  onMove,
  onDelete,
}: {
  question: Question
  index: number
  total: number
  onChange: (next: Question) => void
  onDuplicate: () => void
  onMove: (delta: number) => void
  onDelete: () => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2.5">
        <h2 className="font-heading text-base font-semibold tracking-tight">
          Question {index + 1}
        </h2>
        <span className="text-xs text-muted-foreground">of {total}</span>
        <div className="flex-1" />
        <QuestionTypeSelect question={question} onChange={onChange} />
        <QuestionActions
          index={index}
          total={total}
          onDuplicate={onDuplicate}
          onMove={onMove}
          onDelete={onDelete}
        />
      </div>

      <div className="flex flex-col gap-2.5">
        <SectionHeader
          title="Prompt"
          hint="Bold, italic, underline, lists and code"
        />
        <RichTextEditor
          value={question.promptDoc}
          onChange={(promptDoc) => onChange({ ...question, promptDoc })}
          placeholder="Write the question…"
          meta={
            <span className="font-mono text-[10px] text-muted-foreground">
              {countWords(question.promptDoc)} words
            </span>
          }
        />
      </div>

      <AnswerSection question={question} onChange={onChange} />

      <div className="flex flex-wrap items-center gap-5 border-t pt-4">
        <PointsStepper
          value={question.points}
          onChange={(points) => onChange({ ...question, points })}
        />

        <Label>
          <Checkbox
            checked={question.required}
            onCheckedChange={(checked) =>
              onChange({ ...question, required: checked === true })
            }
          />
          Required
        </Label>

        <div className="flex-1" />

        <span className="text-[11px] text-muted-foreground">
          Correct answers stay on the server, never sent to the exam app
        </span>
      </div>
    </div>
  )
}

/**
 * Dispatch to the registry. The cast is confined here: `typeDef(question.kind)`
 * returns a union of editors and TypeScript cannot see that its `kind` matches
 * this question's.
 */
function AnswerSection({
  question,
  onChange,
}: {
  question: Question
  onChange: (next: Question) => void
}) {
  const def = typeDef(question.kind)
  const Editor = def.Editor as React.ComponentType<{
    question: QuestionOfKind<QuestionKind>
    onChange: (next: Question) => void
  }>

  return <Editor question={question} onChange={onChange} />
}

function PointsStepper({
  value,
  onChange,
}: {
  value: number
  onChange: (points: number) => void
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-xs text-muted-foreground">Points</span>
      <div className="flex items-center rounded-lg border">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Decrease points"
          disabled={value <= 0}
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          <Minus />
        </Button>
        <span className="w-8 text-center font-mono text-xs tabular-nums">{value}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Increase points"
          disabled={value >= MAX_POINTS}
          onClick={() => onChange(Math.min(MAX_POINTS, value + 1))}
        >
          <Plus />
        </Button>
      </div>
    </div>
  )
}
