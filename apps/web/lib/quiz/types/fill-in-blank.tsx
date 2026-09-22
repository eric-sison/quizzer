"use client"

import {
  createBlank,
  createQuestion,
  withDerivedPoints,
  type Blank,
  type SplitScoredQuestion,
} from "@workspace/quiz-core"
import { Plus, TextCursorInput, Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

import { PointsInput, ScoringEditor } from "@/components/quiz/scoring-editor"
import { SectionHeader } from "@/components/quiz/section-header"
import type { QuestionEditorProps, QuestionTypeDef } from "./registry"

function FillInBlankEditor({
  question,
  onChange,
}: QuestionEditorProps<"fill_in_blank">) {
  /**
   * Every edit that can move the total leaves through here, so `points` never
   * disagrees with the blanks it is derived from. Adding, removing and
   * repricing a blank all qualify, which is every change this editor makes.
   */
  function emit(next: SplitScoredQuestion) {
    onChange(withDerivedPoints(next))
  }

  function updateBlank(id: string, patch: Partial<Blank>) {
    emit({
      ...question,
      blanks: question.blanks.map((blank) =>
        blank.id === id ? { ...blank, ...patch } : blank
      ),
    })
  }

  /** `undefined` clears the key rather than storing an explicit undefined. */
  function setPoints(id: string, points: number | undefined) {
    emit({
      ...question,
      blanks: question.blanks.map((blank) => {
        if (blank.id !== id) return blank
        const next = { ...blank }
        if (points === undefined) delete next.points
        else next.points = points
        return next
      }),
    })
  }

  return (
    <div className="flex flex-col gap-5">
    <div className="flex flex-col gap-2.5">
      <SectionHeader
        title="Blanks"
        hint="Write ___ in the prompt where each response goes"
        action={
          <span className="flex items-center gap-4">
            <Label title="Suits a prompt whose blanks are a set, such as naming three gases in any sequence">
              <Checkbox
                checked={question.blankOrder === "any_order"}
                onCheckedChange={(checked) =>
                  emit({
                    ...question,
                    blankOrder: checked === true ? "any_order" : "in_order",
                  })
                }
              />
              Any order
            </Label>
            <Label>
              <Checkbox
                checked={question.caseSensitive}
                onCheckedChange={(checked) =>
                  emit({ ...question, caseSensitive: checked === true })
                }
              />
              Case sensitive
            </Label>
          </span>
        }
      />

      <ul className="flex flex-col gap-2">
        {question.blanks.map((blank, index) => (
          <BlankRow
            key={blank.id}
            blank={blank}
            index={index}
            canDelete={question.blanks.length > 1}
            showPoints={question.scoring === "per_option"}
            onChangeAnswers={(acceptedAnswers) =>
              updateBlank(blank.id, { acceptedAnswers })
            }
            onSetPoints={(points) => setPoints(blank.id, points)}
            onRemove={() =>
              emit({
                ...question,
                blanks: question.blanks.filter((b) => b.id !== blank.id),
              })
            }
          />
        ))}
      </ul>

      {/* Indented onto the answer column: `w-14` for the "Blank n" label plus
          the row's `gap-2`, so Add blank starts where the responses above it
          do rather than under their labels. */}
      <div className="flex items-center gap-3 pl-16">
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            emit({ ...question, blanks: [...question.blanks, createBlank()] })
          }
        >
          <Plus />
          Add blank
        </Button>
        <span className="text-xs text-muted-foreground">
          {question.blankOrder === "any_order"
            ? "Responses can go in any order. Repeating one does not score twice."
            : "Each response is graded against its own blank"}
        </span>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">
          Accepted responses stay on the server
        </span>
      </div>
    </div>

    <ScoringEditor question={question} onChange={emit} />
    </div>
  )
}

function BlankRow({
  blank,
  index,
  canDelete,
  showPoints,
  onChangeAnswers,
  onSetPoints,
  onRemove,
}: {
  blank: Blank
  index: number
  canDelete: boolean
  /** Per-blank values, under per-blank scoring only. */
  showPoints: boolean
  onChangeAnswers: (answers: string[]) => void
  onSetPoints: (points: number | undefined) => void
  onRemove: () => void
}) {
  return (
    <li className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs text-muted-foreground">
        Blank {index + 1}
      </span>
      <span className="min-w-0 flex-1">
        <Input
          value={blank.acceptedAnswers.join(", ")}
          onChange={(event) =>
            // Commas separate alternatives; entries are trimmed at the edge so
            // "H, hydrogen" accepts both spellings.
            onChangeAnswers(
              event.currentTarget.value
                .split(",")
                .map((answer) => answer.trimStart())
            )
          }
          onBlur={() =>
            onChangeAnswers(
              blank.acceptedAnswers.map((a) => a.trim()).filter((a) => a.length > 0)
            )
          }
          placeholder="Accepted responses, comma-separated"
          aria-label={`Accepted responses for blank ${index + 1}`}
        />
      </span>
      {/* A blank box is not a zero: the validator refuses to publish until it
          is filled, and the field says so rather than waiting for the publish
          dialog. */}
      {showPoints ? (
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="w-14">
            <PointsInput
              value={blank.points}
              ariaLabel={`Points for blank ${index + 1}`}
              placeholder=""
              invalid={blank.points === undefined}
              onChange={onSetPoints}
            />
          </span>
          <span className="text-[11px] text-muted-foreground">pts</span>
        </span>
      ) : null}

      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove blank ${index + 1}`}
        disabled={!canDelete}
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </li>
  )
}

export const fillInBlankType: QuestionTypeDef<"fill_in_blank"> = {
  kind: "fill_in_blank",
  label: "Fill in the blank",
  menuLabel: "Fill in the blank",
  description: "Typed responses, one per blank",
  icon: TextCursorInput,
  createDefault: () => createQuestion("fill_in_blank"),
  Editor: FillInBlankEditor,
}
