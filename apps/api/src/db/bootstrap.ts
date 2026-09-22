/**
 * One-time initial-admin bootstrap.
 *
 *   pnpm --filter api auth:bootstrap -- \
 *     --email=admin@msugensan.edu.ph \
 *     --institution="MSU General Santos" \
 *     --domain=msugensan.edu.ph
 *
 * Server-side only: this is a script against the database, not an endpoint -
 * there is deliberately no route that can do what it does. It creates the
 * institution and its first allowed domain, and records the admin as a pending
 * role grant that the named email's first Google sign-in consumes (the user
 * row cannot exist before Google has verified the account).
 *
 * It refuses to run twice: once any admin exists - as a membership or as a
 * still-unconsumed grant - the only way to mint more admins is an existing
 * admin using the member routes. Dev, staging and production each bootstrap
 * their own database independently, because the guard is a database read.
 */
import { parseArgs } from "node:util"

import { sqlClient } from "./index"
import { BootstrapError, bootstrapInitialAdmin } from "../services/bootstrap"

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    institution: { type: "string" },
    domain: { type: "string" },
  },
  // `pnpm auth:bootstrap -- --email=...` forwards the `--` literally, which
  // would otherwise demote everything after it to rejected positionals.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  allowPositionals: false,
})

if (!values.email || !values.institution || !values.domain) {
  console.error(
    "[bootstrap] Usage: pnpm --filter api auth:bootstrap -- --email=<admin email> " +
      '--institution="<name>" --domain=<allowed domain>'
  )
  process.exit(1)
}

try {
  const result = await bootstrapInitialAdmin({
    email: values.email,
    institutionName: values.institution,
    domain: values.domain,
  })
  console.log(
    `[bootstrap] created institution with allowed domain "${result.domain}".\n` +
      `[bootstrap] ${result.email} becomes its administrator on first Google sign-in.`
  )
} catch (error) {
  if (error instanceof BootstrapError) {
    console.error(`[bootstrap] ${error.message}`)
    process.exit(1)
  }
  throw error
} finally {
  await sqlClient.end()
}
