import { Loader2 } from "lucide-react"

export function Starting() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">
        Opening your exam and locking the screen…
      </p>
    </main>
  )
}
