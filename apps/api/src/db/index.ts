import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { env } from "../env"
import * as authSchema from "./auth-schema"
import * as schema from "./schema"

const client = postgres(env.DATABASE_URL, { max: 10 })

export const db = drizzle(client, { schema: { ...schema, ...authSchema } })
export { client as sqlClient }
export * from "./auth-schema"
export * from "./schema"
