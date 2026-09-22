import { describe, expect, it } from "vitest"

import {
  CODE_LANGUAGES,
  countTextWords,
  countWords,
  hasFormatting,
  isRichDocEmpty,
  normalizeCodeLanguage,
  richDocFromText,
  richDocSchema,
  toPlainText,
} from "../rich-text"
import { answerAsRichDoc } from "../manifest"

describe("richDocSchema", () => {
  it("accepts the allowed nodes and marks", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Select all " },
            { type: "text", text: "plant", marks: [{ type: "bold" }, { type: "italic" }] },
            { type: "hardBreak" },
          ],
        },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
          ],
        },
        { type: "codeBlock", content: [{ type: "text", text: "x = 1" }] },
        { type: "orderedList", attrs: { start: 3, type: null }, content: [] },
      ],
    }

    expect(richDocSchema.safeParse(doc).success).toBe(true)
  })

  // The whole point of an allowlist: anything not named above is refused.
  it.each([
    ["image", { type: "image", src: "https://example.com/x.png" }],
    ["script", { type: "script", text: "alert(1)" }],
    ["heading", { type: "heading", attrs: { level: 1 } }],
    ["iframe", { type: "iframe", src: "https://example.com" }],
  ])("rejects a %s node", (_name, node) => {
    const doc = { type: "doc", content: [node] }
    expect(richDocSchema.safeParse(doc).success).toBe(false)
  })

  it("rejects an unknown mark", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hi", marks: [{ type: "link" }] }] },
      ],
    }
    expect(richDocSchema.safeParse(doc).success).toBe(false)
  })

  it("rejects smuggled extra keys", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "hi", onclick: "alert(1)" }],
        },
      ],
    }
    expect(richDocSchema.safeParse(doc).success).toBe(false)
  })

  it("rejects an href attribute on a paragraph", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", attrs: { href: "javascript:alert(1)" } }],
    }
    expect(richDocSchema.safeParse(doc).success).toBe(false)
  })
})

describe("toPlainText", () => {
  it("flattens paragraphs, marks and lists", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph" as const,
          content: [
            { type: "text" as const, text: "Explain " },
            { type: "text" as const, text: "photosynthesis", marks: [{ type: "bold" as const }] },
          ],
        },
        {
          type: "bulletList" as const,
          content: [
            {
              type: "listItem" as const,
              content: [
                { type: "paragraph" as const, content: [{ type: "text" as const, text: "cite one" }] },
              ],
            },
          ],
        },
      ],
    }

    expect(toPlainText(doc)).toBe("Explain photosynthesis\ncite one")
  })

  it("round-trips plain text", () => {
    expect(toPlainText(richDocFromText("a\nb"))).toBe("a\nb")
  })
})

describe("helpers", () => {
  it("treats whitespace-only documents as empty", () => {
    expect(isRichDocEmpty(richDocFromText("   "))).toBe(true)
    expect(isRichDocEmpty(richDocFromText("x"))).toBe(false)
  })

  it("counts words", () => {
    expect(countWords(richDocFromText("one two  three"))).toBe(3)
    expect(countWords(richDocFromText("  "))).toBe(0)
  })

  it("counts plain text the same way it counts a document", () => {
    // A student's essay is counted against min_words in the exam client as
    // they type and again on the server at submit. If those two disagreed,
    // someone would be rejected for a limit they could see they had met.
    for (const text of ["one two  three", "  ", "", "\n\nspaced\tout\n"]) {
      expect(countTextWords(text)).toBe(countWords(richDocFromText(text)))
    }
  })

  it("reads an essay answer whatever shape it was stored in", () => {
    // Essays were plain text before they were rich, so both are live.
    expect(answerAsRichDoc("two words")).toEqual(richDocFromText("two words"))
    expect(countWords(answerAsRichDoc("two words"))).toBe(2)

    const doc = richDocFromText("already a document")
    expect(answerAsRichDoc(doc)).toBe(doc)

    // Nothing answered yet, and a shape that cannot be an essay at all.
    expect(isRichDocEmpty(answerAsRichDoc(undefined))).toBe(true)
    expect(isRichDocEmpty(answerAsRichDoc(["opt-1", "opt-2"]))).toBe(true)
  })

  it("ignores leading and trailing whitespace", () => {
    expect(countTextWords("   hello   ")).toBe(1)
    expect(countTextWords("")).toBe(0)
  })

  it("only reports formatting when plain text would lose something", () => {
    expect(hasFormatting(richDocFromText("Chloroplast"))).toBe(false)
    expect(hasFormatting(richDocFromText("two\nlines"))).toBe(true)
    expect(
      hasFormatting({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "bold" }] }] },
        ],
      })
    ).toBe(true)
  })
})

describe("code block languages", () => {
  it("accepts a language it knows, in any spelling", () => {
    for (const language of CODE_LANGUAGES) {
      expect(normalizeCodeLanguage(language)).toBe(language)
      expect(normalizeCodeLanguage(language.toUpperCase())).toBe(language)
    }

    // What a teacher actually types after the opening fence.
    expect(normalizeCodeLanguage("py")).toBe("python")
    expect(normalizeCodeLanguage("js")).toBe("javascript")
    expect(normalizeCodeLanguage("TS")).toBe("typescript")
    expect(normalizeCodeLanguage("c++")).toBe("cpp")
    expect(normalizeCodeLanguage("  sh  ")).toBe("bash")
  })

  it("reads an unlabelled or unknown block as plain code", () => {
    expect(normalizeCodeLanguage(null)).toBeNull()
    expect(normalizeCodeLanguage(undefined)).toBeNull()
    expect(normalizeCodeLanguage("")).toBeNull()
    expect(normalizeCodeLanguage("brainfuck")).toBeNull()
  })

  it("still parses a document whose language this build has never heard of", () => {
    // The opening fence has always taken any word, so drafts in the database
    // carry names no allowlist was ever applied to. Refusing them here would
    // make a saved quiz impossible to open over a label.
    const doc = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "fortran" },
          content: [{ type: "text", text: "PRINT *, 1" }],
        },
      ],
    }

    const parsed = richDocSchema.parse(doc)
    const block = parsed.content[0]!
    if (block.type !== "codeBlock") throw new Error("wrong node")

    expect(block.attrs?.language).toBe("fortran")
    expect(normalizeCodeLanguage(block.attrs?.language)).toBeNull()
    expect(toPlainText(parsed)).toBe("PRINT *, 1")
  })
})
