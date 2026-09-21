"use client"

import * as React from "react"
import type { QuizMediaItem } from "@workspace/quiz-core"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Spinner } from "@workspace/ui/components/spinner"

import { listQuizImagesAction } from "@/lib/quiz-actions"

type PickResult = { mediaId: string } | null

/**
 * One picker instance serves every insert point in the question editor (the
 * prompt toolbar and each option row): `pickImage()` opens the dialog, and the
 * returned promise resolves with the chosen image or null on close. The list
 * is fetched per open - orphaned uploads (replaced images) showing up again is
 * the feature's whole point.
 */
export function useImagePicker(
  quizId: string,
  resolveImageSrc: (mediaId: string) => string
): {
  pickImage: () => Promise<PickResult>
  dialog: React.ReactNode
} {
  const [open, setOpen] = React.useState(false)
  const [items, setItems] = React.useState<QuizMediaItem[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const resolverRef = React.useRef<((result: PickResult) => void) | null>(null)

  const settle = React.useCallback((result: PickResult) => {
    resolverRef.current?.(result)
    resolverRef.current = null
  }, [])

  const pickImage = React.useCallback(() => {
    setItems(null)
    setError(null)
    setOpen(true)
    void listQuizImagesAction(quizId).then((result) => {
      if (result.ok) setItems(result.images)
      else setError(result.message)
    })
    return new Promise<PickResult>((resolve) => {
      // A pick already in flight resolves as cancelled; last opener wins.
      settle(null)
      resolverRef.current = resolve
    })
  }, [quizId, settle])

  const dialog = (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) settle(null)
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Choose an image</DialogTitle>
          <DialogDescription>
            Images already uploaded to this quiz. Pick one to insert it again.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : items === null ? (
          <div className="grid place-items-center py-8">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No images in this quiz yet. Upload one first.
          </p>
        ) : (
          <ul className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    settle({ mediaId: item.id })
                    setOpen(false)
                  }}
                  className="block w-full overflow-hidden rounded-lg border bg-muted/30 outline-none hover:opacity-85 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- the
                      same-origin proxy; the optimizer buys nothing here */}
                  <img
                    src={resolveImageSrc(item.id)}
                    alt=""
                    className="h-24 w-full object-contain"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )

  return { pickImage, dialog }
}
