import * as React from "react"
import type {
  RichBlock,
  RichDoc,
  RichInline,
  RichListItem,
  RichMark,
  RichTextNode,
} from "@workspace/quiz-core"

/**
 * Renders a quiz prompt.
 *
 * This is the single implementation of the never-render-HTML rule. Prompts are
 * authored by teachers and displayed to students inside a webview that also
 * holds an exam session, so the one thing this file must never grow is a path
 * from quiz content to an HTML string. There is no `dangerouslySetInnerHTML`
 * here and there must never be one: node trees become React elements, and React
 * escapes text, so a prompt containing markup renders as the characters a
 * teacher typed.
 *
 * `apps/web` and `apps/desktop` both render through this, so the teacher's
 * preview is a real rendering of the student's screen rather than a lookalike.
 */
export function RichText({
  doc,
  fallback,
}: {
  /** Absent when the projection decided the plain text lost nothing. */
  doc: RichDoc | undefined
  /** Plain text, always populated on a manifest question. */
  fallback?: string
}) {
  if (!doc) {
    return fallback ? <Fallback text={fallback} /> : null
  }

  return (
    <>
      {doc.content.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </>
  )
}

/** One paragraph per line, matching how `richDocFromText` builds a document. */
function Fallback({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <p key={i} className="my-0 leading-relaxed">
          {line}
        </p>
      ))}
    </>
  )
}

function Block({ block }: { block: RichBlock }) {
  switch (block.type) {
    case "paragraph":
      return (
        <p className="my-0 leading-relaxed">
          <Inline nodes={block.content} />
        </p>
      )

    case "codeBlock":
      return (
        <pre className="my-0 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[0.85em] leading-relaxed">
          <code>{(block.content ?? []).map((node) => node.text).join("")}</code>
        </pre>
      )

    case "bulletList":
      return (
        <ul className="my-0 flex list-disc flex-col gap-1 pl-5">
          <Items items={block.content} />
        </ul>
      )

    case "orderedList":
      return (
        <ol
          start={block.attrs?.start}
          className="my-0 flex list-decimal flex-col gap-1 pl-5"
        >
          <Items items={block.content} />
        </ol>
      )

    default:
      // Unreachable for a document that passed quiz-core's schema, which is
      // strict and rejects unknown nodes at publish. It is here because the
      // desktop receives this JSON over a network from a server it does not
      // control, and a student mid-exam must lose one paragraph rather than
      // the whole screen.
      return null
  }
}

function Items({ items }: { items: RichListItem[] }) {
  return (
    <>
      {items.map((item, i) => (
        <li key={i}>
          {item.content.map((paragraph, j) => (
            <Inline key={j} nodes={paragraph.content} />
          ))}
        </li>
      ))}
    </>
  )
}

function Inline({ nodes }: { nodes: RichInline[] | undefined }) {
  if (!nodes) return null

  return (
    <>
      {nodes.map((node, i) =>
        node.type === "hardBreak" ? <br key={i} /> : <Text key={i} node={node} />
      )}
    </>
  )
}

const MARK_TAG = {
  bold: "strong",
  italic: "em",
  underline: "u",
  code: "code",
} as const satisfies Record<RichMark["type"], string>

function Text({ node }: { node: RichTextNode }) {
  // The text goes in as a child, never as markup, and the marks wrap it from
  // the outside. Nesting order does not matter: these four are all inline and
  // commutative in effect.
  let rendered: React.ReactNode = node.text

  for (const mark of node.marks ?? []) {
    const Tag = MARK_TAG[mark.type]
    if (!Tag) continue

    rendered =
      mark.type === "code" ? (
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          {rendered}
        </code>
      ) : (
        <Tag>{rendered}</Tag>
      )
  }

  return <>{rendered}</>
}
