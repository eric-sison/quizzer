import { CheckCircle2 } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { quitApp } from "@/lib/ipc"

import type { Receipt } from "@/lib/types"

/**
 * Terminal screen. There is deliberately no way back to the exam from here -
 * the session is spent, and lockdown has already been released so the student
 * can quit normally.
 */
export function Submitted({ receipt }: { receipt: Receipt | null }) {
  const submittedAt = receipt
    ? new Date(receipt.submitted_at * 1000).toLocaleString()
    : null

  return (
    <main className="flex min-h-svh items-center justify-center p-8">
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <CheckCircle2 className="size-10 text-primary" aria-hidden />
        <h1 className="font-heading text-2xl font-medium">Exam submitted</h1>
        <p className="text-sm text-muted-foreground">
          Your answers are recorded. Exam mode has been turned off and you can
          close this window.
        </p>

        {receipt ? (
          <dl className="mt-2 w-full rounded-lg border border-border p-4 text-left text-xs">
            <div className="flex justify-between gap-4 py-1">
              <dt className="text-muted-foreground">Receipt</dt>
              <dd className="truncate font-mono">{receipt.receipt_id}</dd>
            </div>
            {submittedAt ? (
              <div className="flex justify-between gap-4 py-1">
                <dt className="text-muted-foreground">Submitted</dt>
                <dd>{submittedAt}</dd>
              </div>
            ) : null}
            {receipt.question_count > 0 ? (
              <div className="flex justify-between gap-4 py-1">
                <dt className="text-muted-foreground">Questions</dt>
                <dd>{receipt.question_count}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Keep the receipt number in case you need to ask your teacher about
          this attempt.
        </p>

        <Button size="lg" className="mt-2" onClick={() => void quitApp()}>
          Close
        </Button>
      </div>
    </main>
  )
}
