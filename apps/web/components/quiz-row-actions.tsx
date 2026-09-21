"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Copy, MoreHorizontal, SquarePen, Trash2 } from "lucide-react"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { toast } from "@workspace/ui/components/toast"

import { deleteQuizAction } from "@/lib/quiz-actions"

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
