/**
 * The drag itself is not exercised here. jsdom reports every element as zero by
 * zero, so dnd-kit's collision detection has nothing to work with and a
 * simulated drag would prove only that the mock agreed with itself. What these
 * cover is what a broken drag setup actually looks like from outside: no
 * handle, a handle that cannot be focused, or a handle that swallows selection.
 * The reorder itself is a pure function, tested in lib/quiz/reducer.test.ts.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createQuestion, validateQuiz, createQuizDoc, type Question } from "@workspace/quiz-core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { QuestionRail } from "./question-rail"

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

const questions: Question[] = [
  createQuestion("true_false"),
  createQuestion("single_choice"),
  createQuestion("essay"),
]

async function mount(overrides: Partial<React.ComponentProps<typeof QuestionRail>> = {}) {
  const props: React.ComponentProps<typeof QuestionRail> = {
    questions,
    selectedId: questions[0]!.id,
    issues: [],
    onSelect: () => {},
    onAdd: () => {},
    onReorder: () => {},
    ...overrides,
  }

  await act(async () => {
    root.render(<QuestionRail {...props} />)
  })
}

function handles(): HTMLButtonElement[] {
  return [...container.querySelectorAll("button")].filter((b) =>
    b.getAttribute("aria-label")?.startsWith("Reorder question")
  )
}

describe("question rail", () => {
  it("gives every question a named, focusable reorder handle", async () => {
    await mount()

    expect(handles().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Reorder question 1",
      "Reorder question 2",
      "Reorder question 3",
    ])

    // Reordering is the only way to change question order, so a handle that
    // cannot take focus puts it out of reach without a mouse.
    for (const handle of handles()) {
      expect(handle.tabIndex).toBe(0)
    }
  })

  it("keeps selecting separate from grabbing", async () => {
    const selected: string[] = []
    await mount({ onSelect: (id) => selected.push(id) })

    const rows = [...container.querySelectorAll("li")]
    expect(rows).toHaveLength(3)

    // The handle is its own control, so clicking a row still selects it.
    const selectButton = [...rows[1]!.querySelectorAll("button")].find(
      (b) => !b.getAttribute("aria-label")?.startsWith("Reorder")
    )
    await act(async () => selectButton!.click())

    expect(selected).toEqual([questions[1]!.id])
  })

  it("marks the question a teacher has to come back to", async () => {
    const doc = { ...createQuizDoc("Midterm"), questions }
    const issues = validateQuiz(doc)
    // A fresh single-choice question has no correct answer yet.
    expect(issues.some((i) => i.questionId === questions[1]!.id)).toBe(true)

    await mount({ issues })

    expect(container.textContent).toContain("issue")
  })
})
