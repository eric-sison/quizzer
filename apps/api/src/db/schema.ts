/**
 * The database is owned exclusively by apps/api. apps/web holds no connection
 * and never imports this file - it imports domain types from
 * @workspace/quiz-core and reaches data over HTTP.
 */
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"

import type { ExamManifest, QuizAnswerKey, QuizDoc } from "@workspace/quiz-core"

import { user } from "./auth-schema"

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow()

export const quizStatus = pgEnum("quiz_status", ["draft", "published", "archived"])

export const memberRole = pgEnum("member_role", ["admin", "teacher", "student"])
export const memberStatus = pgEnum("member_status", ["active", "suspended"])

/**
 * v1 seeds exactly one institution. The tables are shaped for several from the
 * start - the globally unique domain below is what routes a signing-in email
 * to its institution - so growing past one is additive, not a rewrite.
 */
export const institutions = pgTable("institutions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /**
   * When true, a first sign-in from an allowed domain becomes an active
   * student membership with no admin involved. Teacher and admin are never
   * granted this way.
   */
  autoProvisionStudents: boolean("auto_provision_students").notNull().default(true),
  createdAt,
})

/**
 * The sign-in allowlist. An email may authenticate iff its domain (the part
 * after the last "@", lowercased, compared whole) has a row here. Checked
 * inside Better Auth's pipeline on every sign-in, never in a client.
 */
export const institutionDomains = pgTable("institution_domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id")
    .notNull()
    .references(() => institutions.id, { onDelete: "cascade" }),
  /** Lowercased. Globally unique so one email maps to exactly one institution. */
  domain: text("domain").notNull().unique(),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt,
})

/**
 * Where roles live - deliberately not a column Better Auth manages, so no
 * Better Auth endpoint can ever write one. Only the admin routes touch this
 * table.
 */
export const institutionMembers = pgTable(
  "institution_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    institutionId: uuid("institution_id")
      .notNull()
      .references(() => institutions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull(),
    status: memberStatus("status").notNull().default("active"),
    /** Null when auto-provisioned (students, and the bootstrap admin). */
    grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("institution_members_user_idx").on(t.institutionId, t.userId)]
)

/**
 * A role promised to an email that has not signed in yet. Written by the
 * bootstrap script (the initial admin) and consumed exactly once, when that
 * email's first Google sign-in creates its user row.
 */
export const pendingRoleGrants = pgTable("pending_role_grants", {
  /** Lowercased full email address. */
  email: text("email").primaryKey(),
  institutionId: uuid("institution_id")
    .notNull()
    .references(() => institutions.id, { onDelete: "cascade" }),
  role: memberRole("role").notNull(),
  createdAt,
})

export const teachers = pgTable("teachers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  /**
   * The signed-in identity this authoring profile belongs to. Null only for
   * rows that predate real auth (the dev seed); a profile is otherwise created
   * in the same transaction as its teacher/admin membership.
   */
  userId: text("user_id").unique().references(() => user.id, { onDelete: "set null" }),
  createdAt,
})

export const quizzes = pgTable(
  "quizzes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => teachers.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    status: quizStatus("status").notNull().default("draft"),

    /** The authoring document. HOLDS CORRECT ANSWERS - never served as-is. */
    draftDoc: jsonb("draft_doc").$type<QuizDoc>().notNull(),

    /**
     * Which immutable version the link currently resolves to. Nullable, and
     * the reference is lazy, because quizzes and quiz_versions point at each
     * other: a quiz is inserted first with null, then updated on publish.
     */
    activeVersionId: uuid("active_version_id").references(
      (): AnyPgColumn => quizVersions.id,
      { onDelete: "set null" }
    ),

    /** Bumped on every draft write. A stale value is a 409, never a clobber. */
    docVersion: integer("doc_version").notNull().default(0),

    /**
     * The `docVersion` that was current when the active version was published.
     * `docVersion > publishedDocVersion` is what "has unpublished changes"
     * means - cheaper and less ambiguous than diffing two documents.
     */
    publishedDocVersion: integer("published_doc_version"),

    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Soft delete: published versions and receipts must outlive the quiz. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("quizzes_owner_updated_idx").on(t.ownerId, t.updatedAt)]
)

/**
 * Append-only. A published version is never updated or deleted, which is what
 * makes an exam already in progress safe from a teacher's later edits.
 */
export const quizVersions = pgTable(
  "quiz_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),

    /** Exactly what the exam client receives. Carries no answer key. */
    manifest: jsonb("manifest").$type<ExamManifest>().notNull(),
    /** Server-only. No endpoint the exam client can reach returns this. */
    answerKey: jsonb("answer_key").$type<QuizAnswerKey>().notNull(),

    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedBy: uuid("published_by").references(() => teachers.id, {
      onDelete: "set null",
    }),
  },
  (t) => [uniqueIndex("quiz_versions_quiz_no_idx").on(t.quizId, t.versionNo)]
)

/**
 * One row per quiz: republishing reuses the token so links already handed to
 * students keep working and simply resolve to the new active version.
 */
export const examLinks = pgTable(
  "exam_links",
  {
    token: varchar("token", { length: 128 }).primaryKey(),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    opensAt: timestamp("opens_at", { withTimezone: true }),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [uniqueIndex("exam_links_quiz_idx").on(t.quizId)]
)

export const examSessions = pgTable(
  "exam_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: varchar("token", { length: 128 })
      .notNull()
      .references(() => examLinks.token, { onDelete: "cascade" }),

    /**
     * Pinned at session start and never updated. This single column is what
     * guarantees a student who began on v1 finishes on v1.
     */
    versionId: uuid("version_id")
      .notNull()
      .references(() => quizVersions.id, { onDelete: "restrict" }),

    /**
     * The student's verified email, snapshotted at claim time from their
     * signed-in session - never from anything the client asserts. Denormalized
     * on purpose: it survives account deletion and reads meaningfully in
     * results without a join.
     */
    studentRef: text("student_ref"),
    /** The signed-in identity that claimed this session. */
    studentUserId: text("student_user_id").references(() => user.id, {
      onDelete: "set null",
    }),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    /** The server's deadline. The client mirrors it but is never trusted. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    receiptId: text("receipt_id"),
    /** Stable across retries so a double submit replays one receipt. */
    idempotencyKey: text("idempotency_key"),

    clientVersion: text("client_version"),
    platform: text("platform"),
    strikes: integer("strikes").notNull().default(0),
  },
  (t) => [
    index("exam_sessions_token_idx").on(t.token),
    index("exam_sessions_version_idx").on(t.versionId),
  ]
)

export const examAnswers = pgTable(
  "exam_answers",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => examSessions.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    value: jsonb("value").notNull(),
    /** Monotonic per session; lets a retry arriving late be discarded. */
    clientSeq: bigint("client_seq", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.questionId] })]
)

export const proctorEvents = pgTable(
  "proctor_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => examSessions.id, { onDelete: "cascade" }),
    /** Per-session sequence. A gap means the client dropped events. */
    seq: bigint("seq", { mode: "number" }).notNull(),
    kind: text("kind").notNull(),
    /** Client epoch seconds. Advisory only - the client clock is not trusted. */
    atClient: bigint("at_client", { mode: "number" }).notNull(),
    /** When we received it. This is the timestamp that counts. */
    atServer: timestamp("at_server", { withTimezone: true }).notNull().defaultNow(),
    detail: text("detail"),
  },
  (t) => [uniqueIndex("proctor_events_session_seq_idx").on(t.sessionId, t.seq)]
)

/**
 * One row per uploaded question image. The bytes live in Garage under the
 * row's id; this table is what ties an opaque media id to the quiz that may
 * serve it, on both the teacher surface and the exam surface.
 */
export const quizMedia = pgTable("quiz_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  quizId: uuid("quiz_id")
    .notNull()
    .references(() => quizzes.id, { onDelete: "cascade" }),
  uploadedBy: uuid("uploaded_by")
    .notNull()
    .references(() => teachers.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt,
})

export type TeacherRow = typeof teachers.$inferSelect
export type QuizRow = typeof quizzes.$inferSelect
export type QuizVersionRow = typeof quizVersions.$inferSelect
export type ExamLinkRow = typeof examLinks.$inferSelect
export type ExamSessionRow = typeof examSessions.$inferSelect
export type InstitutionRow = typeof institutions.$inferSelect
export type InstitutionDomainRow = typeof institutionDomains.$inferSelect
export type InstitutionMemberRow = typeof institutionMembers.$inferSelect
export type MemberRole = InstitutionMemberRow["role"]
