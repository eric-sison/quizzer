/**
 * Question media: one image per question, referenced by an opaque id.
 *
 * One definition of the limits, shared by apps/web (to refuse a file before
 * uploading it) and apps/api (the authoritative gate). The id is minted by the
 * API; documents and manifests never carry URLs.
 */
import { z } from "zod"

export const IMAGE_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const

export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number]

export function isImageContentType(value: string): value is ImageContentType {
  return (IMAGE_CONTENT_TYPES as readonly string[]).includes(value)
}

/**
 * Generous for a question illustration, small enough that the desktop can
 * inline every image of an exam as data URIs without troubling the webview.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export const uploadMediaResponseSchema = z.strictObject({
  id: z.uuid(),
})

export type UploadMediaResponse = z.infer<typeof uploadMediaResponseSchema>
