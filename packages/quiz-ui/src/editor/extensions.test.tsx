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
