"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Copy, Files, MoreHorizontal, SquarePen, TextCursor, Trash2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/toast"

import {
  deleteQuizAction,
  duplicateQuizAction,
  renameQuizAction,
} from "@/lib/quiz-actions"

export function QuizRowActions({
  id,
  title,
  url,
}: {
  id: string
  title: string
  url: string | null
}) {
  const router = useRouter()
  const [confirming, setConfirming] = React.useState(false)
  const [renaming, setRenaming] = React.useState(false)
  const [draftTitle, setDraftTitle] = React.useState(title)
  const [pending, startTransition] = React.useTransition()

  async function copyLink() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      toast.add({ title: "Link copied", description: url })
    } catch {
      toast.add({ title: "Could not copy", description: "Copy it manually." })
    }
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteQuizAction(id)
      setConfirming(false)

      if (result.ok) {
        toast.add({ title: "Quiz deleted", description: title || "Untitled quiz" })
        router.refresh()
      } else {
        toast.add({ title: "Could not delete", description: result.message })
      }
    })
  }

  function duplicate() {
    startTransition(async () => {
      const result = await duplicateQuizAction(id)
      if (result.ok) {
        toast.add({
          title: "Quiz duplicated",
          description: `${title || "Untitled quiz"} (copy)`,
        })
        router.refresh()
      } else {
        toast.add({ title: "Could not duplicate", description: result.message })
      }
    })
  }

  function rename() {
    startTransition(async () => {
      // The read-modify-write inside can 409 if the quiz is open in an editor
      // elsewhere; surface the message rather than retrying.
      const result = await renameQuizAction(id, draftTitle)
      setRenaming(false)
      if (result.ok) {
        toast.add({ title: "Quiz renamed", description: draftTitle || "Untitled quiz" })
        router.refresh()
      } else {
        toast.add({ title: "Could not rename", description: result.message })
      }
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${title || "untitled quiz"}`}
            >
              <MoreHorizontal />
            </Button>
          }
        />
        <DropdownMenuContent align="end" width="content">
          <DropdownMenuItem onClick={() => router.push(`/quizzes/${id}/edit`)}>
            <SquarePen />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setDraftTitle(title)
              setRenaming(true)
            }}
          >
            <TextCursor />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem disabled={pending} onClick={duplicate}>
            <Files />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!url} onClick={copyLink}>
            <Copy />
            Copy quiz link
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename quiz</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              rename()
            }}
          >
            <Input
              value={draftTitle}
              maxLength={200}
              autoFocus
              onChange={(event) => setDraftTitle(event.currentTarget.value)}
              placeholder="Untitled quiz"
              aria-label="Quiz title"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setRenaming(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this quiz?</AlertDialogTitle>
            <AlertDialogDescription>
              {title || "This untitled quiz"} will disappear from your list.
              Published versions and any submitted results are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                remove()
              }}
            >
              {pending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
