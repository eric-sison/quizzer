import { CheckCircle2, Timer } from "lucide-react"

import { countAnswered } from "@workspace/quiz-core"
import { Button } from "@workspace/ui/components/button"
import { quitApp } from "@/lib/ipc"
import type { EndedBy } from "@/hooks/use-exam-session"

import type { Receipt, SessionSnapshot } from "@/lib/types"

/**
 * Terminal screen. There is deliberately no way back to the exam from here -
 * the session is spent, and lockdown has already been released so the student
 * can quit normally.
 *
 * What it shows is what this app can actually vouch for: what went in, when,
 * and under what reference. It shows no mark, because nothing here grades an
 * attempt - the answer key never leaves the server. Saying so plainly is part
 * of the screen's job: a student who has just finished an exam will look for a
 * score, and silence would read as a missing one.
 */
export function Submitted({
  receipt,
  snapshot,
  endedBy,
}: {
  receipt: Receipt | null
  snapshot: SessionSnapshot | null
  endedBy: EndedBy
}) {
  const questions = snapshot?.manifest?.questions ?? []
  // The receipt's count is the authority on how big the paper was; the local
  // manifest is a fallback for a receipt that never arrived.
  const total = receipt?.question_count ?? questions.length
  const answered = countAnswered(questions, snapshot?.answers ?? {})
  const missed = Math.max(0, total - answered)
  const timedOut = endedBy === "time_up"

  return (
    <main className="flex min-h-svh items-center justify-center p-8">
      <div className="flex w-full max-w-lg flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span
            className={
              timedOut
                ? "flex size-12 items-center justify-center rounded-full bg-muted"
                : "flex size-12 items-center justify-center rounded-full bg-primary/10"
            }
          >
            {timedOut ? (
              <Timer className="size-6 text-muted-foreground" aria-hidden />
            ) : (
              <CheckCircle2 className="size-6 text-primary" aria-hidden />
            )}
          </span>

          <h1 className="font-heading text-2xl font-medium">
            {timedOut ? "Time's up - exam submitted" : "Exam submitted"}
          </h1>

          {snapshot?.manifest?.title ? (
            <p className="text-sm font-medium">{snapshot.manifest.title}</p>
          ) : null}

          <p className="max-w-sm text-sm text-muted-foreground">
            {timedOut
              ? "The clock ran out and your paper went in as it stood. Everything you answered is recorded."
              : "Your answers are recorded. Exam mode has been turned off and you can close this window."}
          </p>
        </div>

        <section
          className="w-full rounded-xl border border-border"
          aria-label="What was submitted"
        >
          <div className="flex flex-col gap-3 border-b border-border p-5">
            <div className="flex items-baseline gap-2">
              <span className="font-heading text-3xl font-medium tabular-nums">
                {answered}
              </span>
              <span className="text-sm text-muted-foreground">
                of {total} answered
              </span>
            </div>

            <Progress answered={answered} total={total} />

            {/* Stated, not hidden: an unfinished paper is the common shape of a
                timed-out attempt, and the student should leave knowing exactly
                what went in rather than guessing later. */}
            <p className="text-xs text-muted-foreground">
              {missed === 0
                ? "Every question was answered."
                : `${missed} question${missed === 1 ? "" : "s"} left unanswered.`}
            </p>
          </div>

          <dl className="flex flex-col gap-2 p-5 text-xs">
            <Row label="Submitted" value={formatSubmittedAt(receipt)} />
            <Row
              label="Receipt"
              value={receipt?.receipt_id ?? "Not issued"}
              mono
            />
          </dl>
        </section>

        <p className="max-w-sm text-center text-xs text-muted-foreground">
          No mark is shown here. Your teacher releases results separately - keep
          the receipt number if you need to ask about this attempt.
        </p>

        <Button size="lg" onClick={() => void quitApp()}>
          Close
        </Button>
      </div>
    </main>
  )
}

/**
 * How much of the paper was answered. `aria-hidden` because the same figures
 * are already read out above it as text: a screen reader should hear the count
 * once, not twice.
 */
function Progress({ answered, total }: { answered: number; total: number }) {
  const percent = total > 0 ? Math.round((answered / total) * 100) : 0

  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      aria-hidden
    >
      <div
        className="h-full rounded-full bg-primary transition-[width]"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "truncate font-mono" : "truncate"}>{value}</dd>
    </div>
  )
}

function formatSubmittedAt(receipt: Receipt | null): string {
  if (!receipt) return "Not recorded"
  return new Date(receipt.submitted_at * 1000).toLocaleString()
}
