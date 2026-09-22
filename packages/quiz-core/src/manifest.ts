/**
 * The student model - the only quiz shape that crosses the network.
 *
 * THERE IS DELIBERATELY NOWHERE HERE FOR AN ANSWER TO LAND. No `correct`, no
 * `answer`, no `rubric`. That is the point: stripping the answer key is a
 * property of the type, not of remembering to delete a field. The Rust
 * `Question` struct in apps/desktop mirrors this for the same reason.
 *
 * Field names are snake_case because this is the wire format that serde
 * deserialises on the client. camelCase means "internal"; snake_case means
 * "this leaves the building". The one exception is the node names inside
 * `prompt_doc`, which stay in the editor's own vocabulary (see rich-text.ts).
 */
import { z } from "zod"

import { QUESTION_KINDS } from "./question"
import {
  emptyRichDoc,
  isRichDocEmpty,
  richDocFromText,
  richDocSchema,
  type RichDoc,
} from "./rich-text"

export const manifestChoiceSchema = z.strictObject({
  id: z.string(),
  label: z.string(),
  label_doc: richDocSchema.optional(),
})

export const manifestQuestionSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(QUESTION_KINDS),
  prompt: z.string(),
  prompt_doc: richDocSchema.optional(),
  choices: z.array(manifestChoiceSchema),
  points: z.number().int().min(0),
  required: z.boolean(),
  min_words: z.number().int().min(0).optional(),
  max_words: z.number().int().min(1).optional(),
  /**
   * Per-kind presentation data. Flat optional fields (the min_words precedent)
   * rather than a per-kind bag, and note what is NOT here: numeric's value and
   * tolerance, the blanks' accepted responses, the matching pairs, ordering's
   * correct sequence. Field names must never contain the substrings "correct",
   * "answer" or "rubric" - the desktop's leak test greps raw session JSON.
   */
  unit: z.string().optional(),
  blank_count: z.number().int().min(1).optional(),
  /** Matching: prompts, in authored order (it carries no secret). */
  left_items: z.array(manifestChoiceSchema).optional(),
  /**
   * Matching: pair rights plus distractors, sorted by their random ids so the
   * order says nothing, and with nothing marking which are distractors.
   */
  right_items: z.array(manifestChoiceSchema).optional(),
  /** Defaulted so manifests published before the field existed still parse. */
  shuffle_options: z.boolean().default(false),
})

export const examManifestSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  duration_s: z.number().int().min(1),
  allow_backtracking: z.boolean(),
  /**
   * Defaulted rather than required so manifests published before this field
   * existed still parse. Exam configuration, not an answer: it may ship.
   */
  shuffle_questions: z.boolean().default(false),
  /** Student-facing blurb, shown on the landing page and link-entry preview. */
  description: z.string().optional(),
  questions: z.array(manifestQuestionSchema),
})

export type ManifestChoice = z.infer<typeof manifestChoiceSchema>
export type ManifestQuestion = z.infer<typeof manifestQuestionSchema>
export type ExamManifest = z.infer<typeof examManifestSchema>

/**
 * What a student submits for one question.
 *
 * A chosen option is its id (numeric reuses the bare string for the student's
 * raw input), a multiple-choice answer is the list of ids (fill-in-the-blank
 * reuses it positionally, ordering as the arranged sequence of ids), a
 * matching answer maps each left id to the chosen right id, and an essay is a
 * `RichDoc` written in the same constrained editor the teacher authored the
 * prompt in.
 *
 * The bare string is kept on purpose. Essays were plain text before, so stored
 * answers and older clients still send one, and `richDocFromText` turns it into
 * a document at the point it is displayed rather than in a migration nobody
 * would run against an exam in progress.
 *
 * It lives here, beside the manifest, because the same shape has to be agreed
 * on by the exam client, the answer endpoint and the grader, and none of them
 * should be reading it out of another's source.
 */
export const answerValueSchema = z.union([
  z.string(),
  z.array(z.string()),
  richDocSchema,
  // Matching: leftId -> rightId. Cannot collide with richDocSchema, whose
  // `content` must be an array and `type` the literal "doc".
  z.record(z.string(), z.string()),
])
export type AnswerValue = z.infer<typeof answerValueSchema>

/**
 * Whether a stored answer counts as given.
 *
 * Presence in the answers map is not the same as having answered: a student
 * who types into a box and then clears it leaves an entry behind, and a paper
 * reported as "15 of 15 answered" with three blanks in it would be a lie told
 * at the one moment a student can no longer do anything about it.
 *
 * Lives here beside `answerValueSchema` because it has to know every shape an
 * answer can take, and a second reading of that union somewhere else is a
 * second thing to keep in step.
 */
export function isAnswered(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === "string") return value.trim().length > 0
  if (Array.isArray(value)) return value.some((entry) => entry.trim().length > 0)

  // An essay is a rich document, a matching answer a record of leftId ->
  // rightId. Both arrive as objects, told apart the way `answerAsRichDoc`
  // tells them apart.
  if (!("type" in value) || value.type !== "doc") {
    return Object.keys(value).length > 0
  }
  return !isRichDocEmpty(value as RichDoc)
}

/** How many of `questions` carry an answer worth counting. */
export function countAnswered(
  questions: readonly { id: string }[],
  answers: Record<string, AnswerValue>
): number {
  return questions.filter((question) => isAnswered(answers[question.id])).length
}

/** An essay answer, however it was stored. */
export function answerAsRichDoc(value: AnswerValue | undefined): RichDoc {
  if (value === undefined) return emptyRichDoc()
  if (typeof value === "string") return richDocFromText(value)
  if (Array.isArray(value)) return emptyRichDoc()
  // A matching record stored before the question became an essay is not a
  // document; degrade like every other stale shape rather than handing the
  // editor a non-doc.
  if (!("type" in value) || value.type !== "doc") return emptyRichDoc()
  return value as RichDoc
}
