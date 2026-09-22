/**
 * Same-origin image proxy for the editor and the preview.
 *
 * apps/api sits on another origin, so <img src="/api/media/{id}"> lands here
 * and this route forwards it with the caller's own session cookie (attached
 * inside quizApi). The API's ownership check is what decides; this route adds
 * no authorisation of its own.
 */
import { quizApi } from "@/lib/api-client"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Next 16: params is a Promise.
  const { id } = await params
  const upstream = await quizApi.imageResponse(id)

  if (!upstream.ok) {
    return new Response(null, { status: upstream.status === 404 ? 404 : 502 })
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
      // Media is immutable - a new upload gets a new id.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  })
}
