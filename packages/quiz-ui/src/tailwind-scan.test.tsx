/**
 * Tailwind has to be told to look inside this package.
 *
 * It finds the importing app's own source automatically but not a workspace
 * package's, so if the `@source` globs in @workspace/ui's globals.css stop
 * covering this directory, every class written here silently disappears from
 * both apps' stylesheets. Nothing fails: the exam screen renders with the right
 * elements, the right text and no styling at all, and the only way to notice is
 * to look at it. That is how this package shipped the first time.
 */
import { globSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const globalsCss = path.resolve(packageRoot, "../ui/src/styles/globals.css")

/** Every `@source` glob, resolved against the stylesheet that declares them. */
function scannedFiles(): string[] {
  const css = readFileSync(globalsCss, "utf8")
  const cssDir = path.dirname(globalsCss)
  const globs = [...css.matchAll(/@source\s+"([^"]+)"/g)].map((m) => m[1] ?? "")

  return globs.flatMap((glob) =>
    globSync(path.resolve(cssDir, glob)).map((file) => path.resolve(String(file)))
  )
}

describe("Tailwind scans this package", () => {
  it("covers the files that write class names", () => {
    const scanned = new Set(scannedFiles())

    const ours = globSync(path.join(packageRoot, "src/**/*.tsx")).filter(
      (file) => !String(file).includes(".test.")
    )
    expect(ours.length).toBeGreaterThan(0)

    const missed = ours.map(String).filter((file) => !scanned.has(path.resolve(file)))
    expect(
      missed,
      `\nNot covered by an @source glob in ${globalsCss}:\n${missed.join("\n")}\n`
    ).toEqual([])
  })

  it("still covers @workspace/ui itself", () => {
    // Guards the check above: a glob broad enough to be meaningless would pass
    // the first test while telling us nothing.
    const scanned = new Set(scannedFiles())
    const button = path.resolve(packageRoot, "../ui/src/components/button.tsx")

    expect(scanned.has(button)).toBe(true)
    expect(scanned.has(path.resolve(packageRoot, "package.json"))).toBe(false)
  })
})
