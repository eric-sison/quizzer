"use client"

import * as React from "react"
import { createQuestion } from "@workspace/quiz-core"
import { Hash } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

import { SectionHeader } from "@/components/quiz/section-header"
import type { QuestionEditorProps, QuestionTypeDef } from "./registry"

function NumericEditor({ question, onChange }: QuestionEditorProps<"numeric">) {
  // Held as text while typing so "-", "1e" and "0." don't fight the field;
  // only parseable numbers reach the document.
  const [valueDraft, setValueDraft] = React.useState(
    question.correctValue === undefined ? "" : String(question.correctValue)
  )
  const [toleranceDraft, setToleranceDraft] = React.useState(String(question.tolerance))

  function commitValue(raw: string) {
    setValueDraft(raw)
    const parsed = Number.parseFloat(raw)
    const next = { ...question }
    if (Number.isFinite(parsed)) next.correctValue = parsed
    else delete next.correctValue
    onChange(next)
  }

  function commitTolerance(raw: string) {
    setToleranceDraft(raw)
    const parsed = Number.parseFloat(raw)
    if (Number.isFinite(parsed) && parsed >= 0) {
      onChange({ ...question, tolerance: parsed })
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <SectionHeader
        title="Correct answer"
        action={<Badge variant="muted">Graded automatically</Badge>}
      />

      <div className="rounded-xl border border-dashed bg-muted/30 p-3.5">
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Students type a number. Any answer within the tolerance of the correct
          value counts; neither is ever sent to the exam app.
        </p>

        <div className="flex flex-wrap items-center gap-4">
          <Label>
            Correct value
            <span className="w-28">
              <Input
                type="text"
                inputMode="decimal"
                value={valueDraft}
                onChange={(event) => commitValue(event.currentTarget.value)}
                placeholder="e.g. 100"
              />
            </span>
          </Label>

          <Label>
            Tolerance (±)
            <span className="w-24">
              <Input
                type="text"
                inputMode="decimal"
                value={toleranceDraft}
                onChange={(event) => commitTolerance(event.currentTarget.value)}
                placeholder="0"
              />
            </span>
          </Label>

          <Label>
            Unit (optional)
            <span className="w-24">
              <Input
                value={question.unit ?? ""}
                maxLength={20}
                onChange={(event) => {
                  const unit = event.currentTarget.value
                  const next = { ...question }
                  if (unit === "") delete next.unit
                  else next.unit = unit
                  onChange(next)
                }}
                placeholder="°C"
              />
            </span>
          </Label>
        </div>
      </div>
    </div>
  )
}

export const numericType: QuestionTypeDef<"numeric"> = {
  kind: "numeric",
  label: "Numeric",
  menuLabel: "Numeric",
  description: "A number, graded with a tolerance",
  icon: Hash,
  createDefault: () => createQuestion("numeric"),
  Editor: NumericEditor,
}
