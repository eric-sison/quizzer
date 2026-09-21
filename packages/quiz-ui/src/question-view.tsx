// A client boundary, because `answer.onChange` is a function prop and those
// cannot cross from a Next.js server component into the client components
// below. Vite ignores the directive, so the desktop is unaffected.
"use client"

import type { ManifestQuestion } from "@workspace/quiz-core"
import { Badge } from "@workspace/ui/components/badge"

import { AnswerSection, type AnswerControls } from "./answer-controls"
import { RichText } from "./rich-text"

/**
 * One question, exactly as a student sees it.
 *
 * Rendered by both the teacher's preview and the desktop exam screen, so the
 * preview is a real rendering test rather than a lookalike that drifts. Only
 * `answer` differs between them.
 *
 * Deliberately not included: the timer, the lockdown badge, the submit button,
 * per-question save state. Those are exam chrome, they have no meaning in a
 * preview, and putting them here would make this component grow a prop for
 * every difference between the two apps. The caller supplies the page.
 *
 * The type of `question` is the guarantee that matters: `ManifestQuestion` has
 * nowhere for a correct answer to live, so there is nothing here to leak.
 */
export function QuestionView({
  question,
  index,
  total,
  answer,
  resolveImageSrc,
}: {
  question: ManifestQuestion
  /** Zero-based. */
  index: number
  total: number
  answer: AnswerControls
  /**
   * Turns a prompt image node's opaque `mediaId` into something an <img> can
   * load. The one other per-app part besides `answer`: the web preview
   * resolves through its same-origin proxy route, the desktop hands back a
   * data URI its Rust process fetched (the webview has no network). Omitted,
   * images render as nothing rather than as broken frames.
   */
  resolveImageSrc?: (mediaId: string) => string | undefined
}) {
  return (
    <section aria-labelledby={`question-${question.id}-heading`} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2
          id={`question-${question.id}-heading`}
          className="font-heading text-sm font-semibold tracking-tight"
        >
          Question {index + 1}
        </h2>
        <span className="text-sm text-muted-foreground">of {total}</span>

        <div className="flex-1" />

        {question.required ? <Badge variant="muted">Required</Badge> : null}
        {question.points > 0 ? (
          <Badge variant="muted">
            {question.points} {question.points === 1 ? "point" : "points"}
          </Badge>
        ) : null}
      </div>

      {/* `prompt` is populated on every question, so a prompt whose formatting
          was not worth shipping still renders. */}
      <div className="flex flex-col gap-3 text-base text-foreground">
        <RichText
          doc={question.prompt_doc}
          fallback={question.prompt}
          resolveImageSrc={resolveImageSrc}
        />
      </div>

      <AnswerSection question={question} answer={answer} />
    </section>
  )
}
