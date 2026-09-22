import * as React from "react"
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Loader2,
  Lock,
  Timer,
} from "lucide-react"
import { countAnswered } from "@workspace/quiz-core"
import { QuestionView, seededShuffle } from "@workspace/quiz-ui"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { AnswerValue, LockdownReport, SessionSnapshot } from "@/lib/types"

type ExamProps = {
  snapshot: SessionSnapshot
  lockdown: LockdownReport | null
  remaining: number
  strikes: number
  strikeNotice: string | null
  unsaved: Set<string>
  submitting: boolean
  /** The deadline has passed and the submit is on its way. */
  timeUp: boolean
  /** When the freeze began, for deciding it has gone on too long. */
  timeUpAt: number | null
  onAnswer: (questionId: string, value: AnswerValue) => void
  onSubmit: () => void
  onDismissStrike: () => void
}

/**
 * How long the submit may take before the student is told something is wrong.
 * Long enough to cover a slow network and the retry behind it, short enough
 * that nobody sits in front of an unexplained spinner.
 */
const STALLED_SUBMIT_MS = 10_000

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
  timeUp,
  timeUpAt,
  onAnswer,
  onSubmit,
  onDismissStrike,
}: ExamProps) {
  const manifest = snapshot.manifest
  const [at, setAt] = React.useState(0)
  const [confirming, setConfirming] = React.useState(false)

  // One random seed per exam sitting drives both question order and per-
  // question option order, so navigation never reshuffles anything. Caveat: a
  // crash-resume remounts this screen and re-seeds; SessionSnapshot exposes no
  // session-stable field to derive from yet, and a fresh order on restart is
  // an acceptable v1 trade.
  const [seed] = React.useState(() => Math.random().toString(36).slice(2))
  const questions = React.useMemo(() => {
    if (!manifest) return []
    return manifest.shuffle_questions
      ? seededShuffle(manifest.questions, seed)
      : manifest.questions
  }, [manifest, seed])

  if (!manifest) return null

  const total = questions.length
  const question = questions[at]
  // Counted through the shared rule rather than by presence in the answers
  // map, so the figure in the header is the one the results screen will show.
  const answered = countAnswered(questions, snapshot.answers)
  const urgent = remaining <= 300
  const last = at >= total - 1

  return (
    <div className="flex h-svh flex-col">
      <ExamHeader
        title={manifest.title}
        remaining={remaining}
        urgent={urgent}
        answered={answered}
        total={total}
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

      {timeUp ? <TimeUpBanner /> : null}

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-10">
          {question ? (
            <>
              {/* The same component the teacher's preview renders, so what they
                  checked before publishing is what a student sits. */}
              <QuestionView
                key={question.id}
                question={question}
                index={at}
                total={total}
                answer={{
                  value: snapshot.answers[question.id],
                  onChange: (value) => onAnswer(question.id, value),
                  // Past the deadline the server refuses writes. Letting the
                  // inputs stay live would invite a student to type an answer
                  // that was never going to count.
                  readOnly: timeUp,
                }}
                // Data URIs Rust fetched at session start; the webview has no
                // network, so an id missing here renders no image at all.
                resolveImageSrc={(imageId) => snapshot.images[imageId]}
                shuffleSeed={seed}
              />

              {unsaved.has(question.id) ? (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <CloudOff className="size-3.5" aria-hidden />
                  This answer is not saved yet. It is being retried.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              This exam has no questions. Tell your teacher.
            </p>
          )}
        </div>
      </main>

      <footer className="shrink-0 border-t border-border">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-6 py-4">
          {timeUp ? (
            <FinishingUp
              since={timeUpAt}
              submitting={submitting}
              onRetry={onSubmit}
            />
          ) : confirming ? (
            <SubmitConfirmation
              answered={answered}
              total={total}
              unsaved={unsaved.size}
              submitting={submitting}
              onSubmit={onSubmit}
              onCancel={() => setConfirming(false)}
            />
          ) : (
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="lg"
                disabled={at === 0 || !manifest.allow_backtracking}
                onClick={() => setAt((i) => Math.max(0, i - 1))}
              >
                <ChevronLeft aria-hidden />
                Previous
              </Button>

              <span className="text-xs text-muted-foreground" aria-live="polite">
                Question {at + 1} of {total}
                {manifest.allow_backtracking ? "" : ", you cannot go back"}
              </span>

              <div className="flex-1" />

              {last ? (
                <Button size="lg" onClick={() => setConfirming(true)}>
                  Submit exam
                </Button>
              ) : (
                <Button
                  size="lg"
                  onClick={() => setAt((i) => Math.min(total - 1, i + 1))}
                >
                  Next
                  <ChevronRight aria-hidden />
                </Button>
              )}
            </div>
          )}
        </div>
      </footer>
    </div>
  )
}

/**
 * Submitting is the one irreversible thing a student can do here, so it states
 * what they are about to leave behind: unanswered questions, and anything that
 * has not reached the server.
 */
function SubmitConfirmation({
  answered,
  total,
  unsaved,
  submitting,
  onSubmit,
  onCancel,
}: {
  answered: number
  total: number
  unsaved: number
  submitting: boolean
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <p className="text-sm">
        Submit your exam? You have answered{" "}
        <strong>
          {answered} of {total}
        </strong>{" "}
        questions. This cannot be undone.
      </p>

      {unsaved > 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <CloudOff className="size-4" aria-hidden />
          {unsaved} answer{unsaved === 1 ? "" : "s"} still being retried. Wait for
          the network if you can.
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button size="lg" disabled={submitting} onClick={onSubmit}>
          {submitting ? "Submitting…" : "Yes, submit"}
        </Button>
        <Button size="lg" variant="outline" disabled={submitting} onClick={onCancel}>
          Keep working
        </Button>
      </div>
    </div>
  )
}

/**
 * The footer between the deadline passing and the results screen arriving.
 *
 * Normally a second or two. When it is not - the machine is offline, or the
 * server is unreachable - it says so and offers the button, because a spinner
 * that never resolves tells a student who has just lost their exam nothing at
 * all. The retry is the same submit the deadline watcher is attempting on its
 * own; pressing it only makes the next attempt sooner.
 */
function FinishingUp({
  since,
  submitting,
  onRetry,
}: {
  since: number | null
  submitting: boolean
  onRetry: () => void
}) {
  const [stalled, setStalled] = React.useState(false)

  React.useEffect(() => {
    if (since === null) return
    // Measured from when the freeze began rather than from this mount, so a
    // re-render does not restart the student's patience.
    const id = window.setTimeout(
      () => setStalled(true),
      Math.max(0, since + STALLED_SUBMIT_MS - Date.now())
    )
    return () => window.clearTimeout(id)
  }, [since])

  if (!stalled) {
    return (
      <p
        className="flex items-center gap-2 text-sm text-muted-foreground"
        aria-live="polite"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Finishing your exam. This takes a moment.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <p className="flex items-start gap-2 text-sm">
        <CloudOff className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <span>
          Your exam is still being submitted. It is retrying by itself - the
          answers you saved are already on the server. Tell your teacher if this
          does not clear.
        </span>
      </p>
      <div>
        <Button size="lg" disabled={submitting} onClick={onRetry}>
          {submitting ? "Submitting…" : "Try again now"}
        </Button>
      </div>
    </div>
  )
}

/**
 * Shown between the deadline passing and the results screen arriving.
 *
 * It says the work is safe, because that is the question a student actually
 * has at this moment: the paper has frozen under them and they did not press
 * anything.
 */
function TimeUpBanner() {
  return (
    <div
      className="border-b border-border bg-muted/60 px-6 py-3"
      role="status"
      aria-live="assertive"
    >
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2.5 text-sm">
        <Timer className="size-4 shrink-0" aria-hidden />
        <p>
          <strong className="font-medium">Time is up.</strong> Your answers are
          being submitted as they stand - there is nothing left to do.
        </p>
      </div>
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

