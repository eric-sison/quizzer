import { AlertCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { AppError, ErrorCode } from "@/lib/types"

/**
 * Each failure mode gets its own explanation and its own next step. A student
 * with an expired link and a student on a dead network need different advice,
 * and "something went wrong" helps neither.
 */
const GUIDANCE: Record<ErrorCode, { title: string; advice: string }> = {
  invalid_link: {
    title: "That link doesn't look right",
    advice: "Check you copied the whole link, then try again.",
  },
  untrusted_host: {
    title: "That link isn't for this app",
    advice:
      "This app only opens exams from your school's server. Ask your teacher for the correct link.",
  },
  expired: {
    title: "This exam has closed",
    advice: "The time window for this exam has passed. Speak to your teacher.",
  },
  already_submitted: {
    title: "You've already submitted this exam",
    advice:
      "Each link can only be used once. If you think this is a mistake, ask your teacher to reopen it.",
  },
  not_yet_open: {
    title: "This exam hasn't started yet",
    advice: "Try again when your teacher opens it.",
  },
  revoked: {
    title: "This link has been cancelled",
    advice: "Your teacher withdrew this link. Ask for a new one.",
  },
  session_conflict: {
    title: "This exam is open somewhere else",
    advice:
      "Close the exam on the other device, or ask your teacher to release the session.",
  },
  network_unavailable: {
    title: "Can't reach the exam server",
    advice: "Check the network connection and try again.",
  },
  no_session: {
    title: "The exam session ended",
    advice: "Start again from your quiz link.",
  },
  server_error: {
    title: "Something went wrong",
    advice: "Try again. If it keeps happening, tell your teacher.",
  },
}

export function ExamError({
  error,
  onDismiss,
}: {
  error: AppError
  onDismiss: () => void
}) {
  const guidance = GUIDANCE[error.code] ?? GUIDANCE.server_error

  return (
    <main className="flex min-h-svh items-center justify-center p-8">
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <AlertCircle className="size-10 text-destructive" aria-hidden />
        <h1 className="font-heading text-2xl font-medium">{guidance.title}</h1>
        <p className="text-sm text-muted-foreground">{guidance.advice}</p>

        <Button size="lg" variant="outline" className="mt-2" onClick={onDismiss}>
          {error.retryable ? "Try again" : "Back to start"}
        </Button>
      </div>
    </main>
  )
}
