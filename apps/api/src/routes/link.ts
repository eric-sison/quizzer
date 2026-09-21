/**
 * `GET /e/:token` - what a student sees if they open a quiz link in a browser.
 *
 * Two rules this page exists to keep:
 *
 *  1. It never serves the manifest. Someone who opens the link in a browser
 *     learns the exam's name and nothing else; questions and choices require an
 *     exam session, which only the desktop client can start.
 *  2. It is the one place in the system that builds an HTML string, and the
 *     only untrusted value in it is the quiz title. `hono/html` escapes
 *     interpolations, so a title containing markup renders as text.
 */
import { Hono } from "hono"
import { html, raw } from "hono/html"

import type { AppEnv } from "../lib/hono"
import { linkUrl } from "../services/publish"
import { resolveLink } from "../services/links"

export const linkRoutes = new Hono<AppEnv>()

linkRoutes.get("/e/:token", async (c) => {
  const token = c.req.param("token")
  const link = await resolveLink(token)

  // An exam link in a search index would be a quiet disaster, and a cached copy
  // would keep telling a student an exam is open after it closed.
  c.header("Cache-Control", "no-store")
  c.header("X-Robots-Tag", "noindex, nofollow")
  c.header("Referrer-Policy", "no-referrer")

  if (link.state === "unknown") {
    return c.html(
      page({
        heading: "This link does not work",
        body: "Check that you copied all of it, then ask your teacher for a new one.",
      }),
      404
    )
  }

  if (link.state === "revoked") {
    return c.html(
      page({
        heading: "This exam is closed",
        body: "Your teacher has taken this link out of service.",
        title: link.title,
        description: link.description,
      }),
      410
    )
  }

  return c.html(
    page({
      heading: "Open this in Quizzer Exam",
      body: "Copy the address below, start the Quizzer Exam app, and paste it when it asks for your quiz link. Opening it in a browser will not start the exam.",
      title: link.title,
      description: link.description,
      // Built from configuration, never from the request. Echoing `c.req.url`
      // would print whatever host reached this process, so a forwarded or
      // spoofed Host header would show the student an address to trust that we
      // never minted.
      link: linkUrl(token),
    })
  )
})

/**
 * Self-contained by necessity: this is served by apps/api, which has no
 * stylesheet pipeline, and it may well be opened on a machine that has not
 * loaded anything else from this origin.
 */
function page({
  heading,
  body,
  title,
  description,
  link,
}: {
  heading: string
  body: string
  title?: string
  /** Teacher-authored, like the title: interpolated through html\`\`, escaped. */
  description?: string
  link?: string
}) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>${heading} | Quizzer</title>
        <style>
          ${raw(STYLES)}
        </style>
      </head>
      <body>
        <main>
          <p class="brand">Quizzer</p>
          <h1>${heading}</h1>
          ${title ? html`<p class="quiz">${title}</p>` : ""}
          ${description ? html`<p class="desc">${description}</p>` : ""}
          <p class="body">${body}</p>
          ${link ? html`<p class="link"><code>${link}</code></p>` : ""}
          <p class="foot">
            No answers are shown on this page, and opening it does not use up an
            attempt.
          </p>
        </main>
      </body>
    </html>`
}

/** `raw` is safe here and only here: this string is a constant in this file. */
const STYLES = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background: #fbfbfc;
    color: #111a1c;
    font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main {
    width: 100%;
    max-width: 30rem;
    background: #fff;
    border: 1px solid #e6e9ea;
    border-radius: 14px;
    padding: 32px;
  }
  .brand {
    margin: 0 0 20px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: #5d7276;
  }
  h1 { margin: 0 0 8px; font-size: 20px; line-height: 1.3; }
  .quiz { margin: 0 0 16px; font-weight: 600; }
  .desc { margin: -8px 0 16px; white-space: pre-line; }
  .body { margin: 0 0 20px; color: #3d4f52; }
  .link { margin: 0 0 20px; }
  code {
    display: block;
    padding: 10px 12px;
    border-radius: 10px;
    background: #f1f4f4;
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    word-break: break-all;
    user-select: all;
  }
  .foot { margin: 0; font-size: 13px; color: #5d7276; }
  @media (prefers-color-scheme: dark) {
    body { background: #0d1416; color: #eef2f2; }
    main { background: #16211f; border-color: #253133; }
    .body { color: #b9c7c9; }
    code { background: #0d1416; }
  }
`
