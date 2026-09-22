/**
 * The one syntax highlighter, shared by the editor and the renderer.
 *
 * Both sides must colour a block the same way or a teacher's preview stops
 * being a preview: the editor highlights through ProseMirror decorations while
 * it is being typed, the renderer highlights the stored text on the exam
 * screen, and this module is the single place that decides what either one
 * knows how to read.
 *
 * Grammars are imported one by one rather than through lowlight's `common`
 * bundle. `common` is 37 languages, all of which would ship to the exam client
 * for the sake of the dozen a quiz is likely to use.
 */
import { CODE_LANGUAGES, type CodeLanguage } from "@workspace/quiz-core"
import type { LanguageFn } from "highlight.js"
import bash from "highlight.js/lib/languages/bash"
import c from "highlight.js/lib/languages/c"
import cpp from "highlight.js/lib/languages/cpp"
import csharp from "highlight.js/lib/languages/csharp"
import css from "highlight.js/lib/languages/css"
import go from "highlight.js/lib/languages/go"
import java from "highlight.js/lib/languages/java"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import php from "highlight.js/lib/languages/php"
import python from "highlight.js/lib/languages/python"
import sql from "highlight.js/lib/languages/sql"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import { createLowlight } from "lowlight"

/**
 * Typed as a total map over `CodeLanguage`, so adding a language to the
 * allowlist in @workspace/quiz-core does not compile until a grammar for it is
 * imported here.
 */
const GRAMMARS: Record<CodeLanguage, LanguageFn> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  go,
  // highlight.js calls it xml; teachers look for HTML, and the grammar is the
  // same one. The name a document stores is ours, not highlight.js's.
  html: xml,
  java,
  javascript,
  json,
  php,
  python,
  sql,
  typescript,
}

export const lowlight = createLowlight(GRAMMARS)

/** What the language picker shows. Total, so a new language needs a name. */
export const CODE_LANGUAGE_LABELS: Record<CodeLanguage, string> = {
  bash: "Bash",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  go: "Go",
  html: "HTML",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  php: "PHP",
  python: "Python",
  sql: "SQL",
  typescript: "TypeScript",
}

/** The allowlist in picker order, each with the name to show for it. */
export const CODE_LANGUAGE_OPTIONS = CODE_LANGUAGES.map((id) => ({
  id,
  label: CODE_LANGUAGE_LABELS[id],
}))
