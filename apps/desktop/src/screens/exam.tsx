import * as React from "react"
import { AlertTriangle, CloudOff, Lock, Timer } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type {
  AnswerValue,
  LockdownReport,
  Question,
  SessionSnapshot,
} from "@/lib/types"

type ExamProps = {
  snapshot: SessionSnapshot
  lockdown: LockdownReport | null
  remaining: number
  strikes: number
  strikeNotice: string | null
  unsaved: Set<string>
  submitting: boolean
  onAnswer: (questionId: string, value: AnswerValue) => void
  onSubmit: () => void
  onDismissStrike: () => void
}

function formatClock(totalSeconds: number) {
  const s = Math.max(0, totalSeconds)
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`
}

export function Exam({
  snapshot,
  lockdown,
  remaining,
  strikes,
  strikeNotice,
  unsaved,
  submitting,
  onAnswer,
  onSubmit,
  onDismissStrike,
}: ExamProps) {
  const manifest = snapshot.manifest
  const [confirming, setConfirming] = React.useState(false)

  if (!manifest) return null

  const answered = manifest.questions.filter(
    (q) => snapshot.answers[q.id] !== undefined
  ).length
  const urgent = remaining <= 300

  return (
    <div className="flex min-h-svh flex-col">
      <ExamHeader
        title={manifest.title}
        remaining={remaining}
        urgent={urgent}
        answered={answered}
        total={manifest.questions.length}
        lockdown={lockdown}
        strikes={strikes}
      />

      {strikeNotice ? (
        <StrikeBanner
          notice={strikeNotice}
          strikes={strikes}
          onDismiss={onDismissStrike}
        />
      ) : null}

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <ol className="flex flex-col gap-8">
          {manifest.questions.map((question, index) => (
            <li key={question.id}>
              <QuestionCard
                question={question}
                index={index}
                value={snapshot.answers[question.id]}
                unsaved={unsaved.has(question.id)}
                onAnswer={onAnswer}
              />
            </li>
          ))}
        </ol>

        <div className="mt-10 flex flex-col gap-3 border-t border-border pt-6">
          {unsaved.size > 0 ? (
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <CloudOff className="size-4" aria-hidden />
              {unsaved.size} answer{unsaved.size === 1 ? "" : "s"} couldn&apos;t
              be saved. Check the network before submitting.
            </p>
          ) : null}

          {confirming ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <p className="text-sm">
                Submit your exam? You&apos;ve answered{" "}
                <strong>
                  {answered} of {manifest.questions.length}
                </strong>{" "}
                questions. This cannot be undone.
              </p>
              <div className="flex gap-2">
                <Button size="lg" disabled={submitting} onClick={onSubmit}>
                  {submitting ? "Submitting…" : "Yes, submit"}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  disabled={submitting}
                  onClick={() => setConfirming(false)}
                >
                  Keep working
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="lg"
              className="self-start"
              onClick={() => setConfirming(true)}
            >
              Submit exam
            </Button>
          )}
        </div>
      </main>
    </div>
  )
}

function ExamHeader({
  title,
  remaining,
  urgent,
  answered,
  total,
  lockdown,
  strikes,
}: {
  title: string
  remaining: number
  urgent: boolean
  answered: number
  total: number
  lockdown: LockdownReport | null
  strikes: number
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-4 px-6 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium">{title}</h1>
          <p className="text-xs text-muted-foreground">
            {answered} of {total} answered
            {strikes > 0 ? ` · ${strikes} focus warning${strikes === 1 ? "" : "s"}` : ""}
          </p>
        </div>

        <LockdownBadge lockdown={lockdown} />

        <div
          className={cn(
            "flex items-center gap-1.5 font-mono text-sm tabular-nums",
            urgent && "text-destructive"
          )}
          role="timer"
          aria-live={urgent ? "polite" : "off"}
        >
          <Timer className="size-4" aria-hidden />
          {formatClock(remaining)}
        </div>
      </div>
    </header>
  )
}

/**
 * Shows the student that lockdown is on, and - deliberately - what it does not
 * cover. Overstating the protection would be the wrong thing to put in front of
 * someone being invigilated by it.
 */
function LockdownBadge({ lockdown }: { lockdown: LockdownReport | null }) {
  const [open, setOpen] = React.useState(false)

  if (!lockdown) return null

  return (
    <div className="relative">
      <Button
        size="sm"
        variant={lockdown.bypassed || lockdown.degraded ? "destructive" : "ghost"}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Lock aria-hidden />
        {lockdown.bypassed
          ? "Lockdown off"
          : lockdown.degraded
            ? "Exam mode (limited)"
            : "Exam mode"}
      </Button>

      {open ? (
        <div className="absolute top-full right-0 z-20 mt-2 w-80 rounded-lg border border-border bg-popover p-4 text-xs shadow-lg">
          <p className="mb-2 font-medium">Active in this exam</p>
          <ul className="mb-3 flex list-disc flex-col gap-1 pl-4 text-muted-foreground">
            {lockdown.engaged.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {lockdown.unavailable.length > 0 ? (
            <>
              <p className="mb-2 font-medium">Not enforced on this computer</p>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground">
                {lockdown.unavailable.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function StrikeBanner({
  notice,
  strikes,
  onDismiss,
}: {
  notice: string
  strikes: number
  onDismiss: () => void
}) {
  return (
    <div
      role="alert"
      className="border-b border-destructive/30 bg-destructive/10 px-6 py-3"
    >
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
        <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
        <p className="flex-1 text-sm">
          {notice} This has been recorded and your teacher will see it
          {strikes > 1 ? ` (${strikes} times so far)` : ""}.
        </p>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}

function QuestionCard({
  question,
  index,
  value,
  unsaved,
  onAnswer,
}: {
  question: Question
  index: number
  value: AnswerValue | undefined
  unsaved: boolean
  onAnswer: (questionId: string, value: AnswerValue) => void
}) {
  return (
    <article
      className={cn(
        "rounded-lg border border-border p-5",
        unsaved && "border-destructive/50"
      )}
    >
      <div className="mb-4 flex items-baseline gap-3">
        <span className="font-mono text-xs text-muted-foreground">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="flex-1">
          {/* Prompts are plain text from the API and rendered as text - never
              as HTML - so a malicious prompt cannot inject markup. */}
          <p className="text-sm leading-relaxed">{question.prompt}</p>
        </div>
        {question.points > 0 ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {question.points} pt{question.points === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      <AnswerInput question={question} value={value} onAnswer={onAnswer} />

      {unsaved ? (
        <p className="mt-3 text-xs text-destructive">Not saved yet - retrying.</p>
      ) : null}
    </article>
  )
}

function AnswerInput({
  question,
  value,
  onAnswer,
}: {
  question: Question
  value: AnswerValue | undefined
  onAnswer: (questionId: string, value: AnswerValue) => void
}) {
  if (question.kind === "short_text") {
    return (
      <textarea
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onAnswer(question.id, e.currentTarget.value)}
        rows={4}
        className="w-full resize-y rounded-lg border border-input bg-background p-3 text-sm outline-none select-text focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        placeholder="Type your answer…"
      />
    )
  }

  if (question.kind === "multiple_choice") {
    const selected = Array.isArray(value) ? value : []
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Select all that apply</legend>
        {question.choices.map((choice) => (
          <label
            key={choice.id}
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-input px-3 py-2.5 text-sm hover:bg-muted has-checked:border-ring has-checked:bg-muted"
          >
            <input
              type="checkbox"
              name={question.id}
              value={choice.id}
              checked={selected.includes(choice.id)}
              onChange={(e) => {
                const next = e.currentTarget.checked
                  ? [...selected, choice.id]
                  : selected.filter((id) => id !== choice.id)
                onAnswer(question.id, next)
              }}
              className="size-4 accent-primary"
            />
            {choice.label}
          </label>
        ))}
      </fieldset>
    )
  }

  // single_choice and true_false share the radio presentation.
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">Select one answer</legend>
      {question.choices.map((choice) => (
        <label
          key={choice.id}
          className="flex cursor-pointer items-center gap-3 rounded-lg border border-input px-3 py-2.5 text-sm hover:bg-muted has-checked:border-ring has-checked:bg-muted"
        >
          <input
            type="radio"
            name={question.id}
            value={choice.id}
            checked={value === choice.id}
            onChange={() => onAnswer(question.id, choice.id)}
            className="size-4 accent-primary"
          />
          {choice.label}
        </label>
      ))}
    </fieldset>
  )
}
