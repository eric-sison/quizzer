"use client"

import { createQuestion, withDerivedPoints } from "@workspace/quiz-core"
import { SquareCheckBig } from "lucide-react"

import { ScoringEditor } from "@/components/quiz/scoring-editor"
import { OptionListEditor } from "@/components/quiz/option-list-editor"
import { SelectionSwitch } from "@/components/quiz/selection-switch"
import { ShuffleOptionsSwitch } from "@/components/quiz/shuffle-options-switch"
import type { QuestionEditorProps, QuestionTypeDef } from "./registry"

function MultipleChoiceEditor({
  question,
  onChange,
}: QuestionEditorProps<"multiple_choice">) {
  /**
   * Every edit that can move the total leaves through here, so `points` never
   * disagrees with the answers it is derived from. Marking an option correct,
   * deleting one, retyping a value and switching mode all qualify - which is
   * every change this editor makes, so the wrapper sits on the whole block
   * rather than being remembered at each call site.
   */
  function emit(next: Parameters<typeof onChange>[0]) {
    onChange(next.kind === "multiple_choice" ? withDerivedPoints(next) : next)
  }

  return (
    <div className="flex flex-col gap-5">
      <OptionListEditor
        options={question.options}
        selection="many"
        optionPoints={question.scoring === "per_option"}
        onChange={(options) => emit({ ...question, options })}
        action={<SelectionSwitch question={question} onChange={emit} />}
        footerExtra={<ShuffleOptionsSwitch question={question} onChange={emit} />}
      />

      <ScoringEditor question={question} onChange={emit} />
    </div>
  )
}

export const multipleChoiceType: QuestionTypeDef<"multiple_choice"> = {
  kind: "multiple_choice",
  label: "Multiple Choice",
  menuLabel: "Multiple Choice (many answers)",
  description: "Checkboxes, one or more correct",
  icon: SquareCheckBig,
  createDefault: () => createQuestion("multiple_choice"),
  Editor: MultipleChoiceEditor,
}
