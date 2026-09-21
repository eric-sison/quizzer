"use client"

import { SquareCheckBig } from "lucide-react"

import { OptionListEditor } from "@/components/quiz/option-list-editor"
import { SelectionSwitch } from "@/components/quiz/selection-switch"
import type { QuestionEditorProps, QuestionTypeDef } from "./registry"

function MultipleChoiceEditor({
  question,
  onChange,
}: QuestionEditorProps<"multiple_choice">) {
  return (
    <OptionListEditor
      options={question.options}
      selection="many"
      onChange={(options) => onChange({ ...question, options })}
      action={<SelectionSwitch question={question} onChange={onChange} />}
    />
  )
}

export const multipleChoiceType: QuestionTypeDef<"multiple_choice"> = {
  kind: "multiple_choice",
  label: "Multiple Choice",
  menuLabel: "Multiple Choice (many answers)",
  description: "Checkboxes, one or more correct",
  icon: SquareCheckBig,
  Editor: MultipleChoiceEditor,
}
