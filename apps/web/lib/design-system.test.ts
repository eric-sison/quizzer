/**
 * Design-system boundary.
 *
 * Components from @workspace/ui are shared with apps/desktop, so restyling one
 * at a call site makes the two apps drift and puts the system's decisions in
 * whichever file happened to need them first.
 *
 * When a shared component does not look right:
 *   - appearance    -> add a variant or prop to the component in packages/ui
 *   - layout        -> put the class on your own wrapper element instead
 *   - a one-off     -> build it out of plain elements, not a system component
 */
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const uiComponents = path.resolve(webRoot, "../../packages/ui/src/components")

function sharedComponentNames(): Set<string> {
  const names = new Set<string>()
  for (const file of readdirSync(uiComponents)) {
    if (!file.endsWith(".tsx")) continue
    const exported = /export \{([^}]*)\}/.exec(readFileSync(path.join(uiComponents, file), "utf8"))
    if (!exported?.[1]) continue
    for (const raw of exported[1].split(",")) {
      const name = raw.trim()
      if (name && /^[A-Z]/.test(name)) names.add(name)
    }
  }
  return names
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(path.join(webRoot, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(rel))
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) out.push(rel)
  }
  return out
}


/**
 * Yield every `<Component ...>` opening tag together with its own `className`.
 *
 * A regex cannot do this, in two different ways:
 *
 *  - `onChange={(e) => f(e)}` contains a `>`, so a pattern that stops at the
 *    first one truncates the attributes and misses a className after a handler.
 *    That is not hypothetical: it is how an override in the option editor
 *    survived this check.
 *  - `render={<Button><Icon className="x" /></Button>}` nests markup inside an
 *    attribute, so a className found anywhere in the attribute text may belong
 *    to something else entirely.
 *
 * So this walks the tag, tracking brace depth and quotes, and only counts a
 * `className=` that sits at depth zero: this tag's own, not a descendant's.
 */
function* openingTags(
  src: string
): Generator<{ tag: string; className: string | null; index: number }> {
  for (const match of src.matchAll(/<([A-Z][A-Za-z0-9]*)(?=[\s/>])/g)) {
    let quote: string | null = null
    let depth = 0
    let className: string | null = null

    for (let i = match.index + match[0].length; i < src.length; i++) {
      const ch = src[i]

      if (quote) {
        if (ch === quote && src[i - 1] !== "\\") quote = null
        continue
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch
        continue
      }
      if (ch === "{") {
        depth++
        continue
      }
      if (ch === "}") {
        depth--
        continue
      }
      if (ch === ">" && depth === 0) {
        yield { tag: match[1] ?? "", className, index: match.index }
        break
      }
      if (depth === 0 && className === null && src.startsWith("className=", i)) {
        className = readAttributeValue(src, i + "className=".length)
      }
    }
  }
}

/** The `"..."` or `{...}` after `className=`, for the failure message. */
function readAttributeValue(src: string, at: number): string {
  if (src[at] === '"' || src[at] === "'") {
    const close = src.indexOf(src[at]!, at + 1)
    return close < 0 ? "?" : src.slice(at, close + 1)
  }
  if (src[at] !== "{") return "?"

  let depth = 0
  for (let i = at; i < src.length; i++) {
    if (src[i] === "{") depth++
    else if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1)
  }
  return "?"
}

describe("@workspace/ui components are used, not restyled", () => {
  it("has no className override on a shared component", () => {
    const shared = sharedComponentNames()
    const offences: string[] = []

    for (const rel of [...sourceFiles("components"), ...sourceFiles("app"), ...sourceFiles("lib")]) {
      const src = readFileSync(path.join(webRoot, rel), "utf8")

      for (const { tag, className, index } of openingTags(src)) {
        if (!shared.has(tag) || className === null) continue

        const line = src.slice(0, index).split("\n").length
        offences.push(`${rel}:${line}  <${tag}> ${className.replace(/\s+/g, " ")}`)
      }
    }

    expect(offences, `\n${offences.join("\n")}\n`).toEqual([])
  })

  it("can actually see the shared components", () => {
    // Guards the test itself: a bad path would make the check above vacuous.
    const shared = sharedComponentNames()
    expect(shared.size).toBeGreaterThan(20)
    expect(shared).toContain("Button")
    expect(shared).toContain("DropdownMenuItem")
  })

  it("finds a className that sits after an arrow-function prop", () => {
    // The blind spot this check used to have. `=>` ends a regex-matched tag
    // early, so five real overrides sat here unreported.
    const found = [...openingTags(`<Input onChange={(e) => f(e)} className="x" />`)]
    expect(found).toEqual([{ tag: "Input", className: '"x"', index: 0 }])
  })

  it("does not blame a component for its render prop's markup", () => {
    const found = [
      ...openingTags(`<Trigger render={<Button><Icon className="y" /></Button>} />`),
    ]
    expect(found[0]).toMatchObject({ tag: "Trigger", className: null })
  })
})

/**
 * Em dashes and en dashes are banned from anything a user reads. Comments and
 * docs are fine, which is why this strips comments before looking.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/[^\n]*/g, "")
}

describe("rendered copy", () => {
  it("contains no em or en dashes", () => {
    const offences: string[] = []

    for (const rel of [...sourceFiles("components"), ...sourceFiles("app"), ...sourceFiles("lib")]) {
      const lines = stripComments(readFileSync(path.join(webRoot, rel), "utf8")).split("\n")

      lines.forEach((line, i) => {
        if (/[–—]/.test(line)) {
          offences.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`)
        }
      })
    }

    expect(offences, `\nUse a comma, a full stop or parentheses instead:\n${offences.join("\n")}\n`).toEqual([])
  })

  it("inspects plain .ts files too, not only components", () => {
    // Copy lives in helpers as well as JSX: formatDuration used to return an
    // em dash, and a .tsx-only sweep would never have seen it.
    expect(sourceFiles("lib").some((f) => f.endsWith(".ts"))).toBe(true)
  })
})
