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

/** The ceiling on any one question's award, and on any single part of it. */
export const MAX_QUESTION_POINTS = 1000

const baseQuestionFields = {
  id: z.string().min(1).max(64),
  // May carry image nodes, referenced by opaque media id - see rich-text.ts.
  promptDoc: richDocSchema,
  /**
   * What the question is worth. Authored directly for most kinds; for
   * multiple_choice it is DERIVED from the per-answer scoring below, which is
   * why the editor shows it read-only there. `questionPoints()` is the one
   * place that knows the difference - read through it rather than this field.
   */
  points: z.number().int().min(0).max(MAX_QUESTION_POINTS),
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
  /**
   * What THIS option is worth, read only by multiple_choice under
   * `per_option` scoring. Optional because nothing else awards per option -
   * and kept, not stripped, when a question moves to single_choice or to
   * uniform scoring, so that flipping back restores what was typed.
   */
  points: z.number().int().min(0).max(MAX_QUESTION_POINTS).optional(),
})

/**
 * Which word pair a true/false question presents. The stored answer is a
 * boolean either way: this chooses the wording shown to the student, not what
 * counts as right, so a question can be reworded after publication without
 * touching its answer key.
 */
export const trueFalseStyleSchema = z.enum(["true_false", "yes_no"])

export const trueFalseQuestionSchema = z.strictObject({
  ...baseQuestionFields,
  kind: z.literal("true_false"),
  correct: z.boolean(),
  /**
   * Defaulted, not required: every quiz authored before yes/no existed was
   * written as true/false, and a required key would make each one fail to
   * parse.
   */
  labelStyle: trueFalseStyleSchema.default("true_false"),
})

export const singleChoiceQuestionSchema = z.strictObject({
  ...baseQuestionFields,
  kind: z.literal("single_choice"),
  options: z.array(choiceOptionSchema).max(50),
  shuffleOptions: z.boolean(),
})

/**
 * How a question splits its award across its scored parts: one flat rate for
 * every part, or a value typed on each of them.
 *
 * `per_option` is the stored spelling for both kinds that use this. It predates
 * the reuse, and renaming it now would make every saved draft fail to parse
 * for the sake of a word; a blank is simply the "option" being priced there.
 */
export const scoringModeSchema = z.enum(["uniform", "per_option"])

/**
 * Shared by the kinds whose award is DERIVED rather than typed: multiple
 * choice, which splits across the answers marked correct, and fill in the
 * blank, which splits across the blanks. Both are defaulted rather than
 * required, because quizzes authored before per-part scoring existed are still
 * in the database and a required key would make every one of them fail to
 * parse. A doc arriving without them reads as the flat rate it effectively was.
 */
const splitScoringFields = {
  scoring: scoringModeSchema.default("uniform"),
  /**
   * The flat rate under `uniform` scoring. Kept while `per_option` is selected
   * so switching back does not lose it.
   */
  pointsPerCorrect: z.number().int().min(0).max(MAX_QUESTION_POINTS).default(1),
}

export const multipleChoiceQuestionSchema = z.strictObject({
  ...baseQuestionFields,
  ...splitScoringFields,
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
  /**
   * What THIS blank is worth, read only under `per_option` scoring - the same
   * arrangement as a choice option's value, and kept for the same reason when
   * the flat rate is showing.
   */
  points: z.number().int().min(0).max(MAX_QUESTION_POINTS).optional(),
})

/**
 * Whether a response has to land in the blank it was written for.
 *
 * `in_order` grades positionally: response 1 against blank 1, and a student
 * who knows every answer but types them in the wrong boxes gets nothing.
 * `any_order` accepts a response that matches ANY blank, which suits a prompt
 * like "name the three noble gases" where the boxes are a set, not a sequence.
 */
export const blankOrderSchema = z.enum(["in_order", "any_order"])

export const fillInBlankQuestionSchema = z.strictObject({
  ...baseQuestionFields,
  ...splitScoringFields,
  kind: z.literal("fill_in_blank"),
  blanks: z.array(blankSchema).max(50),
  caseSensitive: z.boolean(),
  /**
   * Defaulted, not required: quizzes authored before this existed are graded
   * positionally, which is what they were written against.
   */
  blankOrder: blankOrderSchema.default("in_order"),
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
  /**
   * When the link starts working, as an ISO instant in UTC.
   *
   * Absent means "as soon as it is published", which is why this is optional
   * rather than nullable-with-a-default: no opening time is the ordinary case,
   * and every quiz authored before this existed is one of them.
   *
   * Stored as an instant, never as wall-clock text. A teacher in one timezone
   * setting 9am for a class in another is a mistake to make once; the editor
   * converts at the edge and everything inland is absolute.
   *
   * Authoring data, not exam data: it reaches `exam_links.opens_at` when the
   * quiz is published and is enforced there, on the server, when a link is
   * resolved. It is deliberately not in the manifest - by the time a client
   * holds one, the exam is open.
   */
  opensAt: z.iso.datetime().optional(),
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
export type TrueFalseStyle = z.infer<typeof trueFalseStyleSchema>
export type ScoringMode = z.infer<typeof scoringModeSchema>
export type TrueFalseQuestion = z.infer<typeof trueFalseQuestionSchema>
export type SingleChoiceQuestion = z.infer<typeof singleChoiceQuestionSchema>
export type MultipleChoiceQuestion = z.infer<typeof multipleChoiceQuestionSchema>
export type NumericQuestion = z.infer<typeof numericQuestionSchema>
export type Blank = z.infer<typeof blankSchema>
export type BlankOrder = z.infer<typeof blankOrderSchema>
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
      return {
        ...base,
        kind: "true_false",
        correct: true,
        labelStyle: "true_false",
      } as QuestionOfKind<K>
    case "single_choice":
      return {
        ...base,
        kind: "single_choice",
        options: [createOption(), createOption()],
        shuffleOptions: false,
      } as QuestionOfKind<K>
    case "multiple_choice":
      // points 0, not 1: it is derived, and a fresh question has nothing
      // marked correct yet. Marking the first answer makes it worth 1.
      return {
        ...base,
        kind: "multiple_choice",
        points: 0,
        options: [createOption(), createOption()],
        shuffleOptions: false,
        scoring: "uniform",
        pointsPerCorrect: 1,
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
        blankOrder: "in_order",
        // One blank at the default rate, which is what `base` already says.
        scoring: "uniform",
        pointsPerCorrect: 1,
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

/**
 * The kinds whose award is derived from their parts rather than typed on the
 * question. Adding a third would mean adding it here and to `scoredParts`.
 */
export type SplitScoredQuestion = MultipleChoiceQuestion | FillInBlankQuestion

export function isSplitScored(question: Question): question is SplitScoredQuestion {
  return question.kind === "multiple_choice" || question.kind === "fill_in_blank"
}

/** One part that earns points, at its position in the question's own array. */
export type ScoredPart = { index: number; points: number | undefined }

/**
 * The parts of a question that earn points.
 *
 * The two kinds differ in which parts count: a multiple-choice question only
 * awards for the options marked correct, while every blank is scored - there
 * is no unscored blank to filter out. The index comes back with each part
 * because a validator reporting one has to name its row, and filtered
 * positions would otherwise not survive the trip.
 */
export function scoredParts(question: SplitScoredQuestion): ScoredPart[] {
  if (question.kind === "fill_in_blank") {
    return question.blanks.map((blank, index) => ({ index, points: blank.points }))
  }
  return question.options.flatMap((option, index) =>
    option.correct ? [{ index, points: option.points }] : []
  )
}

/**
 * The award to show and to project, for any kind.
 *
 * Read points through this rather than `question.points`: a split-scored
 * question authored before per-part scoring carries a stored total that no
 * longer follows from its parts, and deriving here means such a question reads
 * correctly without first having to be edited and re-saved.
 *
 * Clamped, because fifty parts at the per-part ceiling would otherwise exceed
 * what `points` accepts and make the document unsavable.
 */
export function questionPoints(question: Question): number {
  if (!isSplitScored(question)) return question.points

  const parts = scoredParts(question)
  const total =
    question.scoring === "uniform"
      ? parts.length * question.pointsPerCorrect
      : parts.reduce((sum, part) => sum + (part.points ?? 0), 0)
  return Math.min(total, MAX_QUESTION_POINTS)
}

/**
 * Write the derived total back into `points`, so the stored document agrees
 * with what the editor shows. Every edit to a split-scored question's parts or
 * scoring goes through here; returns the same object when nothing moved, so it
 * cannot by itself make a clean draft look dirty.
 */
export function withDerivedPoints<Q extends SplitScoredQuestion>(question: Q): Q {
  const points = questionPoints(question)
  return points === question.points ? question : { ...question, points }
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
