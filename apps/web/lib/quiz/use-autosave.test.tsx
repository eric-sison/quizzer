/**
 * Autosave is the part of the editor a teacher never looks at until it has
 * already failed them, so these cover the failure paths as closely as the happy
 * one: what retries, what does not, and what the indicator claims meanwhile.
 */
import { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createQuizDoc, type QuizDoc } from "@workspace/quiz-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AUTOSAVE_DELAY_MS,
  backoffMs,
  useAutosave,
  type SaveResult,
  type SaveStatus,
} from "./use-autosave"

let container: HTMLDivElement
let root: Root
type Observed = { status: SaveStatus; hasUnsavedChanges: boolean; retryNow: () => void }

/** Published from an effect, not from render, so the harness stays pure. */
const observed: { current: Observed | null } = { current: null }
const latest = () => observed.current!

function Harness({
  doc,
  docVersion,
  save,
}: {
  doc: QuizDoc
  docVersion: number
  save: (doc: QuizDoc, docVersion: number) => Promise<SaveResult>
}) {
  const result = useAutosave({ doc, docVersion, save })
  useEffect(() => {
    observed.current = result
  })
  return null
}

beforeEach(() => {
  vi.useFakeTimers()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})

async function render(
  doc: QuizDoc,
  save: (doc: QuizDoc, docVersion: number) => Promise<SaveResult>,
  docVersion = 3
) {
  await act(async () => {
    root.render(<Harness doc={doc} docVersion={docVersion} save={save} />)
  })
}

/** Let the debounce expire and any resulting save settle. */
async function tick(ms = AUTOSAVE_DELAY_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

type Save = (doc: QuizDoc, docVersion: number) => Promise<SaveResult>

const ok = (docVersion: number): SaveResult => ({
  ok: true,
  docVersion,
  savedAt: "2026-09-22T00:00:00.000Z",
})

function titled(doc: QuizDoc, title: string): QuizDoc {
  return { ...doc, title }
}

describe("useAutosave", () => {
  it("saves nothing on mount", async () => {
    const save = vi.fn<Save>()
    await render(createQuizDoc("Midterm"), save)
    await tick()

    expect(save).not.toHaveBeenCalled()
    expect(latest().status).toEqual({ kind: "saved", at: null })
    expect(latest().hasUnsavedChanges).toBe(false)
  })

  it("ignores a re-render that hands back the same document", async () => {
    const doc = createQuizDoc("Midterm")
    const save = vi.fn<Save>()

    await render(doc, save)
    await render(doc, save)
    await tick()

    expect(save).not.toHaveBeenCalled()
  })

  it("debounces a burst of edits into one save of the last one", async () => {
    const doc = createQuizDoc("M")
    const save = vi.fn<Save>(async () => ok(4))

    await render(doc, save)
    await render(titled(doc, "Mi"), save)
    await render(titled(doc, "Mid"), save)
    await render(titled(doc, "Midterm"), save)

    expect(save).not.toHaveBeenCalled()
    expect(latest().status).toEqual({ kind: "dirty" })
    expect(latest().hasUnsavedChanges).toBe(true)

    await tick()

    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]![0].title).toBe("Midterm")
    expect(save.mock.calls[0]![1]).toBe(3)
    expect(latest().status.kind).toBe("saved")
  })

  it("sends the version the server returned, not the one it was mounted with", async () => {
    const doc = createQuizDoc("M")
    const save = vi.fn<Save>(async () => ok(9))

    await render(doc, save)
    await render(titled(doc, "one"), save)
    await tick()
    await render(titled(doc, "two"), save)
    await tick()

    expect(save.mock.calls[0]![1]).toBe(3)
    expect(save.mock.calls[1]![1]).toBe(9)
  })

  it("does not run two saves at once, and sends the newer edit after the first lands", async () => {
    const doc = createQuizDoc("M")
    let release: (r: SaveResult) => void = () => {}
    const save = vi.fn<Save>(
      () => new Promise<SaveResult>((resolve) => { release = resolve })
    )

    await render(doc, save)
    await render(titled(doc, "first"), save)
    await tick()
    expect(save).toHaveBeenCalledTimes(1)
    expect(latest().status).toEqual({ kind: "saving" })

    // Edited while that request is still open, and left long enough that the
    // new debounce expires before the first save comes back. Without an
    // in-flight guard this is where a second request goes out behind the first,
    // both carrying version 3, and one of them loses.
    await render(titled(doc, "second"), save)
    await tick(AUTOSAVE_DELAY_MS * 4)
    expect(save).toHaveBeenCalledTimes(1)

    await act(async () => release(ok(4)))
    expect(latest().status).toEqual({ kind: "dirty" })

    await tick()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]![0].title).toBe("second")
    expect(save.mock.calls[1]![1]).toBe(4)
  })

  it("retries a transient failure on its own and recovers", async () => {
    const doc = createQuizDoc("M")
    const save = vi
      .fn<Save>()
      .mockResolvedValueOnce({
        ok: false,
        reason: "transient",
        message: "Could not reach the quiz service.",
      })
      .mockResolvedValueOnce(ok(4))

    await render(doc, save)
    await render(titled(doc, "Midterm"), save)
    await tick()

    expect(latest().status).toEqual({
      kind: "failed",
      message: "Could not reach the quiz service.",
      canRetry: false,
    })

    await tick(backoffMs(1))

    expect(save).toHaveBeenCalledTimes(2)
    expect(latest().status.kind).toBe("saved")
  })

  it("stops retrying after five attempts and waits to be asked", async () => {
    const doc = createQuizDoc("M")
    const save = vi.fn<Save>(
      async (): Promise<SaveResult> => ({
        ok: false,
        reason: "transient",
        message: "down",
      })
    )

    await render(doc, save)
    await render(titled(doc, "Midterm"), save)
    await tick()
    for (const attempt of [1, 2, 3, 4]) await tick(backoffMs(attempt))

    expect(save).toHaveBeenCalledTimes(5)
    expect(latest().status).toEqual({ kind: "failed", message: "down", canRetry: true })

    // It has given up, so nothing more happens by itself.
    await tick(60_000)
    expect(save).toHaveBeenCalledTimes(5)

    await act(async () => latest().retryNow())
    expect(save).toHaveBeenCalledTimes(6)
  })

  it("treats a thrown Server Action as transient rather than guessing", async () => {
    const doc = createQuizDoc("M")
    const save = vi.fn<Save>(async () => {
      throw new Error("An error occurred in the Server Components render.")
    })

    await render(doc, save)
    await render(titled(doc, "Midterm"), save)
    await tick()

    expect(latest().status.kind).toBe("failed")
  })

  it("never retries a conflict, because the same body can only fail again", async () => {
    const doc = createQuizDoc("M")
    const save = vi.fn<Save>(
      async (): Promise<SaveResult> => ({
        ok: false,
        reason: "conflict",
        message: "This quiz was edited somewhere else (now at version 8).",
      })
    )

    await render(doc, save)
    await render(titled(doc, "Midterm"), save)
    await tick()

    expect(latest().status).toEqual({
      kind: "conflict",
      message: "This quiz was edited somewhere else (now at version 8).",
    })

    await tick(60_000)
    await render(titled(doc, "more typing"), save)
    await tick(60_000)
    await act(async () => latest().retryNow())

    expect(save).toHaveBeenCalledTimes(1)
  })

  it("does not retry a quiz that is gone", async () => {
    const doc = createQuizDoc("M")
    const save = vi.fn<Save>(
      async (): Promise<SaveResult> => ({
        ok: false,
        reason: "gone",
        message: "No such quiz.",
      })
    )

    await render(doc, save)
    await render(titled(doc, "Midterm"), save)
    await tick()
    await tick(60_000)

    expect(save).toHaveBeenCalledTimes(1)
    expect(latest().status.kind).toBe("conflict")
  })

  it("warns before unload only while something is unsaved", async () => {
    const doc = createQuizDoc("M")
    const save = vi.fn<Save>(async () => ok(4))
    const added = vi.spyOn(window, "addEventListener")
    const removed = vi.spyOn(window, "removeEventListener")

    await render(doc, save)
    expect(added.mock.calls.some(([type]) => type === "beforeunload")).toBe(false)

    await render(titled(doc, "Midterm"), save)
    expect(added.mock.calls.some(([type]) => type === "beforeunload")).toBe(true)

    await tick()
    expect(latest().hasUnsavedChanges).toBe(false)
    expect(removed.mock.calls.some(([type]) => type === "beforeunload")).toBe(true)

    added.mockRestore()
    removed.mockRestore()
  })
})

describe("backoffMs", () => {
  it("doubles, then stops growing", () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 20_000,
    ])
  })
})
