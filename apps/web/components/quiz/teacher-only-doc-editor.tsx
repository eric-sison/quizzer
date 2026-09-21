"use client"

import * as React from "react"
import { emptyRichDoc, type RichDoc } from "@workspace/quiz-core"
import { ChevronRight } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { RichTextEditor } from "@workspace/quiz-ui"

/**
 * A collapsible rich-text field for content that never reaches students - the
 * essay rubric and the per-question answer explanation. Collapsing it clears
 * the field: an empty teacher-only doc is noise in the stored document.
 */
export function TeacherOnlyDocEditor({
  label,
  value,
  placeholder,
  caption,
  onChange,
}: {
  label: string
  value: RichDoc | undefined
  placeholder: string
  /** Reminds the teacher this is stripped at publish. */
  caption: string
  onChange: (doc: RichDoc | undefined) => void
}) {
  const [open, setOpen] = React.useState(value !== undefined)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const next = !open
            setOpen(next)
            if (next && value === undefined) onChange(emptyRichDoc())
            if (!next) onChange(undefined)
          }}
        >
          <ChevronRight
            className={open ? "rotate-90 transition-transform" : "transition-transform"}
          />
          {label}
        </Button>
      </div>

      {open ? (
        <>
          <RichTextEditor
            value={value ?? emptyRichDoc()}
            onChange={onChange}
            placeholder={placeholder}
          />
          {/* Worth stating plainly: these fields are deliberately withheld
              from the published manifest. */}
          <p className="text-xs text-muted-foreground">{caption}</p>
        </>
      ) : null}
    </div>
  )
}
