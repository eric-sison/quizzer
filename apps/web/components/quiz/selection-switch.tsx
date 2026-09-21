"use client"

import * as React from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import {
  toMultipleChoice,
  toSingleChoice,
  willDiscardCorrectAnswers,
  type ChoiceQuestion,
} from "@/lib/quiz/selection"

/** One-answer / many-answers switch, with a warning when the change is lossy. */
export function SelectionSwitch({
  question,
  onChange,
}: {
  question: ChoiceQuestion
  onChange: (next: ChoiceQuestion) => void
}) {
  const [pendingLoss, setPendingLoss] = React.useState(0)

  function select(value: string) {
    if (value === "many") {
      onChange(toMultipleChoice(question))
      return
    }

    const losing = willDiscardCorrectAnswers(question)
    if (losing > 0) {
      setPendingLoss(losing)
      return
    }
    onChange(toSingleChoice(question))
  }

  return (
    <>
      <Tabs
        value={question.kind === "single_choice" ? "one" : "many"}
        onValueChange={select}
      >
        <TabsList>
          <TabsTrigger value="one">One answer</TabsTrigger>
          <TabsTrigger value="many">Multiple answers</TabsTrigger>
        </TabsList>
      </Tabs>

      <AlertDialog open={pendingLoss > 0} onOpenChange={() => setPendingLoss(0)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to one answer?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingLoss === 1
                ? "One option is marked correct and will be unmarked."
                : `${pendingLoss} options are marked correct and will be unmarked.`}{" "}
              The first correct option is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep multiple</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                onChange(toSingleChoice(question))
                setPendingLoss(0)
              }}
            >
              Switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
