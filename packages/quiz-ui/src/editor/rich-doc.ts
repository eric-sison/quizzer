import { richDocSchema, type RichDoc } from "@workspace/quiz-core"

/**
 * Coerce whatever the editor handed us into a valid `RichDoc`.
 *
 * The editor is configured to emit only allowed nodes, so this should always
 * succeed - but the schema is the contract, and a document that fails it must
 * never reach the server, where it would be rejected at publish time with a far
 * less useful message.
 */
export function asRichDoc(value: unknown): RichDoc | null {
  const parsed = richDocSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
