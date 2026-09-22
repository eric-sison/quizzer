import { MonitorSmartphone } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"

import { DeviceVerification } from "./device-verification"

export const metadata = { title: "Connect the exam app" }

/**
 * The device-flow verification page (RFC 8628). The exam app on a lab machine
 * shows a code and points here; whoever is signed in on THIS browser approves
 * it. Public route: the page itself handles the signed-out case, because the
 * user usually arrives signed out and must come back to the same user_code
 * after Google.
 */
export default async function DevicePage({
  searchParams,
}: {
  // Next 16: searchParams is a Promise.
  searchParams: Promise<{ user_code?: string | string[] }>
}) {
  const params = await searchParams
  const raw = params.user_code
  const userCode = (Array.isArray(raw) ? raw[0] : raw) ?? ""

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <div className="flex flex-col items-center gap-1 text-center">
              <span className="mb-1 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <MonitorSmartphone className="size-5" />
              </span>
              <CardTitle>Connect the exam app</CardTitle>
              <CardDescription>Approve the sign-in request the exam app is waiting on.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <DeviceVerification initialUserCode={userCode} />
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
