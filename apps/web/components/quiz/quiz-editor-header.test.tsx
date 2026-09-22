/**
 * The header is where a teacher reads the state of the whole quiz. What it
 * says about points has to agree with the question editor below it, and the
 * two do not compute it the same way: several kinds derive their total.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  createBlank,
  createOption,
  createQuestion,
  createQuizDoc,
  type QuizDoc,
} from "@workspace/quiz-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/quiz-actions", () => ({
  publishQuizAction: vi.fn(),
  unpublishQuizAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }))

const { QuizEditorHeader } = await import("./quiz-editor-header")

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

async function mount(doc: QuizDoc) {
  await act(async () => {
    root.render(
      <QuizEditorHeader
        quizId="quiz-1"
        doc={doc}
        status="draft"
        url={null}
        hasUnpublishedChanges={false}
        saveStatus={{ kind: "saved", at: null }}
        selectedId={null}
        canUndo={false}
        canRedo={false}
        onUndo={() => {}}
        onRedo={() => {}}
        onTitleChange={() => {}}
        onDescriptionChange={() => {}}
        onSettingsChange={() => {}}
        onRetry={() => {}}
        onReload={() => {}}
        onSelectQuestion={() => {}}
        onPublished={() => {}}
      />
    )
  })
}

function text() {
  return container.textContent ?? ""
}

function docWith(questions: QuizDoc["questions"]): QuizDoc {
  return { ...createQuizDoc("Quiz"), questions }
}

describe("the points total", () => {
  it("adds up questions that carry their own total", async () => {
    await mount(
      docWith([
        { ...createQuestion("essay"), points: 5 },
        { ...createQuestion("true_false"), points: 2 },
      ])
    )

    expect(text()).toContain("7 pts")
  })

  it("derives a many-answer question rather than trusting its stored total", async () => {
    // What a quiz authored before per-answer scoring looks like: a total that
    // no longer follows from the answers marked correct.
    await mount(
      docWith([
        {
          ...createQuestion("multiple_choice"),
          points: 99,
          pointsPerCorrect: 3,
          options: [
            { ...createOption("a"), correct: true },
            { ...createOption("b"), correct: true },
            { ...createOption("c"), correct: false },
          ],
        },
      ])
    )

    expect(text()).toContain("6 pts")
    expect(text()).not.toContain("99")
  })

  it("derives a fill-in-the-blank question the same way", async () => {
    await mount(
      docWith([
        {
          ...createQuestion("fill_in_blank"),
          points: 40,
          pointsPerCorrect: 2,
          blanks: [createBlank(), createBlank(), createBlank()],
        },
      ])
    )

    expect(text()).toContain("6 pts")
  })

  it("says pt, not pts, for a one-point quiz", async () => {
    await mount(docWith([{ ...createQuestion("essay"), points: 1 }]))
    expect(text()).toContain("1 pt")
    expect(text()).not.toContain("1 pts")
  })
})

describe("the title field", () => {
  /** The invisible twin that gives the field its width, beside the input. */
  function sizer() {
    const cell = container.querySelector('[data-slot="input"]')!.parentElement!
    return cell.previousElementSibling!
  }

  it("mirrors the title, so the box is as wide as the name in it", async () => {
    await mount({
      ...createQuizDoc("Introduction to Computer Science"),
      questions: [],
    })

    expect(sizer().textContent).toBe("Introduction to Computer Science")
    // Measured, never read out: the input already carries the title.
    expect(sizer().getAttribute("aria-hidden")).toBe("true")
  })

  it("measures the placeholder while there is no title", async () => {
    await mount({ ...createQuizDoc(""), questions: [] })

    // Otherwise an untitled quiz collapses the field to nothing and the
    // placeholder it is meant to show has nowhere to sit.
    expect(sizer().textContent).toBe("Untitled quiz")
  })
})

describe("the header's two halves", () => {
  it("reads state beside the title and actions at the far end", async () => {
    await mount(docWith([{ ...createQuestion("essay"), points: 3 }]))

    const order = ["Quiz title", "Undo", "Redo", "Quiz settings"].map((label) =>
      [...container.querySelectorAll("[aria-label]")].findIndex(
        (el) => el.getAttribute("aria-label") === label
      )
    )

    // Every one present, and in this order: the title first, the history pair
    // together, then the document-level controls.
    expect(order.every((i) => i >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it("keeps the save readout out of the action run", async () => {
    await mount(docWith([]))

    const saved = container.querySelector("[aria-live=polite]")!
    const undo = container.querySelector('[aria-label="Undo"]')!

    // The readout precedes the buttons now; it used to sit between them and
    // Preview, where it read as one more control.
    expect(saved.compareDocumentPosition(undo)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
  })
})
