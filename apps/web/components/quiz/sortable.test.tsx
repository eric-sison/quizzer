/**
 * The drag handles' `aria-describedby` has to survive hydration.
 *
 * dnd-kit names each context off a module-level counter, so the id depended on
 * how many lists had mounted before - a number the server and the browser do
 * not agree on. Rendering the same tree repeatedly in one module is that
 * counter's whole failure mode: if the ids drift here, they drift between the
 * server's HTML and the client's first render too.
 */
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { SortableList, useSortableRow } from "@/components/quiz/sortable"

function Row({ id }: { id: string }) {
  const { rowProps, handleProps } = useSortableRow(id)
  return (
    <li {...rowProps}>
      <button {...handleProps}>grab</button>
    </li>
  )
}

function List() {
  return (
    <SortableList ids={["a", "b"]} onReorder={() => {}}>
      <ul>
        <Row id="a" />
        <Row id="b" />
      </ul>
    </SortableList>
  )
}

function describedBy(html: string) {
  return [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1])
}

describe("the drag context id", () => {
  it("is the same no matter how many lists rendered before it", () => {
    const first = describedBy(renderToStaticMarkup(<List />))
    const second = describedBy(renderToStaticMarkup(<List />))
    const third = describedBy(renderToStaticMarkup(<List />))

    expect(first.length).toBe(2)
    expect(second).toEqual(first)
    expect(third).toEqual(first)
  })
})
