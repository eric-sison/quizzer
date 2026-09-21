import * as React from "react"
import { Loader2, ShieldCheck } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { quitApp, validateLink } from "@/lib/ipc"
import { toAppError, type AppError, type LinkInfo } from "@/lib/types"

type LinkEntryProps = {
  onBegin: (link: string) => void
  busy: boolean
  /** Carried over from a failed start attempt, so the student sees why. */
  error: AppError | null
}

export function LinkEntry({ onBegin, busy, error }: LinkEntryProps) {
  const [value, setValue] = React.useState("")
  const [info, setInfo] = React.useState<LinkInfo | null>(null)
  const [localError, setLocalError] = React.useState<string | null>(null)

  // Validate as they type, but entirely offline - this never contacts the
  // server, it only checks the link's shape and origin.
  React.useEffect(() => {
    const raw = value.trim()
    if (!raw) {
      setInfo(null)
      setLocalError(null)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const result = await validateLink(raw)
        if (!cancelled) {
          setInfo(result)
          setLocalError(null)
        }
      } catch (raw_) {
        if (!cancelled) {
          setInfo(null)
          setLocalError(toAppError(raw_).message)
        }
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
