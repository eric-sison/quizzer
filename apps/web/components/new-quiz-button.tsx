"use client"

import { useFormStatus } from "react-dom"
import { Plus } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"

import { createQuizAction } from "@/lib/quiz-actions"

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus()

  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Spinner /> : <Plus />}
      {label}
    </Button>
  )
}

export function NewQuizButton({ label = "New quiz" }: { label?: string }) {
  return (
    <form action={createQuizAction}>
      <Submit label={label} />
    </form>
  )
}
