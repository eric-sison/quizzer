/**
 * The one S3 client in the service, pointed at Garage.
 *
 * `forcePathStyle` because Garage (like MinIO) serves buckets as paths, not
 * subdomains, on a local endpoint.
 */
import { S3Client } from "@aws-sdk/client-s3"

import { env } from "../env"

export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
})

export const MEDIA_BUCKET = env.S3_BUCKET
