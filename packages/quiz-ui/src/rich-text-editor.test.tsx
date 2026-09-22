/**
 * Mount test.
 *
 * Tiptap builds its DOM outside React and the editor is deliberately
 * client-only (`immediatelyRender: false`), so server-rendered HTML shows only
 * the skeleton. This is the check that the real editor and its toolbar actually
 * appear once mounted.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { emptyRichDoc, richDocSchema, type RichDoc } from "@workspace/quiz-core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { RichTextEditor } from "./rich-text-editor"

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

async function mount(onChange: (doc: RichDoc) => void = () => {}) {
  await act(async () => {
    root.render(<RichTextEditor value={emptyRichDoc()} onChange={onChange} placeholder="Write the question…" />)
  })
}

describe("RichTextEditor", () => {
  it("mounts a ProseMirror surface", async () => {
    await mount()
    expect(container.querySelector(".ProseMirror")).not.toBeNull()
  })

  it("renders one control per allowed formatting option", async () => {
    await mount()

    for (const label of [
      "Bold",
      "Italic",
      "Underline",
      "Bullet list",
      "Numbered list",
      "Code",
      "Code block",
    ]) {
      expect(
        container.querySelector(`[aria-label="${label}"]`),
        `missing control: ${label}`
      ).not.toBeNull()
    }
  })

  it("offers no control for anything off the allowlist", async () => {
    await mount()
    const labels = [...container.querySelectorAll("[aria-label]")].map((el) =>
      el.getAttribute("aria-label")
    )

    for (const forbidden of ["Link", "Image", "Heading", "Table", "Strikethrough"]) {
      expect(labels).not.toContain(forbidden)
    }
  })

  it("shows the placeholder while empty", async () => {
    await mount()
    const empty = container.querySelector("[data-placeholder]")
    expect(empty?.getAttribute("data-placeholder")).toBe("Write the question…")
  })

  it("pipes a toolbar action through to a valid RichDoc", async () => {
    const seen: RichDoc[] = []
    await mount((doc) => seen.push(doc))

    const bulletList = container.querySelector<HTMLElement>('[aria-label="Bullet list"]')
    expect(bulletList).not.toBeNull()

    await act(async () => {
      bulletList!.click()
    })

    // The toolbar changed the document, the editor reported it, and what it
    // reported satisfies the shared schema - the whole wiring in one assertion.
    expect(seen.length).toBeGreaterThan(0)
    const last = seen.at(-1)!
    expect(richDocSchema.safeParse(last).success).toBe(true)
    expect(JSON.stringify(last)).toContain("bulletList")
  })
})

describe("code blocks", () => {
  it("inserts one, and only then offers a language", async () => {
    const seen: RichDoc[] = []
    await mount((doc) => seen.push(doc))

    // The picker belongs to the block under the caret, so there is nothing to
    // pick until there is a block.
    expect(container.querySelector('[aria-label="Code language"]')).toBeNull()

    await act(async () => {
      container.querySelector<HTMLElement>('[aria-label="Code block"]')!.click()
    })

    expect(JSON.stringify(seen.at(-1))).toContain("codeBlock")
    expect(richDocSchema.safeParse(seen.at(-1)).success).toBe(true)
    expect(container.querySelector('[aria-label="Code language"]')).not.toBeNull()
  })

  it("writes the chosen language into the document, and plain text as null", async () => {
    const seen: RichDoc[] = []
    await mount((doc) => seen.push(doc))

    await act(async () => {
      container.querySelector<HTMLElement>('[aria-label="Code block"]')!.click()
    })

    const select = container.querySelector<HTMLSelectElement>(
      '[aria-label="Code language"]'
    )!
    await act(async () => {
      select.value = "python"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })

    const labelled = seen.at(-1)!
    expect(richDocSchema.safeParse(labelled).success).toBe(true)
    expect(JSON.stringify(labelled)).toContain('"language":"python"')

    await act(async () => {
      const current = container.querySelector<HTMLSelectElement>(
        '[aria-label="Code language"]'
      )!
      current.value = ""
      current.dispatchEvent(new Event("change", { bubbles: true }))
    })

    // "Plain text" is a real choice: it stores the same null an unlabelled
    // block carries, not the string "plaintext".
    expect(JSON.stringify(seen.at(-1))).toContain('"language":null')
  })

  it("colours the code as it is typed, with the class names the exam screen uses", async () => {
    // Editor-side highlighting is ProseMirror decorations, renderer-side is
    // React elements, and one stylesheet paints both. They agree only because
    // both carry hljs class names - so check the editor really emits them.
    await act(async () => {
      root.render(
        <RichTextEditor
          value={{
            type: "doc",
            content: [
              {
                type: "codeBlock",
                attrs: { language: "javascript" },
                content: [{ type: "text", text: "const x = 1" }],
              },
            ],
          }}
          onChange={() => {}}
        />
      )
    })

    const pre = container.querySelector(".ProseMirror pre")!
    expect(pre.textContent).toBe("const x = 1")
    expect(pre.querySelector(".hljs-keyword")?.textContent).toBe("const")
  })

  it("offers the same block to a student, but still no image upload", async () => {
    // The essay answer editor mounts this component without an upload handler.
    // Code blocks are shared ground; uploading a file is not.
    await mount()

    expect(container.querySelector('[aria-label="Code block"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Insert image"]')).toBeNull()
    expect(container.querySelector('[aria-label="Insert existing image"]')).toBeNull()
  })
})

describe("the existing-image picker", () => {
  async function mountWith(
    onChange: (doc: RichDoc) => void,
    onPickImage?: () => Promise<{ mediaId: string } | null>
  ) {
    await act(async () => {
      root.render(
        <RichTextEditor
          value={emptyRichDoc()}
          onChange={onChange}
          onUploadImage={async () => ({ error: "not under test" })}
          onPickImage={onPickImage}
        />
      )
    })
  }

  it("offers the picker only when the app provides one", async () => {
    await mountWith(() => {})
    expect(container.querySelector('[aria-label="Insert existing image"]')).toBeNull()

    await mountWith(() => {}, async () => null)
    expect(
      container.querySelector('[aria-label="Insert existing image"]')
    ).not.toBeNull()
  })

  it("inserts the picked media id as an image node", async () => {
    const docs: RichDoc[] = []
    await mountWith(
      (doc) => docs.push(doc),
      async () => ({ mediaId: "0198c5a4-2f6f-4b58-9f5a-1c2d3e4f5a6b" })
    )

    await act(async () => {
      container
        .querySelector<HTMLElement>('[aria-label="Insert existing image"]')!
        .click()
    })

    const latest = docs.at(-1)
    expect(latest).toBeDefined()
    expect(richDocSchema.safeParse(latest).success).toBe(true)
    expect(JSON.stringify(latest)).toContain(
      '"mediaId":"0198c5a4-2f6f-4b58-9f5a-1c2d3e4f5a6b"'
    )
  })

  it("inserts nothing when the picker is cancelled", async () => {
    const docs: RichDoc[] = []
    await mountWith(
      (doc) => docs.push(doc),
      async () => null
    )

    await act(async () => {
      container
        .querySelector<HTMLElement>('[aria-label="Insert existing image"]')!
        .click()
    })

    expect(docs).toHaveLength(0)
  })
})
