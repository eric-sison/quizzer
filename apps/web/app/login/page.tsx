import { CircleAlert, ClipboardCheck } from "lucide-react"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"

import { GoogleSignInButton } from "@/components/google-sign-in-button"
import { describeSignInError } from "@/lib/sign-in-error"

export const metadata = { title: "Sign in" }

export default async function LoginPage({
  searchParams,
}: {
  // Next 16: searchParams is a Promise.
  searchParams: Promise<{ error?: string | string[] }>
}) {
  const { error } = await searchParams
  const code = Array.isArray(error) ? error[0] : error

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <div className="flex flex-col items-center gap-1 text-center">
              <span className="mb-1 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ClipboardCheck className="size-5" />
              </span>
              <CardTitle>Quizzer</CardTitle>
              <CardDescription>Sign in with your school Google account to manage quizzes.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              {code ? (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertDescription>{describeSignInError(code)}</AlertDescription>
                </Alert>
              ) : null}
              <GoogleSignInButton callbackURL="/quizzes" />
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
