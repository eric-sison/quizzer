import { ServerCrash } from "lucide-react"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { QuizzesView } from "@/components/quizzes-view"
import { ApiClientError, quizApi } from "@/lib/api-client"

export const metadata = { title: "Quizzes" }

export default async function QuizzesPage() {
  // The fetch is awaited outside the JSX: a component constructed inside a
  // try/catch does not render inside it, so an error thrown while rendering
  // QuizzesView would slip past this handler and look like a dead API.
  let quizzes
  try {
    quizzes = await quizApi.list()
  } catch (error) {
    if (error instanceof ApiClientError && error.code === "network_unavailable") {
      return <ServiceDown />
    }
    throw error
  }

  return <QuizzesView quizzes={quizzes} />
}

/**
 * apps/web and apps/api are separate processes, so "the API isn't running" is a
 * routine local state rather than an exception. Saying which command to run
 * beats a stack trace.
 */
function ServiceDown() {
  return (
    <div className="flex flex-1 flex-col p-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ServerCrash />
          </EmptyMedia>
          <EmptyTitle>Can&apos;t reach the quiz service</EmptyTitle>
          <EmptyDescription>
            Start it with{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              docker compose up -d
            </code>{" "}
            and{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              pnpm --filter api dev
            </code>
            , then reload.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
