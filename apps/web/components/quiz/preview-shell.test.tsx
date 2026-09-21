/**
 * The preview's job is to be the student's screen, minus the parts that would
 * be a lie. These cover the paging and the two things it must never do: show an
 * answer, or record an attempt.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  createOption,
  createQuestion,
  createQuizDoc,
  project,
  richDocFromText,
  type ExamManifest,
  type Question,
} from "@workspace/quiz-core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { PreviewShell } from "./preview-shell"

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

function questions(): Question[] {
  const choice = createQuestion("single_choice")
  if (!("options" in choice)) throw new Error("expected options")

  return [
    {
      ...createQuestion("true_false"),
      correct: true,
      promptDoc: richDocFromText("Water boils at 100C."),
    },
    {
      ...choice,
      promptDoc: richDocFromText("Pick the prime."),
      options: [{ ...createOption("7"), correct: true }, createOption("9")],
    },
    { ...createQuestion("essay"), promptDoc: richDocFromText("Explain why.") },
  ]
}

function manifestOf(
  settings: Partial<ReturnType<typeof createQuizDoc>["settings"]> = {},
  qs: Question[] = questions()
): ExamManifest {
  const base = createQuizDoc("Midterm")
  return project("quiz-1", {
    ...base,
    settings: { ...base.settings, ...settings },
    questions: qs,
  })
}

async function show(manifest: ExamManifest) {
  await act(async () => {
    root.render(
      <PreviewShell
        quizId="quiz-1"
        manifest={manifest}
        hasUnpublishedChanges={false}
        status="draft"
      />
    )
  })
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label
  )
}

describe("one question per page", () => {
  it("starts on the first question and shows only that one", async () => {
    await show(manifestOf())

    expect(container.textContent).toContain("Water boils at 100C.")
    expect(container.textContent).not.toContain("Pick the prime.")
    expect(container.textContent).toContain("1 of 3")
  })

  it("walks forward and back", async () => {
    await show(manifestOf())

    await act(async () => button("Next")!.click())
    expect(container.textContent).toContain("Pick the prime.")

    await act(async () => button("Previous")!.click())
    expect(container.textContent).toContain("Water boils at 100C.")
  })

  it("has no Previous to press on the first question", async () => {
    await show(manifestOf())
    expect(button("Previous")?.disabled).toBe(true)
  })

  it("offers Submit instead of Next on the last question", async () => {
    await show(manifestOf())

    await act(async () => button("Next")!.click())
    await act(async () => button("Next")!.click())

    expect(button("Next")).toBeUndefined()
    // Inert: a preview that could file a result would pollute real ones.
    expect(button("Submit")?.disabled).toBe(true)
  })

  it("disables going back when the quiz forbids it", async () => {
    await show(manifestOf({ allowBacktracking: false }))

    await act(async () => button("Next")!.click())

    expect(button("Previous")?.disabled).toBe(true)
    expect(container.textContent).toContain("no going back")
  })

  it("keeps an answer while paging away and back", async () => {
    await show(manifestOf())

    const radios = [...container.querySelectorAll<HTMLInputElement>("input[type=radio]")]
    await act(async () => radios[0]!.click())

    await act(async () => button("Next")!.click())
    await act(async () => button("Previous")!.click())

    const after = [...container.querySelectorAll<HTMLInputElement>("input[type=radio]")]
    expect(after[0]!.checked).toBe(true)
  })

  it("says so when there is nothing to preview", async () => {
    await show(manifestOf({}, []))

    expect(container.textContent).toContain("Nothing to preview")
    expect(button("Submit")).toBeUndefined()
  })
})

describe("what the preview must not show", () => {
  it("marks no option as correct, on any page", async () => {
    const manifest = manifestOf()
    expect(manifest.questions).toHaveLength(3)

    // One mount, paged through: `show` re-renders into the same root, so the
    // page index would survive a second call and the walk would not restart.
    await show(manifest)

    for (let page = 1; page <= manifest.questions.length; page++) {
      const rendered = `${container.textContent} ${container.innerHTML}`
      expect(rendered, `page ${page}`).not.toMatch(/correct/i)

      const next = button("Next")
      if (next) await act(async () => next.click())
      else expect(page).toBe(manifest.questions.length)
    }
  })

  it("shows the quiz settings without pretending to enforce them", async () => {
    // The duration is worth stating; a running countdown would either be a lie
    // or would run a teacher out of time reading their own questions.
    await show(manifestOf({ durationS: 2_700 }))

    expect(container.textContent).toContain("45m")
    expect(container.querySelector('[role="timer"]')).toBeNull()
  })
})
