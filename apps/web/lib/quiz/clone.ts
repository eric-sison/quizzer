import { newId, type Question } from "@workspace/quiz-core"

import { isChoiceQuestion } from "./selection"

/**
 * Copy a question for the Duplicate action.
 *
 * Every id is minted afresh, options included: two questions sharing an option
 * id would make the answer key ambiguous, since a key is keyed by option id.
 *
 * This lives outside the reducer on purpose. `newId()` is random, and a reducer
 * that is not a pure function of its inputs cannot be replayed or tested.
 */
export function cloneQuestion(source: Question): Question {
  if (isChoiceQuestion(source)) {
    return {
      ...source,
      id: newId(),
      options: source.options.map((option) => ({ ...option, id: newId() })),
    }
  }
  return { ...source, id: newId() }
}
