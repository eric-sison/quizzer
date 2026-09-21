/**
 * The shared student-facing renderer.
 *
 * Consumed by apps/web (the teacher's preview) and apps/desktop (the exam
 * screen). It is plain React over the @workspace/ui tokens: no Next.js, no
 * Tauri, enforced by a lint rule rather than by remembering.
 */
export { QuestionView } from "./question-view"
export { AnswerSection, type AnswerControls } from "./answer-controls"
export { RichText } from "./rich-text"
export { RichTextEditor } from "./rich-text-editor"
export { richTextExtensions, type RichTextOptions } from "./editor/extensions"
export { asRichDoc } from "./editor/rich-doc"
