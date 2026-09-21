"use client"

import * as React from "react"

/**
 * Image upload and display for everything inside one question's editor.
 *
 * A context rather than a prop because the registry's per-kind editors are
 * deliberately generic ({ question, onChange }) - threading quizId through
 * every kind so that one of them can upload would put a media concern in four
 * signatures that have nothing to do with media. The provider lives in the
 * question editor shell, which already knows the quiz.
 */
export type QuestionMedia = {
  uploadImage: (file: File) => Promise<{ mediaId: string } | { error: string }>
  resolveImageSrc: (mediaId: string) => string
  /**
   * Open the app's picker over already-uploaded media; resolves with the
   * chosen id, or null on cancel. One imperative member rather than a list
   * method: the dialog, its fetch and its states stay private to one
   * component, and every insert point just wants "an id or nothing".
   */
  pickImage?: () => Promise<{ mediaId: string } | null>
}

const QuestionMediaContext = React.createContext<QuestionMedia | null>(null)

export const QuestionMediaProvider = QuestionMediaContext.Provider

/** Null outside a provider, in which case upload affordances should hide. */
export function useQuestionMedia(): QuestionMedia | null {
  return React.useContext(QuestionMediaContext)
}
