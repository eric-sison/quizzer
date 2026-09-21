"use client"

import { createBlank, createQuestion, type Blank } from "@workspace/quiz-core"
import { Plus, TextCursorInput, Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

import { SectionHeader } from "@/components/quiz/section-header"
import type { QuestionEditorProps, QuestionTypeDef } from "./registry"

function FillInBlankEditor({
  question,
  onChange,
}: QuestionEditorProps<"fill_in_blank">) {
  function updateBlank(id: string, acceptedAnswers: string[]) {
    onChange({
      ...question,
      blanks: question.blanks.map((blank) =>
        blank.id === id ? { ...blank, acceptedAnswers } : blank
      ),
    })
  }

  return (
    <div className="flex flex-col gap-2.5">
      <SectionHeader
        title="Blanks"
        hint="Write ___ in the prompt where each response goes"
        action={
          <Label>
            <Checkbox
              checked={question.caseSensitive}
              onCheckedChange={(checked) =>
                onChange({ ...question, caseSensitive: checked === true })
              }
            />
            Case sensitive
          </Label>
        }
      />

      <ul className="flex flex-col gap-2">
        {question.blanks.map((blank, index) => (
          <BlankRow
            key={blank.id}
            blank={blank}
            index={index}
            canDelete={question.blanks.length > 1}
            onChangeAnswers={(answers) => updateBlank(blank.id, answers)}
            onRemove={() =>
              onChange({
                ...question,
                blanks: question.blanks.filter((b) => b.id !== blank.id),
              })
            }
          />
        ))}
      </ul>

      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            onChange({ ...question, blanks: [...question.blanks, createBlank()] })
          }
        >
          <Plus />
          Add blank
        </Button>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">
          Accepted responses stay on the server
        </span>
      </div>
    </div>
  )
}

function BlankRow({
  blank,
  index,
  canDelete,
  onChangeAnswers,
  onRemove,
}: {
  blank: Blank
  index: number
  canDelete: boolean
  onChangeAnswers: (answers: string[]) => void
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
