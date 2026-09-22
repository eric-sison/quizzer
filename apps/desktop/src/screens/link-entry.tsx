import * as React from "react"
import {
  AlertCircle,
  CalendarClock,
  Info,
  Loader2,
  Lock,
  ShieldCheck,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { previewLink, quitApp, validateLink } from "@/lib/ipc"
import {
  toAppError,
  type AppError,
  type LinkInfo,
  type LinkPreview,
} from "@/lib/types"

type LinkEntryProps = {
  onBegin: (link: string) => void
  busy: boolean
  /** Carried over from a failed start attempt, so the student sees why. */
  error: AppError | null
}

export function LinkEntry({ onBegin, busy, error }: LinkEntryProps) {
  const [value, setValue] = React.useState("")
  const [info, setInfo] = React.useState<LinkInfo | null>(null)
  const [preview, setPreview] = React.useState<LinkPreview | null>(null)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [localError, setLocalError] = React.useState<string | null>(null)

  // Validate as they type - entirely offline, checking only the link's shape
  // and origin. Once that passes, ask the server (through Rust) for the exam's
  // configuration, so the student sees what they are about to start before
  // committing to lockdown.
  React.useEffect(() => {
    const raw = value.trim()
    setInfo(null)
    setPreview(null)
    setPreviewError(null)
    setLocalError(null)
    if (!raw) return

    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const result = await validateLink(raw)
        if (cancelled) return
        setInfo(result)
      } catch (raw_) {
        if (!cancelled) setLocalError(toAppError(raw_).message)
        return
      }

      try {
        const config = await previewLink(raw)
        if (!cancelled) setPreview(config)
      } catch (raw_) {
        if (cancelled) return
        const appError = toAppError(raw_)
        // A dead network must not block starting - the preview is a courtesy.
        // A verdict about this link (revoked, expired, not open yet) is worth
        // hearing before the student presses Begin.
        if (!appError.retryable) setPreviewError(appError.message)
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [value])

  // The absence of `opens_at`, not a comparison against this machine's clock,
  // is what says the exam may be started. The server decides that and says so
  // in the shape of its answer.
  const shut = preview?.exam.opens_at !== undefined
  const opensIn = useOpensIn(preview)
  const dueToOpen = shut && opensIn !== null && opensIn <= 0

  // The wait is over by our reckoning. Ask the server rather than enabling the
  // button on the strength of a countdown, and keep asking: a clock a few
  // seconds fast would otherwise offer a Begin that is refused on press.
  React.useEffect(() => {
    if (!dueToOpen) return
    const raw = value.trim()
    if (!raw) return

    let cancelled = false
    const recheck = async () => {
      try {
        const config = await previewLink(raw)
        if (!cancelled) setPreview(config)
      } catch {
        // Keep the card we have. The wait it describes is still true, and
        // blanking the screen because one poll missed helps nobody.
      }
    }

    void recheck()
    const timer = window.setInterval(() => void recheck(), 5_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [dueToOpen, value])

  const canBegin = Boolean(info) && !busy && !shut
  const message = error?.message ?? localError

  return (
    <main className="flex min-h-svh items-center justify-center p-8">
      <div className="flex w-full max-w-lg flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="size-6 text-primary" aria-hidden />
          </span>
          <h1 className="font-heading text-2xl font-medium">Start your exam</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Paste the link your teacher gave you.
          </p>
        </div>

        <form
          className="flex flex-col gap-3 rounded-xl border bg-card p-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (canBegin) onBegin(value.trim())
          }}
        >
          <label htmlFor="quiz-link" className="text-sm font-medium">
            Quiz link
          </label>
          <Input
            id="quiz-link"
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            placeholder="https://…/e/your-exam-code"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            disabled={busy}
            aria-invalid={Boolean(message) || undefined}
            aria-describedby={message ? "quiz-link-error" : undefined}
            className="h-11 font-mono"
          />

          {message ? (
            <Notice id="quiz-link-error" tone="bad">
              {message}
            </Notice>
          ) : previewError ? (
            // A verdict about the link itself - closed, revoked, not open yet.
            // Worth reading before pressing Begin, and the reason the preview
            // runs at all.
            <Notice tone="bad">{previewError}</Notice>
          ) : preview ? (
            <ExamConfigCard preview={preview} opensIn={opensIn} />
          ) : info ? (
            <Notice tone="ok">
              Ready to connect to <span className="font-mono">{info.host}</span>{" "}
              (exam {info.token_preview})
            </Notice>
          ) : (
            <Notice tone="quiet">
              The link is checked before anything is sent.
            </Notice>
          )}

          <Button type="submit" size="lg" disabled={!canBegin} className="mt-1 w-full">
            {busy ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Connecting…
              </>
            ) : (
              "Begin exam"
            )}
          </Button>

          {/* Beside the button that causes it, not in the page's opening
              paragraph: this is what pressing Begin does, and it is the last
              thing worth reading before doing it. */}
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            The exam opens in a locked window. You will not be able to switch to
            other apps until you submit.
          </p>
        </form>

        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void quitApp()}
          >
            Quit
          </Button>
        </div>
      </div>
    </main>
  )
}

/**
 * Seconds until the link opens, or null when it is already open.
 *
 * Measured against the server's clock, not this machine's. The server sends
 * its own time with the preview and the offset between the two is fixed when
 * that answer arrives, so a clock that is wrong by hours, or changed halfway
 * through the wait, moves the countdown by nothing. The tick itself is local,
 * which is fine: a drifting tick is a second here or there.
 *
 * It is not a security control - the server refuses an early session claim
 * whatever this says. It is so a screen somebody is sitting and watching does
 * not tell them the wrong thing.
 */
function useOpensIn(preview: LinkPreview | null): number | null {
  const opensAt = preview?.exam.opens_at
  const serverTime = preview?.exam.server_time
  const [seconds, setSeconds] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (opensAt === undefined) return

    // Fixed here, when the answer carrying it arrives, rather than on every
    // tick: a clock changed halfway through the wait then moves the countdown
    // by nothing. Reading the clock belongs in an effect, which is also why
    // the first value is scheduled rather than assigned during render.
    const skewMs =
      serverTime === undefined ? 0 : serverTime * 1_000 - Date.now()

    const tick = () =>
      setSeconds(
        Math.max(0, Math.round((opensAt * 1_000 - (Date.now() + skewMs)) / 1_000))
      )

    const first = window.setTimeout(tick, 0)
    const timer = window.setInterval(tick, 1_000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [opensAt, serverTime])

  // Gated on the link rather than cleared, so a stale count from a previous
  // link can never be read as this one's.
  return opensAt === undefined ? null : seconds
}

/**
 * One line under the field, in the three flavours it comes in.
 *
 * They all occupy the same place and are told apart by an icon as well as a
 * colour, because this screen is read in a hurry by someone who has just been
 * handed a link, and "is that red or grey" is not a question worth asking.
 */
function Notice({
  id,
  tone,
  children,
}: {
  id?: string
  tone: "bad" | "ok" | "quiet"
  children: React.ReactNode
}) {
  const Icon = tone === "bad" ? AlertCircle : tone === "ok" ? ShieldCheck : Info

  return (
    <p
      id={id}
      role={tone === "bad" ? "alert" : undefined}
      className={
        tone === "bad"
          ? "flex items-start gap-2 text-sm text-destructive"
          : "flex items-start gap-2 text-sm text-muted-foreground"
      }
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

/**
 * When the link opens, and how long that is from now.
 *
 * Neutral rather than alarming: an exam that has not started yet is not a
 * problem with the link, and colouring it like one would send a student back
 * to their teacher asking for a new one. The clock icon and the disabled
 * button carry the state; the words carry the detail.
 */
function OpensAtNotice({
  at,
  opensIn,
}: {
  /** Epoch seconds. */
  at: number
  opensIn: number | null
}) {
  const due = opensIn !== null && opensIn <= 0

  return (
    <div className="flex items-start gap-2.5 rounded-md border bg-background p-3">
      <CalendarClock
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-medium">
          {due ? "Opening now" : `Opens ${formatOpening(new Date(at * 1_000))}`}
        </p>
        <p className="text-xs text-muted-foreground">
          {due
            ? "Checking with the server."
            : opensIn === null
              ? "You can leave this window open."
              : `That is ${formatWait(opensIn)} from now. You can leave this window open: Begin turns on by itself.`}
        </p>
      </div>
    </div>
  )
}

/**
 * The opening time, dated only as far as it needs to be. "tomorrow at 9:00 AM"
 * is read at a glance; "Wed 23 Sep 2026 at 9:00 AM" has to be worked out
 * against what day it is now, which is work the screen can do instead.
 */
function formatOpening(at: Date): string {
  const time = at.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })

  const days = calendarDaysAhead(at)
  if (days === 0) return `today at ${time}`
  if (days === 1) return `tomorrow at ${time}`

  const date = at.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(days > 300 ? { year: "numeric" } : {}),
  })
  return `${date} at ${time}`
}

/**
 * Whole calendar days between today and `at`, which is not the same as the
 * hours between them: 11pm to 1am is two hours and one sleep, and "tomorrow"
 * is what a student would call it.
 */
function calendarDaysAhead(at: Date): number {
  const midnight = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((midnight(at) - midnight(new Date())) / 86_400_000)
}

/**
 * The wait, at the precision it is worth stating.
 *
 * Seconds matter in the last minute and are noise in the last day. "1 d 3 h
 * 27 min 14 s" is a figure nobody reads, and it rewrites itself every second
 * on a screen somebody may be sitting in front of for an hour.
 */
function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} s`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rest = minutes % 60
    return rest ? `${hours} h ${rest} min` : `${hours} h`
  }

  const days = Math.floor(hours / 24)
  const rest = hours % 24
  return rest ? `${days} d ${rest} h` : `${days} d`
}

function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/**
 * What the student is about to sit, before they commit to lockdown: the exam's
 * configuration, never its questions - the server does not reveal those until
 * a session is claimed.
 */
function ExamConfigCard({
  preview,
  opensIn,
}: {
  preview: LinkPreview
  /** Seconds left of the wait, or null once the link is open. */
  opensIn: number | null
}) {
  const { exam } = preview
  const rows: Array<[string, string]> = [
    ["Questions", String(exam.question_count)],
    ["Time limit", formatDuration(exam.duration_s)],
    ["Going back", exam.allow_backtracking ? "Allowed" : "Not allowed"],
    ["Question order", exam.shuffle_questions ? "Shuffled" : "As written"],
  ]

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
      <div className="flex flex-col gap-1">
        <p className="font-medium">{exam.title}</p>
        {exam.description ? (
          <p className="text-xs whitespace-pre-line text-muted-foreground">
            {exam.description}
          </p>
        ) : null}
      </div>

      {/* Above the configuration rather than instead of it. A student who has
          just pasted a link wants to know three things, and "not open yet" on
          its own answers one: they also want to see that this is the exam they
          were expecting, and how long the wait is in terms they can act on. */}
      {exam.opens_at !== undefined ? (
        <OpensAtNotice at={exam.opens_at} opensIn={opensIn} />
      ) : null}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
        {rows.map(([label, valueText]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">
              {label}
            </dt>
            <dd className="text-sm">{valueText}</dd>
          </div>
        ))}
      </dl>

      <p className="flex items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
        Ready to connect to <span className="font-mono">{preview.host}</span>{" "}
        (exam {preview.token_preview})
      </p>
    </div>
  )
}
