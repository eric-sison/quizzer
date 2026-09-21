"use client"

import * as React from "react"
import { ChevronDown, ChevronUp, Copy, MoreHorizontal, Trash2 } from "lucide-react"
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

export function QuestionActions({
  index,
  total,
  questionLabel,
  onDuplicate,
  onMove,
  onDelete,
}: {
  index: number
  total: number
  /** The prompt's text, for the delete confirmation. */
  questionLabel: string
  onDuplicate: () => void
  onMove: (delta: number) => void
  onDelete: () => void
}) {
  // Deletion is confirmed: autosave persists it within a second, so an
  // accidental click would otherwise be a real loss (undo covers the session,
  // not a closed tab).
  const [confirming, setConfirming] = React.useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              aria-label={`Actions for question ${index + 1}`}
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" width="content">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === 0} onClick={() => onMove(-1)}>
              <ChevronUp />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === total - 1} onClick={() => onMove(1)}>
              <ChevronDown />
              Move down
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
              <Trash2 />
              Delete question
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete question {index + 1}?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{questionLabel}&rdquo; will be removed. You can undo this
              with ⌘Z while the editor is open.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                onDelete()
                setConfirming(false)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
