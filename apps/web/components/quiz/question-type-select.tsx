"use client"

import * as React from "react"
import {
  isRichDocEmpty,
  isSplitScored,
  withDerivedPoints,
  type Question,
  type QuestionKind,
} from "@workspace/quiz-core"
import { ChevronDown } from "lucide-react"
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
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { isChoiceQuestion } from "@/lib/quiz/selection"
import {
  questionTypes,
  TYPE_MENU_ORDER,
  typeDef,
} from "@/lib/quiz/types/registry"

function isChoice(kind: QuestionKind): boolean {
  return kind === "single_choice" || kind === "multiple_choice"
}

/**
 * What switching to `next` would throw away, phrased to follow "Switching to X".
 * Returns null when the change is lossless.
 */
function lossFor(question: Question, next: QuestionKind): string | null {
  if (question.kind === next) return null
  // The two choice variants are structurally identical; moving between them
  // only ever unmarks answers, which SelectionSwitch already warns about.
  if (isChoiceQuestion(question) && isChoice(next)) return null

  if (isChoiceQuestion(question) && question.options.length > 0) {
    const count = question.options.length
    return `would discard all ${count} answer ${count === 1 ? "option" : "options"}.`
  }
  if (question.kind === "essay" && question.rubricDoc !== undefined) {
    return "would discard the marking rubric."
  }
  if (question.kind === "numeric" && question.correctValue !== undefined) {
    return "would discard the correct value and tolerance."
  }
  if (
    question.kind === "fill_in_blank" &&
    question.blanks.some((blank) => blank.acceptedAnswers.some((a) => a.trim()))
  ) {
    return "would discard the blanks and their accepted responses."
  }
  if (question.kind === "matching") {
    const filled =
      question.pairs.filter((p) => p.leftText.trim() || p.rightText.trim()).length +
      question.distractors.filter((d) => d.text.trim()).length
    if (filled > 0) {
      return `would discard all ${question.pairs.length} pairs.`
    }
  }
  if (question.kind === "ordering") {
    if (question.items.some((item) => !isRichDocEmpty(item.labelDoc))) {
      return `would discard all ${question.items.length} items.`
    }
  }
  return null
}

export function QuestionTypeSelect({
  question,
  onChange,
}: {
  question: Question
  onChange: (next: Question) => void
}) {
  const [pending, setPending] = React.useState<QuestionKind | null>(null)

  const current = typeDef(question.kind)
  const Icon = current.icon

  /** Keep the prompt, scoring and explanation; replace the answer config. */
  function convert(kind: QuestionKind): Question {
    const fresh = typeDef(kind).createDefault()
    const next: Question = {
      ...fresh,
      id: question.id,
      promptDoc: question.promptDoc,
      points: question.points,
      required: question.required,
      // Conditional so a question without one doesn't gain an explicit
      // `explanationDoc: undefined` key, which the strict schema rejects.
      ...(question.explanationDoc !== undefined
        ? { explanationDoc: question.explanationDoc }
        : {}),
    }
    // A split-scored question's points follow from its parts, and the fresh
    // one has none priced yet. Carrying the old total across would leave the
    // read-only field showing a number its own scoring does not produce.
    return isSplitScored(next) ? withDerivedPoints(next) : next
  }

  function select(kind: QuestionKind) {
    if (kind === question.kind) return
    if (lossFor(question, kind)) {
      setPending(kind)
      return
    }
    onChange(convert(kind))
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline">
              <Icon className="text-primary" />
              {current.label}
              <ChevronDown className="text-muted-foreground" />
            </Button>
          }
        />

        <DropdownMenuContent align="end" width="content">
          <div className="w-84">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Question type</DropdownMenuLabel>

              {/* A radio group, because this is a pick-one-of-N: the selected
                  state and its check mark come from the component. */}
              <DropdownMenuRadioGroup
                value={question.kind}
                onValueChange={(value) => select(value as QuestionKind)}
              >
                {TYPE_MENU_ORDER.map((kind) => {
                  const def = questionTypes[kind]
                  const ItemIcon = def.icon
                  const active = kind === question.kind

                  return (
                    <DropdownMenuRadioItem
                      key={kind}
                      value={kind}
                      size="lg"
                    >
                      <ItemIcon
                        data-active={active || undefined}
                        className="size-4 self-start text-muted-foreground"
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-[13px] leading-tight font-medium">
                          {def.menuLabel}
                        </span>
                        <span className="text-[11px] leading-snug text-muted-foreground">
                          {def.description}
                        </span>
                      </span>
                    </DropdownMenuRadioItem>
                  )
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={pending !== null}
        onOpenChange={() => setPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change question type?</AlertDialogTitle>
            <AlertDialogDescription>
              Switching to {pending ? typeDef(pending).label : "this type"}{" "}
              {pending ? lossFor(question, pending) : null} The question text
              and required setting are kept
              {pending && isSplitScored(typeDef(pending).createDefault())
                ? ", and its points are recalculated from the parts you price."
                : ", along with its points."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                if (pending) onChange(convert(pending))
                setPending(null)
              }}
            >
              Change type
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
