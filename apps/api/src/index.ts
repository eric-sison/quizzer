import { serve } from "@hono/node-server"

import { createApp } from "./app"
import { env, warnIfPortWillBreakDesktopLinks } from "./env"

warnIfPortWillBreakDesktopLinks()

serve({ fetch: createApp().fetch, port: env.PORT }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`)
  console.log(`[api] quiz links will be minted at ${env.PUBLIC_API_ORIGIN}/e/<token>`)
})
