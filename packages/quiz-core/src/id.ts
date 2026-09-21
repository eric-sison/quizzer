/**
 * Ids for questions and answer options.
 *
 * These are document-internal identifiers, not credentials - the exam link
 * token is minted separately in `apps/api` with `crypto.randomBytes`. Sixteen
 * hex characters is ample for uniqueness within one quiz.
 */

// This package compiles without the DOM or @types/node libs on purpose: it must
// stay usable from a browser bundle, a Next server component and a Hono route
// alike. Declaring the one global we need keeps that true.
declare const globalThis: { crypto: { randomUUID(): string } }

export function newId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16)
}
