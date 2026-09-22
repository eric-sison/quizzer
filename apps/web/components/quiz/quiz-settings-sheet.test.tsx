/**
 * The opening time is the one setting here that is stored in a different unit
 * from the one it is edited in: a teacher picks a wall-clock time, the document
 * holds an instant. These cover that conversion in both directions, because
 * getting it wrong means an exam that opens an hour early for a class in
 * another timezone and nobody finds out until it does.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createQuizDoc, quizSettingsSchema, type QuizSettings } from "@workspace/quiz-core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { QuizSettingsSheet } from "./quiz-settings-sheet"

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

async function open(
  settings: QuizSettings,
  onChange: (next: QuizSettings) => void = () => {}
) {
  await act(async () => {
    root.render(
      <QuizSettingsSheet
        settings={settings}
        description=""
        onChange={onChange}
        onDescriptionChange={() => {}}
      />
    )
  })

  await act(async () => {
    container.querySelector<HTMLElement>('[aria-label="Quiz settings"]')!.click()
  })
}

function tab(name: string) {
  return [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (el) => el.textContent === name
  )
}

function openingInput() {
  return document.querySelector<HTMLInputElement>('[aria-label="Opening time"]')
}

const base = createQuizDoc("Midterm").settings

describe("the opening time", () => {
  it("offers no time to set until one is asked for", async () => {
    await open(base)

    expect(openingInput()).toBeNull()
    expect(document.body.textContent).toContain("The link works the moment you publish")
  })

  it("seeds a time rather than an empty box, and stores it as an instant", async () => {
    const seen: QuizSettings[] = []
    await open(base, (next) => seen.push(next))

    await act(async () => tab("At a set time")!.click())

    const stored = seen.at(-1)?.opensAt
    expect(stored).toBeDefined()
    // Whatever it seeds has to be something the document will accept.
    expect(quizSettingsSchema.safeParse(seen.at(-1)).success).toBe(true)
    expect(new Date(stored!).getTime()).toBeGreaterThan(Date.now())
  })

  it("reads a stored instant back as the teacher's own wall clock", async () => {
    // Built from local parts, so this test says the same thing in any timezone
    // the suite happens to run in.
    const at = new Date(2026, 8, 22, 9, 0, 0, 0)
    await open({ ...base, opensAt: at.toISOString() })

    expect(openingInput()?.value).toBe("2026-09-22T09:00")
  })

  it("commits what was typed as an instant, and clears it on the way back", async () => {
    const seen: QuizSettings[] = []
    await open({ ...base, opensAt: new Date(2026, 8, 22, 9, 0).toISOString() }, (next) =>
      seen.push(next)
    )

    const input = openingInput()!
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )!.set!
    await act(async () => {
      setValue.call(input, "2026-09-22T14:30")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(seen.at(-1)?.opensAt).toBe(new Date(2026, 8, 22, 14, 30).toISOString())

    await act(async () => tab("As soon as published")!.click())

    // Absent, not undefined: the document schema is strict, and a key holding
    // nothing is not the same as no key.
    expect(seen.at(-1)).not.toHaveProperty("opensAt")
    expect(quizSettingsSchema.safeParse(seen.at(-1)).success).toBe(true)
  })
})
