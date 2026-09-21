import { Toaster } from "@workspace/ui/components/toast"

// The editor is a focused, full-height workspace: no app sidebar, so the
// question rail and canvas get the whole viewport.
export default function EditorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      {children}
      <Toaster />
    </>
  )
}
