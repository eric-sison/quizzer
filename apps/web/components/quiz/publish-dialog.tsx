"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  hasErrors,
  validateQuiz,
  type Issue,
  type QuizDoc,
  type QuizStatus,
} from "@workspace/quiz-core"
import { Check, Copy, Send, TriangleAlert } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { toast } from "@workspace/ui/components/toast"

import { publishQuizAction, unpublishQuizAction } from "@/lib/quiz-actions"

/**
 * Publishing, from the teacher's side.
 *
 * The dialog shows the local validation verdict before anything is sent, so a
 * teacher is not made to wait for a round trip to learn a question has no
 * correct answer. That is a courtesy, not a gate: the Publish button stays
 * enabled and apps/api decides. A client that refused to send would be acting
 * as a control it is not, and would also be the only thing standing between a
 * false negative here and a teacher who cannot publish at all.
 */
export function PublishDialog({
  quizId,
  doc,
  status,
  url,
  hasUnpublishedChanges,
  onSelectQuestion,
  onPublished,
}: {
  quizId: string
  doc: QuizDoc
  status: QuizStatus
  /** The existing link, when the quiz has been published before. */
  url: string | null
  hasUnpublishedChanges: boolean
  /** Jump the editor to a question, so an issue is one click from its cause. */
  onSelectQuestion: (id: string) => void
  /**
   * The server accepted this document. Hands back the doc as it stood when
   * Publish was pressed, so the editor can reset its dirty tracking without
   * mistaking a mid-flight edit for a published one.
   */
  onPublished?: (doc: QuizDoc) => void
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const [serverIssues, setServerIssues] = React.useState<Issue[] | null>(null)
  const [publishedUrl, setPublishedUrl] = React.useState<string | null>(null)

  // The same function the question rail runs, so the dialog and the rail dots
  // cannot disagree about what is wrong.
  const localIssues = React.useMemo(() => validateQuiz(doc), [doc])
  const issues = serverIssues ?? localIssues
  const blocked = hasErrors(issues)
  const live = status === "published"
  const shownUrl = publishedUrl ?? url

  function reset(next: boolean) {
    setOpen(next)
    if (!next) {
      setServerIssues(null)
      setPublishedUrl(null)
    }
  }

  function publish() {
    // Captured now, not at resolution: an edit made while the request is in
    // flight was not part of what the server published.
    const submitted = doc

    startTransition(async () => {
      const result = await publishQuizAction(quizId)

      if (result.ok) {
        setServerIssues(null)
        setPublishedUrl(result.published.url)
        onPublished?.(submitted)
        toast.add({
          title: `Version ${result.published.versionNo} is live`,
          description: result.published.url,
        })
        router.refresh()
        return
      }

      if (result.reason === "invalid") {
        // The server's list, not ours. If the two disagree, the teacher should
        // be looking at the one that actually decided.
        setServerIssues(result.issues)
        return
      }

      toast.add({ title: "Could not publish", description: result.message })
    })
  }

  function unpublish() {
    startTransition(async () => {
      const result = await unpublishQuizAction(quizId)
      if (result.ok) {
        setPublishedUrl(null)
        reset(false)
        toast.add({
          title: "Link closed",
          description: "No new attempts can start. Exams in progress are unaffected.",
        })
        router.refresh()
      } else {
        toast.add({ title: "Could not close the link", description: result.message })
      }
    })
  }

  return (
    <>
      <Button variant={live ? "outline" : "default"} onClick={() => setOpen(true)}>
        <Send />
        {live && hasUnpublishedChanges ? "Publish changes" : live ? "Published" : "Publish"}
      </Button>

      <Dialog open={open} onOpenChange={reset}>
        {/* A quiz link is a long line of text and needs more room than a
            confirmation prompt. */}
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>
              {live && hasUnpublishedChanges
                ? "Publish changes"
                : live
                  ? "This quiz is live"
                  : "Publish this quiz"}
            </DialogTitle>
            <DialogDescription>
              {live
                ? "The link stays the same, so students who already have it can keep using it. Anyone who starts after you publish gets the new version. Anyone taking the exam right now stays on the version they started."
                : "Publishing creates a link you can hand to students. You can keep editing afterwards, and publish again when you are ready."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {blocked ? (
              <IssueSummary issues={issues} onSelectQuestion={onSelectQuestion} onGo={() => reset(false)} />
            ) : (
              <Warnings issues={issues} />
            )}

            {shownUrl ? (
              <LinkRow
                url={shownUrl}
                onClose={live ? unpublish : undefined}
                pending={pending}
              />
            ) : null}
          </div>

          {/* Two buttons, deliberately. Taking a link out of service is not the
              same kind of act as publishing one, and sitting them side by side
              made the row wider than the dialog. It lives with the link it
              closes instead. */}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => reset(false)}>
              {publishedUrl ? "Done" : "Cancel"}
            </Button>
            {/* A live quiz with nothing new to publish gets a confirmation,
                not an action: republishing an identical document would only
                mint a redundant version. The action returns the moment an
                edit makes it meaningful. */}
            {live && !hasUnpublishedChanges ? (
              <Button disabled>
                <Check />
                Published
              </Button>
            ) : (
              <Button disabled={pending} onClick={publish}>
                {pending
                  ? "Publishing…"
                  : live
                    ? "Publish changes"
                    : "Publish"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * One general message, deliberately not a list. A quiz can carry dozens of
 * issues, and itemizing them here turns the dialog into a scroll of errors;
 * the rail's red dots already say where each problem lives. One button jumps
 * to the first offending question so the fix is still a single click away.
 */
function IssueSummary({
  issues,
  onSelectQuestion,
  onGo,
}: {
  issues: Issue[]
  onSelectQuestion: (id: string) => void
  onGo: () => void
}) {
  const errors = issues.filter((i) => i.severity === "error")
  const firstQuestionId = errors.find((i) => i.questionId)?.questionId ?? null

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5">
      <p className="flex items-center gap-2 text-sm font-medium text-destructive">
        <TriangleAlert className="size-4" />
        This quiz isn&apos;t ready to publish
      </p>
      <p className="text-sm text-foreground">
        {errors.length === 1 ? "1 issue needs" : `${errors.length} issues need`}{" "}
        fixing first.
        {firstQuestionId
          ? " Questions with problems are marked with a red dot in the list on the left."
          : ""}
      </p>
      {firstQuestionId ? (
        <div className="flex">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onSelectQuestion(firstQuestionId)
              onGo()
            }}
          >
            Go to first issue
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function Warnings({ issues }: { issues: Issue[] }) {
  const warnings = issues.filter((i) => i.severity === "warning")
  if (warnings.length === 0) return null

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-muted/40 p-3.5">
      <p className="text-sm font-medium">Worth a look, but not blocking</p>
      {warnings.map((issue, i) => (
        <p key={i} className="text-sm text-muted-foreground">
          {issue.message}
        </p>
      ))}
    </div>
  )
}

function LinkRow({
  url,
  onClose,
  pending,
}: {
  url: string
  /** Only for a quiz that is currently live. */
  onClose?: () => void
  pending: boolean
}) {
  const [copied, setCopied] = React.useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2_000)
    } catch {
      toast.add({ title: "Could not copy", description: "Select the link and copy it." })
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        Student link
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-2.5 py-2 font-mono text-xs select-all">
          {url}
        </code>
        <Button variant="outline" size="icon" aria-label="Copy the student link" onClick={copy}>
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      {onClose ? (
        <div className="flex items-center gap-2 border-t pt-3">
          <p className="flex-1 text-xs text-muted-foreground">
            Closing the link stops new attempts. Anyone already sitting the exam
            finishes it.
          </p>
          <Button variant="destructive" size="sm" disabled={pending} onClick={onClose}>
            Close the link
          </Button>
        </div>
      ) : null}
    </div>
  )
}
