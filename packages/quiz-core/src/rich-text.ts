/**
 * The rich-text subset the Quiz Maker allows.
 *
 * This is deliberately a closed allowlist rather than "whatever the editor
 * produced". Prompts authored here are rendered by the desktop exam client,
 * and `packages/quiz-ui` maps these nodes to React elements - no code path
 * turns quiz content into an HTML string. Validating the node set on the
 * server is what keeps that guarantee cheap to hold.
 *
 * Node names match Tiptap/ProseMirror (`bulletList`, `hardBreak`) because this
 * is exactly what the editor emits and what the Rust client receives. Unlike
 * the rest of the wire format, they are camelCase for that reason.
 */
import { z } from "zod"

export const RICH_MARKS = ["bold", "italic", "underline", "code"] as const
export type RichMarkName = (typeof RICH_MARKS)[number]

// ProseMirror serialises marks as objects, not bare strings: a text node
// carries `marks: [{ type: "bold" }]`. Matching that exactly is what lets the
// editor's output be stored and shipped without a conversion step.
const richMarkSchema = z.strictObject({ type: z.enum(RICH_MARKS) })

const richTextNodeSchema = z.strictObject({
  type: z.literal("text"),
  text: z.string(),
  marks: z.array(richMarkSchema).optional(),
})

const richHardBreakSchema = z.strictObject({
  type: z.literal("hardBreak"),
})

const richInlineSchema = z.discriminatedUnion("type", [
  richTextNodeSchema,
  richHardBreakSchema,
])

const richParagraphSchema = z.strictObject({
  type: z.literal("paragraph"),
  content: z.array(richInlineSchema).optional(),
})

const richCodeBlockSchema = z.strictObject({
  type: z.literal("codeBlock"),
  // The editor ships no syntax highlighting, so `language` is always null. The
  // key exists because ProseMirror always serialises a node type's attributes.
  attrs: z.strictObject({ language: z.string().nullable() }).optional(),
  content: z.array(richTextNodeSchema).optional(),
})

const richListItemSchema = z.strictObject({
  type: z.literal("listItem"),
  content: z.array(richParagraphSchema),
})

const richBulletListSchema = z.strictObject({
  type: z.literal("bulletList"),
  content: z.array(richListItemSchema),
})

const richOrderedListSchema = z.strictObject({
  type: z.literal("orderedList"),
  attrs: z
    .strictObject({
      start: z.number().int().min(1),
      /** List style (a, A, i, I). Unused, but the editor always emits it. */
      type: z.string().nullable(),
    })
    .partial()
    .optional(),
  content: z.array(richListItemSchema),
})

const richBlockSchema = z.discriminatedUnion("type", [
  richParagraphSchema,
  richCodeBlockSchema,
  richBulletListSchema,
  richOrderedListSchema,
])

export const richDocSchema = z.strictObject({
  type: z.literal("doc"),
  content: z.array(richBlockSchema),
})

export type RichMark = z.infer<typeof richMarkSchema>
export type RichTextNode = z.infer<typeof richTextNodeSchema>
export type RichInline = z.infer<typeof richInlineSchema>
export type RichParagraph = z.infer<typeof richParagraphSchema>
export type RichListItem = z.infer<typeof richListItemSchema>
export type RichBlock = z.infer<typeof richBlockSchema>
export type RichDoc = z.infer<typeof richDocSchema>

/** An empty document. Tiptap renders this as a single blank paragraph. */
export function emptyRichDoc(): RichDoc {
  return { type: "doc", content: [{ type: "paragraph" }] }
}

/** Build a document from plain text. One paragraph per line. */
export function richDocFromText(text: string): RichDoc {
  const lines = text.split("\n")
  return {
    type: "doc",
    content: lines.map((line) =>
      line.length > 0
        ? { type: "paragraph", content: [{ type: "text", text: line }] }
        : { type: "paragraph" }
    ),
  }
}

function inlineToText(nodes: RichInline[] | undefined): string {
  if (!nodes) return ""
  return nodes.map((n) => (n.type === "text" ? n.text : "\n")).join("")
}

function blockToText(block: RichBlock): string {
  switch (block.type) {
    case "paragraph":
      return inlineToText(block.content)
    case "codeBlock":
      return (block.content ?? []).map((n) => n.text).join("")
    case "bulletList":
    case "orderedList":
      return block.content
        .map((item) => item.content.map((p) => inlineToText(p.content)).join("\n"))
        .join("\n")
  }
}

/**
 * Flatten a document to plain text.
 *
 * Every published question carries this alongside `prompt_doc`, so a client
 * that does not understand the rich format still renders something correct.
 */
export function toPlainText(doc: RichDoc): string {
  return doc.content.map(blockToText).join("\n")
}

/** True when a document holds no visible text. */
export function isRichDocEmpty(doc: RichDoc): boolean {
  return toPlainText(doc).trim().length === 0
}

/**
 * Word count for plain text.
 *
 * Exported because a student's essay is counted against `min_words` in three
 * places: the exam client as they type, the preview, and eventually the server
 * at submit. A limit that is satisfied on screen and rejected on submit is the
 * kind of bug that costs someone marks, so all three count the same way.
 */
export function countTextWords(text: string): number {
  const trimmed = text.trim()
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length
}

/** Word count, used by the essay min/max rules. */
export function countWords(doc: RichDoc): number {
  return countTextWords(toPlainText(doc))
}

/**
 * Whether the plain-text flattening loses anything.
 *
 * Used to decide if a projected manifest needs to carry `*_doc` alongside the
 * plain string. Most answer options are unformatted, and shipping a node tree
 * for the word "Chloroplast" is waste.
 */
export function hasFormatting(doc: RichDoc): boolean {
  if (doc.content.length > 1) return true
  const [block] = doc.content
  if (!block) return false
  if (block.type !== "paragraph") return true
  return (block.content ?? []).some(
    (n) => n.type === "hardBreak" || (n.marks !== undefined && n.marks.length > 0)
  )
}
