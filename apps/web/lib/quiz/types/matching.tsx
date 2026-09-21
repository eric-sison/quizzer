"use client"

import {
  createDistractor,
  createMatchPair,
  createQuestion,
  type MatchDistractor,
  type MatchPair,
} from "@workspace/quiz-core"
import { ArrowLeftRight, MoveRight, Plus, Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"

import { SectionHeader } from "@/components/quiz/section-header"
import type { QuestionEditorProps, QuestionTypeDef } from "./registry"

function MatchingEditor({ question, onChange }: QuestionEditorProps<"matching">) {
  function updatePair(index: number, patch: Partial<MatchPair>) {
    onChange({
      ...question,
      pairs: question.pairs.map((pair, i) => (i === index ? { ...pair, ...patch } : pair)),
    })
  }

  function updateDistractor(index: number, patch: Partial<MatchDistractor>) {
    onChange({
      ...question,
      distractors: question.distractors.map((d, i) =>
        i === index ? { ...d, ...patch } : d
      ),
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2.5">
        <SectionHeader
          title="Pairs"
          hint="Students see the right column shuffled and match each left item to it"
        />

        <ul className="flex flex-col gap-2">
          {question.pairs.map((pair, index) => (
            <li key={pair.leftId} className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <Input
                  value={pair.leftText}
                  maxLength={500}
                  onChange={(event) =>
                    updatePair(index, { leftText: event.currentTarget.value })
                  }
                  placeholder={`Left ${index + 1}`}
                  aria-label={`Pair ${index + 1} left side`}
                />
              </span>
              <MoveRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <Input
                  value={pair.rightText}
                  maxLength={500}
                  onChange={(event) =>
                    updatePair(index, { rightText: event.currentTarget.value })
                  }
                  placeholder={`Right ${index + 1}`}
                  aria-label={`Pair ${index + 1} right side`}
                />
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove pair ${index + 1}`}
                disabled={question.pairs.length <= 2}
                onClick={() =>
                  onChange({
                    ...question,
                    pairs: question.pairs.filter((_, i) => i !== index),
                  })
                }
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>

        <div className="flex">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              onChange({ ...question, pairs: [...question.pairs, createMatchPair()] })
            }
          >
            <Plus />
            Add pair
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <SectionHeader
          title="Extra right-side items"
          hint="Shown mixed into the right column; they match nothing"
        />

        {question.distractors.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {question.distractors.map((distractor, index) => (
              <li key={distractor.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <Input
                    value={distractor.text}
                    maxLength={500}
                    onChange={(event) =>
                      updateDistractor(index, { text: event.currentTarget.value })
                    }
                    placeholder={`Extra item ${index + 1}`}
                    aria-label={`Extra right-side item ${index + 1}`}
                  />
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove extra item ${index + 1}`}
                  onClick={() =>
                    onChange({
                      ...question,
                      distractors: question.distractors.filter((_, i) => i !== index),
                    })
                  }
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              onChange({
                ...question,
                distractors: [...question.distractors, createDistractor()],
              })
            }
          >
            <Plus />
            Add extra item
          </Button>
        </div>
      </div>
    </div>
  )
}

export const matchingType: QuestionTypeDef<"matching"> = {
  kind: "matching",
  label: "Matching",
  menuLabel: "Matching",
  description: "Pair each left item with its match",
  icon: ArrowLeftRight,
  createDefault: () => createQuestion("matching"),
  Editor: MatchingEditor,
}
