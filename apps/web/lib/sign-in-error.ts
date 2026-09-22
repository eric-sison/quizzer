/**
 * Human wording for the `?error=` codes the login page can land with.
 *
 * Better Auth appends error codes to the callback URL when a sign-in is
 * rejected server-side; `not_authorized` is apps/web's own, set when a valid
 * session belongs to someone this dashboard is not for. Codes are not typed
 * anywhere, so unknown ones get a generic line rather than leaking upstream.
 */
export function describeSignInError(code: string): string {
  switch (code) {
    case "domain_not_allowed":
      return "That Google account's domain isn't allowed here. Sign in with your school account, or ask an admin to add your domain."
    case "email_not_verified":
      return "That Google account's email address isn't verified. Verify it with Google, then try again."
    case "not_authorized":
      return "You're signed in, but this dashboard is for teachers and admins. Ask an admin for access if you should have it."
    default:
      return "Sign-in didn't complete. Please try again."
  }
}
