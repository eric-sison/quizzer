"use client"

import { createQuestion, FALSE_ID, TRUE_ID } from "@workspace/quiz-core"
import { ToggleLeft } from "lucide-react"
import { Label } from "@workspace/ui/components/label"
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group"

import { SectionHeader } from "@/components/quiz/section-header"
import type { QuestionEditorProps, QuestionTypeDef } from "./registry"

function TrueFalseEditor({ question, onChange }: QuestionEditorProps<"true_false">) {
  const value = question.correct ? TRUE_ID : FALSE_ID

  return (
    <div className="flex flex-col gap-2.5">
      <SectionHeader title="Answer" hint="Fixed pair, pick the correct one" />

      <RadioGroup
        value={value}
        onValueChange={(next) => onChange({ ...question, correct: next === TRUE_ID })}
      >
        {[
          { id: TRUE_ID, label: "True" },
          { id: FALSE_ID, label: "False" },
        ].map((choice) => (
          <div
            key={choice.id}
            data-correct={value === choice.id || undefined}
            className="flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors data-correct:border-primary/40 data-correct:bg-primary/5"
          >
            <Label>
              <RadioGroupItem value={choice.id} />
              {choice.label}
            </Label>
            {value === choice.id ? (
              <span className="ml-auto text-[10px] font-semibold tracking-wide text-primary">
                CORRECT
              </span>
            ) : null}
          </div>
        ))}
      </RadioGroup>

      {/* The model stores a boolean, so "exactly one correct" is unrepresentable
          rather than merely validated. */}
      <p className="text-xs text-muted-foreground">
        These two options are fixed: they cannot be renamed, reordered or removed.
      </p>
    </div>
  )
}

export const trueFalseType: QuestionTypeDef<"true_false"> = {
  kind: "true_false",
  label: "True / False",
  menuLabel: "True / False",
  description: "Two fixed options, one correct",
  icon: ToggleLeft,
  createDefault: () => createQuestion("true_false"),
  Editor: TrueFalseEditor,
}
