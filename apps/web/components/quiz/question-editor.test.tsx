/**
 * Proves the registry dispatch works for every kind: each question renders its
 * own answer configuration, while prompt, points and required stay shared.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createOption, createQuestion, type Question } from "@workspace/quiz-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The image field reaches for a Server Action, whose module imports
// `server-only`; in this client-side test the action is a stub.
vi.mock("@/lib/quiz-actions", () => ({
  uploadQuestionImageAction: vi.fn(async () => ({ ok: false, message: "stubbed" })),
}))

import { QuestionEditor } from "./question-editor"

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

async function mount(question: Question, onChange: (q: Question) => void = () => {}) {
  await act(async () => {
    root.render(
      <QuestionEditor
        quizId="quiz-1"
        question={question}
        index={0}
        total={3}
        onChange={onChange}
        onDuplicate={() => {}}
        onMove={() => {}}
        onDelete={() => {}}
      />
    )
  })
}

function text() {
  return container.textContent ?? ""
}

function labels() {
  return [...container.querySelectorAll("[aria-label]")].map((el) =>
    el.getAttribute("aria-label")
  )
}

describe("shared shell", () => {
  it.each(["true_false", "single_choice", "multiple_choice", "essay"] as const)(
    "gives %s a prompt editor, points and required",
    async (kind) => {
      await mount(createQuestion(kind))

      expect(container.querySelector('[aria-label="Bold"]')).not.toBeNull()
      expect(labels()).toContain("Increase points")
      expect(text()).toContain("Required")
      expect(text()).toContain("Question 1")
    }
  )

  it("reports a points change through onChange", async () => {
    const seen: Question[] = []
    const question = createQuestion("essay")
    await mount(question, (q) => seen.push(q))

    await act(async () => {
      container.querySelector<HTMLElement>('[aria-label="Increase points"]')!.click()
    })

    expect(seen.at(-1)?.points).toBe(question.points + 1)
  })
})

describe("per-kind answer configuration", () => {
  it("true/false offers the fixed pair and nothing to add", async () => {
    await mount(createQuestion("true_false"))

    expect(text()).toContain("True")
    expect(text()).toContain("False")
    expect(text()).not.toContain("Add option")
  })

  it("single choice offers options and the one/many switch", async () => {
    await mount(createQuestion("single_choice"))

    expect(text()).toContain("Add option")
    expect(text()).toContain("One answer")
    expect(text()).toContain("Exactly one must be correct")
  })

  it("multiple choice counts how many are marked correct", async () => {
    const question = {
      ...createQuestion("multiple_choice"),
      options: [
        { ...createOption("a"), correct: true },
        { ...createOption("b"), correct: false },
        { ...createOption("c"), correct: true },
      ],
    }
    await mount(question)

    expect(text()).toContain("2 of 3 marked correct")
  })

  it("essay offers word bounds and says it is graded by hand", async () => {
    await mount(createQuestion("essay"))

    expect(text()).toContain("Min words")
    expect(text()).toContain("Max words")
    expect(text()).toContain("Graded manually")
    expect(text()).not.toContain("Add option")
  })
})

describe("editing options", () => {
  it("adds an option through onChange", async () => {
    const seen: Question[] = []
    const question = createQuestion("multiple_choice")
    await mount(question, (q) => seen.push(q))

    const addButton = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Add option")
    )
    await act(async () => addButton!.click())

    const next = seen.at(-1)
    expect(next?.kind).toBe("multiple_choice")
    if (next?.kind === "multiple_choice") {
      expect(next.options).toHaveLength(question.options.length + 1)
    }
  })

  it("marking one option correct clears the others when only one may be", async () => {
    const seen: Question[] = []
    const question = {
      ...createQuestion("single_choice"),
      options: [
        { ...createOption("a"), correct: true },
        { ...createOption("b"), correct: false },
      ],
    }
    await mount(question, (q) => seen.push(q))

    const marks = [...container.querySelectorAll<HTMLElement>("[aria-label^='Mark ']")]
    expect(marks).toHaveLength(2)
    await act(async () => marks[1]!.click())

    const next = seen.at(-1)
    if (next?.kind === "single_choice") {
      expect(next.options.filter((o) => o.correct)).toHaveLength(1)
      expect(next.options[1]?.correct).toBe(true)
    }
  })
})

describe("type menu", () => {
  /**
   * Opens the menu for real. Base UI reports a misplaced menu label through
   * console.error rather than by throwing, so this only fails via the guard in
   * vitest.setup.ts - which is the point: that class of bug used to reach a
   * browser console instead of CI.
   */
  async function openTypeMenu() {
    const trigger = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Essay")
    )
    expect(trigger).toBeDefined()

    await act(async () => {
      trigger!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
      trigger!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
      trigger!.click()
    })
  }

  /** Base UI portals menu content, so the items are not inside `container`. */
  function menuItem(label: string): HTMLElement | undefined {
    return [...document.querySelectorAll('[role="menuitemradio"]')].find((el) =>
      el.textContent?.includes(label)
    ) as HTMLElement | undefined
  }

  it("warns before a switch that would discard the answer options", async () => {
    const question = {
      ...createQuestion("multiple_choice"),
      options: [createOption("a"), createOption("b"), createOption("c")],
    }
    await mount(question)

    const trigger = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Multiple Choice")
    )
    await act(async () => {
      trigger!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
      trigger!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
      trigger!.click()
    })

    // Opening the menu must not itself warn about anything.
    expect(document.body.textContent ?? "").not.toContain("Switching to")

    const essay = menuItem("Essay")
    expect(essay).toBeDefined()
    await act(async () => essay!.click())

    const rendered = document.body.textContent ?? ""
    expect(rendered).toContain("Switching to")
    expect(rendered).toContain("would discard all 3 answer options")
  })

  it("does not warn when the switch loses nothing", async () => {
    const changes: Question[] = []
    await mount(createQuestion("true_false"), (q) => changes.push(q))

    const trigger = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("True / False")
    )
    await act(async () => {
      trigger!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
      trigger!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
      trigger!.click()
    })

    await act(async () => menuItem("Essay")!.click())

    expect(document.body.textContent ?? "").not.toContain("Switching to")
    expect(changes.at(-1)?.kind).toBe("essay")
  })

  it("names every kind, spelling out the two that share a short label", async () => {
    await mount(createQuestion("essay"))
    await openTypeMenu()

    const rendered = document.body.textContent ?? ""
    expect(rendered).toContain("Question type")
    expect(rendered).toContain("True / False")

    // The two choice variants share a short label, so the menu must spell out
    // which is which, otherwise it shows "Multiple Choice" twice.
    expect(rendered).toContain("Multiple Choice (one answer)")
    expect(rendered).toContain("Multiple Choice (many answers)")
  })
})
