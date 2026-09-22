import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * Optimistic auth check at the edge of the app.
 *
 * This only asks "is there a session cookie at all?" - never whether it is
 * valid, which would mean a DB hit per request. A forged cookie gets through
 * here and then bounces off `getSession()` in the layout; what this buys is
 * that a plainly signed-out visitor never renders a protected shell first.
 */
const SESSION_COOKIES = [
  "better-auth.session_token",
  // Better Auth prefixes the cookie when it is Secure.
  "__Secure-better-auth.session_token",
]

export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name))
  if (hasSession) return NextResponse.next()

  return NextResponse.redirect(new URL("/login", request.url))
}

export const config = {
  matcher: [
    /*
     * Everything except the public surface:
     * - /login (where the redirect lands)
     * - /device (desktop verification; it handles sign-in itself)
     * - /api (route handlers and the /api/auth rewrite answer 401 themselves)
     * - /_next internals and static assets (anything with a file extension)
     */
    "/((?!login|device|api|_next|favicon\\.ico|.*\\..*).*)",
  ],
}
