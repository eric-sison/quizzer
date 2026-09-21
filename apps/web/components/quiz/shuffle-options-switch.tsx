"use client"

import type { SingleChoiceQuestion, MultipleChoiceQuestion } from "@workspace/quiz-core"
import { Label } from "@workspace/ui/components/label"
import { Switch } from "@workspace/ui/components/switch"

type ChoiceQuestion = SingleChoiceQuestion | MultipleChoiceQuestion

/** Per-question option shuffling; rides updateQuestion like any other edit. */
export function ShuffleOptionsSwitch({
  question,
  onChange,
}: {
  question: ChoiceQuestion
  onChange: (next: ChoiceQuestion) => void
}) {
  return (
    <Label title="Each student sees these options in a different order">
      <Switch
        size="sm"
        checked={question.shuffleOptions}
        onCheckedChange={(shuffleOptions) => onChange({ ...question, shuffleOptions })}
      />
      <span className="text-xs text-muted-foreground">Shuffle options</span>
    </Label>
  )
}
