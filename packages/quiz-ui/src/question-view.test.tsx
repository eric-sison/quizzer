/**
 * Fixtures come from `project()` on a real authoring document, not from
 * hand-written manifests. A hand-written fixture only ever confirms what its
 * author already believed about the shape, which is how a wrong rich-text
 * schema once passed a full suite in this repo.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  createOption,
  createQuestion,
  createQuizDoc,
  project,
  richDocFromText,
  richDocSchema,
  type AnswerValue,
  type ExamManifest,
  type ManifestQuestion,
  type Question,
  type QuizDoc,
} from "@workspace/quiz-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { QuestionView } from "./question-view"

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

function docOf(...questions: Question[]): QuizDoc {
  return { ...createQuizDoc("Midterm"), questions }
}

function manifestOf(...questions: Question[]): ExamManifest {
  return project("quiz-1", docOf(...questions))
}

/** One projected question, so every test runs against real wire output. */
function projected(question: Question): ManifestQuestion {
  const [first] = manifestOf(question).questions
  if (!first) throw new Error("projection produced no question")
  return first
}

async function show(
  question: ManifestQuestion,
  answer: Parameters<typeof QuestionView>[0]["answer"] = {},
  index = 0,
  total = 4
) {
  await act(async () => {
    root.render(
      <QuestionView question={question} index={index} total={total} answer={answer} />
    )
  })
}

function inputs(type: string): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>(`input[type=${type}]`)]
}

function trueFalse(): Question {
  return { ...createQuestion("true_false"), promptDoc: richDocFromText("Water boils at 100C.") }
}

function singleChoice(): Question {
  const base = createQuestion("single_choice")
  if (!("options" in base)) throw new Error("expected options")
  return {
    ...base,
    promptDoc: richDocFromText("Pick the prime."),
    options: [
      { ...createOption("7"), correct: true },
      createOption("9"),
      createOption("15"),
    ],
  }
}

function multipleChoice(): Question {
  const base = createQuestion("multiple_choice")
  if (!("options" in base)) throw new Error("expected options")
  return {
    ...base,
    promptDoc: richDocFromText("Pick the primes."),
    options: [
      { ...createOption("7"), correct: true },
      createOption("9"),
      { ...createOption("13"), correct: true },
    ],
  }
}

function essay(overrides: Partial<{ minWords: number; maxWords: number }> = {}): Question {
  return {
    ...createQuestion("essay"),
    promptDoc: richDocFromText("Explain photosynthesis."),
    ...overrides,
  }
}

describe("the shared question header", () => {
  it("numbers the question within the paper", async () => {
    await show(projected(essay()), {}, 2, 9)
    expect(container.textContent).toContain("Question 3")
    expect(container.textContent).toContain("of 9")
  })

  it("names its own heading for screen readers", async () => {
    const question = projected(essay())
    await show(question)

    const section = container.querySelector("section")
    const labelledBy = section?.getAttribute("aria-labelledby")
    expect(labelledBy).toBeTruthy()
    expect(container.querySelector(`#${labelledBy}`)?.textContent).toContain("Question 1")
  })

  it("states the marks on offer and whether an answer is compulsory", async () => {
    const question = { ...projected(essay()), points: 5, required: true }
    await show(question)

    expect(container.textContent).toContain("5 points")
    expect(container.textContent).toContain("Required")
  })

  it("says nothing about points when the question carries none", async () => {
    await show({ ...projected(essay()), points: 0, required: false })
    expect(container.textContent).not.toContain("point")
    expect(container.textContent).not.toContain("Required")
  })

  it("renders the prompt", async () => {
    await show(projected(singleChoice()))
    expect(container.textContent).toContain("Pick the prime.")
  })
})

describe("the control follows the question kind", () => {
  it("gives true/false two radios labelled True and False", async () => {
    await show(projected(trueFalse()))

    expect(inputs("radio")).toHaveLength(2)
    expect(container.textContent).toContain("True")
    expect(container.textContent).toContain("False")
  })

  it("gives a one-answer question radios", async () => {
    await show(projected(singleChoice()))
    expect(inputs("radio")).toHaveLength(3)
    expect(inputs("checkbox")).toHaveLength(0)
  })

  it("gives a many-answer question checkboxes", async () => {
    await show(projected(multipleChoice()))
    expect(inputs("checkbox")).toHaveLength(3)
    expect(inputs("radio")).toHaveLength(0)
  })

  it("gives an essay the same constrained editor the prompt was written in", async () => {
    await show(projected(essay()))

    expect(container.querySelector(".ProseMirror")).not.toBeNull()
    for (const label of ["Bold", "Italic", "Bullet list", "Code"]) {
      expect(
        container.querySelector(`[aria-label="${label}"]`),
        `missing control: ${label}`
      ).not.toBeNull()
    }
  })

  it("offers an essay no control for anything off the allowlist", async () => {
    await show(projected(essay()))
    const labels = [...container.querySelectorAll("[aria-label]")].map((el) =>
      el.getAttribute("aria-label")
    )

    // A student must not be able to put a node in an answer that a prompt
    // could not contain, or the renderer would have cases the schema forbids.
    for (const forbidden of ["Link", "Image", "Heading", "Table"]) {
      expect(labels).not.toContain(forbidden)
    }
  })

  it("tells the student plainly when the kind is newer than this build", async () => {
    // What a desktop build predating a new question type receives. The Rust
    // side degrades the same way, via #[serde(other)].
    const future = { ...projected(essay()), kind: "matching" } as unknown as ManifestQuestion

    await show(future)
    expect(container.textContent).toContain("newer version of the exam app")
    expect(container.querySelector(".ProseMirror")).toBeNull()
  })
})

describe("answering", () => {
  it("reports the chosen option id for a one-answer question", async () => {
    const question = projected(singleChoice())
    const onChange = vi.fn<(value: AnswerValue) => void>()
    await show(question, { onChange })

    await act(async () => inputs("radio")[1]!.click())

    expect(onChange).toHaveBeenCalledWith(question.choices[1]!.id)
  })

  it("shows which option is already selected", async () => {
    const question = projected(singleChoice())
    await show(question, { value: question.choices[2]!.id, onChange: () => {} })

    expect(inputs("radio").map((i) => i.checked)).toEqual([false, false, true])
  })

  it("adds to and removes from a many-answer selection", async () => {
    const question = projected(multipleChoice())
    const [a, b] = question.choices
    const onChange = vi.fn<(value: AnswerValue) => void>()

    await show(question, { value: [a!.id], onChange })

    await act(async () => inputs("checkbox")[1]!.click())
    expect(onChange).toHaveBeenLastCalledWith([a!.id, b!.id])

    await act(async () => inputs("checkbox")[0]!.click())
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it("reports an essay answer as a document, not a string", async () => {
    const onChange = vi.fn<(value: AnswerValue) => void>()
    await show(projected(essay()), { onChange })

    // Drive the editor the way the toolbar does: the change has to come out of
    // ProseMirror for this to prove the wiring.
    await act(async () => {
      container.querySelector<HTMLElement>('[aria-label="Bullet list"]')!.click()
    })

    expect(onChange).toHaveBeenCalled()
    const reported = onChange.mock.calls.at(-1)?.[0]
    // Whatever it reported has to satisfy the shared schema, or it could not be
    // stored, shipped or rendered.
    expect(() => richDocSchema.parse(reported)).not.toThrow()
  })

  it("reads an essay answer that was stored as plain text", async () => {
    // Answers written before essays became rich text are bare strings.
    await show(projected(essay()), { value: "Plants convert light.", readOnly: true })
    expect(container.textContent).toContain("Plants convert light.")
  })

  it("ignores an answer of the wrong shape rather than half-reading it", async () => {
    // A single-choice answer stored against a question that later became
    // multiple-choice. The id is deliberately one of the real options: a
    // `String.includes` on the raw value would tick that box, which would show
    // a student a selection they never made.
    const question = projected(multipleChoice())
    await show(question, { value: question.choices[0]!.id, onChange: () => {} })

    expect(inputs("checkbox").map((i) => i.checked)).toEqual([false, false, false])
  })
})

describe("the preview is inert, not disabled", () => {
  it("accepts no input when no handler is given", async () => {
    const question = projected(singleChoice())
    await show(question, { value: question.choices[0]!.id })

    await act(async () => inputs("radio")[1]!.click())
    expect(inputs("radio")[0]!.checked).toBe(true)
  })

  it("refuses input even when a handler is supplied", async () => {
    const onChange = vi.fn<(value: AnswerValue) => void>()
    await show(projected(singleChoice()), { readOnly: true, onChange })

    await act(async () => inputs("radio")[1]!.click())
    expect(onChange).not.toHaveBeenCalled()
  })

  it("refuses a checkbox the same way", async () => {
    const onChange = vi.fn<(value: AnswerValue) => void>()
    await show(projected(multipleChoice()), { readOnly: true, onChange })

    await act(async () => inputs("checkbox")[0]!.click())
    expect(onChange).not.toHaveBeenCalled()
  })

  it("leaves the controls looking usable", async () => {
    // `disabled` would grey out the whole paper, which is not what a student
    // sees and so not what a preview should show.
    await show(projected(singleChoice()), { readOnly: true })
    expect(inputs("radio").some((i) => i.disabled)).toBe(false)
  })

  it("makes an essay editor read-only without hiding it", async () => {
    await show(projected(essay()), { readOnly: true })

    const surface = container.querySelector(".ProseMirror")
    expect(surface).not.toBeNull()
    expect(surface?.getAttribute("contenteditable")).toBe("false")
  })
})

describe("essay word count", () => {
  it("counts nothing before anything is typed", async () => {
    await show(projected(essay()))
    expect(container.textContent).toContain("0 words")
  })

  it("counts words, not characters", async () => {
    await show(projected(essay()), { value: "Plants convert light into sugar" })
    expect(container.textContent).toContain("5 words")
  })

  it("says one word in the singular", async () => {
    await show(projected(essay()), { value: "Photosynthesis" })
    expect(container.textContent).toContain("1 word")
  })

  it("states the limits before the student starts writing", async () => {
    await show(projected(essay({ minWords: 50, maxWords: 200 })))
    expect(container.textContent).toContain("50 to 200 expected")
  })

  it("states a lone minimum or a lone maximum", async () => {
    await show(projected(essay({ minWords: 50 })))
    expect(container.textContent).toContain("at least 50 expected")

    await show(projected(essay({ maxWords: 200 })))
    expect(container.textContent).toContain("at most 200 expected")
  })

  it("announces the count, since nothing the student clicked changed it", async () => {
    await show(projected(essay()))
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull()
  })
})

/**
 * The invariant the whole design exists to protect, checked at the last point
 * before a student's screen.
 */
describe("no answer reaches the rendered page", () => {
  it("renders every kind without any correct-answer marking", async () => {
    const manifest = manifestOf(trueFalse(), singleChoice(), multipleChoice(), essay())
    // Without this the loop below could pass by never running.
    expect(manifest.questions).toHaveLength(4)

    for (const [index, question] of manifest.questions.entries()) {
      await show(question, { readOnly: true }, index, manifest.questions.length)

      const rendered = `${container.textContent} ${container.innerHTML}`
      expect(rendered.toLowerCase()).not.toContain("correct")
      expect(rendered.toLowerCase()).not.toContain("answer key")
      // The option marked correct must look exactly like the others.
      expect(inputs("radio").some((i) => i.checked)).toBe(false)
      expect(inputs("checkbox").some((i) => i.checked)).toBe(false)
    }
  })

  it("does not show the marking rubric with the question", async () => {
    const withRubric: Question = {
      ...createQuestion("essay"),
      promptDoc: richDocFromText("Explain photosynthesis."),
      rubricDoc: richDocFromText("Award two marks for naming chlorophyll."),
    }

    await show(projected(withRubric), { readOnly: true })
    expect(container.textContent).not.toContain("chlorophyll")
  })
})
