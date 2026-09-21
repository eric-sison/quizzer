import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

import { env } from "../env"

// A dedicated single connection: migrations must not share the app pool.
const client = postgres(env.DATABASE_URL, { max: 1 })

try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" })
  console.log("[api] migrations applied")
} finally {
  await client.end()
}
