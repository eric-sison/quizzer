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
  questions: z.array(manifestQuestionSchema),
})

export type ManifestChoice = z.infer<typeof manifestChoiceSchema>
export type ManifestQuestion = z.infer<typeof manifestQuestionSchema>
export type ExamManifest = z.infer<typeof examManifestSchema>

/**
 * What a student submits for one question.
 *
 * A chosen option is its id, a multiple-choice answer is the list of ids, and
 * an essay is a `RichDoc` written in the same constrained editor the teacher
 * authored the prompt in.
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
])
export type AnswerValue = z.infer<typeof answerValueSchema>

/** An essay answer, however it was stored. */
export function answerAsRichDoc(value: AnswerValue | undefined): RichDoc {
  if (value === undefined) return emptyRichDoc()
  if (typeof value === "string") return richDocFromText(value)
  if (Array.isArray(value)) return emptyRichDoc()
  return value
}
