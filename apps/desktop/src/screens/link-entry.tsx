import * as React from "react"
import { AlertCircle, Info, Loader2, Lock, ShieldCheck } from "lucide-react"

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

  const canBegin = Boolean(info) && !busy
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
            <ExamConfigCard preview={preview} />
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
function ExamConfigCard({ preview }: { preview: LinkPreview }) {
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
