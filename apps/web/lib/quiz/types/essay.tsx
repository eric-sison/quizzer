"use client"

import { createQuestion, type RichDoc } from "@workspace/quiz-core"
import { TextAlignStart } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

import { SectionHeader } from "@/components/quiz/section-header"
import { TeacherOnlyDocEditor } from "@/components/quiz/teacher-only-doc-editor"
import type { QuestionEditorProps, QuestionTypeDef } from "./registry"

function toBound(raw: string): number | undefined {
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

function EssayEditor({ question, onChange }: QuestionEditorProps<"essay">) {
  function setRubric(doc: RichDoc | undefined) {
    const next = { ...question }
    if (doc === undefined) delete next.rubricDoc
    else next.rubricDoc = doc
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-2.5">
      <SectionHeader
        title="Student answer"
        action={
          <Badge variant="muted">
            Graded manually
          </Badge>
        }
      />

      <div className="rounded-xl border border-dashed bg-muted/30 p-3.5">
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Students type into a plain text box in the exam app. There is no answer
          key for this type, so it never reaches the auto-grader.
        </p>

        <div className="flex flex-wrap items-center gap-4">
          <Label>
            Min words
            <span className="w-20">
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={question.minWords ?? ""}
              onChange={(event) => {
                const next = { ...question }
                const bound = toBound(event.currentTarget.value)
                if (bound === undefined) delete next.minWords
                else next.minWords = bound
                onChange(next)
              }}
            />
            </span>
          </Label>

          <Label>
            Max words
            <span className="w-20">
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              value={question.maxWords ?? ""}
              onChange={(event) => {
                const next = { ...question }
                const bound = toBound(event.currentTarget.value)
                if (bound === undefined) delete next.maxWords
                else next.maxWords = bound
                onChange(next)
              }}
            />
            </span>
          </Label>
        </div>
      </div>

      <TeacherOnlyDocEditor
        label="Marking rubric (teacher only)"
        value={question.rubricDoc}
        placeholder="What earns marks…"
        caption="Never sent to students. The rubric is stripped when the quiz is published."
        onChange={setRubric}
      />
    </div>
  )
}

export const essayType: QuestionTypeDef<"essay"> = {
  kind: "essay",
  label: "Essay",
  menuLabel: "Essay",
  description: "Free written response, graded manually",
  icon: TextAlignStart,
  createDefault: () => createQuestion("essay"),
  Editor: EssayEditor,
}
