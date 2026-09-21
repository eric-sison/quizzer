/**
 * The editor's node and mark set.
 *
 * Built by explicit inclusion rather than StarterKit-minus-things. A denylist
 * silently grows whenever StarterKit adds an extension; this list can only
 * change when someone edits this file. It must stay in step with
 * `richDocSchema` in @workspace/quiz-core - the contract test next to this file
 * fails if it drifts.
 *
 * Nothing here can produce a link, heading, table or raw HTML, which is what
 * lets the desktop client render prompts as React elements without ever
 * building an HTML string. Images exist, but only as uploaded media referenced
 * by an opaque id - never by URL.
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

import { QuestionImage } from "./question-image"

export type RichTextOptions = {
  placeholder?: string
  /**
   * How the editor displays an image node's `mediaId`. Rendering is the only
   * thing this controls: whether a document may CONTAIN images is decided by
   * the schema, and whether the toolbar OFFERS an upload is decided by the
   * editor component's `onUploadImage` prop.
   */
  resolveImageSrc?: (mediaId: string) => string | undefined
}

/**
 * Used for both sides of a quiz: the teacher writing a prompt and the student
 * writing an essay answer. One allowlist means an answer can never contain a
 * node a prompt could not, so the renderer that displays both needs no second
 * set of cases.
 */
export function richTextExtensions({
  placeholder,
  resolveImageSrc,
}: RichTextOptions = {}) {
  return [
    // Structure
    Document,
    Paragraph,
    Text,
    HardBreak,
    // Images by opaque media id only - no src attribute, no parseHTML, so a
    // paste from the open web cannot smuggle one in. See question-image.ts.
    QuestionImage.configure({ resolveSrc: resolveImageSrc ?? (() => undefined) }),
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
