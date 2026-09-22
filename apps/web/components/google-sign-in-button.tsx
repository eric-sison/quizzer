"use client"

import * as React from "react"
import { Button } from "@workspace/ui/components/button"

import { authClient } from "@/lib/auth-client"

/** Google's "G", inlined: lucide dropped brand icons. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.11A12 12 0 0 0 12 24Z"
      />
      <path fill="#FBBC05" d="M5.28 14.28a7.2 7.2 0 0 1 0-4.56V6.61H1.27a12 12 0 0 0 0 10.78l4.01-3.11Z" />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.98 11.98 0 0 0 1.27 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77Z"
      />
    </svg>
  )
}

/**
 * The one way in. `callbackURL` is where Google drops the user afterwards -
 * the dashboard from /login, back to /device mid-pairing. A refused sign-in
 * (domain not allowed, unverified email) lands back on /login with ?error=,
 * where this app explains it - not on Better Auth's bare error page.
 */
export function GoogleSignInButton({ callbackURL }: { callbackURL: string }) {
  const [pending, setPending] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  async function signIn() {
    setPending(true)
    setFailed(false)
    const { error } = await authClient.signIn.social({
      provider: "google",
      callbackURL,
      errorCallbackURL: "/login",
    })
    if (error) {
      // Normally the browser has already left for Google; reaching this means
      // the redirect itself could not be arranged. Inline, not a toast: the
      // public pages that render this button mount no Toaster.
      setPending(false)
      setFailed(true)
    }
  }

  return (
    // `grid` stretches the inline-flex button to the full card width without
    // restyling the shared Button itself.
    <div className="grid w-full gap-2">
      <Button variant="outline" disabled={pending} onClick={signIn}>
        <GoogleMark />
        {pending ? "Redirecting…" : "Continue with Google"}
      </Button>
      {failed ? (
        <p className="text-center text-xs text-destructive">Could not start sign-in. Please try again.</p>
      ) : null}
    </div>
  )
}
