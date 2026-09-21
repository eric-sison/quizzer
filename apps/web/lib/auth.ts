import "server-only"

/**
 * The authentication seam.
 *
 * Sign-in is mocked: this resolves to the teacher seeded by
 * `pnpm --filter api db:seed`. When real auth lands, this is the only file
 * that changes - it reads the session instead, and every caller keeps working
 * because they only ever see a `Teacher`.
 *
 * It is async on purpose, so gaining a real session lookup is not a signature
 * change that ripples through every call site.
 */
export type Teacher = {
  id: string
  name: string
  email: string
}

/** Matches DEV_TEACHER_ID in apps/api/src/db/seed.ts. */
const DEV_TEACHER: Teacher = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Dev Teacher",
  email: "dev-teacher@example.test",
}

export async function getCurrentTeacher(): Promise<Teacher> {
  return DEV_TEACHER
}
