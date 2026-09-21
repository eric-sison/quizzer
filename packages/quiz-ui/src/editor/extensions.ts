/**
 * The editor's node and mark set.
 *
 * Built by explicit inclusion rather than StarterKit-minus-things. A denylist
 * silently grows whenever StarterKit adds an extension; this list can only
 * change when someone edits this file. It must stay in step with
 * `richDocSchema` in @workspace/quiz-core - the contract test next to this file
 * fails if it drifts.
 *
 * Nothing here can produce a link, image, heading, table or raw HTML, which is
 * what lets the desktop client render prompts as React elements without ever
 * building an HTML string.
 */
import Bold from "@tiptap/extension-bold"
import Code from "@tiptap/extension-code"
import CodeBlock from "@tiptap/extension-code-block"
import Document from "@tiptap/extension-document"
import HardBreak from "@tiptap/extension-hard-break"
import Italic from "@tiptap/extension-italic"
import { BulletList, ListItem, ListKeymap, OrderedList } from "@tiptap/extension-list"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import Underline from "@tiptap/extension-underline"
import { Placeholder, UndoRedo } from "@tiptap/extensions"

export type RichTextOptions = {
  placeholder?: string
}

/**
 * Used for both sides of a quiz: the teacher writing a prompt and the student
 * writing an essay answer. One allowlist means an answer can never contain a
 * node a prompt could not, so the renderer that displays both needs no second
 * set of cases.
 */
export function richTextExtensions({ placeholder }: RichTextOptions = {}) {
  return [
    // Structure
    Document,
    Paragraph,
    Text,
    HardBreak,
    CodeBlock.configure({
      // No syntax highlighting, so the language attribute is dead weight that
      // would only show up in the published payload.
      languageClassPrefix: "",
      exitOnTripleEnter: true,
    }),
    BulletList,
    OrderedList,
    ListItem,
    ListKeymap,

    // Marks
    Bold,
    Italic,
    Underline,
    Code,

    // Editing affordances. These add behaviour, never nodes or marks.
    UndoRedo,
    Placeholder.configure({ placeholder: placeholder ?? "" }),
  ]
}
