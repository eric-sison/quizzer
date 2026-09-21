/**
 * Copying authored content.
 *
 * `cloneQuestion` backs the editor's Duplicate action; the doc-level helpers
 * back server-side quiz duplication, which must also re-point media: media
 * authorization is scoped by quiz id, so a copied document referencing the
 * source quiz's media ids would 404 for that copy's exam sessions.
 *
 * Everything here is pure - ids are minted by these functions at call time, so
 * none of it may live inside a reducer.
 */
import { newId } from "./id"
import type { Question, QuizDoc } from "./question"
import type { RichBlock, RichDoc } from "./rich-text"

/**
 * Copy a question with every id minted afresh - options, blanks, pairs,
 * distractors and ordering items included. Two questions sharing a nested id
 * would make the answer key ambiguous, since keys are keyed by those ids.
 */
export function cloneQuestion(source: Question): Question {
  const id = newId()

  switch (source.kind) {
    case "single_choice":
    case "multiple_choice":
      return {
        ...source,
        id,
        options: source.options.map((option) => ({ ...option, id: newId() })),
      }
    case "fill_in_blank":
      return {
        ...source,
        id,
        blanks: source.blanks.map((blank) => ({ ...blank, id: newId() })),
      }
    case "matching":
      return {
        ...source,
        id,
        pairs: source.pairs.map((pair) => ({ ...pair, leftId: newId(), rightId: newId() })),
        distractors: source.distractors.map((d) => ({ ...d, id: newId() })),
      }
    case "ordering":
      return {
        ...source,
        id,
        items: source.items.map((item) => ({ ...item, id: newId() })),
      }
    case "true_false":
    case "numeric":
    case "essay":
      return { ...source, id }
  }
}

/** Rewrite every image node's mediaId through `map`. */
export function mapRichDocMediaIds(
  doc: RichDoc,
  map: (mediaId: string) => string
): RichDoc {
  const content = doc.content.map((block): RichBlock => {
    if (block.type !== "image") return block
    return { ...block, attrs: { ...block.attrs, mediaId: map(block.attrs.mediaId) } }
  })
  return { type: "doc", content }
}

function questionDocs(question: Question): RichDoc[] {
  const docs = [question.promptDoc]
  if (question.explanationDoc) docs.push(question.explanationDoc)
  switch (question.kind) {
    case "single_choice":
    case "multiple_choice":
      docs.push(...question.options.map((o) => o.labelDoc))
      break
    case "ordering":
      docs.push(...question.items.map((i) => i.labelDoc))
      break
    case "essay":
      if (question.rubricDoc) docs.push(question.rubricDoc)
      break
    default:
      break
  }
  return docs
}

/** Every media id referenced anywhere in the document, deduplicated. */
export function collectMediaIds(doc: QuizDoc): string[] {
  const ids = new Set<string>()
  for (const question of doc.questions) {
    for (const rich of questionDocs(question)) {
      for (const block of rich.content) {
        if (block.type === "image") ids.add(block.attrs.mediaId)
      }
    }
  }
  return [...ids]
}

function mapQuestionMedia(question: Question, map: (id: string) => string): Question {
  const next: Question = {
    ...question,
    promptDoc: mapRichDocMediaIds(question.promptDoc, map),
  }
  if (next.explanationDoc) next.explanationDoc = mapRichDocMediaIds(next.explanationDoc, map)

  switch (next.kind) {
    case "single_choice":
    case "multiple_choice":
      next.options = next.options.map((o) => ({
        ...o,
        labelDoc: mapRichDocMediaIds(o.labelDoc, map),
      }))
      break
    case "ordering":
      next.items = next.items.map((i) => ({
        ...i,
        labelDoc: mapRichDocMediaIds(i.labelDoc, map),
      }))
      break
    case "essay":
      if (next.rubricDoc) next.rubricDoc = mapRichDocMediaIds(next.rubricDoc, map)
      break
    default:
      break
  }
  return next
}

/**
 * Copy a whole document for quiz duplication: every question and nested id
 * re-minted, every image node re-pointed through `mediaIdMap`. Ids without a
 * mapping stay untouched - they were already dangling in the source, and the
 * copy is not made worse.
 */
export function cloneQuizDoc(doc: QuizDoc, mediaIdMap: Record<string, string>): QuizDoc {
  const map = (id: string) => mediaIdMap[id] ?? id
  return {
    ...doc,
    questions: doc.questions.map((q) => mapQuestionMedia(cloneQuestion(q), map)),
  }
}
