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

describe("question images", () => {
  const IMAGE_ID = "0198c5a4-2f6f-4b58-9f5a-1c2d3e4f5a6b"

  function withImage(): Question {
    return {
      ...trueFalse(),
      promptDoc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Water boils at 100C." }],
          },
          { type: "image", attrs: { mediaId: IMAGE_ID, alt: "A phase diagram" } },
        ],
      },
    }
  }

  async function showWithResolver(
    question: ManifestQuestion,
    resolveImageSrc?: (id: string) => string | undefined
  ) {
    await act(async () => {
      root.render(
        <QuestionView
          question={question}
          index={0}
          total={1}
          answer={{}}
          resolveImageSrc={resolveImageSrc}
        />
      )
    })
  }

  it("renders the image through the caller's resolver, with its alt text", async () => {
    await showWithResolver(projected(withImage()), (id) => `/api/media/${id}`)

    const img = container.querySelector("img")
    expect(img?.getAttribute("src")).toBe(`/api/media/${IMAGE_ID}`)
    expect(img?.getAttribute("alt")).toBe("A phase diagram")
  })

  it("renders no image at all when the resolver cannot place the id", async () => {
    // Better a question without its picture than a broken image frame mid-exam.
    await showWithResolver(projected(withImage()), () => undefined)
    expect(container.querySelector("img")).toBeNull()
  })

  it("renders an image inside an answer option, resolved the same way", async () => {
    const base = singleChoice()
    if (!("options" in base)) throw new Error("expected options")
    const question = {
      ...base,
      options: base.options.map((option, i) =>
        i === 0
          ? {
              ...option,
              labelDoc: {
                type: "doc" as const,
                content: [
                  ...option.labelDoc.content,
                  {
                    type: "image" as const,
                    attrs: { mediaId: IMAGE_ID, alt: "Seven tallies" },
                  },
                ],
              },
            }
          : option
      ),
    }

    await showWithResolver(projected(question), (id) => `data:image/png;base64,${id}`)

    const img = container.querySelector("img")
    expect(img?.getAttribute("src")).toBe(`data:image/png;base64,${IMAGE_ID}`)
    expect(img?.getAttribute("alt")).toBe("Seven tallies")
  })

  it("renders no image without a resolver, and none for a question without one", async () => {
    await showWithResolver(projected(withImage()))
    expect(container.querySelector("img")).toBeNull()

    await showWithResolver(projected(trueFalse()), () => "/never-asked")
    expect(container.querySelector("img")).toBeNull()
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
    // "hotspot" is not a real kind; it stands in for whatever ships next.
    const future = { ...projected(essay()), kind: "hotspot" } as unknown as ManifestQuestion

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

// ---------------------------------------------------------------------------
// The four newer kinds
// ---------------------------------------------------------------------------

function numeric(): Question {
  return {
    ...createQuestion("numeric"),
    promptDoc: richDocFromText("Boiling point of water at sea level?"),
    correctValue: 100,
    tolerance: 0.5,
    unit: "°C",
  }
}

function fillInBlank(): Question {
  const base = createQuestion("fill_in_blank")
  if (!("blanks" in base)) throw new Error("expected blanks")
  return {
    ...base,
    promptDoc: richDocFromText("Water is ___ and ___."),
    blanks: [
      { ...base.blanks[0]!, acceptedAnswers: ["hydrogen"] },
      { id: "blank-2", acceptedAnswers: ["oxygen"] },
    ],
  }
}

function matchingQ(): Question {
  const base = createQuestion("matching")
  if (!("pairs" in base)) throw new Error("expected pairs")
  return {
    ...base,
    promptDoc: richDocFromText("Match organelle to role."),
    pairs: [
      { ...base.pairs[0]!, leftText: "Mitochondrion", rightText: "ATP" },
      { ...base.pairs[1]!, leftText: "Chloroplast", rightText: "Photosynthesis" },
    ],
    distractors: [{ id: "distractor-1", text: "Waste disposal" }],
  }
}

function orderingQ(): Question {
  const base = createQuestion("ordering")
  if (!("items" in base)) throw new Error("expected items")
  return {
    ...base,
    promptDoc: richDocFromText("Order the phases."),
    items: [
      { ...base.items[0]!, labelDoc: richDocFromText("Prophase") },
      { ...base.items[1]!, labelDoc: richDocFromText("Metaphase") },
      { ...base.items[2]!, labelDoc: richDocFromText("Anaphase") },
    ],
  }
}

function typeInto(input: HTMLInputElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )!.set!
  setValue.call(input, text)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("numeric answers", () => {
  it("shows the unit and emits the raw string, never a parsed number", async () => {
    const seen: unknown[] = []
    await show(projected(numeric()), { onChange: (v) => seen.push(v) })

    expect(container.textContent).toContain("°C")
    const input = container.querySelector<HTMLInputElement>("input[inputmode=decimal]")!
    await act(async () => typeInto(input, "99.50"))

    expect(seen.at(-1)).toBe("99.50")
  })

  it("never renders the correct value or tolerance", async () => {
    await show(projected(numeric()), { readOnly: true })
    expect(container.innerHTML).not.toContain("100")
    expect(container.innerHTML).not.toContain("tolerance")
  })
})

describe("fill-in-the-blank answers", () => {
  it("renders one input per blank and emits a dense positional array", async () => {
    const seen: unknown[] = []
    await show(projected(fillInBlank()), { onChange: (v) => seen.push(v) })

    expect(container.textContent).toContain("Answer 1")
    expect(container.textContent).toContain("Answer 2")
    const fields = [...container.querySelectorAll<HTMLInputElement>("input")]
    expect(fields).toHaveLength(2)

    await act(async () => typeInto(fields[1]!, "oxygen"))
    expect(seen.at(-1)).toEqual(["", "oxygen"])
  })

  it("leaves a lone blank unlabelled, but still names it for a screen reader", async () => {
    const one = fillInBlank()
    if (one.kind !== "fill_in_blank") throw new Error("bad fixture")
    one.blanks = [one.blanks[0]!]
    one.promptDoc = richDocFromText("Water is ___.")

    await show(projected(one), {})

    // Nothing numbered: with one box the prompt has already said what goes in
    // it, and "Blank 1" above it is furniture.
    expect(container.textContent).not.toContain("Answer 1")
    expect(container.textContent).not.toContain("Blank")

    const field = container.querySelector<HTMLInputElement>("input")!
    expect(field.getAttribute("aria-label")).toBe("Your answer")
  })

  it("tolerates a stale non-array answer", async () => {
    await show(projected(fillInBlank()), { value: "left over essay text" })
    const fields = [...container.querySelectorAll<HTMLInputElement>("input")]
    expect(fields.map((f) => f.value)).toEqual(["", ""])
  })
})

describe("matching answers", () => {
  it("offers one choice control per left item over every right item", async () => {
    const q = matchingQ()
    await show(projected(q), { onChange: () => {} })

    expect(container.textContent).toContain("Mitochondrion")
    expect(container.textContent).toContain("Chloroplast")
    const triggers = [...container.querySelectorAll('[aria-label^="Match for"]')]
    expect(triggers).toHaveLength(2)
  })

  it("read-only renders the chosen match as text, or a dash when unanswered", async () => {
    const q = matchingQ()
    const manifest = projected(q)
    if (q.kind !== "matching") throw new Error("expected matching")
    const record = { [q.pairs[0]!.leftId]: q.pairs[0]!.rightId }

    await show(manifest, { readOnly: true, value: record })

    expect(container.textContent).toContain("ATP")
    expect(container.textContent).toContain("—")
    expect(container.querySelector('[aria-label^="Match for"]')).toBeNull()
  })

  it("tolerates a stale array or document answer without crashing", async () => {
    await show(projected(matchingQ()), { readOnly: true, value: ["stale-id"] })
    expect(container.textContent).toContain("Mitochondrion")
  })

  it("shows the chosen match by name on the closed control, never its id", async () => {
    const q = matchingQ()
    const manifest = projected(q)
    if (q.kind !== "matching") throw new Error("expected matching")
    const rightId = q.pairs[0]!.rightId

    await show(manifest, { value: { [q.pairs[0]!.leftId]: rightId }, onChange: () => {} })

    const trigger = container.querySelector('[aria-label^="Match for"]')!
    // Base UI renders the raw value here unless the root is handed an item
    // map, and the raw value is an opaque id no student can read.
    expect(trigger.textContent).toContain("ATP")
    expect(trigger.textContent).not.toContain(rightId)
  })

  it("shows the placeholder while nothing is chosen", async () => {
    await show(projected(matchingQ()), { onChange: () => {} })

    const trigger = container.querySelector('[aria-label^="Match for"]')!
    expect(trigger.textContent).toContain("Choose a match")
  })
})

describe("ordering answers", () => {
  it("presents manifest order for an untouched question and reorders on move", async () => {
    const q = orderingQ()
    if (q.kind !== "ordering") throw new Error("expected ordering")
    const manifest = projected(q)
    const seen: unknown[] = []

    await show(manifest, { onChange: (v) => seen.push(v) })

    // The projection de-correlates: displayed order is id-sorted.
    const displayedIds = manifest.choices.map((c) => c.id)
    expect(displayedIds).toEqual([...q.items.map((i) => i.id)].sort())

    const firstLabel = manifest.choices[0]!.label
    await act(async () => {
      container
        .querySelector<HTMLElement>(`[aria-label='Move "${firstLabel}" down']`)!
        .click()
    })

    const emitted = seen.at(-1) as string[]
    expect(emitted).toHaveLength(3)
    expect(emitted[1]).toBe(displayedIds[0])
    expect([...emitted].sort()).toEqual([...displayedIds].sort())
  })

  it("drops stale foreign ids and appends unmentioned items", async () => {
    const manifest = projected(orderingQ())
    const [a, b, c] = manifest.choices.map((x) => x.id)

    await show(manifest, { value: ["gone-id", c!, a!], onChange: () => {} })

    const rows = [...container.querySelectorAll("li")]
    const texts = rows.map((r) => r.textContent ?? "")
    const labelOf = (id: string) => manifest.choices.find((x) => x.id === id)!.label
    expect(texts[0]).toContain(labelOf(c!))
    expect(texts[1]).toContain(labelOf(a!))
    expect(texts[2]).toContain(labelOf(b!))
  })

  it("read-only hides the move buttons", async () => {
    await show(projected(orderingQ()), { readOnly: true })
    expect(container.querySelector('[aria-label^="Move"]')).toBeNull()
  })
})

describe("shuffled options", () => {
  function shuffledChoice(): Question {
    const q = singleChoice()
    if (!("shuffleOptions" in q)) throw new Error("expected choice")
    return { ...q, shuffleOptions: true }
  }

  async function renderedLabels(
    question: ManifestQuestion,
    seed: string
  ): Promise<string[]> {
    await act(async () => {
      root.render(
        <QuestionView
          question={question}
          index={0}
          total={1}
          answer={{}}
          shuffleSeed={seed}
        />
      )
    })
    return [...container.querySelectorAll("label")].map((l) => l.textContent ?? "")
  }

  it("orders by the seed, keeps every option, and is stable per seed", async () => {
    // One manifest for both renders: the seed keys off the question id, so a
    // freshly minted question would legitimately shuffle differently.
    const question = projected(shuffledChoice())
    const first = await renderedLabels(question, "sitting-1")
    const again = await renderedLabels(question, "sitting-1")

    expect(first).toEqual(again)
    expect([...first].sort()).toEqual(question.choices.map((c) => c.label).sort())
  })
})
