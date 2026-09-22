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
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group"
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
          <Button
            variant="outline"
            size="icon"
            aria-label="Quiz settings"
            title="Quiz settings"
          />
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

          <OpensAtField
            opensAt={settings.opensAt}
            onCommit={(opensAt) => {
              const next = { ...settings }
              // Deleted rather than set to undefined: the schema is strict and
              // "no opening time" is the absence of the key, not a key holding
              // nothing.
              if (opensAt) next.opensAt = opensAt
              else delete next.opensAt
              onChange(next)
            }}
          />

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
 * When the link starts working.
 *
 * Two options rather than a nullable field with a disabled input, because
 * they are two different intentions: "the moment I publish" and "at this
 * time". Each says what it does to a student, since that is what is being
 * chosen between. Choosing a time seeds the box with tomorrow morning rather
 * than empty, so the common case is one edit and not four.
 *
 * `datetime-local` reads and writes the teacher's own wall clock; the document
 * stores an instant. The conversion happens here, at the edge, so nothing
 * downstream has to wonder whose 9am a stored time means.
 */
function OpensAtField({
  opensAt,
  onCommit,
}: {
  opensAt: string | undefined
  onCommit: (opensAt: string | undefined) => void
}) {
  const scheduled = opensAt !== undefined
  // Held locally while typing: a half-finished datetime is not a time, and
  // committing one would put an unparseable value in the document.
  const [draft, setDraft] = React.useState<string | null>(null)

  function handleChange(raw: string) {
    setDraft(raw)
    const at = new Date(raw)
    if (raw && !Number.isNaN(at.getTime())) {
      setDraft(null)
      onCommit(at.toISOString())
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Opens</Label>

      <RadioGroup
        value={scheduled ? "scheduled" : "immediately"}
        onValueChange={(mode) =>
          onCommit(mode === "scheduled" ? defaultOpensAt() : undefined)
        }
      >
        <OpensOption
          value="immediately"
          selected={!scheduled}
          label="As soon as published"
          hint="The link works the moment you publish."
        />

        <OpensOption
          value="scheduled"
          selected={scheduled}
          label="At a set time"
          hint="A student who opens the link before then is told the exam has not opened yet."
        >
          {/* Inside the option it belongs to, so the time and the choice that
              needs one cannot be read apart. */}
          <Input
            id="quiz-opens-at"
            type="datetime-local"
            aria-label="Opening time"
            value={draft ?? toLocalInput(opensAt)}
            onChange={(event) => handleChange(event.currentTarget.value)}
            onBlur={() => setDraft(null)}
            aria-invalid={draft !== null || undefined}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Your own time zone.
          </p>
        </OpensOption>
      </RadioGroup>
    </div>
  )
}

/**
 * One choice, its consequence, and - when it has one - the field it needs.
 *
 * The hint is part of the option rather than a line under the group because
 * the two options differ in what they do to a student, not in their wording,
 * and that is the thing being chosen between.
 */
function OpensOption({
  value,
  selected,
  label,
  hint,
  children,
}: {
  value: string
  selected: boolean
  label: string
  hint: string
  children?: React.ReactNode
}) {
  const id = `quiz-opens-${value}`

  return (
    <div
      data-selected={selected || undefined}
      className="rounded-lg border px-3 py-2.5 transition-colors data-selected:border-primary/40 data-selected:bg-primary/5"
    >
      {/* Associated by id rather than by wrapping, so the row's layout lives on
          these plain elements and the shared Label and RadioGroupItem are used
          as the design system ships them. */}
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex">
          <RadioGroupItem id={id} value={value} />
        </span>
        <div className="flex flex-col gap-1">
          <Label htmlFor={id}>{label}</Label>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>

      {selected && children ? <div className="mt-2.5 pl-6">{children}</div> : null}
    </div>
  )
}

/** Tomorrow at 9am, local - a sensible thing to be adjusting rather than an
 *  empty box to be filled in from nothing. */
function defaultOpensAt(): string {
  const at = new Date()
  at.setDate(at.getDate() + 1)
  at.setHours(9, 0, 0, 0)
  return at.toISOString()
}

/** An instant as the local wall-clock text `datetime-local` expects. */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return ""
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}`
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
