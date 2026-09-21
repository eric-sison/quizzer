/**
 * Same-origin image proxy for the editor and the preview.
 *
 * The browser can never call apps/api directly - the service credential is
 * server-only - so <img src="/api/media/{id}"> lands here and this route
 * forwards it as the current teacher. The API's ownership check is what
 * decides; this route adds no authorisation of its own.
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
