import * as React from "react"

import { useExamSession } from "@/hooks/use-exam-session"
import { useProctorUnlock } from "@/hooks/use-proctor-unlock"
import { installGuardBridge } from "@/lib/ipc"
import { Exam } from "@/screens/exam"
import { ExamError } from "@/screens/exam-error"
import { LinkEntry } from "@/screens/link-entry"
import { Starting } from "@/screens/starting"
import { Submitted } from "@/screens/submitted"

function App() {
  const session = useExamSession()

  // Only while an exam is on screen: there is nothing to release before one
  // starts, and nothing to release after it is submitted.
  useProctorUnlock(session.screen === "exam")

  // `guard.js` runs before this bundle exists, so it publishes through a global
  // that we fill in here. Until then its reports are silently dropped, which is
  // fine - the Rust-side signals cover the same ground.
  React.useEffect(() => {
    installGuardBridge()
  }, [])

  switch (session.screen) {
    case "starting":
      return <Starting />

    case "exam":
      return session.snapshot ? (
        <Exam
          snapshot={session.snapshot}
          lockdown={session.lockdown}
          remaining={session.remaining}
          strikes={session.strikes}
          strikeNotice={session.strikeNotice}
          unsaved={session.unsaved}
          submitting={session.submitting}
          timeUp={session.timeUp}
          timeUpAt={session.timeUpAt}
          onAnswer={session.answer}
          onSubmit={session.submit}
          onDismissStrike={session.dismissStrikeNotice}
        />
      ) : (
        <Starting />
      )

    case "submitted":
      return (
        <Submitted
          receipt={session.snapshot?.receipt ?? null}
          snapshot={session.snapshot}
          endedBy={session.endedBy}
        />
      )

    case "error":
      return session.error ? (
        <ExamError error={session.error} onDismiss={session.dismissError} />
      ) : (
        <Starting />
      )

    case "link-entry":
    default:
      return (
        <LinkEntry
          onBegin={session.begin}
          busy={false}
          error={session.error}
        />
      )
  }
}

export default App
