"use client"

import * as React from "react"
import { CircleAlert, CircleCheck, ShieldAlert } from "lucide-react"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Spinner } from "@workspace/ui/components/spinner"

import { GoogleSignInButton } from "@/components/google-sign-in-button"
import { authClient } from "@/lib/auth-client"

/**
 * The device flow rejects a code with an OAuth error body. These are the
 * codes a person can actually cause; anything else gets the generic line.
 */
function describeDeviceError(code: string | undefined, fallback?: string): string {
  switch (code) {
    case "expired_token":
      return "That code has expired. Ask the exam app for a fresh one and try again."
    case "invalid_request":
      return "That code isn't recognised. Check it against the exam screen and try again."
    case "device_code_already_processed":
      return "That code was already used. If the exam app isn't signed in, ask it for a fresh code."
    case "access_denied":
      return "That request was already denied. Ask the exam app for a fresh code if this was a mistake."
    default:
      return fallback ?? "Something went wrong. Try again with a fresh code."
  }
}

type Outcome = { state: "idle" } | { state: "approved" } | { state: "denied" } | { state: "error"; message: string }

export function DeviceVerification({ initialUserCode }: { initialUserCode: string }) {
  const { data: session, isPending } = authClient.useSession()
  const [userCode, setUserCode] = React.useState(initialUserCode)
  const [outcome, setOutcome] = React.useState<Outcome>({ state: "idle" })
  const [busy, setBusy] = React.useState<"approve" | "deny" | null>(null)

  async function decide(action: "approve" | "deny") {
    const code = userCode.trim()
    if (!code) return
    setBusy(action)
    setOutcome({ state: "idle" })

    // The plugin insists the signed-in session *claims* the code first
    // (GET /device) - approving an unclaimed code is refused outright. This
    // also means an unknown or expired code fails here, with the right story.
    let verify: Response
    try {
      verify = await fetch(`/api/auth/device?user_code=${encodeURIComponent(code)}`, {
        credentials: "same-origin",
      })
    } catch {
      setBusy(null)
      setOutcome({ state: "error", message: describeDeviceError(undefined) })
      return
    }
    if (!verify.ok) {
      const body = (await verify.json().catch(() => null)) as {
        error?: string
        error_description?: string
      } | null
      setBusy(null)
      setOutcome({
        state: "error",
        message: describeDeviceError(body?.error, body?.error_description),
      })
      return
    }

    const { error } =
      action === "approve"
        ? await authClient.device.approve({ userCode: code })
        : await authClient.device.deny({ userCode: code })

    setBusy(null)
    if (error) {
      // The device endpoints answer with an OAuth error body: a machine
      // `error` code plus a human `error_description`.
      setOutcome({
        state: "error",
        message: describeDeviceError(error.error, error.error_description),
      })
      return
    }
    setOutcome({ state: action === "approve" ? "approved" : "denied" })
  }

  if (isPending) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <ShieldAlert />
          <AlertDescription>
            Only continue if this code is shown on YOUR exam screen. If someone sent you this link, close it.
          </AlertDescription>
        </Alert>
        <p className="text-sm text-muted-foreground">Sign in first, then you can approve the exam app.</p>
        <GoogleSignInButton callbackURL={`/device?user_code=${encodeURIComponent(userCode)}`} />
      </div>
    )
  }

  if (outcome.state === "approved") {
    return (
      <Alert>
        <CircleCheck />
        <AlertDescription>
          You&apos;re signed in on the exam app. Return to it now; you can close this tab.
        </AlertDescription>
      </Alert>
    )
  }

  if (outcome.state === "denied") {
    return (
      <Alert>
        <CircleCheck />
        <AlertDescription>Request denied. The exam app stays signed out; you can close this tab.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Signed in as <span className="font-medium text-foreground">{session.user.email}</span>. The exam app will run as
        this account.
      </p>

      <Alert>
        <ShieldAlert />
        <AlertDescription>
          Only continue if this code is shown on YOUR exam screen. If someone sent you this link, deny it.
        </AlertDescription>
      </Alert>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="device-user-code">Code on the exam screen</Label>
        <Input
          id="device-user-code"
          value={userCode}
          placeholder="XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setUserCode(event.currentTarget.value)}
        />
      </div>

      {outcome.state === "error" ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{outcome.message}</AlertDescription>
        </Alert>
      ) : null}

      {/* The grid stretches each button to half the row without restyling them. */}
      <div className="grid grid-cols-2 gap-2">
        <Button disabled={busy !== null || !userCode.trim()} onClick={() => decide("approve")}>
          {busy === "approve" ? "Approving…" : "Approve"}
        </Button>
        <Button variant="outline" disabled={busy !== null || !userCode.trim()} onClick={() => decide("deny")}>
          {busy === "deny" ? "Denying…" : "Deny"}
        </Button>
      </div>
    </div>
  )
}
