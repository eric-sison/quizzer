/**
 * The contract seam.
 *
 * The editor's extension list and `richDocSchema` in @workspace/quiz-core are
 * two descriptions of the same allowlist. If they drift, a teacher can author a
 * prompt that the server rejects at publish time - so pin them together here.
 */
import { Editor } from "@tiptap/core"
import { richDocSchema } from "@workspace/quiz-core"
import { describe, expect, it } from "vitest"

import { richTextExtensions } from "./extensions"

function docFrom(content: string): unknown {
  const editor = new Editor({ extensions: richTextExtensions(), content })
  const json = editor.getJSON()
  editor.destroy()
  return json
}

function expectValid(content: string) {
  const json = docFrom(content)
  const result = richDocSchema.safeParse(json)

  if (!result.success) {
    throw new Error(
      `editor output rejected by richDocSchema:\n` +
        `${JSON.stringify(json, null, 2)}\n\n` +
        result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")
    )
  }
  return result.data
}

describe("editor output satisfies richDocSchema", () => {
  it("plain paragraph", () => {
    expectValid("<p>Explain photosynthesis.</p>")
  })

  it("every allowed mark", () => {
    expectValid(
      "<p><strong>bold</strong> <em>italic</em> <u>under</u> <code>code</code></p>"
    )
  })

  it("hard break", () => {
    expectValid("<p>one<br>two</p>")
  })

  it("bullet list", () => {
    expectValid("<ul><li><p>one</p></li><li><p>two</p></li></ul>")
  })

  it("ordered list", () => {
    expectValid("<ol><li><p>one</p></li><li><p>two</p></li></ol>")
  })

  it("ordered list with a start offset", () => {
    expectValid("<ol start='3'><li><p>three</p></li></ol>")
  })

  it("code block", () => {
    expectValid("<pre><code>x = 1</code></pre>")
  })

  it("code block carrying a language", () => {
    const doc = expectValid(
      '<pre><code class="language-python">def f():\n    return 1</code></pre>'
    )
    const block = doc.content[0]

    // The language survives the round trip as an attribute, which is all the
    // document stores: the colour is worked out again at render time.
    if (block?.type !== "codeBlock") throw new Error("not a code block")
    expect(block.attrs?.language).toBe("python")
  })

  it("an empty document", () => {
    expectValid("")
  })

  it("a realistic essay prompt", () => {
    expectValid(
      "<p>Explain how the <strong>mitochondrion</strong> supports its function.</p>" +
        "<p>Refer to:</p>" +
        "<ul><li><p>the inner membrane</p></li><li><p>the matrix</p></li></ul>"
    )
  })
})

describe("Tab inside a code block", () => {
  /**
   * Press a key at the editor's current selection, as ProseMirror sees it, and
   * report whether anything claimed it. False means the keystroke reaches the
   * browser - which for Tab is the difference between indenting and moving
   * focus to the next control.
   */
  function press(editor: Editor, key: string, shift = false): boolean {
    return (
      editor.view.someProp("handleKeyDown", (handler) =>
        handler(
          editor.view,
          new KeyboardEvent("keydown", { key, shiftKey: shift, bubbles: true })
        )
      ) === true
    )
  }

  function editorWith(content: string) {
    return new Editor({ extensions: richTextExtensions(), content })
  }

  it("indents rather than letting focus leave", () => {
    const editor = editorWith("<pre><code>x = 1</code></pre>")
    editor.commands.setTextSelection(1)

    // Handled here, so the browser never sees the keystroke and focus stays.
    expect(press(editor, "Tab")).toBe(true)
    expect(editor.state.doc.textBetween(1, editor.state.doc.content.size - 1)).toBe(
      "  x = 1"
    )

    editor.destroy()
  })

  it("outdents on Shift-Tab, and stops at the margin", () => {
    const editor = editorWith("<pre><code>    x = 1</code></pre>")
    editor.commands.setTextSelection(3)

    press(editor, "Tab", true)
    expect(editor.state.doc.textBetween(1, editor.state.doc.content.size - 1)).toBe(
      "  x = 1"
    )

    press(editor, "Tab", true)
    press(editor, "Tab", true)
    // Nothing left to remove: outdenting an unindented line is not an error,
    // it just does nothing.
    expect(editor.state.doc.textBetween(1, editor.state.doc.content.size - 1)).toBe(
      "x = 1"
    )

    editor.destroy()
  })

  it("indents every line a selection touches", () => {
    const editor = editorWith("<pre><code>a\nb</code></pre>")
    editor.commands.setTextSelection({ from: 1, to: 4 })

    press(editor, "Tab")
    expect(editor.state.doc.textBetween(1, editor.state.doc.content.size - 1)).toBe(
      "  a\n  b"
    )

    editor.destroy()
  })

  it("leaves Tab alone in ordinary text, so the editor can still be left", () => {
    // The whole reason the handler is scoped to code blocks: a keyboard user
    // who could not Tab out of a prompt would be trapped in it.
    const editor = editorWith("<p>Explain photosynthesis.</p>")
    editor.commands.setTextSelection(3)

    expect(press(editor, "Tab")).toBe(false)
    expect(editor.getText()).toBe("Explain photosynthesis.")

    editor.destroy()
  })

  it("still indents a list with Tab, which has its own meaning for the key", () => {
    const editor = editorWith("<ul><li><p>one</p></li><li><p>two</p></li></ul>")
    editor.commands.setTextSelection(9)

    expect(press(editor, "Tab")).toBe(true)
    // Nested, not indented with spaces: the list keymap still owns Tab here.
    expect(JSON.stringify(editor.getJSON())).toContain("bulletList")
    expect(editor.getText()).not.toContain("  ")

    editor.destroy()
  })
})

describe("uploaded images", () => {
  it("round-trips the schema as a mediaId node, with no URL anywhere", () => {
    const editor = new Editor({
      extensions: richTextExtensions({ resolveImageSrc: () => "blob:preview" }),
      content: "<p>Look at this:</p>",
    })
    editor
      .chain()
      .insertQuestionImage({
        mediaId: "0198c5a4-2f6f-4b58-9f5a-1c2d3e4f5a6b",
        alt: "A phase diagram",
      })
      .run()
    const json = editor.getJSON()
    editor.destroy()

    const result = richDocSchema.safeParse(json)
    expect(result.success).toBe(true)

    const serialised = JSON.stringify(json)
    expect(serialised).toContain('"mediaId":"0198c5a4-2f6f-4b58-9f5a-1c2d3e4f5a6b"')
    expect(serialised).toContain('"alt":"A phase diagram"')
    // The resolver's output styles the editor only; it never enters the doc.
    expect(serialised).not.toContain("blob:preview")
    expect(serialised).not.toContain("src")
  })
})

describe("the editor cannot produce disallowed content", () => {
  it.each([
    ["heading", "<h1>Title</h1>"],
    ["link", '<p><a href="https://evil.test">click</a></p>'],
    ["image", '<p><img src="https://evil.test/x.png"></p>'],
    ["script", "<p>hi</p><script>alert(1)</script>"],
    ["blockquote", "<blockquote><p>quoted</p></blockquote>"],
    ["table", "<table><tr><td>a</td></tr></table>"],
    ["strikethrough", "<p><s>gone</s></p>"],
  ])("drops %s, and what remains still validates", (_name, html) => {
    const doc = expectValid(html)
    const serialised = JSON.stringify(doc)

    expect(serialised).not.toContain("heading")
    expect(serialised).not.toContain("image")
    expect(serialised).not.toContain("script")
    expect(serialised).not.toContain("evil.test")
    expect(serialised).not.toContain("blockquote")
    expect(serialised).not.toContain("strike")
  })
})
