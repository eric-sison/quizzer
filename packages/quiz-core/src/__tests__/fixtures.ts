import {
  createBlank,
  createDistractor,
  createMatchPair,
  createOption,
  createOrderingItem,
  createQuestion,
  createQuizDoc,
  type EssayQuestion,
  type FillInBlankQuestion,
  type MatchingQuestion,
  type MultipleChoiceQuestion,
  type NumericQuestion,
  type OrderingQuestion,
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

export function numeric(
  prompt: string,
  extra: Partial<NumericQuestion> = {}
): NumericQuestion {
  return {
    ...createQuestion("numeric"),
    promptDoc: richDocFromText(prompt),
    correctValue: 42,
    tolerance: 0.5,
    ...extra,
  }
}

export function fillInBlank(
  prompt: string,
  blanks: string[][],
  extra: Partial<FillInBlankQuestion> = {}
): FillInBlankQuestion {
  return {
    ...createQuestion("fill_in_blank"),
    promptDoc: richDocFromText(prompt),
    blanks: blanks.map((acceptedAnswers) => ({ ...createBlank(), acceptedAnswers })),
    ...extra,
  }
}

export function matching(
  prompt: string,
  pairs: [string, string][],
  distractors: string[] = []
): MatchingQuestion {
  return {
    ...createQuestion("matching"),
    promptDoc: richDocFromText(prompt),
    pairs: pairs.map(([leftText, rightText]) => ({
      ...createMatchPair(),
      leftText,
      rightText,
    })),
    distractors: distractors.map((text) => createDistractor(text)),
  }
}

export function ordering(prompt: string, labels: string[]): OrderingQuestion {
  return {
    ...createQuestion("ordering"),
    promptDoc: richDocFromText(prompt),
    items: labels.map((label) => createOrderingItem(label)),
  }
}

/** A valid quiz exercising the four original question kinds. */
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

/** A valid quiz exercising every question kind, teacher-only fields included. */
export function fullSampleQuiz(): QuizDoc {
  const base = sampleQuiz()
  return {
    ...base,
    questions: [
      ...base.questions.map((q) => ({
        ...q,
        explanationDoc: richDocFromText(`Because of ${q.kind}.`),
      })),
      numeric("What is the boiling point of water at sea level, in °C?", {
        correctValue: 100,
        tolerance: 0.5,
        unit: "°C",
      }),
      fillInBlank("Water is made of ___ and ___.", [
        ["hydrogen", "H"],
        ["oxygen", "O"],
      ]),
      matching(
        "Match each organelle to its role.",
        [
          ["Mitochondrion", "ATP synthesis"],
          ["Chloroplast", "Photosynthesis"],
          ["Ribosome", "Protein synthesis"],
        ],
        ["Waste disposal"]
      ),
      ordering("Order the phases of mitosis.", [
        "Prophase",
        "Metaphase",
        "Anaphase",
        "Telophase",
      ]),
    ],
  }
}
