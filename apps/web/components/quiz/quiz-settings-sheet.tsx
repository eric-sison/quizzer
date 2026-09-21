"use client"

import * as React from "react"
import type { QuizSettings } from "@workspace/quiz-core"
import { Settings2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@workspace/ui/components/sheet"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"

/** Bounds mirror quizSettingsSchema's durationS range of 1s-24h. */
const MAX_DURATION_MIN = 1_440

/**
 * Quiz-level settings live in a sheet behind one button, so the default editor
 * view stays about questions. Every change dispatches immediately and rides the
 * same autosave as the rest of the document - closing the sheet is not a save.
 */
export function QuizSettingsSheet({
  settings,
  description,
  onChange,
  onDescriptionChange,
}: {
  settings: QuizSettings
  description: string
  onChange: (next: QuizSettings) => void
  onDescriptionChange: (description: string) => void
}) {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="outline" size="icon" aria-label="Quiz settings" />
        }
      >
        <Settings2 />
      </SheetTrigger>

      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Quiz settings</SheetTitle>
          <SheetDescription>
            These apply to the whole exam. Changes save with the draft and take
            effect when you publish.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quiz-description">Description</Label>
            <Textarea
              id="quiz-description"
              value={description}
              maxLength={2000}
              rows={3}
              placeholder="What this exam covers, what to bring…"
              onChange={(event) => onDescriptionChange(event.currentTarget.value)}
            />
            <p className="text-xs text-muted-foreground">
              Shown to students on the exam link page. Don&apos;t put answers here.
            </p>
          </div>

          <DurationField
            durationS={settings.durationS}
            onCommit={(durationS) => onChange({ ...settings, durationS })}
          />

          <SettingRow
            label="Allow backtracking"
            hint="Students can return to earlier questions with Previous."
            checked={settings.allowBacktracking}
            onCheckedChange={(allowBacktracking) =>
              onChange({ ...settings, allowBacktracking })
            }
          />

          <SettingRow
            label="Shuffle questions"
            hint="Each student sees the questions in a different order."
            checked={settings.shuffleQuestions}
            onCheckedChange={(shuffleQuestions) =>
              onChange({ ...settings, shuffleQuestions })
            }
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Minutes in the UI, seconds in the document. The field holds invalid text
 * (empty, zero, out of range) locally while the teacher types and only commits
 * values the schema accepts, because a draft with an impossible duration would
 * be rejected by the API and jam autosave.
 */
function DurationField({
  durationS,
  onCommit,
}: {
  durationS: number
  onCommit: (durationS: number) => void
}) {
  const minutes = Math.max(1, Math.round(durationS / 60))
  const [draft, setDraft] = React.useState<string | null>(null)

  function handleChange(raw: string) {
    const value = Number.parseInt(raw, 10)
    if (Number.isInteger(value) && value >= 1 && value <= MAX_DURATION_MIN) {
      setDraft(null)
      onCommit(value * 60)
    } else {
      setDraft(raw)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="quiz-duration">Time limit (minutes)</Label>
      <div className="w-28">
        <Input
          id="quiz-duration"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_DURATION_MIN}
          value={draft ?? String(minutes)}
          onChange={(event) => handleChange(event.currentTarget.value)}
          onBlur={() => setDraft(null)}
          aria-invalid={draft !== null || undefined}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        The exam submits itself when time runs out. Between 1 minute and 24
        hours.
      </p>
    </div>
  )
}

function SettingRow({
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  label: string
  hint: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}
