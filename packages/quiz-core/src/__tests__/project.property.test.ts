/**
 * Property test for the invariant the whole design exists to protect: no
 * generated authoring document, however shaped, projects to a manifest that
 * carries an answer. The example-based tests in project.test.ts pin specific
 * behaviours; this one searches the input space for a counterexample.
 */
import fc from "fast-check"
import { describe, expect, it } from "vitest"

import {
  createBlank,
  createDistractor,
  createMatchPair,
  createOption,
  createOrderingItem,
  createQuestion,
  createQuizDoc,
} from "../question"
import type { Question, QuizDoc } from "../question"
import { project } from "../project"
import { richDocFromText } from "../rich-text"

const text = fc.string({ minLength: 0, maxLength: 40 })

const arbTrueFalse: fc.Arbitrary<Question> = fc
  .record({ prompt: text, correct: fc.boolean() })
  .map(({ prompt, correct }) => ({
    ...createQuestion("true_false"),
    promptDoc: richDocFromText(prompt),
    correct,
  }))

const arbOptions = fc.array(
  fc.record({ label: text, correct: fc.boolean() }),
  { minLength: 1, maxLength: 6 }
)

const arbSingleChoice: fc.Arbitrary<Question> = fc
  .record({ prompt: text, options: arbOptions })
  .map(({ prompt, options }) => ({
    ...createQuestion("single_choice"),
    promptDoc: richDocFromText(prompt),
    options: options.map(({ label, correct }) => ({ ...createOption(label), correct })),
  }))

const arbMultipleChoice: fc.Arbitrary<Question> = fc
  .record({ prompt: text, options: arbOptions })
  .map(({ prompt, options }) => ({
    ...createQuestion("multiple_choice"),
    promptDoc: richDocFromText(prompt),
    options: options.map(({ label, correct }) => ({ ...createOption(label), correct })),
  }))

const arbEssay: fc.Arbitrary<Question> = fc
  .record({
    prompt: text,
    minWords: fc.option(fc.integer({ min: 0, max: 1_000 }), { nil: undefined }),
    maxWords: fc.option(fc.integer({ min: 1, max: 10_000 }), { nil: undefined }),
    rubric: fc.option(text, { nil: undefined }),
  })
  .map(({ prompt, minWords, maxWords, rubric }) => {
    const question = { ...createQuestion("essay"), promptDoc: richDocFromText(prompt) }
    if (minWords !== undefined) question.minWords = minWords
    if (maxWords !== undefined) question.maxWords = maxWords
    if (rubric !== undefined) question.rubricDoc = richDocFromText(rubric)
    return question
  })

const arbNumeric: fc.Arbitrary<Question> = fc
  .record({
    prompt: text,
    correctValue: fc.option(fc.double({ noNaN: true, noDefaultInfinity: true }), {
      nil: undefined,
    }),
    tolerance: fc.double({ min: 0, max: 100, noNaN: true }),
    unit: fc.option(fc.string({ maxLength: 8 }), { nil: undefined }),
  })
  .map(({ prompt, correctValue, tolerance, unit }) => {
    const question = {
      ...createQuestion("numeric"),
      promptDoc: richDocFromText(prompt),
      tolerance,
    }
    if (correctValue !== undefined) question.correctValue = correctValue
    if (unit !== undefined) question.unit = unit
    return question
  })

const arbFillInBlank: fc.Arbitrary<Question> = fc
  .record({
    prompt: text,
    blanks: fc.array(fc.array(text, { maxLength: 4 }), { minLength: 0, maxLength: 6 }),
    caseSensitive: fc.boolean(),
  })
  .map(({ prompt, blanks, caseSensitive }) => ({
    ...createQuestion("fill_in_blank"),
    promptDoc: richDocFromText(prompt),
    blanks: blanks.map((acceptedAnswers) => ({ ...createBlank(), acceptedAnswers })),
    caseSensitive,
  }))

const arbMatching: fc.Arbitrary<Question> = fc
  .record({
    prompt: text,
    pairs: fc.array(fc.record({ left: text, right: text }), { minLength: 0, maxLength: 6 }),
    distractors: fc.array(text, { maxLength: 3 }),
  })
  .map(({ prompt, pairs, distractors }) => ({
    ...createQuestion("matching"),
    promptDoc: richDocFromText(prompt),
    pairs: pairs.map(({ left, right }) => ({
      ...createMatchPair(),
      leftText: left,
      rightText: right,
    })),
    distractors: distractors.map((d) => createDistractor(d)),
  }))

const arbOrdering: fc.Arbitrary<Question> = fc
  .record({ prompt: text, labels: fc.array(text, { minLength: 0, maxLength: 6 }) })
  .map(({ prompt, labels }) => ({
    ...createQuestion("ordering"),
    promptDoc: richDocFromText(prompt),
    items: labels.map((label) => createOrderingItem(label)),
  }))

const arbExplanation = fc.option(text, { nil: undefined })

const arbQuestion = fc
  .tuple(
    fc.oneof(
      arbTrueFalse,
      arbSingleChoice,
      arbMultipleChoice,
      arbNumeric,
      arbFillInBlank,
      arbMatching,
      arbOrdering,
      arbEssay
    ),
    arbExplanation
  )
  .map(([question, explanation]) =>
    explanation === undefined
      ? question
      : { ...question, explanationDoc: richDocFromText(explanation) }
  )

const arbQuizDoc: fc.Arbitrary<QuizDoc> = fc
  .record({
    title: text,
    questions: fc.array(arbQuestion, { minLength: 0, maxLength: 15 }),
    durationS: fc.integer({ min: 1, max: 86_400 }),
    allowBacktracking: fc.boolean(),
    shuffleQuestions: fc.boolean(),
  })
  .map(({ title, questions, durationS, allowBacktracking, shuffleQuestions }) => ({
    ...createQuizDoc(title),
    settings: { durationS, allowBacktracking, shuffleQuestions },
    questions,
  }))

describe("project() over generated documents", () => {
  it("strips every correct answer, whatever the document looks like", () => {
    fc.assert(
      fc.property(arbQuizDoc, (doc) => {
        // project() runs assertNoAnswerLeak internally, so merely returning is
        // already a schema-plus-forbidden-keys pass. Assert on the serialised
        // output too, so a leak through a value (not a key) also fails.
        const manifest = project("quiz-under-test", doc)
        const serialised = JSON.stringify(manifest)

        expect(serialised).not.toContain('"correct"')
        expect(serialised).not.toContain("answerKey")
        expect(serialised).not.toContain("answer_key")
        expect(serialised).not.toContain("rubric")
        expect(serialised).not.toContain("explanation")
        expect(serialised).not.toContain("tolerance")
        expect(serialised).not.toContain("accepted")
        expect(serialised).not.toContain('"pairs"')
        expect(serialised).not.toContain("distractor")
        expect(serialised).not.toContain('"blanks"')

        // Structure survives: every question and option is still addressable.
        expect(manifest.questions).toHaveLength(doc.questions.length)
        for (const [i, q] of doc.questions.entries()) {
          const projected = manifest.questions[i]
          expect(projected?.id).toBe(q.id)
          if (q.kind === "single_choice" || q.kind === "multiple_choice") {
            expect(projected?.choices.map((c) => c.id)).toEqual(
              q.options.map((o) => o.id)
            )
          }
          if (q.kind === "ordering") {
            // Same ids, never the authored (correct) order unless id-sort
            // happens to coincide with it.
            expect(projected?.choices.map((c) => c.id)).toEqual(
              q.items.map((item) => item.id).sort()
            )
          }
          if (q.kind === "matching") {
            expect(projected?.right_items?.map((c) => c.id)).toEqual(
              [...q.pairs.map((p) => p.rightId), ...q.distractors.map((d) => d.id)].sort()
            )
          }
        }
      }),
      { numRuns: 250 }
    )
  })
})
