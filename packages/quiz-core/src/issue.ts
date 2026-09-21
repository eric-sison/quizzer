/** A validation finding. Errors block publishing; warnings do not. */
export type IssueSeverity = "error" | "warning"

export type Issue = {
  /** null for quiz-level issues (title, duration, question count). */
  questionId: string | null
  /** Dot path within the question or quiz, for focusing the right control. */
  field: string
  severity: IssueSeverity
  /** Stable machine-readable discriminant; the UI may localise off this. */
  code: string
  message: string
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === "error")
}
