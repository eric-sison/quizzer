/**
 * Question images.
 *
 * The bytes live in Garage; Postgres holds one row per image tying its opaque
 * id to the quiz that may serve it. Both surfaces stream through this API -
 * the storage endpoint is never handed to a browser or to the desktop client,
 * so its credentials and its origin stay private to this process.
 *
 * Authorisation is ownership, on both sides: a teacher reads media of quizzes
 * they own, an exam session reads media of the one quiz it is sitting. The id
 * being an unguessable UUID is not the access control; these checks are.
 */
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import {
  isImageContentType,
  MAX_IMAGE_BYTES,
  type QuizMediaItem,
} from "@workspace/quiz-core"
import { and, desc, eq, isNull } from "drizzle-orm"

import { db } from "../db"
import { quizMedia, quizVersions, quizzes } from "../db/schema"
import { ApiError } from "../lib/errors"
import { MEDIA_BUCKET, s3 } from "../lib/s3"

const notFound = () => new ApiError("not_found", 404, "No such image.")

export type MediaObject = {
  contentType: string
  body: Uint8Array
}

/** Store one image for a quiz the teacher owns and mint its id. */
export async function uploadQuizImage(
  teacherId: string,
  quizId: string,
  contentType: string,
  body: Uint8Array
): Promise<{ id: string }> {
  if (!isImageContentType(contentType)) {
    throw new ApiError(
      "unsupported_media_type",
      415,
      "Images must be PNG, JPEG, WebP or GIF."
    )
  }
  if (body.byteLength === 0) {
    throw new ApiError("validation_failed", 400, "The uploaded file is empty.")
  }
  if (body.byteLength > MAX_IMAGE_BYTES) {
    throw new ApiError(
      "payload_too_large",
      413,
      `Images are limited to ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))} MB.`
    )
  }

  const [quiz] = await db
    .select({ id: quizzes.id })
    .from(quizzes)
    .where(
      and(eq(quizzes.id, quizId), eq(quizzes.ownerId, teacherId), isNull(quizzes.archivedAt))
    )
    .limit(1)
  if (!quiz) throw new ApiError("not_found", 404, "No such quiz.")

  // The row first: an orphaned object in the bucket is garbage, an orphaned
  // row is a 404 that claims an image exists. Failing between the two steps
  // leaves the row pointing at nothing, which the GET below reports as a
  // server error rather than serving garbage.
  const [row] = await db
    .insert(quizMedia)
    .values({ quizId, uploadedBy: teacherId, contentType, sizeBytes: body.byteLength })
    .returning({ id: quizMedia.id })
  if (!row) throw new Error("media insert returned no row")

  await s3.send(
    new PutObjectCommand({
      Bucket: MEDIA_BUCKET,
      Key: row.id,
      Body: body,
      ContentType: contentType,
    })
  )

  return { id: row.id }
}

/** The quiz's media library, newest first, for the reuse picker. */
export async function listQuizMedia(
  teacherId: string,
  quizId: string
): Promise<QuizMediaItem[]> {
  const [quiz] = await db
    .select({ id: quizzes.id })
    .from(quizzes)
    .where(
      and(eq(quizzes.id, quizId), eq(quizzes.ownerId, teacherId), isNull(quizzes.archivedAt))
    )
    .limit(1)
  if (!quiz) throw new ApiError("not_found", 404, "No such quiz.")

  const rows = await db
    .select({
      id: quizMedia.id,
      contentType: quizMedia.contentType,
      sizeBytes: quizMedia.sizeBytes,
      createdAt: quizMedia.createdAt,
    })
    .from(quizMedia)
    .where(eq(quizMedia.quizId, quizId))
    .orderBy(desc(quizMedia.createdAt))

  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

/** An image belonging to any quiz this teacher owns. */
export async function readImageForTeacher(
  teacherId: string,
  mediaId: string
): Promise<MediaObject> {
  const [row] = await db
    .select({ id: quizMedia.id, contentType: quizMedia.contentType })
    .from(quizMedia)
    .innerJoin(quizzes, eq(quizMedia.quizId, quizzes.id))
    .where(and(eq(quizMedia.id, mediaId), eq(quizzes.ownerId, teacherId)))
    .limit(1)
  if (!row) throw notFound()

  return { contentType: row.contentType, body: await fetchObject(row.id) }
}

/**
 * An image belonging to the quiz this session is sitting - scoped through the
 * session's pinned version, so one class's exam can never read another's
 * media, whatever id it asks for.
 */
export async function readImageForSession(
  versionId: string,
  mediaId: string
): Promise<MediaObject> {
  const [row] = await db
    .select({ id: quizMedia.id, contentType: quizMedia.contentType })
    .from(quizMedia)
    .innerJoin(quizVersions, eq(quizMedia.quizId, quizVersions.quizId))
    .where(and(eq(quizMedia.id, mediaId), eq(quizVersions.id, versionId)))
    .limit(1)
  if (!row) throw notFound()

  return { contentType: row.contentType, body: await fetchObject(row.id) }
}

async function fetchObject(key: string): Promise<Uint8Array> {
  const result = await s3.send(new GetObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }))
  if (!result.Body) throw new Error(`media object ${key} has no body`)
  return result.Body.transformToByteArray()
}
