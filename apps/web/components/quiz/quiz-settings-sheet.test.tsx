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

/** The radio for one option, reached the way a click on its label would. */
function option(name: string) {
  const label = [...document.querySelectorAll<HTMLLabelElement>("label")].find(
    (el) => el.textContent === name
  )
  if (!label?.htmlFor) throw new Error(`no option labelled ${name}`)

  const radio = document.getElementById(label.htmlFor)
  if (!radio) throw new Error(`${name} labels nothing`)
  return radio
}

function timeInput() {
  return document.querySelector<HTMLInputElement>('[aria-label="Opening time"]')
}

function dateButton() {
  return document.querySelector<HTMLElement>('[aria-label="Opening date"]')
}

/** Type into a controlled field the way React's own listener sees it. */
async function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )!.set!
  await act(async () => {
    setValue.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

const base = createQuizDoc("Midterm").settings

describe("the opening time", () => {
  it("offers no time to set until one is asked for", async () => {
    await open(base)

    expect(timeInput()).toBeNull()
    expect(dateButton()).toBeNull()
    expect(document.body.textContent).toContain("The link works the moment you publish")
  })

  it("seeds a time rather than an empty box, and stores it as an instant", async () => {
    const seen: QuizSettings[] = []
    await open(base, (next) => seen.push(next))

    await act(async () => option("At a set time").click())

    const stored = seen.at(-1)?.opensAt
    expect(stored).toBeDefined()
    // Whatever it seeds has to be something the document will accept.
    expect(quizSettingsSchema.safeParse(seen.at(-1)).success).toBe(true)
    expect(new Date(stored!).getTime()).toBeGreaterThan(Date.now())
  })

  it("reads a stored instant back as the teacher's own wall clock", async () => {
    // Built from local parts, so this test says the same thing in whatever
    // timezone the suite happens to run in.
    const at = new Date(2026, 8, 22, 9, 5, 0, 0)
    await open({ ...base, opensAt: at.toISOString() })

    expect(timeInput()?.value).toBe("09:05")
    // Compared against the same formatter rather than a fixed string, so the
    // assertion is about the date shown and not about the test's locale.
    expect(dateButton()?.textContent).toContain(
      at.toLocaleDateString(undefined, { dateStyle: "medium" })
    )
  })

  it("keeps the day when the time changes", async () => {
    const seen: QuizSettings[] = []
    await open({ ...base, opensAt: new Date(2026, 8, 22, 9, 0).toISOString() }, (next) =>
      seen.push(next)
    )

    await typeInto(timeInput()!, "14:30")

    // The date and the time are two controls over one instant; editing either
    // has to carry the other through untouched.
    expect(seen.at(-1)?.opensAt).toBe(new Date(2026, 8, 22, 14, 30).toISOString())
  })

  it("keeps the time when a day is picked from the calendar", async () => {
    const seen: QuizSettings[] = []
    await open({ ...base, opensAt: new Date(2026, 8, 22, 9, 30).toISOString() }, (next) =>
      seen.push(next)
    )

    await act(async () => dateButton()!.click())

    // The 24th of the month the picker opened on, chosen by its own label so
    // this does not depend on where in the grid that day lands.
    const day = [...document.querySelectorAll<HTMLElement>('[role="gridcell"] button')]
      .find((el) => el.textContent?.trim() === "24")
    expect(day, "no day cell to click").toBeDefined()
    await act(async () => day!.click())

    expect(seen.at(-1)?.opensAt).toBe(new Date(2026, 8, 24, 9, 30).toISOString())
  })

  it("ignores a half-typed time rather than storing something unparseable", async () => {
    const opensAt = new Date(2026, 8, 22, 9, 0).toISOString()
    const seen: QuizSettings[] = []
    await open({ ...base, opensAt }, (next) => seen.push(next))

    await typeInto(timeInput()!, "")

    expect(seen).toHaveLength(0)
  })

  it("clears the time on the way back to publishing immediately", async () => {
    const seen: QuizSettings[] = []
    await open({ ...base, opensAt: new Date(2026, 8, 22, 9, 0).toISOString() }, (next) =>
      seen.push(next)
    )

    await act(async () => option("As soon as published").click())

    // Absent, not undefined: the document schema is strict, and a key holding
    // nothing is not the same as no key.
    expect(seen.at(-1)).not.toHaveProperty("opensAt")
    expect(quizSettingsSchema.safeParse(seen.at(-1)).success).toBe(true)
  })
})
