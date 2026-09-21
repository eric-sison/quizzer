"use client"

import * as React from "react"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import type { RichDoc } from "@workspace/quiz-core"
import { Bold, Code, Italic, List, ListOrdered, Underline } from "lucide-react"
import { Separator } from "@workspace/ui/components/separator"
import { Toggle } from "@workspace/ui/components/toggle"
import { cn } from "@workspace/ui/lib/utils"

import { richTextExtensions } from "./editor/extensions"
import { asRichDoc } from "./editor/rich-doc"

type RichTextEditorProps = {
  value: RichDoc
  onChange: (doc: RichDoc) => void
  placeholder?: string
  /** Rendered bottom-right of the toolbar, e.g. a word count. */
  meta?: React.ReactNode
  className?: string
  editable?: boolean
}

/**
 * Styling lives here rather than in a global stylesheet because Tailwind's
 * preflight strips list markers, and the editor is the only place in the app
 * that renders author-controlled block content.
 */
const CONTENT_CLASS = cn(
  "min-h-[4.5rem] px-4 py-3 text-sm leading-relaxed outline-none",
  "[&_p]:my-0 [&_p+p]:mt-2",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-0.5 [&_li>p]:my-0",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  // Placeholder: Tiptap marks the empty node and exposes the text as an attr.
  "[&_.is-editor-empty:first-child::before]:pointer-events-none",
  "[&_.is-editor-empty:first-child::before]:float-left",
  "[&_.is-editor-empty:first-child::before]:h-0",
  "[&_.is-editor-empty:first-child::before]:text-muted-foreground",
  "[&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]"
)

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  meta,
  className,
  editable = true,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: richTextExtensions({ placeholder }),
    content: value,
    editable,
    // The editor renders on the client only; letting it render on the server
    // produces a hydration mismatch against ProseMirror's own DOM.
    immediatelyRender: false,
    editorProps: { attributes: { class: CONTENT_CLASS } },
    onUpdate({ editor: instance }) {
      const doc = asRichDoc(instance.getJSON())
      // A document that fails the shared schema must never reach the server.
      // The extension list makes this unreachable; the guard is here so that
      // if it ever becomes reachable, it fails here and not at publish time.
      if (doc) onChange(doc)
    },
  })

  if (!editor) {
    return (
      <div className={cn("rounded-xl border bg-background", className)}>
        <div className="h-9 border-b bg-muted/40" />
        <div className="min-h-[4.5rem]" />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-background focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        className
      )}
    >
      <Toolbar editor={editor} meta={meta} />
      <EditorContent editor={editor} />
    </div>
  )
}

function Toolbar({ editor, meta }: { editor: Editor; meta?: React.ReactNode }) {
  // ProseMirror state changes outside React, so subscribe to force re-renders
  // and keep the pressed states honest.
  const [, force] = React.useReducer((n: number) => n + 1, 0)

  React.useEffect(() => {
    editor.on("transaction", force)
    return () => {
      editor.off("transaction", force)
    }
  }, [editor])

  return (
    <div className="flex items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1">
      <MarkToggle
        label="Bold"
        icon={Bold}
        pressed={editor.isActive("bold")}
        onPressedChange={() => editor.chain().focus().toggleBold().run()}
      />
      <MarkToggle
        label="Italic"
        icon={Italic}
        pressed={editor.isActive("italic")}
        onPressedChange={() => editor.chain().focus().toggleItalic().run()}
      />
      <MarkToggle
        label="Underline"
        icon={Underline}
        pressed={editor.isActive("underline")}
        onPressedChange={() => editor.chain().focus().toggleUnderline().run()}
      />

      <span className="mx-1 flex h-4">
        <Separator orientation="vertical" />
      </span>

      <MarkToggle
        label="Bullet list"
        icon={List}
        pressed={editor.isActive("bulletList")}
        onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
      />
      <MarkToggle
        label="Numbered list"
        icon={ListOrdered}
        pressed={editor.isActive("orderedList")}
        onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
      />

      <span className="mx-1 flex h-4">
        <Separator orientation="vertical" />
      </span>

      <MarkToggle
        label="Code"
        icon={Code}
        pressed={editor.isActive("code")}
        onPressedChange={() => editor.chain().focus().toggleCode().run()}
      />

      {meta ? <div className="ml-auto pr-1">{meta}</div> : null}
    </div>
  )
}

function MarkToggle({
  label,
  icon: Icon,
  pressed,
  onPressedChange,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  pressed: boolean
  onPressedChange: () => void
}) {
  return (
    <Toggle
      size="sm"
      aria-label={label}
      title={label}
      pressed={pressed}
      onPressedChange={onPressedChange}
    >
      <Icon className="size-3.5" />
    </Toggle>
  )
}
