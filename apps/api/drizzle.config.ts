import { defineConfig } from "drizzle-kit"

// `generate` only reads the schema, so an absent DATABASE_URL must not throw
// here - it is `migrate` and `studio` that actually need a database.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
})
