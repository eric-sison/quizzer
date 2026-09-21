import {
  createOption,
  createQuestion,
  createQuizDoc,
  type EssayQuestion,
  type MultipleChoiceQuestion,
  type QuizDoc,
  type SingleChoiceQuestion,
  type TrueFalseQuestion,
} from "../question"
import { richDocFromText } from "../rich-text"

export function option(label: string, correct: boolean) {
  return { ...createOption(label), correct }
}

export function trueFalse(prompt: string, correct: boolean): TrueFalseQuestion {
  return { ...createQuestion("true_false"), promptDoc: richDocFromText(prompt), correct }
}

export function singleChoice(
  prompt: string,
  labels: [string, boolean][]
): SingleChoiceQuestion {
  return {
    ...createQuestion("single_choice"),
    promptDoc: richDocFromText(prompt),
    options: labels.map(([l, c]) => option(l, c)),
  }
}

export function multipleChoice(
  prompt: string,
  labels: [string, boolean][]
): MultipleChoiceQuestion {
  return {
    ...createQuestion("multiple_choice"),
    promptDoc: richDocFromText(prompt),
    options: labels.map(([l, c]) => option(l, c)),
  }
}

export function essay(prompt: string, extra: Partial<EssayQuestion> = {}): EssayQuestion {
  return { ...createQuestion("essay"), promptDoc: richDocFromText(prompt), ...extra }
}

/** A valid quiz exercising all four question kinds. */
export function sampleQuiz(): QuizDoc {
  return {
    ...createQuizDoc("Biology Midterm"),
    questions: [
      trueFalse("Mitochondria are the site of photosynthesis.", false),
      singleChoice("Which organelle synthesises most ATP?", [
        ["Ribosome", false],
        ["Mitochondrion", true],
        ["Golgi apparatus", false],
      ]),
      multipleChoice("Select all structures unique to plant cells.", [
        ["Chloroplast", true],
        ["Mitochondrion", false],
        ["Cell wall", true],
      ]),
      essay("Explain how the mitochondrion's structure supports its function.", {
        minWords: 80,
        maxWords: 300,
        rubricDoc: richDocFromText("Award marks for cristae, matrix, surface area."),
      }),
    ],
  }
}
