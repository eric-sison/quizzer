/**
 * The indicator is the only place a teacher learns their work is not on the
 * server, so what it says in each state is worth pinning down. A "Saved" that
 * is not true is the failure mode this guards against.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SaveStatus } from "@/lib/quiz/use-autosave"

import { SaveIndicator, savedLabel } from "./save-indicator"

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

async function show(status: SaveStatus, onRetry = () => {}, onReload = () => {}) {
  await act(async () => {
    root.render(
      <SaveIndicator status={status} onRetry={onRetry} onReload={onReload} />
    )
  })
}

function buttons() {
  return [...container.querySelectorAll("button")].map((b) => b.textContent)
}

describe("save indicator", () => {
  it("says Saved before the first save, without claiming a time", async () => {
    await show({ kind: "saved", at: null })
    expect(container.textContent).toBe("Saved")
  })

  it("names the unsaved states plainly", async () => {
    await show({ kind: "dirty" })
    expect(container.textContent).toContain("Unsaved changes")

    await show({ kind: "saving" })
    expect(container.textContent).toContain("Saving")
  })

  it("offers no Retry while it is still retrying by itself", async () => {
    await show({ kind: "failed", message: "down", canRetry: false })
    expect(container.textContent).toContain("retrying")
    expect(buttons()).toEqual([])
  })

  it("offers Retry once it has given up", async () => {
    const onRetry = vi.fn()
    await show({ kind: "failed", message: "down", canRetry: true }, onRetry)

    expect(buttons()).toEqual(["Retry"])
    await act(async () => container.querySelector("button")!.click())
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("offers Reload on a conflict, because retrying cannot fix it", async () => {
    const onReload = vi.fn()
    await show({ kind: "conflict", message: "version 8" }, () => {}, onReload)

    expect(container.textContent).toContain("Edited in another tab")
    expect(buttons()).toEqual(["Reload"])
    await act(async () => container.querySelector("button")!.click())
    expect(onReload).toHaveBeenCalledOnce()
  })

  it("announces itself, since nothing the teacher did caused the change", async () => {
    await show({ kind: "dirty" })
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull()
  })
})

describe("savedLabel", () => {
  it("reads as just now until a minute has passed", () => {
    expect(savedLabel(1_000_000, 1_000_000)).toBe("Saved just now")
    expect(savedLabel(1_000_000, 1_059_999)).toBe("Saved just now")
  })

  it("counts whole minutes, singular and plural", () => {
    expect(savedLabel(0, 60_000)).toBe("Saved 1 minute ago")
    expect(savedLabel(0, 125_000)).toBe("Saved 2 minutes ago")
  })

  it("does not go backwards if the clock trails the save", () => {
    expect(savedLabel(2_000, 1_000)).toBe("Saved just now")
  })
})
