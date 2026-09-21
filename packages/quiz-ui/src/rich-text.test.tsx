/**
 * The invariant this file exists for: quiz content becomes React elements and
 * never an HTML string. A teacher's prompt is untrusted input rendered inside a
 * webview that also holds a live exam session.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { richDocSchema, type RichDoc } from "@workspace/quiz-core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { RichText } from "./rich-text"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function render(doc: RichDoc | undefined, fallback?: string) {
  await act(async () => {
    root.render(<RichText doc={doc} fallback={fallback} />)
  })
}

/** Fails the test if the fixture is not something the server would publish. */
function valid(doc: unknown): RichDoc {
  return richDocSchema.parse(doc)
}

describe("RichText", () => {
  it("renders a paragraph", async () => {
    await render(valid({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Name the capital." }] }] }))
    expect(container.querySelectorAll("p")).toHaveLength(1)
    expect(container.textContent).toBe("Name the capital.")
  })

  it("renders each mark as its own element", async () => {
    await render(
      valid({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "b", marks: [{ type: "bold" }] },
              { type: "text", text: "i", marks: [{ type: "italic" }] },
              { type: "text", text: "u", marks: [{ type: "underline" }] },
              { type: "text", text: "c", marks: [{ type: "code" }] },
            ],
          },
        ],
      })
    )

    expect(container.querySelector("strong")?.textContent).toBe("b")
    expect(container.querySelector("em")?.textContent).toBe("i")
    expect(container.querySelector("u")?.textContent).toBe("u")
    expect(container.querySelector("code")?.textContent).toBe("c")
  })

  it("nests stacked marks around the same text", async () => {
    await render(
      valid({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "both", marks: [{ type: "bold" }, { type: "italic" }] },
            ],
          },
        ],
      })
    )

    expect(container.querySelector("em strong, strong em")?.textContent).toBe("both")
  })

  it("renders a hard break as a line break, not as text", async () => {
    await render(
      valid({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "one" },
              { type: "hardBreak" },
              { type: "text", text: "two" },
            ],
          },
        ],
      })
    )

    expect(container.querySelectorAll("br")).toHaveLength(1)
    expect(container.textContent).toBe("onetwo")
  })

  it("renders both list kinds, and honours where an ordered list starts", async () => {
    const item = (text: string) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    })

    await render(
      valid({
        type: "doc",
        content: [
          { type: "bulletList", content: [item("a"), item("b")] },
          { type: "orderedList", attrs: { start: 3, type: null }, content: [item("c")] },
        ],
      })
    )

    expect(container.querySelectorAll("ul li")).toHaveLength(2)
    expect(container.querySelectorAll("ol li")).toHaveLength(1)
    expect(container.querySelector("ol")?.getAttribute("start")).toBe("3")
  })

  it("renders a code block inside pre, preserving its text", async () => {
    await render(
      valid({
        type: "doc",
        content: [
          {
            type: "codeBlock",
            attrs: { language: null },
            content: [{ type: "text", text: "SELECT 1;" }],
          },
        ],
      })
    )

    expect(container.querySelector("pre code")?.textContent).toBe("SELECT 1;")
  })

  describe("never produces HTML from quiz content", () => {
    it("renders markup in a prompt as the characters that were typed", async () => {
      const hostile = '<script>alert(1)</script><img src=x onerror="alert(2)">'
      await render(
        valid({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: hostile }] }],
        })
      )

      expect(container.querySelector("script")).toBeNull()
      expect(container.querySelector("img")).toBeNull()
      expect(container.textContent).toBe(hostile)
    })

    it("renders markup in a code block as text too", async () => {
      await render(
        valid({
          type: "doc",
          content: [
            {
              type: "codeBlock",
              attrs: { language: null },
              content: [{ type: "text", text: "<script>bad()</script>" }],
            },
          ],
        })
      )

      expect(container.querySelector("script")).toBeNull()
      expect(container.textContent).toContain("<script>bad()</script>")
    })

    it("renders markup in the plain-text fallback as text", async () => {
      await render(undefined, "<script>alert(1)</script>")
      expect(container.querySelector("script")).toBeNull()
      expect(container.textContent).toBe("<script>alert(1)</script>")
    })
  })

  describe("degrading rather than crashing", () => {
    it("drops a node type this build does not know", async () => {
      // Unpublishable through quiz-core, but the desktop reads this JSON off a
      // network. One missing paragraph beats a blank screen mid-exam.
      const future = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "kept" }] },
          { type: "table", content: [] },
        ],
      } as unknown as RichDoc

      expect(() => richDocSchema.parse(future)).toThrow()
      await render(future)
      expect(container.textContent).toBe("kept")
    })

    it("ignores a mark type this build does not know", async () => {
      const future = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "plain", marks: [{ type: "highlight" }] }],
          },
        ],
      } as unknown as RichDoc

      await render(future)
      expect(container.textContent).toBe("plain")
    })
  })

  describe("plain-text fallback", () => {
    it("is used when the projection shipped no document", async () => {
      await render(undefined, "Just text.")
      expect(container.textContent).toBe("Just text.")
    })

    it("becomes one paragraph per line", async () => {
      await render(undefined, "first\nsecond")
      expect(container.querySelectorAll("p")).toHaveLength(2)
    })

    it("renders nothing at all when there is neither", async () => {
      await render(undefined)
      expect(container.innerHTML).toBe("")
    })

    it("is ignored once a document is present", async () => {
      await render(
        valid({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "rich" }] }] }),
        "plain"
      )
      expect(container.textContent).toBe("rich")
    })
  })
})
