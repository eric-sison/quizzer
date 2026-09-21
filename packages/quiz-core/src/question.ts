/**
 * The authoring model.
 *
 * A `QuizDoc` HOLDS CORRECT ANSWERS and must never be served to a student. It
 * lives in `quizzes.draft_doc` and is projected into an `ExamManifest` by
 * `project()` before anything crosses the network. See `manifest.ts`.
 *
 * Schemas are the source of truth and the types are inferred from them, so the
 * runtime check at the API boundary and the compile-time type cannot drift.
 */
import { z } from "zod"

import { newId } from "./id"
import { emptyRichDoc, richDocFromText, richDocSchema } from "./rich-text"

export const QUESTION_KINDS = [
  "true_false",
  "single_choice",
  "multiple_choice",
  "numeric",
  "fill_in_blank",
  "matching",
  "ordering",
  "essay",
] as const

export type QuestionKind = (typeof QUESTION_KINDS)[number]

const baseQuestionFields = {
  id: z.string().min(1).max(64),
  // May carry image nodes, referenced by opaque media id - see rich-text.ts.
  promptDoc: richDocSchema,
  points: z.number().int().min(0).max(1000),
  required: z.boolean(),
  /**
   * Teacher-only notes on the intended answer ("why the answer is B"). Never
   * projected into the manifest - same contract as the essay rubric.
   */
  explanationDoc: richDocSchema.optional(),
}

export const choiceOptionSchema = z.strictObject({
  id: z.string().min(1).max(64),
  labelDoc: richDocSchema,
  correct: z.boolean(),
})

export const trueFalseQuestionSchema = z.strictObject({
  ...baseQuestionFields,
  kind: z.literal("true_false"),
  correct: z.boolean(),
})

export const singleChoiceQuestionSchema = z.strictObject({
  ...baseQuestionFields,
  kind: z.literal("single_choice"),
  options: z.array(choiceOptionSchema).max(50),
  shuffleOptions: z.boolean(),
})

export const multipleChoiceQuestionSchema = z.strictObject({
  ...baseQuestionFields,
  kind: z.literal("multiple_choice"),
  options: z.array(choiceOptionSchema).max(50),
  shuffleOptions: z.boolean(),
})

export const essayQuestionSchema = z.strictObject({
  ...baseQuestionFields,
  kind: z.literal("essay"),
  minWords: z.number().int().min(0).max(10000).optional(),
  maxWords: z.number().int().min(1).max(10000).optional(),
  /** Teacher-only marking guidance. Never projected into the manifest. */
  rubricDoc: richDocSchema.optional(),
})

export const numericQuestionSchema = z.strictObject({
  ...baseQuestionFields,
  kind: z.literal("numeric"),
  /** Optional so a half-built draft still saves; publish requires it. */
  correctValue: z.number().finite().optional(),
  /** Absolute tolerance; 0 means exact. Grading data, never projected. */
  tolerance: z.number().min(0).finite(),
  /** Display-only suffix shown beside the student's input, e.g. "°C". */
  unit: z.string().max(20).optional(),
})

export const blankSchema = z.strictObject({
  id: z.string().min(1).max(64),
  /** Matching ANY entry counts as right. Grading data, never projected. */
  acceptedAnswers: z.array(z.string().max(200)).max(20),
})

export const fillInBlankQuestionSchema = z.strictObject({
  ...baseQuestionFields,
  kind: z.literal("fill_in_blank"),
  blanks: z.array(blankSchema).max(50),
  caseSensitive: z.boolean(),
})

export const matchPairSchema = z.strictObject({
  /**
   * Both ids are minted independently at authoring time. A right id that was
   * derivable from its left id would hand students the mapping.
   */
  leftId: z.string().min(1).max(64),
  rightId: z.string().min(1).max(64),
  leftText: z.string().max(500),
  rightText: z.string().max(500),
})

export const matchDistractorSchema = z.strictObject({
  id: z.string().min(1).max(64),
  text: z.string().max(500),
})

export const matchingQuestionSchema = z.strictObject({
  ...baseQuestionFields,
  kind: z.literal("matching"),
  pairs: z.array(matchPairSchema).max(50),
  /** Extra right-column entries that match nothing. */
  distractors: z.array(matchDistractorSchema).max(20),
})

export const orderingItemSchema = z.strictObject({
  id: z.string().min(1).max(64),
  labelDoc: richDocSchema,
})

export const orderingQuestionSchema = z.strictObject({
  ...baseQuestionFields,
  kind: z.literal("ordering"),
  /** AUTHORED IN CORRECT ORDER. The projection de-correlates; see logic.ts. */
  items: z.array(orderingItemSchema).max(50),
})

export const questionSchema = z.discriminatedUnion("kind", [
  trueFalseQuestionSchema,
  singleChoiceQuestionSchema,
  multipleChoiceQuestionSchema,
  numericQuestionSchema,
  fillInBlankQuestionSchema,
  matchingQuestionSchema,
  orderingQuestionSchema,
  essayQuestionSchema,
])

export const quizSettingsSchema = z.strictObject({
  durationS: z.number().int().min(1).max(86_400),
  allowBacktracking: z.boolean(),
  shuffleQuestions: z.boolean(),
})

/**
 * Note what is NOT constrained here: a title may be empty and the question list
 * may be short or invalid. Drafts must save in any state - a half-built
 * question cannot be allowed to block autosave. `validateQuiz()` enforces the
 * stricter rules, and only at publish time.
 */
export const quizDocSchema = z.strictObject({
  schemaVersion: z.literal(1),
  title: z.string().max(200),
  description: z.string().max(2000).optional(),
  settings: quizSettingsSchema,
  questions: z.array(questionSchema).max(500),
})

export type ChoiceOption = z.infer<typeof choiceOptionSchema>
export type TrueFalseQuestion = z.infer<typeof trueFalseQuestionSchema>
export type SingleChoiceQuestion = z.infer<typeof singleChoiceQuestionSchema>
export type MultipleChoiceQuestion = z.infer<typeof multipleChoiceQuestionSchema>
export type NumericQuestion = z.infer<typeof numericQuestionSchema>
export type Blank = z.infer<typeof blankSchema>
export type FillInBlankQuestion = z.infer<typeof fillInBlankQuestionSchema>
export type MatchPair = z.infer<typeof matchPairSchema>
export type MatchDistractor = z.infer<typeof matchDistractorSchema>
export type MatchingQuestion = z.infer<typeof matchingQuestionSchema>
export type OrderingItem = z.infer<typeof orderingItemSchema>
export type OrderingQuestion = z.infer<typeof orderingQuestionSchema>
export type EssayQuestion = z.infer<typeof essayQuestionSchema>
export type Question = z.infer<typeof questionSchema>
export type QuizSettings = z.infer<typeof quizSettingsSchema>
export type QuizDoc = z.infer<typeof quizDocSchema>

/** Narrow a question to one kind. */
export type QuestionOfKind<K extends QuestionKind> = Extract<Question, { kind: K }>

export const DEFAULT_DURATION_S = 45 * 60

export function createOption(label = ""): ChoiceOption {
  return { id: newId(), labelDoc: richDocFromText(label), correct: false }
}

export function createBlank(): Blank {
  return { id: newId(), acceptedAnswers: [] }
}

export function createMatchPair(): MatchPair {
  return { leftId: newId(), rightId: newId(), leftText: "", rightText: "" }
}

export function createDistractor(text = ""): MatchDistractor {
  return { id: newId(), text }
}

export function createOrderingItem(label = ""): OrderingItem {
  return { id: newId(), labelDoc: richDocFromText(label) }
}

export function createQuestion<K extends QuestionKind>(kind: K): QuestionOfKind<K> {
  const base = { id: newId(), promptDoc: emptyRichDoc(), points: 1, required: true }

  switch (kind) {
    case "true_false":
      return { ...base, kind: "true_false", correct: true } as QuestionOfKind<K>
    case "single_choice":
      return {
        ...base,
        kind: "single_choice",
        options: [createOption(), createOption()],
        shuffleOptions: false,
      } as QuestionOfKind<K>
    case "multiple_choice":
      return {
        ...base,
        kind: "multiple_choice",
        options: [createOption(), createOption()],
        shuffleOptions: false,
      } as QuestionOfKind<K>
    case "numeric":
      // No correctValue key: undefined means "not set yet", and strictObject
      // output should not carry explicit undefineds.
      return { ...base, kind: "numeric", tolerance: 0 } as QuestionOfKind<K>
    case "fill_in_blank":
      return {
        ...base,
        kind: "fill_in_blank",
        blanks: [createBlank()],
        caseSensitive: false,
      } as QuestionOfKind<K>
    case "matching":
      return {
        ...base,
        kind: "matching",
        pairs: [createMatchPair(), createMatchPair()],
        distractors: [] as MatchDistractor[],
      } as QuestionOfKind<K>
    case "ordering":
      return {
        ...base,
        kind: "ordering",
        items: [createOrderingItem(), createOrderingItem(), createOrderingItem()],
      } as QuestionOfKind<K>
    case "essay":
      return { ...base, kind: "essay", points: 5 } as QuestionOfKind<K>
    default: {
      const exhaustive: never = kind
      throw new Error(`unknown question kind: ${String(exhaustive)}`)
    }
  }
}

export function createQuizDoc(title = ""): QuizDoc {
  return {
    schemaVersion: 1,
    title,
    settings: {
      durationS: DEFAULT_DURATION_S,
      allowBacktracking: true,
      shuffleQuestions: false,
    },
    questions: [],
  }
}
