/**
 * The dialog's job is to make a refusal legible. The server decides; this is
 * about what a teacher can see and do when it says no.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  createOption,
  createQuestion,
  createQuizDoc,
  richDocFromText,
  type Issue,
  type PublishResponse,
  type QuizDoc,
} from "@workspace/quiz-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const publishQuizAction = vi.fn()
const unpublishQuizAction = vi.fn()

vi.mock("@/lib/quiz-actions", () => ({ publishQuizAction, unpublishQuizAction }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }))

const { PublishDialog } = await import("./publish-dialog")

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  publishQuizAction.mockReset()
  unpublishQuizAction.mockReset()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

function publishable(): QuizDoc {
  const choice = createQuestion("single_choice")
  if (!("options" in choice)) throw new Error("expected options")

  return {
    ...createQuizDoc("Biology Midterm"),
    questions: [
      {
        ...choice,
        promptDoc: richDocFromText("Pick the prime."),
        options: [{ ...createOption("7"), correct: true }, createOption("9")],
      },
    ],
  }
}

/** Missing a title and any questions, so local validation objects. */
function unpublishable(): QuizDoc {
  return createQuizDoc("")
}

const selected: string[] = []

async function open(doc: QuizDoc, overrides: Partial<{ status: "draft" | "published"; url: string | null; hasUnpublishedChanges: boolean }> = {}) {
  selected.length = 0
  await act(async () => {
    root.render(
      <PublishDialog
        quizId="quiz-1"
        doc={doc}
        status={overrides.status ?? "draft"}
        url={overrides.url ?? null}
        hasUnpublishedChanges={overrides.hasUnpublishedChanges ?? false}
        onSelectQuestion={(id) => selected.push(id)}
      />
    )
  })

  // Base UI portals dialog content, so look at the whole document afterwards.
  await act(async () => trigger().click())
}

function trigger(): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")][0]
  if (!button) throw new Error("no trigger rendered")
  return button
}

function text(): string {
  return document.body.textContent ?? ""
}

/**
 * Scoped to the popup. The trigger also reads "Publish", and searching the
 * whole document finds it first, so an unscoped lookup clicks the trigger and
 * every assertion afterwards quietly describes a dialog that never advanced.
 */
function dialogButton(label: string): HTMLButtonElement | undefined {
  const dialog = document.querySelector('[role="dialog"]')
  if (!dialog) throw new Error("the dialog is not open")

  return [...dialog.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label
  )
}

const published: PublishResponse = {
  versionNo: 1,
  token: "abcdefghijklmnopqrstuvwx",
  url: "http://localhost:3000/e/abcdefghijklmnopqrstuvwx",
  publishedAt: "2026-09-22T00:00:00.000Z",
}

describe("before publishing", () => {
  it("lists what is wrong without waiting for the server", async () => {
    await open(unpublishable())

    expect(text()).toContain("to fix first")
    expect(text()).toContain("Give the quiz a title.")
    expect(text()).toContain("Add at least one question.")
    expect(publishQuizAction).not.toHaveBeenCalled()
  })

  it("still lets the teacher press Publish, because the gate is the server's", async () => {
    // A client that refused to send would be acting as a control it is not,
    // and a false negative here would leave a teacher unable to publish at all.
    await open(unpublishable())
    expect(dialogButton("Publish")?.disabled).toBe(false)
  })

  it("says nothing alarming about a quiz that is ready", async () => {
    await open(publishable())

    expect(text()).not.toContain("to fix first")
    expect(dialogButton("Publish")).toBeDefined()
  })
})

describe("when the server refuses", () => {
  it("shows the server's list, not the local one", async () => {
    publishQuizAction.mockResolvedValue({
      ok: false,
      reason: "invalid",
      issues: [
        {
          questionId: "q1",
          field: "options",
          severity: "error",
          code: "no_correct_option",
          message: "Mark one option as correct.",
        },
      ] satisfies Issue[],
    })

    await open(publishable())
    await act(async () => dialogButton("Publish")!.click())

    expect(text()).toContain("Mark one option as correct.")
  })

  it("takes the teacher to the question at fault", async () => {
    publishQuizAction.mockResolvedValue({
      ok: false,
      reason: "invalid",
      issues: [
        {
          questionId: "q7",
          field: "options",
          severity: "error",
          code: "no_correct_option",
          message: "Mark one option as correct.",
        },
      ] satisfies Issue[],
    })

    await open(publishable())
    await act(async () => dialogButton("Publish")!.click())
    await act(async () => dialogButton("Mark one option as correct.")!.click())

    expect(selected).toEqual(["q7"])
  })

  it("reports a service failure as a failure, not as invalid input", async () => {
    publishQuizAction.mockResolvedValue({
      ok: false,
      reason: "error",
      message: "Could not reach the quiz service.",
    })

    await open(publishable())
    await act(async () => dialogButton("Publish")!.click())

    // No issue list: nothing is wrong with the quiz.
    expect(text()).not.toContain("to fix first")
  })
})

describe("after publishing", () => {
  it("shows the link the server minted", async () => {
    publishQuizAction.mockResolvedValue({ ok: true, published })

    await open(publishable())
    await act(async () => dialogButton("Publish")!.click())

    expect(text()).toContain(published.url)
    expect(text()).toContain("Student link")
  })

  it("offers a way to copy the link rather than making it be retyped", async () => {
    publishQuizAction.mockResolvedValue({ ok: true, published })

    await open(publishable())
    await act(async () => dialogButton("Publish")!.click())

    expect(
      document.querySelector('[aria-label="Copy the student link"]')
    ).not.toBeNull()
  })
})

function footerButtons(): string[] {
  const footer = document.querySelector('[data-slot="dialog-footer"]')
  if (!footer) throw new Error("no dialog footer rendered")
  return [...footer.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "")
}

describe("the footer stays inside the dialog", () => {
  /**
   * Not a style assertion: three nowrap buttons in a row were wider than the
   * panel, and a grid child that does not fit draws outside it rather than
   * wrapping. Keeping the count down is the structural half of that fix.
   */
  it("never offers more than two actions, however the quiz stands", async () => {
    await open(unpublishable())
    expect(footerButtons()).toEqual(["Cancel", "Publish"])

    await open(publishable(), {
      status: "published",
      url: published.url,
      hasUnpublishedChanges: true,
    })
    expect(footerButtons()).toEqual(["Cancel", "Publish new version"])
  })

  it("keeps closing the link away from publishing one", async () => {
    await open(publishable(), { status: "published", url: published.url })

    expect(footerButtons()).not.toContain("Close the link")
    expect(dialogButton("Close the link")).toBeDefined()
  })
})

describe("a quiz that is already live", () => {
  it("offers to close the link", async () => {
    await open(publishable(), { status: "published", url: published.url })
    expect(dialogButton("Close the link")).toBeDefined()
  })

  it("does not offer to close a link that does not exist yet", async () => {
    await open(publishable())
    expect(dialogButton("Close the link")).toBeUndefined()
  })

  it("promises an exam in progress is unaffected by a new version", async () => {
    await open(publishable(), {
      status: "published",
      url: published.url,
      hasUnpublishedChanges: true,
    })

    expect(text()).toContain("stays on the version they started")
    expect(dialogButton("Publish new version")).toBeDefined()
  })

  it("shows the existing link before anything is republished", async () => {
    await open(publishable(), { status: "published", url: published.url })
    expect(text()).toContain(published.url)
  })
})
