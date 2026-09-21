"use client"

import { createQuestion, type ChoiceOption } from "@workspace/quiz-core"
import { ListOrdered } from "lucide-react"

import { OptionListEditor } from "@/components/quiz/option-list-editor"
import type { QuestionEditorProps, QuestionTypeDef } from "./registry"

function OrderingEditor({ question, onChange }: QuestionEditorProps<"ordering">) {
  // Reuse the option list (drag reorder, keyboard reorder, images, paste) by
  // dressing items as options. `correct` is scaffolding for the round trip and
  // is stripped before it can reach the document - the strict schema would
  // reject a stray key.
  const asOptions: ChoiceOption[] = question.items.map((item) => ({
    id: item.id,
    labelDoc: item.labelDoc,
    correct: false,
  }))

  return (
    <OptionListEditor
      options={asOptions}
      selection="none"
      title="Items, in the correct order"
      itemNoun="Item"
      footerHint="Students see these shuffled and arrange them; this order is the answer"
      onChange={(options) =>
        onChange({
          ...question,
          items: options.map(({ id, labelDoc }) => ({ id, labelDoc })),
        })
      }
    />
  )
}

export const orderingType: QuestionTypeDef<"ordering"> = {
  kind: "ordering",
  label: "Ordering",
  menuLabel: "Ordering",
  description: "Arrange items into the right sequence",
  icon: ListOrdered,
  createDefault: () => createQuestion("ordering"),
  Editor: OrderingEditor,
}
