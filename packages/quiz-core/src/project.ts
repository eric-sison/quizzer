/**
 * The one code path that turns an authoring document into something a student
 * may receive.
 *
 * `project()` is pure and total, so `apps/web` can run it to render a preview
 * and `apps/api` can run it at publish time and get byte-identical output. The
 * manifest a student actually receives is always the one `apps/api` produced.
 */
import type { QuizAnswerKey } from "./answer-key"
import { examManifestSchema, type ExamManifest } from "./manifest"
import type { QuizDoc } from "./question"
import { questionToAnswerKey, questionToManifest } from "./types/registry"

export class AnswerLeakError extends Error {
  constructor(detail: string) {
    super(`refusing to publish: ${detail}`)
    this.name = "AnswerLeakError"
  }
}

/**
 * Key names that must never appear anywhere in a manifest, at any depth.
 *
 * The strict schema below already rejects unknown keys, so this is defence in
 * depth - it is here to fail loudly if someone later relaxes the schema or
 * adds a passthrough. Both spellings are listed because the authoring model is
 * camelCase and the wire format is snake_case.
 */
const FORBIDDEN_KEYS = new Set([
  "correct",
  "correctOptionId",
  "correct_option_id",
  "correctOptionIds",
  "correct_option_ids",
  "answer",
  "answerKey",
  "answer_key",
  "rubric",
  "rubricDoc",
  "rubric_doc",
])

function scanForForbiddenKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => scanForForbiddenKeys(item, `${path}[${i}]`))
    return
  }
  if (value === null || typeof value !== "object") return

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new AnswerLeakError(`manifest contains a "${key}" field at ${path}`)
    }
    scanForForbiddenKeys(child, `${path}.${key}`)
  }
}

/**
 * Throw unless `manifest` is a well-formed manifest carrying no answer data.
 *
 * Called on every projection rather than only in tests, because the cost of
 * being wrong here is handing every student the answer key.
 */
export function assertNoAnswerLeak(manifest: unknown): void {
  const parsed = examManifestSchema.safeParse(manifest)
  if (!parsed.success) {
    const [first] = parsed.error.issues
    const where = first ? first.path.join(".") : "unknown"
    const why = first ? first.message : "unknown"
    throw new AnswerLeakError(`manifest failed its own schema at "${where}": ${why}`)
  }
  scanForForbiddenKeys(parsed.data, "manifest")
}

/** Derive the student-facing manifest. Strips the answer key by construction. */
export function project(quizId: string, doc: QuizDoc): ExamManifest {
  const manifest: ExamManifest = {
    id: quizId,
    title: doc.title,
    duration_s: doc.settings.durationS,
    allow_backtracking: doc.settings.allowBacktracking,
    shuffle_questions: doc.settings.shuffleQuestions,
    questions: doc.questions.map(questionToManifest),
  }

  assertNoAnswerLeak(manifest)
  return manifest
}

/** Derive the server-only grading key. Never leaves `apps/api`. */
export function extractKey(doc: QuizDoc): QuizAnswerKey {
  const keys: QuizAnswerKey["keys"] = {}
  for (const question of doc.questions) {
    keys[question.id] = questionToAnswerKey(question)
  }
  return { version: 1, keys }
}
