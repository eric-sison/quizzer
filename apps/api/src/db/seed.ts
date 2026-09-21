/**
 * Development seed.
 *
 * Creates the single teacher that `getCurrentTeacher()` resolves to while
 * sign-in is mocked. The id is fixed so apps/web can send it in `X-Teacher-Id`
 * without a lookup, and so re-seeding is idempotent.
 */
import { db, sqlClient, teachers } from "./index"

export const DEV_TEACHER_ID = "00000000-0000-4000-8000-000000000001"

try {
  await db
    .insert(teachers)
    .values({
      id: DEV_TEACHER_ID,
      name: "Dev Teacher",
      email: "dev-teacher@example.test",
    })
    .onConflictDoNothing({ target: teachers.id })

  console.log(`[api] seeded dev teacher ${DEV_TEACHER_ID}`)
} finally {
  await sqlClient.end()
}
