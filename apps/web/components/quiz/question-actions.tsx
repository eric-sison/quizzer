"use client"

import { ChevronDown, ChevronUp, Copy, MoreHorizontal, Trash2 } from "lucide-react"
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
  onDuplicate,
  onMove,
  onDelete,
}: {
  index: number
  total: number
  onDuplicate: () => void
  onMove: (delta: number) => void
  onDelete: () => void
}) {
  return (
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
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 />
            Delete question
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
