"use client"

import * as React from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

/**
 * Drag reordering for the question rail and the option list.
 *
 * Both lists are vertical and identical in behaviour, so they share this rather
 * than growing two copies that drift apart.
 *
 * A KeyboardSensor is not optional here. Reordering is the only way to change a
 * quiz's question order, and a drag-only implementation would put that out of
 * reach for anyone not using a mouse. The handle is a real focusable button:
 * Space picks a row up, the arrow keys move it, Space drops it, Escape cancels.
 */
export function SortableList({
  ids,
  onReorder,
  children,
}: {
  /** In display order. The drop target's position in here is the new index. */
  ids: string[]
  onReorder: (id: string, toIndex: number) => void
  children: React.ReactNode
}) {
  /**
   * Named so the server and the client agree on the name.
   *
   * Left to itself dnd-kit numbers each context off a module-level counter
   * ("DndDescribedBy-0", "-1", ...) that starts wherever the last mount left
   * it. That counter sits at a different number on the server than in a
   * browser that has already rendered other lists, so the `aria-describedby`
   * it puts on every handle arrives mismatched and React reports a hydration
   * error. `useId` is stable across the two renders by construction, which is
   * the property the counter lacks.
   */
  const id = React.useId()

  const sensors = useSensors(
    // Without a small threshold a click on the handle registers as a drag of
    // zero distance, which cancels the row's own click handling.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const toIndex = ids.indexOf(String(over.id))
    if (toIndex < 0) return

    onReorder(String(active.id), toIndex)
  }

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

export type SortableRow = {
  isDragging: boolean
  /** Spread onto the element that moves. */
  rowProps: {
    ref: (node: HTMLElement | null) => void
    style: React.CSSProperties
  }
  /** Spread onto the grab handle, which must be focusable. */
  handleProps: Record<string, unknown>
}

export function useSortableRow(id: string): SortableRow {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  return {
    isDragging,
    rowProps: {
      ref: setNodeRef,
      style: {
        // Translate only. A scaling transform would stretch the row's text
        // while it is in flight.
        transform: CSS.Translate.toString(transform),
        transition,
        // Lift the row being dragged above its neighbours.
        zIndex: isDragging ? 1 : undefined,
        position: isDragging ? "relative" : undefined,
      },
    },
    handleProps: { ref: setActivatorNodeRef, ...attributes, ...listeners },
  }
}
