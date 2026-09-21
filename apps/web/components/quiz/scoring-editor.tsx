"use client"

import {
  questionPoints,
  scoredParts,
  MAX_QUESTION_POINTS,
  type SplitScoredQuestion,
} from "@workspace/quiz-core"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import { SectionHeader } from "@/components/quiz/section-header"

/**
 * How a question's points are split across the parts that earn them.
 *
 * Two kinds have this block: multiple choice, where the parts are the answers
 * marked correct, and fill in the blank, where they are the blanks. In both
 * the award is a function of those parts, which is why the Points field in the
 * shell below is read-only. The two modes both write the same derived total,
 * so switching between them is never lossy - the flat rate and each part's own
 * value are kept while the other mode is showing.
 */
export function ScoringEditor({
  question,
  onChange,
}: {
  question: SplitScoredQuestion
  onChange: (next: SplitScoredQuestion) => void
}) {
  const words = wordsFor(question)
  const count = scoredParts(question).length
  const total = questionPoints(question)
  const perPart = question.scoring === "per_option"

  return (
    <div className="flex flex-col gap-2.5">
      <SectionHeader
        title="Scoring"
        action={
          <Tabs
            value={question.scoring}
            onValueChange={(scoring) =>
              onChange({
                ...question,
                scoring: scoring === "per_option" ? "per_option" : "uniform",
              })
            }
          >
            <TabsList>
              <TabsTrigger value="uniform">Same for each</TabsTrigger>
              <TabsTrigger value="per_option">{words.perPartTab}</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      <div className="rounded-xl border border-dashed bg-muted/30 p-3.5">
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          {perPart ? words.perPartHint : words.uniformHint}
        </p>

        <div className="flex flex-wrap items-center gap-4">
          {perPart ? null : (
            <Label>
              {words.rateLabel}
              <span className="w-20">
                <PointsInput
                  value={question.pointsPerCorrect}
                  ariaLabel={words.rateLabel}
                  // A flat rate always has a value, so an emptied box is 0
                  // rather than "not set" - unlike the per-part boxes.
                  onChange={(points) =>
                    onChange({ ...question, pointsPerCorrect: points ?? 0 })
                  }
                />
              </span>
            </Label>
          )}

          <p className="text-xs text-muted-foreground">
            Worth{" "}
            <span className="font-medium text-foreground">
              {total} {total === 1 ? "point" : "points"}
            </span>
            {count === 0
              ? words.emptyHint
              : ` across ${count} ${count === 1 ? words.part : words.parts}`}
          </p>
        </div>
      </div>
    </div>
  )
}

/** Each kind's own vocabulary for the same mechanism. */
function wordsFor(question: SplitScoredQuestion) {
  if (question.kind === "fill_in_blank") {
    return {
      perPartTab: "Per blank",
      rateLabel: "Points per blank",
      uniformHint:
        "Every blank is worth the same. The question's total follows from how many there are.",
      perPartHint:
        "Every blank above needs a value. One left empty blocks publishing, rather than counting as zero.",
      emptyHint: " (there are no blanks yet)",
      part: "blank",
      parts: "blanks",
    }
  }
  return {
    perPartTab: "Per answer",
    rateLabel: "Points per correct answer",
    uniformHint:
      "Every correct answer is worth the same. The question's total follows from how many you mark.",
    perPartHint:
      "Every correct answer above needs a value. One left empty blocks publishing, rather than counting as zero.",
    emptyHint: " (nothing is marked correct yet)",
    part: "correct answer",
    parts: "correct answers",
  }
}

/**
 * A whole-number field for a point value.
 *
 * Driven straight from the document rather than from a local draft: undo, the
 * one/many switch and a type change all move these values under a field that
 * nobody is typing in, and a draft would have to be resynced on every one of
 * them. Focusing selects what is there instead, so retyping a value is one
 * gesture - which is how these boxes are actually used.
 *
 * `undefined` is an empty box, which per-part scoring stores as "no value set"
 * rather than as a zero.
 */
export function PointsInput({
  value,
  ariaLabel,
  placeholder = "0",
  invalid = false,
  onChange,
}: {
  value: number | undefined
  ariaLabel: string
  /** "0" only where blank really does mean zero - not on a box that must be filled. */
  placeholder?: string
  /** Marks the box the publish gate will reject, rather than saving it up. */
  invalid?: boolean
  onChange: (points: number | undefined) => void
}) {
  return (
    <Input
      type="text"
      inputMode="numeric"
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      value={value === undefined ? "" : String(value)}
      placeholder={placeholder}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => {
        const raw = event.currentTarget.value
        // Anything that is not a plain whole number is refused outright, so
        // the field can never hold text the document would reject.
        if (raw !== "" && !/^\d{1,4}$/.test(raw)) return
        onChange(
          raw === "" ? undefined : Math.min(Number.parseInt(raw, 10), MAX_QUESTION_POINTS)
        )
      }}
    />
  )
}
