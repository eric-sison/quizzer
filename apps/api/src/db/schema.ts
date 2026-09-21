/**
 * The database is owned exclusively by apps/api. apps/web holds no connection
 * and never imports this file - it imports domain types from
 * @workspace/quiz-core and reaches data over HTTP.
 */
import {
  bigint,
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

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow()

export const quizStatus = pgEnum("quiz_status", ["draft", "published", "archived"])

export const teachers = pgTable("teachers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
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

    /** Null until students identify themselves - see the note in seed.ts. */
    studentRef: text("student_ref"),

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
