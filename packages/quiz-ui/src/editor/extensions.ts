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
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight"
import Document from "@tiptap/extension-document"
import HardBreak from "@tiptap/extension-hard-break"
import Italic from "@tiptap/extension-italic"
import { BulletList, ListItem, ListKeymap, OrderedList } from "@tiptap/extension-list"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import Underline from "@tiptap/extension-underline"
import { Placeholder, UndoRedo } from "@tiptap/extensions"

import { lowlight } from "./highlight"
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
    // Highlighting is a decoration over the same `codeBlock` node the plain
    // extension produced: the stored JSON is text plus a language name, so a
    // document written before this shipped needs no migration, and one written
    // now still renders as readable code on a client that cannot colour it.
    CodeBlockLowlight.configure({
      lowlight,
      exitOnTripleEnter: true,
      /**
       * Tab indents inside a code block instead of moving focus.
       *
       * The handler returns false anywhere else, so Tab still leaves the
       * editor from ordinary text - which matters, because this is the only
       * way a keyboard user gets out. Inside a block the way out is the arrow
       * keys: `exitOnArrowDown`/`exitOnArrowUp` are on by default and step the
       * caret past the block, where Tab behaves normally again.
       */
      enableTabIndentation: true,
      // Two spaces rather than Tiptap's four: the prompt editor sits beside a
      // question rail in a panel, and the student's answer editor is narrower
      // still, so deeply nested code has less room here than in an IDE.
      tabSize: 2,
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
