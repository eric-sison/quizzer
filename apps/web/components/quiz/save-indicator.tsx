"use client"

import * as React from "react"
import { Check, CloudAlert, TriangleAlert } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"

import type { SaveStatus } from "@/lib/quiz/use-autosave"

/**
 * Says where the teacher's work actually is.
 *
 * The failure states are the point. A quiet "Saved" that is not true is worse
 * than no indicator at all, so a save that did not land says so, and says
 * whether anything is being done about it.
 *
 * `aria-live="polite"` because this changes without the teacher doing anything
 * to it, and a failure is not something to find out about later.
 */
export function SaveIndicator({
  status,
  onRetry,
  onReload,
}: {
  status: SaveStatus
  onRetry: () => void
  onReload: () => void
}) {
  return (
    <div
      aria-live="polite"
      className="flex items-center gap-2 text-xs text-muted-foreground"
    >
      {status.kind === "saved" ? (
        <>
          <Check className="size-3.5 text-primary" />
          <SavedAt at={status.at} />
        </>
      ) : null}

      {status.kind === "dirty" ? <span>Unsaved changes</span> : null}

      {status.kind === "saving" ? (
        <>
          <Spinner />
          <span>Saving</span>
        </>
      ) : null}

      {status.kind === "failed" ? (
        <>
          <CloudAlert className="size-3.5 text-destructive" />
          <span className="text-destructive" title={status.message}>
            {status.canRetry ? "Not saved" : "Not saved, retrying"}
          </span>
          {status.canRetry ? (
            <Button variant="outline" size="xs" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </>
      ) : null}

      {status.kind === "conflict" ? (
        <>
          <TriangleAlert className="size-3.5 text-destructive" />
          <span className="text-destructive" title={status.message}>
            Edited in another tab
          </span>
          <Button variant="outline" size="xs" onClick={onReload}>
            Reload
          </Button>
        </>
      ) : null}
    </div>
  )
}

/**
 * "Saved" until there is a save to date, then "Saved 2 minutes ago". It reticks
 * once a minute rather than once a second: a clock that never settles pulls the
 * eye away from the question being written.
 */
function SavedAt({ at }: { at: number | null }) {
  // The clock is read on a timer, never in render. Until the first tick `now`
  // trails `at`, which reads as "just now", and that is exactly right: the save
  // has only this moment landed.
  const [now, setNow] = React.useState(at ?? 0)

  React.useEffect(() => {
    if (at === null) return
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [at])

  if (at === null) return <span>Saved</span>
  return <span>{savedLabel(at, Math.max(now, at))}</span>
}

/** Pure, so the ticking can be tested without waiting a minute for it. */
export function savedLabel(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return "Saved just now"
  return `Saved ${minutes === 1 ? "1 minute" : `${minutes} minutes`} ago`
}
