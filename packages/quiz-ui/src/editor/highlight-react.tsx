/**
 * Highlighted code as React elements.
 *
 * lowlight hands back a hast tree - spans carrying `hljs-*` class names - and
 * this walks it into React elements. The obvious alternative, asking
 * highlight.js for an HTML string and injecting it, is the one thing the
 * renderer may never do: quiz content is authored by one person and displayed
 * to another inside a live exam session, and `dangerouslySetInnerHTML` here
 * would undo that guarantee for every prompt in the app, not just the code.
 *
 * The class names are the same ones the editor's decorations use, so both
 * sides are coloured by one stylesheet and a teacher's preview matches the
 * student's screen exactly.
 */
import * as React from "react"
import { normalizeCodeLanguage } from "@workspace/quiz-core"
import type { Element, Root, RootContent } from "hast"

import { lowlight } from "./highlight"

/** A hast child list as React nodes. Anything but text and spans is skipped. */
function Nodes({ nodes }: { nodes: RootContent[] }): React.ReactNode {
  return nodes.map((node, i) => {
    if (node.type === "text") return node.value
    if (node.type !== "element") return null
    return <Span key={i} node={node} />
  })
}

function Span({ node }: { node: Element }): React.ReactNode {
  const className = node.properties?.className

  return (
    <span className={Array.isArray(className) ? className.join(" ") : undefined}>
      <Nodes nodes={node.children} />
    </span>
  )
}

/**
 * Highlight `code`, or return null when it cannot be.
 *
 * Null covers an unlabelled block, a label this build does not know and a
 * grammar that threw on some input it disliked. Every one of those renders as
 * plain code, because a code block that a student can read uncoloured beats an
 * exam screen that fails over syntax highlighting.
 */
export function highlightToTree(code: string, language: string | null | undefined): Root | null {
  const normalized = normalizeCodeLanguage(language)
  if (!normalized || !lowlight.registered(normalized)) return null

  try {
    return lowlight.highlight(normalized, code)
  } catch {
    return null
  }
}

/** The contents of a `<code>` element: coloured if possible, plain if not. */
export function HighlightedCode({
  code,
  language,
}: {
  code: string
  language: string | null | undefined
}): React.ReactNode {
  // Exam screens re-render on every keystroke the student types elsewhere on
  // the page; re-parsing every prompt's code each time would be felt.
  const tree = React.useMemo(() => highlightToTree(code, language), [code, language])

  if (!tree) return code
  return <Nodes nodes={tree.children} />
}
