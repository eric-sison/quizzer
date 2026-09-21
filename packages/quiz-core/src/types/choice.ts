/**
 * Rules and projection shared by the two multiple-choice variants. They differ
 * only in how many options may be correct, so that difference is a parameter
 * rather than a second copy of this file.
 */
import type { Issue } from "../issue"
import type { ChoiceOption } from "../question"
import { isRichDocEmpty, richDocHasImage, toPlainText } from "../rich-text"
import { issue, manifestChoice } from "./logic"

export const MIN_OPTIONS = 2

export function validateOptions(questionId: string, options: ChoiceOption[]): Issue[] {
  const issues: Issue[] = []

  if (options.length < MIN_OPTIONS) {
    issues.push(
      issue(
        questionId,
        "options",
        "too_few_options",
        `Add at least ${MIN_OPTIONS} answer options.`
      )
    )
  }

  const seen = new Map<string, number>()
  options.forEach((option, index) => {
    const noText = isRichDocEmpty(option.labelDoc)

    // An image-only option is perfectly visible, so an image satisfies the
    // emptiness rule. It also opts out of duplicate detection below, which
    // compares text: two different pictures with no caption are not "the same
    // option", and this validator cannot see the pixels.
    if (noText) {
      if (!richDocHasImage(option.labelDoc)) {
        issues.push(
          issue(
            questionId,
            `options.${index}.labelDoc`,
            "empty_option",
            "An empty option is invisible to students."
          )
        )
      }
      return
    }

    const key = toPlainText(option.labelDoc).trim().toLowerCase()
    const first = seen.get(key)
    if (first === undefined) {
      seen.set(key, index)
    } else {
      issues.push(
        issue(
          questionId,
          `options.${index}.labelDoc`,
          "duplicate_option",
          `This repeats option ${first + 1}.`
        )
      )
    }
  })

  return issues
}

export function optionChoices(options: ChoiceOption[]) {
  return options.map((o) => manifestChoice(o.id, o.labelDoc))
}

export function correctOptions(options: ChoiceOption[]): ChoiceOption[] {
  return options.filter((o) => o.correct)
}
