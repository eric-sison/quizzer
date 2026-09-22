/**
 * Proves the registry dispatch works for every kind: each question renders its
 * own answer configuration, while prompt, points and required stay shared.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  createBlank,
  createOption,
  createQuestion,
  richDocFromText,
  withDerivedPoints,
  type Question,
} from "@workspace/quiz-core"
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

/**
 * Type into a controlled field. React listens for the native input event, so
 * the value has to be set through the prototype setter it does not shadow.
 */
async function typeInto(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)
  if (!input) throw new Error(`no input matching ${selector}`)
  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )!.set!
  await act(async () => {
    setValue.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function labels() {
  return [...container.querySelectorAll("[aria-label]")].map((el) =>
    el.getAttribute("aria-label")
  )
}

describe("shared shell", () => {
  it.each([
    "true_false",
    "single_choice",
    "multiple_choice",
    "numeric",
    "fill_in_blank",
    "matching",
    "ordering",
    "essay",
  ] as const)(
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

  it("refuses to step the points of a many-answer question", async () => {
    const seen: Question[] = []
    // Two correct answers at the default rate: worth 2, and not by hand.
    const question = {
      ...createQuestion("multiple_choice"),
      options: [
        { ...createOption("a"), correct: true },
        { ...createOption("b"), correct: true },
      ],
    }
    await mount(withDerivedPoints(question), (q) => seen.push(q))

    const up = container.querySelector<HTMLButtonElement>(
      '[aria-label="Increase points"]'
    )!
    const down = container.querySelector<HTMLButtonElement>(
      '[aria-label="Decrease points"]'
    )!

    expect(up.disabled).toBe(true)
    expect(down.disabled).toBe(true)

    await act(async () => up.click())
    expect(seen).toEqual([])
  })

  it("shows the total its per-answer scoring produces", async () => {
    await mount(
      withDerivedPoints({
        ...createQuestion("multiple_choice"),
        pointsPerCorrect: 3,
        options: [
          { ...createOption("a"), correct: true },
          { ...createOption("b"), correct: true },
          { ...createOption("c"), correct: false },
        ],
      })
    )

    expect(text()).toContain("Worth 6 points")
    expect(text()).toContain("across 2 correct answers")
  })

  it("leaves every other kind's stepper alone", async () => {
    await mount(createQuestion("single_choice"))

    const up = container.querySelector<HTMLButtonElement>(
      '[aria-label="Increase points"]'
    )!
    expect(up.disabled).toBe(false)
  })
})

describe("per-kind answer configuration", () => {
  it("true/false offers the fixed pair and nothing to add", async () => {
    await mount(createQuestion("true_false"))

    expect(text()).toContain("True")
    expect(text()).toContain("False")
    expect(text()).not.toContain("Add option")
  })

  it("true/false can be reworded as yes/no without moving the answer", async () => {
    const changes: Question[] = []
    await mount({ ...createQuestion("true_false"), correct: false }, (q) =>
      changes.push(q)
    )

    const yesNo = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (tab) => tab.textContent === "Yes / No"
    )!
    await act(async () => yesNo.click())

    const next = changes.at(-1)
    if (next?.kind !== "true_false") throw new Error("wrong kind")
    expect(next.labelStyle).toBe("yes_no")
    // Wording only: the boolean the key is written against is untouched.
    expect(next.correct).toBe(false)

    await mount(next)
    const pair = [...container.querySelectorAll('[role="radio"]')].map(
      (radio) => radio.closest("label")?.textContent
    )
    expect(pair).toEqual(["Yes", "No"])
  })

  it("single choice offers options and the one/many switch", async () => {
    await mount(createQuestion("single_choice"))

    expect(text()).toContain("Add option")
    expect(text()).toContain("One answer")
    expect(text()).toContain("Exactly one must be correct")
  })

  it("options can carry an image, which survives retyping the caption", async () => {
    const withImage = {
      ...createOption("The left diagram"),
      labelDoc: {
        type: "doc" as const,
        content: [
          {
            type: "paragraph" as const,
            content: [{ type: "text" as const, text: "The left diagram" }],
          },
          {
            type: "image" as const,
            attrs: { mediaId: "0198c5a4-2f6f-4b58-9f5a-1c2d3e4f5a6b", alt: "Mitosis" },
          },
        ],
      },
    }
    const question = {
      ...createQuestion("multiple_choice"),
      options: [withImage, createOption("The right diagram")],
    }
    const seen: Question[] = []
    await mount(question, (q) => seen.push(q))

    // Both rows offer an upload; the one with an image shows it with its alt.
    expect(labels()).toContain("Replace the image on The left diagram")
    expect(labels()).toContain("Add an image to The right diagram")
    const img = container.querySelector("img")
    expect(img?.getAttribute("src")).toBe(
      "/api/media/0198c5a4-2f6f-4b58-9f5a-1c2d3e4f5a6b"
    )
    expect(img?.getAttribute("alt")).toBe("Mitosis")

    // Retyping the caption must not drop the picture.
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Option 1 text"]'
    )!
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )!.set!
    await act(async () => {
      setValue.call(input, "The corrected diagram")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const latest = seen.at(-1)
    if (!latest || !("options" in latest)) throw new Error("expected options")
    const doc = latest.options[0]!.labelDoc
    expect(JSON.stringify(doc)).toContain("The corrected diagram")
    const imageBlock = doc.content.find((block) => block.type === "image")
    expect(imageBlock).toBeDefined()
    // Alt text is positional, not authored: any edit re-syncs it to the
    // option's place in the list, so a screen reader never hears a stale one.
    expect(imageBlock).toMatchObject({ attrs: { alt: "Option 1" } })
  })

  it("removing an option's image keeps its caption", async () => {
    const question = {
      ...createQuestion("single_choice"),
      options: [
        {
          ...createOption("Seven"),
          labelDoc: {
            type: "doc" as const,
            content: [
              {
                type: "paragraph" as const,
                content: [{ type: "text" as const, text: "Seven" }],
              },
              {
                type: "image" as const,
                attrs: { mediaId: "0198c5a4-2f6f-4b58-9f5a-1c2d3e4f5a6b", alt: "" },
              },
            ],
          },
        },
        createOption("Nine"),
      ],
    }
    const seen: Question[] = []
    await mount(question, (q) => seen.push(q))

    await act(async () => {
      container
        .querySelector<HTMLElement>('[aria-label="Remove the image from Seven"]')!
        .click()
    })

    const latest = seen.at(-1)
    if (!latest || !("options" in latest)) throw new Error("expected options")
    const doc = latest.options[0]!.labelDoc
    expect(doc.content.some((block) => block.type === "image")).toBe(false)
    expect(JSON.stringify(doc)).toContain("Seven")
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

  it("multiple choice shows a per-answer value only on the correct rows", async () => {
    await mount({
      ...createQuestion("multiple_choice"),
      scoring: "per_option",
      options: [
        { ...createOption("a"), correct: true },
        { ...createOption("b"), correct: false },
      ],
    })

    expect(labels()).toContain("Points for a")
    expect(labels()).not.toContain("Points for b")
  })

  it("multiple choice hides the per-answer values under the flat rate", async () => {
    await mount({
      ...createQuestion("multiple_choice"),
      options: [{ ...createOption("a"), correct: true }, createOption("b")],
    })

    expect(labels()).not.toContain("Points for a")
    expect(labels()).toContain("Points per correct answer")
  })

  it("multiple choice flags a correct answer with no value typed on it", async () => {
    await mount({
      ...createQuestion("multiple_choice"),
      scoring: "per_option",
      options: [
        { ...createOption("a"), correct: true, points: 2 },
        { ...createOption("b"), correct: true },
      ],
    })

    const filled = container.querySelector('[aria-label="Points for a"]')
    const blank = container.querySelector('[aria-label="Points for b"]')

    expect(filled!.getAttribute("aria-invalid")).toBeNull()
    expect(blank!.getAttribute("aria-invalid")).toBe("true")
  })

  it("multiple choice re-totals as a per-answer value is typed", async () => {
    const seen: Question[] = []
    await mount(
      {
        ...createQuestion("multiple_choice"),
        scoring: "per_option",
        options: [
          { ...createOption("a"), correct: true },
          { ...createOption("b"), correct: true },
        ],
      },
      (q) => seen.push(q)
    )

    await typeInto('[aria-label="Points for a"]', "7")

    const latest = seen.at(-1)
    if (latest?.kind !== "multiple_choice") throw new Error("expected multiple choice")
    expect(latest.options[0]!.points).toBe(7)
    // The second answer is still blank, so it adds nothing.
    expect(latest.points).toBe(7)
  })

  it("multiple choice re-totals as answers are marked correct", async () => {
    const seen: Question[] = []
    await mount(
      withDerivedPoints({
        ...createQuestion("multiple_choice"),
        pointsPerCorrect: 5,
        options: [{ ...createOption("a"), correct: true }, createOption("b")],
      }),
      (q) => seen.push(q)
    )

    await act(async () => {
      container
        .querySelector<HTMLElement>(`[aria-label='Mark "b" as correct']`)!
        .click()
    })

    expect(seen.at(-1)?.points).toBe(10)
  })

  it("fill in the blank gets the same scoring block, in its own words", async () => {
    await mount(createQuestion("fill_in_blank"))

    expect(text()).toContain("SCORING")
    expect(text()).toContain("Same for each")
    expect(text()).toContain("Per blank")
    expect(labels()).toContain("Points per blank")
    expect(text()).toContain("Worth 1 point")
    expect(text()).toContain("across 1 blank")
  })

  it("fill in the blank prices every blank, not a correct subset", async () => {
    await mount({
      ...createQuestion("fill_in_blank"),
      scoring: "per_option",
      blanks: [
        { ...createBlank(), acceptedAnswers: ["helium"], points: 2 },
        { ...createBlank(), acceptedAnswers: ["neon"] },
      ],
    })

    expect(labels()).toContain("Points for blank 1")
    expect(labels()).toContain("Points for blank 2")
    // The unfilled one is flagged where it sits, not saved up for publish.
    expect(
      container
        .querySelector('[aria-label="Points for blank 2"]')!
        .getAttribute("aria-invalid")
    ).toBe("true")
  })

  it("fill in the blank re-totals as a blank is added", async () => {
    const seen: Question[] = []
    await mount(
      withDerivedPoints({
        ...createQuestion("fill_in_blank"),
        pointsPerCorrect: 4,
      }),
      (q) => seen.push(q)
    )

    const addButton = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Add blank")
    )
    await act(async () => addButton!.click())

    expect(seen.at(-1)?.points).toBe(8)
  })

  it("fill in the blank refuses to step its points", async () => {
    await mount(createQuestion("fill_in_blank"))

    const up = container.querySelector<HTMLButtonElement>(
      '[aria-label="Increase points"]'
    )!
    expect(up.disabled).toBe(true)
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

describe("the newer kinds' editors", () => {
  it("numeric offers value, tolerance and unit", async () => {
    await mount(createQuestion("numeric"))
    expect(text()).toContain("Correct value")
    expect(text()).toContain("Tolerance")
    expect(text()).toContain("Unit")
  })

  it("fill in the blank offers blanks and the case toggle", async () => {
    await mount(createQuestion("fill_in_blank"))
    expect(text()).toContain("Blank 1")
    expect(text()).toContain("Case sensitive")
    expect(text()).toContain("Add blank")
  })

  it("matching offers pairs and extra right-side items", async () => {
    await mount(createQuestion("matching"))
    expect(labels()).toContain("Pair 1 left side")
    expect(labels()).toContain("Pair 2 right side")
    expect(text()).toContain("Add pair")
    expect(text()).toContain("Add extra item")
  })

  it("ordering reuses the item list without any correct-marking", async () => {
    await mount(createQuestion("ordering"))
    // SectionHeader renders titles uppercased.
    expect(text().toUpperCase()).toContain("ITEMS, IN THE CORRECT ORDER")
    expect(text()).toContain("Add item")
    // No correct-marking controls at all in "none" mode. (The shell's own
    // Required checkbox remains, so assert on the marking affordances.)
    expect(container.querySelector("input[type=radio]")).toBeNull()
    expect(labels().some((l) => l?.startsWith("Mark "))).toBe(false)
  })
})

describe("the answer explanation", () => {
  it("is collapsed by default, edits into the question, and clears on collapse", async () => {
    const seen: Question[] = []
    const question = createQuestion("true_false")
    await mount(question, (q) => seen.push(q))

    expect(container.querySelector(".ProseMirror")).not.toBeNull() // the prompt
    const toggle = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Answer explanation")
    )!
    await act(async () => toggle.click())

    // Opening mints an empty explanation doc on the question.
    expect(seen.at(-1)?.explanationDoc).toBeDefined()

    await act(async () => toggle.click())
    expect(seen.at(-1)?.explanationDoc).toBeUndefined()
  })
})

describe("deleting a question", () => {
  async function openActions() {
    const trigger = container.querySelector<HTMLElement>(
      '[aria-label="Actions for question 1"]'
    )!
    await act(async () => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
      trigger.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
      trigger.click()
    })
  }

  function menuItem(label: string): HTMLElement {
    const item = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find(
      (el) => el.textContent?.includes(label)
    )
    if (!item) throw new Error(`no menu item: ${label}`)
    return item
  }

  it("asks first, and only confirming fires onDelete", async () => {
    let deleted = 0
    await act(async () => {
      root.render(
        <QuestionEditor
          quizId="quiz-1"
          question={createQuestion("essay")}
          index={0}
          total={3}
          onChange={() => {}}
          onDuplicate={() => {}}
          onMove={() => {}}
          onDelete={() => {
            deleted += 1
          }}
        />
      )
    })

    await openActions()
    await act(async () => menuItem("Delete question").click())

    // The menu item opened a dialog instead of deleting.
    expect(deleted).toBe(0)
    const dialog = document.querySelector('[role="alertdialog"]')
    expect(dialog?.textContent).toContain("Delete question 1?")

    const confirm = [...dialog!.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Delete"
    )!
    await act(async () => confirm.click())
    expect(deleted).toBe(1)
  })

  it("keeping it deletes nothing", async () => {
    let deleted = 0
    await act(async () => {
      root.render(
        <QuestionEditor
          quizId="quiz-1"
          question={createQuestion("essay")}
          index={0}
          total={3}
          onChange={() => {}}
          onDuplicate={() => {}}
          onMove={() => {}}
          onDelete={() => {
            deleted += 1
          }}
        />
      )
    })

    await openActions()
    await act(async () => menuItem("Delete question").click())
    const dialog = document.querySelector('[role="alertdialog"]')!
    const cancel = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Keep it"
    )!
    await act(async () => cancel.click())

    expect(deleted).toBe(0)
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  })
})

describe("pasting a list of options", () => {
  function paste(input: HTMLInputElement, textContent: string) {
    // jsdom has no DataTransfer; a plain event with a stubbed clipboardData is
    // what React's synthetic onPaste reads.
    const event = new Event("paste", { bubbles: true, cancelable: true })
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => textContent },
    })
    input.dispatchEvent(event)
  }

  it("turns a multi-line paste into one option per line", async () => {
    const seen: Question[] = []
    const question = createQuestion("multiple_choice")
    await mount(question, (q) => seen.push(q))

    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Option 1 text"]'
    )!
    await act(async () => paste(input, "Seven\nNine\nThirteen\n"))

    const latest = seen.at(-1)
    if (!latest || !("options" in latest)) throw new Error("expected options")
    // Blank option 1 took the first line; the rest were inserted after it.
    const labelsOf = latest.options.map((o) => JSON.stringify(o.labelDoc))
    expect(labelsOf[0]).toContain("Seven")
    expect(labelsOf[1]).toContain("Nine")
    expect(labelsOf[2]).toContain("Thirteen")
    expect(latest.options).toHaveLength(4) // the untouched second default stays
    expect(latest.options.every((o) => !o.correct)).toBe(true)
  })

  it("keeps typed text and appends the pasted lines after it", async () => {
    const seen: Question[] = []
    const base = createQuestion("multiple_choice")
    if (!("options" in base)) throw new Error("expected options")
    const question = {
      ...base,
      options: [
        { ...base.options[0]!, labelDoc: richDocFromText("Keep me") },
        base.options[1]!,
      ],
    }
    await mount(question, (q) => seen.push(q))

    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Option 1 text"]'
    )!
    await act(async () => paste(input, "A\nB"))

    const latest = seen.at(-1)
    if (!latest || !("options" in latest)) throw new Error("expected options")
    expect(JSON.stringify(latest.options[0]!.labelDoc)).toContain("Keep me")
    expect(JSON.stringify(latest.options[1]!.labelDoc)).toContain('"A"')
    expect(JSON.stringify(latest.options[2]!.labelDoc)).toContain('"B"')
  })

  it("leaves a single-line paste to the browser", async () => {
    const seen: Question[] = []
    await mount(createQuestion("multiple_choice"), (q) => seen.push(q))

    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Option 1 text"]'
    )!
    await act(async () => paste(input, "just one line"))

    // Not intercepted: no onChange fired from the paste handler itself.
    expect(seen).toHaveLength(0)
  })
})

describe("type switches and the newer kinds", () => {
  function openMenuFor(labelText: string) {
    const trigger = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(labelText)
    )!
    return act(async () => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
      trigger.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
      trigger.click()
    })
  }

  function radioItem(label: string): HTMLElement {
    const item = [...document.querySelectorAll('[role="menuitemradio"]')].find((el) =>
      el.textContent?.includes(label)
    ) as HTMLElement | undefined
    if (!item) throw new Error(`no menu item: ${label}`)
    return item
  }

  it("warns before discarding a numeric correct value", async () => {
    const question = {
      ...createQuestion("numeric"),
      correctValue: 100,
    }
    await mount(question)

    await openMenuFor("Numeric")
    await act(async () => radioItem("Essay").click())

    expect(document.body.textContent ?? "").toContain(
      "would discard the correct value and tolerance"
    )
  })

  it("carries the explanation across a kind switch", async () => {
    const changes: Question[] = []
    const question = {
      ...createQuestion("true_false"),
      explanationDoc: richDocFromText("Because water boils at 100C at sea level."),
    }
    await mount(question, (q) => changes.push(q))

    await openMenuFor("True / False")
    await act(async () => radioItem("Essay").click())

    const switched = changes.at(-1)
    expect(switched?.kind).toBe("essay")
    expect(JSON.stringify(switched?.explanationDoc)).toContain("sea level")
  })
})
