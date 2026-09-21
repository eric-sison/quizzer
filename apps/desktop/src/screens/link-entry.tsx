import * as React from "react"
import { Loader2, ShieldCheck } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
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
      <div className="w-full max-w-lg">
        <div className="mb-8 flex flex-col gap-2">
          <h1 className="font-heading text-2xl font-medium">Start your exam</h1>
          <p className="text-sm text-muted-foreground">
            Paste the quiz link your teacher gave you. The exam opens in a
            locked window and you won&apos;t be able to switch to other apps
            until you submit.
          </p>
        </div>

        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (canBegin) onBegin(value.trim())
          }}
        >
          <label htmlFor="quiz-link" className="text-sm font-medium">
            Quiz link
          </label>
          <input
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
            className="h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive"
          />

          {message ? (
            <p id="quiz-link-error" role="alert" className="text-sm text-destructive">
              {message}
            </p>
          ) : previewError ? (
            <p role="alert" className="text-sm text-destructive">
              {previewError}
            </p>
          ) : preview ? (
            <ExamConfigCard preview={preview} />
          ) : info ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <ShieldCheck className="size-4" aria-hidden />
              Ready to connect to <span className="font-mono">{info.host}</span>{" "}
              (exam {info.token_preview})
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              The link will be checked before anything is sent.
            </p>
          )}

          <Button type="submit" size="lg" disabled={!canBegin} className="mt-2 w-full">
            {busy ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Connecting…
              </>
            ) : (
              "Begin exam"
            )}
          </Button>
        </form>

        <div className="mt-6 flex justify-center">
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
    <div className="rounded-lg border bg-muted/30 p-4">
      <p className="text-sm font-medium">{exam.title}</p>
      {exam.description ? (
        <p className="mt-1 text-xs whitespace-pre-line text-muted-foreground">
          {exam.description}
        </p>
      ) : null}

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
        {rows.map(([label, valueText]) => (
          <React.Fragment key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{valueText}</dd>
          </React.Fragment>
        ))}
      </dl>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" aria-hidden />
        Ready to connect to <span className="font-mono">{preview.host}</span>{" "}
        (exam {preview.token_preview})
      </p>
    </div>
  )
}
