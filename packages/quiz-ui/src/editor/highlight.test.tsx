/**
 * The second contract seam.
 *
 * @workspace/quiz-core names the languages a document may claim; this package
 * owns the grammars that colour them. If the two drift, a teacher picks a
 * language from the toolbar and the exam screen renders it grey - a failure
 * with no error attached to it, which is the kind worth a test.
 */
import { CODE_LANGUAGES, normalizeCodeLanguage } from "@workspace/quiz-core"
import { describe, expect, it } from "vitest"

import { highlightToTree } from "./highlight-react"
import { CODE_LANGUAGE_LABELS, lowlight } from "./highlight"

describe("the highlighter knows every language the allowlist offers", () => {
  it("registers a grammar for each", () => {
    for (const language of CODE_LANGUAGES) {
      expect(lowlight.registered(language), `no grammar for ${language}`).toBe(true)
    }
  })

  it("registers nothing the allowlist does not name", () => {
    // Extra grammars are dead weight in the exam client's bundle, and one a
    // document may never name cannot earn its place.
    expect([...lowlight.listLanguages()].sort()).toEqual([...CODE_LANGUAGES].sort())
  })

  it("names each one for the picker", () => {
    for (const language of CODE_LANGUAGES) {
      expect(CODE_LANGUAGE_LABELS[language]).toBeTruthy()
    }
  })
})

describe("highlightToTree", () => {
  it("marks up the pieces of a line", () => {
    const tree = highlightToTree("const x = 1 // note", "javascript")
    const classes = JSON.stringify(tree)

    expect(classes).toContain("hljs-keyword")
    expect(classes).toContain("hljs-number")
    expect(classes).toContain("hljs-comment")
  })

  it("takes the spellings a teacher types", () => {
    expect(highlightToTree("print(1)", "py")).not.toBeNull()
    expect(normalizeCodeLanguage("py")).toBe("python")
  })

  it("gives up rather than throwing on a language it cannot read", () => {
    // lowlight throws on an unregistered language. A prompt must not be able to
    // take down the exam screen by naming one.
    expect(highlightToTree("PRINT *, 1", "fortran")).toBeNull()
    expect(highlightToTree("plain", null)).toBeNull()
    expect(highlightToTree("plain", undefined)).toBeNull()
  })
})
