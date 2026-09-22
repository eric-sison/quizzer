/**
 * Request and response shapes for `apps/api`.
 *
 * Both sides import these: Hono validates incoming bodies with them, and
 * `apps/web`'s api-client types its calls off them, so a route and its caller
 * cannot drift.
 */
import { z } from "zod"

import { answerValueSchema, examManifestSchema } from "./manifest"
import { quizDocSchema } from "./question"

/**
 * Error codes. The exam-surface entries must match `AppError::from_server_code`
 * in apps/desktop/src-tauri/src/error.rs - note it expects `invalid_token`, and
 * collapses anything it does not recognise to `server_error`, which leaves the
 * student with a useless message.
 */
export const API_ERROR_CODES = [
  // exam surface (desktop)
  "invalid_token",
  "expired",
  "already_submitted",
  "not_yet_open",
  "revoked",
  "session_conflict",
  /** The claim needs a signed-in student and none was presented. */
  "auth_required",
  /** Signed in, but the account may not sit exams (suspended, delisted domain). */
  "student_not_allowed",
  // teacher surface (web)
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "validation_failed",
  // media uploads
  "unsupported_media_type",
  "payload_too_large",
  // shared
  "server_error",
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export const apiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(API_ERROR_CODES),
    message: z.string().optional(),
    /** Present on `validation_failed`, so the editor can link each issue. */
    issues: z
      .array(
        z.strictObject({
          questionId: z.string().nullable(),
          field: z.string(),
          severity: z.enum(["error", "warning"]),
          code: z.string(),
          message: z.string(),
        })
      )
      .optional(),
  }),
})

export const quizStatusSchema = z.enum(["draft", "published", "archived"])
export type QuizStatus = z.infer<typeof quizStatusSchema>

/** Row shape for the quiz list. Deliberately excludes the draft document. */
export const quizSummarySchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  status: quizStatusSchema,
  questionCount: z.number().int().min(0),
  durationS: z.number().int().min(0),
  updatedAt: z.string(),
  publishedAt: z.string().nullable(),
  versionNo: z.number().int().nullable(),
  hasUnpublishedChanges: z.boolean(),
  token: z.string().nullable(),
  url: z.string().nullable(),
})

export const quizDetailSchema = z.strictObject({
  id: z.string(),
  status: quizStatusSchema,
  doc: quizDocSchema,
  docVersion: z.number().int().min(0),
  hasUnpublishedChanges: z.boolean(),
  token: z.string().nullable(),
  url: z.string().nullable(),
})

export const createQuizRequestSchema = z.strictObject({
  title: z.string().max(200).optional(),
})

export const saveDraftRequestSchema = z.strictObject({
  doc: quizDocSchema,
  /** The version this edit was based on. A mismatch is a 409, never a clobber. */
  docVersion: z.number().int().min(0),
})

export const saveDraftResponseSchema = z.strictObject({
  docVersion: z.number().int().min(0),
  updatedAt: z.string(),
})

export const publishResponseSchema = z.strictObject({
  versionNo: z.number().int().min(1),
  token: z.string(),
  url: z.string(),
  publishedAt: z.string(),
})

export type ApiError = z.infer<typeof apiErrorSchema>
export type QuizSummary = z.infer<typeof quizSummarySchema>
export type QuizDetail = z.infer<typeof quizDetailSchema>
export type CreateQuizRequest = z.infer<typeof createQuizRequestSchema>
export type SaveDraftRequest = z.infer<typeof saveDraftRequestSchema>
export type SaveDraftResponse = z.infer<typeof saveDraftResponseSchema>
export type PublishResponse = z.infer<typeof publishResponseSchema>

/**
 * The admin surface: institution configuration, the domain allowlist, and
 * membership/role management. Roles are only ever written through these
 * endpoints (behind requireAdmin) - no other request body anywhere carries
 * a role.
 */
export const memberRoleSchema = z.enum(["admin", "teacher", "student"])
export const memberStatusSchema = z.enum(["active", "suspended"])

export const institutionSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  autoProvisionStudents: z.boolean(),
})

export const allowedDomainSchema = z.strictObject({
  id: z.string(),
  domain: z.string(),
  createdAt: z.string(),
})

export const institutionConfigSchema = z.strictObject({
  institution: institutionSchema,
  domains: z.array(allowedDomainSchema),
})

export const updateInstitutionRequestSchema = z.strictObject({
  name: z.string().min(1).max(200).optional(),
  autoProvisionStudents: z.boolean().optional(),
})

/**
 * A bare domain: no scheme, no "@", no port, at least one dot. Lowercased by
 * the server before storage; matched whole against the part of a signing-in
 * email after its last "@".
 */
export const addDomainRequestSchema = z.strictObject({
  domain: z
    .string()
    .min(3)
    .max(253)
    .regex(
      /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i,
      "Not a valid domain name."
    ),
})

export const memberSchema = z.strictObject({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: memberRoleSchema,
  status: memberStatusSchema,
  createdAt: z.string(),
})

export const memberListSchema = z.strictObject({
  members: z.array(memberSchema),
})

export const setMemberRoleRequestSchema = z.strictObject({
  role: memberRoleSchema,
})

export const setMemberStatusRequestSchema = z.strictObject({
  status: memberStatusSchema,
})

export type MemberRole = z.infer<typeof memberRoleSchema>
export type MemberStatus = z.infer<typeof memberStatusSchema>
export type Institution = z.infer<typeof institutionSchema>
export type AllowedDomain = z.infer<typeof allowedDomainSchema>
export type InstitutionConfig = z.infer<typeof institutionConfigSchema>
export type Member = z.infer<typeof memberSchema>

/**
 * The exam surface.
 *
 * These shapes mirror the Rust structs in apps/desktop/src-tauri/src/api/mod.rs
 * by hand, on purpose: Rust is the security boundary and should not import a
 * schema it does not control. That makes drift the risk, so the names and
 * casing here are not free choices.
 *
 * Two conventions worth stating because breaking either is silent:
 *
 *  - snake_case throughout. serde deserialises these field names literally.
 *  - times are **epoch seconds**, not ISO strings. The client does arithmetic
 *    on them to drive a countdown and to measure clock skew.
 */
const epochSeconds = z.number().int().min(0)

export const startSessionRequestSchema = z.strictObject({
  token: z.string().min(16).max(128),
  client_version: z.string().max(64),
  platform: z.string().max(32),
})

/**
 * Pre-flight look at an exam's configuration, shown on the link-entry screen
 * before the student commits to lockdown. Token-authorised like a session
 * claim, but claims nothing: no session row, no credential, no questions.
 *
 * This is the one place a link that is not open yet still answers. A session
 * claim refuses it, and must: the preview exists so a student who has just
 * been handed a link can read what they are about to sit and when it starts,
 * which is a strictly better answer than the door being shut with no notice
 * on it. Nothing here is more than the configuration a published link already
 * gives out the moment it opens.
 */
export const previewExamRequestSchema = z.strictObject({
  token: z.string().min(16).max(128),
})

export const previewExamResponseSchema = z.strictObject({
  title: z.string(),
  description: z.string().optional(),
  duration_s: z.number().int().min(1),
  allow_backtracking: z.boolean(),
  shuffle_questions: z.boolean(),
  question_count: z.number().int().min(0),
  /**
   * Present only while the link is still shut. Absent means it is open now,
   * so the client never has to compare this against its own clock to find out
   * whether it may start.
   */
  opens_at: epochSeconds.optional(),
  /**
   * The server's clock at the moment of the answer, so a countdown to
   * `opens_at` is drawn against the clock that decides, not the student's.
   * The gate is enforced server-side either way; this is so the waiting
   * screen does not lie on a machine whose clock is wrong.
   */
  server_time: epochSeconds,
})

export const startSessionResponseSchema = z.strictObject({
  session_jwt: z.string(),
  exam: examManifestSchema,
  /** The server's own clock, so the client can derive skew and not trust its own. */
  server_time: epochSeconds,
  expires_at: epochSeconds,
})

export const saveAnswerRequestSchema = z.strictObject({
  question_id: z.string().min(1).max(200),
  value: answerValueSchema,
  /** Monotonic per session. Lets a retry that arrives late be discarded. */
  client_seq: z.number().int().min(0),
})

export const heartbeatRequestSchema = z.strictObject({
  elapsed_s: z.number().int().min(0),
})

export const heartbeatResponseSchema = z.strictObject({
  expires_at: epochSeconds,
  server_time: epochSeconds,
  /** The teacher closed the link while this exam was running. */
  revoked: z.boolean(),
})

export const proctorEventSchema = z.strictObject({
  seq: z.number().int().min(0),
  kind: z.string().min(1).max(64),
  /** Client epoch seconds. Advisory: the server records its own receipt time. */
  at: epochSeconds,
  detail: z.string().max(2_000).optional(),
})

export const eventBatchRequestSchema = z.strictObject({
  events: z.array(proctorEventSchema).max(200),
})

export const submitRequestSchema = z.strictObject({
  /** Stable across retries, so a double submit replays one receipt. */
  idempotency_key: z.string().min(8).max(200),
})

export const receiptSchema = z.strictObject({
  receipt_id: z.string(),
  submitted_at: epochSeconds,
  question_count: z.number().int().min(0),
})

export type StartSessionRequest = z.infer<typeof startSessionRequestSchema>
export type StartSessionResponse = z.infer<typeof startSessionResponseSchema>
export type PreviewExamRequest = z.infer<typeof previewExamRequestSchema>
export type PreviewExamResponse = z.infer<typeof previewExamResponseSchema>
export type SaveAnswerRequest = z.infer<typeof saveAnswerRequestSchema>
export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>
export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>
export type ProctorEventPayload = z.infer<typeof proctorEventSchema>
export type EventBatchRequest = z.infer<typeof eventBatchRequestSchema>
export type SubmitRequest = z.infer<typeof submitRequestSchema>
export type Receipt = z.infer<typeof receiptSchema>
