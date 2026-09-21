/**
 * Whether a keydown landed in something that owns its own keystrokes - a text
 * field, or Tiptap's contenteditable. Global shortcuts (theme toggle, editor
 * undo/redo) must stand down there: inputs have native undo, and Tiptap ships
 * its own history for prompt text.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}
