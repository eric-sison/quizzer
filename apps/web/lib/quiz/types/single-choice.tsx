"use client"

import { createQuestion } from "@workspace/quiz-core"
import { CircleDot } from "lucide-react"
import { RadioGroup } from "@workspace/ui/components/radio-group"

import { OptionListEditor } from "@/components/quiz/option-list-editor"
import { SelectionSwitch } from "@/components/quiz/selection-switch"
import { ShuffleOptionsSwitch } from "@/components/quiz/shuffle-options-switch"
import type { QuestionEditorProps, QuestionTypeDef } from "./registry"

function SingleChoiceEditor({
  question,
  onChange,
}: QuestionEditorProps<"single_choice">) {
  const correctId = question.options.find((option) => option.correct)?.id ?? ""

  return (
    <RadioGroup
      value={correctId}
      onValueChange={(next) =>
        onChange({
          ...question,
          options: question.options.map((option) => ({
            ...option,
            correct: option.id === next,
          })),
        })
      }
    >
      <OptionListEditor
        options={question.options}
        selection="one"
        onChange={(options) => onChange({ ...question, options })}
        action={<SelectionSwitch question={question} onChange={onChange} />}
        footerExtra={<ShuffleOptionsSwitch question={question} onChange={onChange} />}
      />
    </RadioGroup>
  )
}

export const singleChoiceType: QuestionTypeDef<"single_choice"> = {
  kind: "single_choice",
  label: "Multiple Choice",
  menuLabel: "Multiple Choice (one answer)",
  description: "Radio buttons, exactly one correct",
  icon: CircleDot,
  createDefault: () => createQuestion("single_choice"),
  Editor: SingleChoiceEditor,
}
