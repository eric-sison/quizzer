/**
 * The authoring registry: teacher-side presentation for each question kind.
 *
 * Deliberately separate from the logic registry in @workspace/quiz-core, which
 * validates and projects. That one runs on the server and must stay free of
 * React; this one is only ever rendered.
 *
 * Adding a kind means one file here, one entry below, and the matching logic in
 * quiz-core. Nothing generic - not the editor shell, not the type menu, not the
 * question list - needs to learn about it.
 */
import type { Question, QuestionKind, QuestionOfKind } from "@workspace/quiz-core"
import type { LucideIcon } from "lucide-react"
import {
  ArrowLeftRight,
  CircleDot,
  Hash,
  ListOrdered,
  SquareCheckBig,
  TextAlignStart,
  TextCursorInput,
  ToggleLeft,
} from "lucide-react"

import { essayType } from "./essay"
import { fillInBlankType } from "./fill-in-blank"
import { matchingType } from "./matching"
import { multipleChoiceType } from "./multiple-choice"
import { numericType } from "./numeric"
import { orderingType } from "./ordering"
import { singleChoiceType } from "./single-choice"
import { trueFalseType } from "./true-false"

export type QuestionEditorProps<K extends QuestionKind> = {
  question: QuestionOfKind<K>
  /**
   * Takes the whole union rather than the narrowed kind, because switching
   * between one-answer and many-answer changes a question's kind in place.
   */
  onChange: (next: Question) => void
}

export type QuestionTypeDef<K extends QuestionKind> = {
  kind: K
  /** Short form, for the type button and the question rail. */
  label: string
  /**
   * Long form, for the type menu. The two multiple-choice variants share a
   * `label`, so the menu needs something that tells them apart.
   */
  menuLabel: string
  /** Shown under the menu label. */
  description: string
  icon: LucideIcon
  /**
   * A blank question of this kind with fresh ids. Delegates to quiz-core's
   * `createQuestion`, so the registry stays the one place the editor shell
   * reaches for a new question without owning the model defaults itself.
   */
  createDefault(): QuestionOfKind<K>
  /**
   * The answer-configuration block only. Prompt, points and required are the
   * same for every kind and live in the editor shell.
   */
  Editor: React.ComponentType<QuestionEditorProps<K>>
}

/**
 * Annotated rather than `satisfies`, so that indexing by a generic kind
 * resolves to that kind's definition instead of a union of all four. The
 * annotation still makes a missing or mislabelled entry a compile error.
 */
export type QuestionTypeRegistry = { [K in QuestionKind]: QuestionTypeDef<K> }

export const questionTypes: QuestionTypeRegistry = {
  true_false: trueFalseType,
  single_choice: singleChoiceType,
  multiple_choice: multipleChoiceType,
  numeric: numericType,
  fill_in_blank: fillInBlankType,
  matching: matchingType,
  ordering: orderingType,
  essay: essayType,
}

export const ICONS: Record<QuestionKind, LucideIcon> = {
  true_false: ToggleLeft,
  single_choice: CircleDot,
  multiple_choice: SquareCheckBig,
  numeric: Hash,
  fill_in_blank: TextCursorInput,
  matching: ArrowLeftRight,
  ordering: ListOrdered,
  essay: TextAlignStart,
}

/**
 * Menu order. Explicit so it does not depend on object key order - and the
 * registry test asserts it covers every kind, because forgetting an entry here
 * makes a kind silently unreachable in the menu.
 */
export const TYPE_MENU_ORDER: QuestionKind[] = [
  "true_false",
  "single_choice",
  "multiple_choice",
  "numeric",
  "fill_in_blank",
  "matching",
  "ordering",
  "essay",
]

export function typeDef<K extends QuestionKind>(kind: K): QuestionTypeDef<K> {
  return questionTypes[kind]
}

/** Short label for the question list, e.g. "Multiple Choice". */
export function typeLabel(kind: QuestionKind): string {
  return questionTypes[kind].label
}
