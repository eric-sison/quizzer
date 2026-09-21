import { afterEach, beforeEach, vi } from "vitest"

/**
 * Fail a test if anything logged to console.error.
 *
 * Base UI reports contract violations that way - a Button rendering a
 * non-<button> while `nativeButton` is true, or a menu label outside a
 * Menu.Group - and so does React for invalid nesting and hydration mismatches.
 * None of those throw, so without this they only ever show up in a browser
 * console, which is where two of them reached a human before this existed.
 */
let captured: string[] = []
let spy: ReturnType<typeof vi.spyOn> | undefined

beforeEach(() => {
  captured = []
  spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    captured.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "))
  })
})

afterEach(() => {
  spy?.mockRestore()
  spy = undefined

  if (captured.length > 0) {
    const seen = captured.join("\n  ")
    captured = []
    throw new Error(`console.error during this test:\n  ${seen}`)
  }
})
