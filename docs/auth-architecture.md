# Authentication & Authorization — architecture plan

> **Status: implemented** (Phases 1–3; the SERVICE_TOKEN test bridge from
> Phase 4 remains, non-production only). This document is the design the code
> follows. It uses the same conventions as
> [quiz-maker-engine-architecture.md](./quiz-maker-engine-architecture.md) and
> assumes you have read its "Two constraints that shape everything" section.

Quizzer gains three kinds of authenticated people, all signing in with Google
and nothing else:

```
Admin ───────┐
Teacher ─────┼── apps/web (browser) ── Google OAuth ──► Better Auth on apps/api
Student ─────── apps/desktop (Tauri) ── device flow ──► same Better Auth instance
```

Authentication answers *who is this*. Authorization answers *what may they do*.
Institution/domain restriction answers *does this Google account belong here at
all*. The three are deliberately separate mechanisms in this design, and a
user's email domain never determines their role.

---

## Decisions at a glance

| Question | Decision |
|---|---|
| Auth library / provider | Better Auth, Google OAuth as the **only** sign-in method |
| Where Better Auth runs | `apps/api` (Hono), mounted at `/api/auth/*` |
| How browsers reach it | Through a Next.js rewrite on `apps/web` — the API stays browser-invisible |
| Where roles live | A hand-written `institution_members` table, **not** Better Auth's admin plugin |
| Domain allowlist | `institution_domains` table, enforced inside Better Auth hooks, server-side |
| Desktop OAuth flow | OAuth 2.0 **Device Authorization Grant** (RFC 8628) |
| Student credential at exam claim | Better Auth session token as `Authorization: Bearer`, spent on `POST /api/exam/session` |
| Provisioning | Hybrid: students auto-provision from allowed domains; teacher/admin are admin-granted |
| Existing `teachers` table | Kept, as the authoring-profile table, linked to `user` by a new `user_id` column |
| Existing exam JWT surface | Untouched — remains a separate credential class |

---

## Inherited constraints this design honors

1. **`apps/api` owns all data.** Better Auth therefore runs *in* the API, on
   the API's Drizzle connection. `apps/web` still never opens a database
   connection.
2. **No browser ever calls `apps/api`.** The API has no CORS and no cookies
   today, on purpose ([app.ts](../apps/api/src/app.ts)). This design keeps
   that true: browser-facing auth traffic is proxied through the web origin.
3. **Credential classes never overlap.** [env.ts](../apps/api/src/env.ts)
   already refuses to boot when `SERVICE_TOKEN === EXAM_JWT_SECRET`, because an
   exam token must never authorize a teacher endpoint. Auth adds a third
   credential class and extends that boot check pairwise.
4. **The desktop webview has no network and persists nothing.** All desktop
   auth traffic goes through the existing Rust `reqwest` client against the
   compile-time [`API_ORIGIN`](../apps/desktop/src-tauri/src/session.rs), and
   no credential ever crosses the IPC boundary or touches disk.
5. **The auth seams are already marked.**
   [apps/web/lib/auth.ts](../apps/web/lib/auth.ts) ("when real auth lands,
   this is the only file that changes") and
   [apps/api/src/middleware/auth.ts](../apps/api/src/middleware/auth.ts)
   ("this middleware reads the user's JWT instead") are the promised insertion
   points, and this design changes exactly those — plus new files.

---

## 1. Topology: Better Auth on Hono, behind a Next.js rewrite

The Better Auth instance lives in a new `apps/api/src/lib/auth.ts` (beside
[exam-token.ts](../apps/api/src/lib/exam-token.ts)), constructed with the
Drizzle adapter over the API's existing `db`. It mounts in
[app.ts](../apps/api/src/app.ts) before the routed groups:

```ts
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
```

Browsers never see the API origin. `apps/web/next.config.ts` gains a rewrite:

```ts
async rewrites() {
  return [{ source: "/api/auth/:path*", destination: `${env.API_ORIGIN}/api/auth/:path*` }]
}
```

Better Auth's `baseURL` is `${PUBLIC_WEB_ORIGIN}/api/auth`, so Google's
registered redirect URI sits on the **web** origin
(`${PUBLIC_WEB_ORIGIN}/api/auth/callback/google`) and the callback flows
through the rewrite to Hono. Next rewrites pass `Set-Cookie` through
untouched, and Better Auth sets no `Domain` attribute — the session cookie is
scoped to the web origin only.

What this buys:

- The API keeps **zero CORS and zero browser-facing cookies** on its own
  origin. The "no browser calls apps/api" invariant survives real auth.
- `apps/web` still holds no DB connection.
- The desktop's Rust client calls `${API_ORIGIN}/api/auth/*` directly. Rust is
  not a browser: no CORS, no cookie jar — the device-flow endpoints are plain
  token endpoints.
- No production constraint that web and API share a parent domain (no
  `crossSubDomainCookies`, no widened cookie scope).

**Rejected alternatives.**

- *Browser talks to Hono directly.* Requires CORS on the API (a surface
  [app.ts](../apps/api/src/app.ts) explicitly refuses) or cross-subdomain
  cookies in production, which scope the session cookie to every subdomain
  forever. Dev only works by the localhost port quirk.
- *Better Auth inside Next with its own DB connection.* Two writers to the
  auth tables, two migration owners, and a flat violation of the schema
  header: "The database is owned exclusively by apps/api."

**How web forwards identity to the API.** The session cookie itself becomes
the credential. The single `request()` chokepoint in
[api-client.ts](../apps/web/lib/api-client.ts) forwards the incoming request's
cookies (`await cookies()` — async in Next 16) in place of today's
`Authorization: Bearer SERVICE_TOKEN` + `X-Teacher-Id`. On the API side,
`requireTeacher` resolves either a forwarded cookie **or** a bearer session
token through the same `auth.api.getSession({ headers })` call (the `bearer`
plugin handles the latter — that is what the desktop presents).

---

## 2. Data model

### 2a. Better Auth core tables

Generated with `npx @better-auth/cli generate` into a new
`apps/api/src/db/auth-schema.ts` — kept separate from the hand-written
[schema.ts](../apps/api/src/db/schema.ts) so provenance is obvious, and
re-exported from `db/index.ts`. Text primary keys are Better Auth's default;
do not fight it.

| Table | Purpose |
|---|---|
| `user` | id, name, email (unique), `email_verified`, image, timestamps |
| `session` | DB-backed sessions: hashed token, `expires_at`, ip, user agent |
| `account` | the Google link: `provider_id`, `account_id` (Google `sub`), tokens |
| `verification` | where Better Auth persists **OAuth state** server-side |
| `device_code` | added by the device-authorization plugin (student flow, §5) |

### 2b. Institution model (hand-written, in `schema.ts`)

```
pgEnum member_role   : admin | teacher | student
pgEnum member_status : active | suspended

institutions
  id            uuid PK defaultRandom
  name          text NOT NULL
  slug          text NOT NULL UNIQUE
  auto_provision_students boolean NOT NULL DEFAULT true
  created_at

institution_domains
  id             uuid PK defaultRandom
  institution_id uuid NOT NULL → institutions.id (cascade)
  domain         text NOT NULL UNIQUE      -- stored lowercased; globally unique
  created_by     text → user.id (set null) -- so an email maps to exactly one institution
  created_at

institution_members
  id             uuid PK defaultRandom
  institution_id uuid NOT NULL → institutions.id (cascade)
  user_id        text NOT NULL → user.id (cascade)
  role           member_role NOT NULL
  status         member_status NOT NULL DEFAULT 'active'
  granted_by     text → user.id (set null) -- null when auto-provisioned
  created_at, updated_at
  UNIQUE (institution_id, user_id)          -- one role per user per institution
```

v1 seeds exactly one institution (e.g. *MSU General Santos* →
`msugensan.edu.ph`). Multi-institution later is purely additive: the global
uniqueness of `institution_domains.domain` already makes the email's domain
the routing key from sign-in to institution, and every membership row is
already institution-scoped. Nothing needs a rewrite.

**Why roles live here and not in Better Auth's admin plugin.** The admin
plugin stores a global `role` column on `user` and exposes Better
Auth-managed endpoints that can mutate it — the wrong shape for
per-institution roles, and one more surface where a role could be flipped. A
plain membership table has **no Better Auth endpoint that can touch it**; only
our own admin routes write to it. The organization plugin is skipped for the
same reason: its invitation/active-organization machinery is surface we do not
need, and domain allowlisting is not native to it.

### 2c. Bridging the existing tables

- **`teachers` stays.** Three FKs depend on it (`quizzes.owner_id`,
  `quiz_versions.published_by`, `quiz_media.uploaded_by`) and migrating them
  buys nothing. It becomes the *authoring-profile* table: add a nullable
  `user_id text UNIQUE → user.id (set null)`. A `teachers` row is created in
  the same transaction that grants a user the teacher role, copying
  name/email from the `user` row. Ownership scoping in
  [services/quizzes.ts](../apps/api/src/services/quizzes.ts) is untouched.
- **`exam_sessions`** gains `student_user_id text → user.id (set null)`, and
  the long-reserved `student_ref` column finally gets written: the student's
  **verified email** — a denormalized snapshot that survives account deletion
  and reads meaningfully in results without a join.

---

## 3. Better Auth configuration

`apps/api/src/lib/auth.ts` (new), hooks in `apps/api/src/lib/auth-hooks.ts`
(new):

```ts
export const auth = betterAuth({
  baseURL: `${env.PUBLIC_WEB_ORIGIN}/api/auth`,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),

  emailAndPassword: { enabled: false },              // Google is the only door
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      prompt: "select_account",
    },
  },
  account: { accountLinking: { enabled: false } },

  trustedOrigins: [env.PUBLIC_WEB_ORIGIN],
  session: {
    expiresIn: 60 * 60 * 24 * 7,                     // 7 days
    updateAge: 60 * 60 * 24,                         // rolling refresh
    cookieCache: { enabled: false },                 // revocation must bite immediately
  },

  databaseHooks: {
    user: {
      create: {
        before: assertAllowedDomainAndVerified,      // gate NEW users
        after: provisionOnFirstSignIn,               // student auto-role / admin bootstrap
      },
    },
    session: {
      create: { before: assertStillAllowed },        // gate EVERY sign-in
    },
  },

  plugins: [
    bearer(),                                        // desktop presents the token as Bearer
    deviceAuthorization({                            // student flow, §5
      expiresIn: "10m",
      interval: "5s",
      validateClient: (clientId) => clientId === "quizzer-desktop",
      verificationUri: `${env.PUBLIC_WEB_ORIGIN}/device`,
    }),
    customSession(async ({ user, session }) => {
      const m = await activeMembership(user.id)      // server-computed, never client-supplied
      return {
        user: { ...user, role: m?.role ?? null, institutionId: m?.institutionId ?? null },
        session,
      }
    }),
  ],
})
```

The three hooks are the entire domain-restriction story, and they run
**inside** Better Auth's pipeline — there is no code path to a session that
skips them:

- **`validateUserInfo`** (Better Auth's provisioning seam; it runs on OAuth
  sign-up, sign-in *and* account-link, with Google's raw profile in hand) —
  reject unless Google reported `email_verified: true`; lowercase the email's
  domain and require a matching `institution_domains` row. Google's `hd`
  claim is **never** the check — it is absent for personal accounts and
  spoof-prone in misconfigured verifiers. The verified email string is the
  single source of truth.
- **`assertStillAllowed`** (`session.create.before`) — re-run the domain check
  against the user's stored email and require an `active` membership. A
  returning user whose domain was delisted, or whose membership was
  suspended, cannot mint a new session even though their `user` row exists.
- **`provisionOnFirstSignIn`** (`user.create.after`) — map domain →
  institution; if a **pending role grant** for this email exists (written by
  the bootstrap script, below), consume it: create the membership with the
  granted role plus the authoring profile, and delete the grant. Otherwise,
  if `auto_provision_students`, insert a `student` membership. There is no
  other automatic path to any role above student.

> ### Why the client can never bypass the domain check
> The desktop and web clients never validate domains at all — they have
> nothing to bypass. The only way to obtain a session is Google's hosted
> consent screen followed by Better Auth's callback handler, and the hooks
> above run inside that handler on the server. A client that lies about its
> email has no effect: the email comes from Google's verified profile, not
> from any request the client composes.

---

## 4. Web flows: Teacher and Admin

```
Teacher/Admin
  → opens apps/web, hits a protected route without a session cookie
  → proxy.ts redirects to /login
  → "Continue with Google" → authClient.signIn.social()      (same-origin /api/auth)
  → Google OAuth (state + PKCE handled by Better Auth)
  → callback → hooks: email_verified? domain allowed? membership active?
  → session cookie set on the web origin → redirect to /quizzes
  → server components read the session through the DAL
  → role decides what renders and — separately — what the API permits
```

File by file:

1. **`apps/web/app/login/page.tsx`** (new) — the "Continue with Google"
   button, via a new `apps/web/lib/auth-client.ts`
   (`createAuthClient({ baseURL: "/api/auth" })` — same-origin through the
   rewrite, so CORS never enters the picture). A rejected domain lands back on
   `/login?error=domain_not_allowed` with a human explanation.
2. **`apps/web/lib/auth.ts`** — the promised seam, rewritten as a Next 16
   data-access layer:
   - `getSession()` — wrapped in React `cache()`; a server-to-server fetch of
     `${env.API_ORIGIN}/api/auth/get-session` forwarding the incoming cookie
     header. Returns the `customSession` payload (user + role +
     institutionId + teacher profile id).
   - `getCurrentTeacher(): Promise<Teacher>` — **keeps its exact signature.**
     Requires role ∈ {teacher, admin}, returns the teachers-profile identity.
     Every existing caller keeps working, as the file's comment promised.
   - `requireAdmin()` — for admin pages and actions.
3. **`apps/web/proxy.ts`** (new — Next 16 renamed `middleware.ts` to
   `proxy.ts`, Node runtime) — an **optimistic** check only: no session
   cookie on a protected path → redirect to `/login`. No DB lookups in the
   proxy, per the Next 16 auth guide; it runs on prefetches. Real
   enforcement lives in the DAL and, above all, in the API.
4. **`apps/web/lib/api-client.ts`** — `request()` forwards the session cookie
   instead of `SERVICE_TOKEN` + `X-Teacher-Id`. One chokepoint, one change.
5. **Admin UI** — `apps/web/app/(dashboard)/admin/domains/page.tsx` and
   `.../admin/members/page.tsx`, with Server Actions in
   `apps/web/lib/admin-actions.ts` calling new API admin endpoints through
   `api-client.ts`. As [quiz-actions.ts](../apps/web/lib/quiz-actions.ts)
   already documents, Server Actions are reachable by direct POST — so these
   actions carry no authority of their own; the API's `requireAdmin` does.
6. **Sign-out** — a control in the sidebar calling
   `authClient.signOut()`; Better Auth deletes the session row.

---

## 5. Desktop flow: Student, via the Device Authorization Grant

The desktop client is a kiosk whose webview has no network, whose Rust client
follows no redirects, which registers no URL scheme, ships no Tauri plugins,
and persists nothing. **The device flow (RFC 8628) is the only OAuth flow
that fits every one of those invariants without adding a single new
capability** — and Better Auth ships it as the `deviceAuthorization` plugin.

```
Webview (no network)     Rust (reqwest, origin-pinned)      API :3000 (Better Auth)     Student's browser (ANY device)
   |                        |                                   |                            |
   |-- paste exam link ---->|-- validate_link (offline) ------->|                            |
   |<- preview -------------|-- POST /api/exam/preview -------->|   (unauthenticated, as today)
   |-- "Sign in" ---------->|-- POST /api/auth/device/code ---->|   client_id=quizzer-desktop
   |                        |<- device_code, user_code,         |
   |<- {user_code,          |     verification_uri, interval ---|
   |    verification_uri,   |   (device_code never leaves Rust) |
   |    expires_in} --------|                                   |
   |  [shows: go to         |   poll every `interval` s:        |<-- GET /device?user_code --|
   |   <web>/device, enter  |-- POST /api/auth/device/token --->|--- Google OAuth ---------->|
   |   ABCD-1234]           |<- authorization_pending ----------|<-- callback, hooks run ----|
   |                        |        ...student approves...     |<-- POST /device/approve ---|
   |                        |<- { access_token: BA session } ---|                            |
   |                        |-- GET /api/auth/get-session ----->|   (bearer)                 |
   |<- auth://status event -|   { name, email } → AuthStore     |
   |   {signed_in, name}    |                                   |
   |-- Begin -------------->|-- POST /api/exam/session -------->|   requireStudent: resolve token,
   |                        |   Authorization: Bearer <token>   |   re-check domain/status, write
   |                        |<- { session_jwt, exam, ... } -----|   student_user_id + student_ref
   |   lockdown engages (unchanged)                             |   return exam JWT as today
```

Why this flow, concretely:

- **All auth traffic is plain POSTs from Rust** to the compile-time
  `API_ORIGIN` — the existing `reqwest` client with
  `redirect: Policy::none()` works unmodified, because the device flow's
  token endpoints never redirect.
- **No browser is opened by the exam client and no listener is opened in
  it.** The student completes Google sign-in on *any* device — their phone, a
  lab machine's browser — which matters exactly here: managed school machines
  where the default browser may be policy-locked or absent.
- **Nothing secret crosses IPC.** The webview receives only `user_code`, the
  verification URL, a countdown, and eventually a name/email to display —
  all public by design. The `device_code` (the polling secret) and the
  resulting session token live only in Rust memory.
- Sign-in happens strictly **pre-lockdown**, on the link-entry screen; the
  machine is still free at that point.

**Rejected alternatives.**

- *Loopback redirect (RFC 8252).* Requires the hardened exam binary to open a
  system browser and to run an ephemeral TCP listener — a new local attack
  surface any process on the machine can hit — plus a hand-built
  "mint a transferable one-time code from the browser's cookie session,
  redeem it from Rust" endpoint pair that the device plugin provides for
  free. It also fails outright when the machine's browser is policy-blocked.
  Documented fallback only, if typing an 8-character code proves a real
  support burden.
- *Deep link callback.* No deep-link plugin is installed, no scheme is
  registered, the navigation handler's catch-all refusal (with the
  `blocks_non_web_schemes` test asserting it) would block a `quizzer://`
  navigation, and without a single-instance plugin the OS would launch a
  *second* kiosk instance to handle the callback.
- *Embedding Google sign-in in the webview.* Impossible here (the webview has
  no network) and disallowed in general: Google blocks OAuth in embedded
  webviews (`disallowed_useragent`).

### Credential handling on the desktop

- The Better Auth session token lives in a new `AuthStore`
  (`Mutex<Option<AuthState>>` in a new `src-tauri/src/auth.rs`), mirroring how
  [`session.rs`](../apps/desktop/src-tauri/src/session.rs) holds the exam JWT:
  **Rust memory only, never serialized to the frontend, never on disk.** The
  existing IPC-boundary test gets a sibling asserting the same for the student
  token and the device code.
- **No persistence — students sign in each app launch.** An exam sitting is a
  one-shot event; the sign-in costs ~30 seconds on the student's phone; and on
  shared lab machines a persisted identity is actively dangerous. Persisting
  would also require a keychain plugin the app deliberately does not have.
- The token is spent exactly once, as `Authorization: Bearer` on
  `POST /api/exam/session`. Everything after the claim runs on the exam JWT,
  exactly as today. A stolen student token grants no exam-surface power; a
  stolen exam JWT grants no identity power.
- Rust origin-pins the displayed `verification_uri` against a compile-time
  web-origin constant (the same `option_env!` pattern as `API_ORIGIN`) before
  showing it — the same paranoia `parse_link` applies to exam links.

### Desktop changes (design level)

| Where | What |
|---|---|
| `src-tauri/src/auth.rs` (new) | `AuthState` (`SignedOut` / `Pending{device_code,…}` / `SignedIn{token,identity}`), `AuthStore`, snapshot type that excludes token + device_code |
| `src-tauri/src/api/{mod,live,mock}.rs` | `request_device_code()`, `poll_device_token()` (typed `authorization_pending` / `slow_down` / `expired_token` / `access_denied` outcomes), `get_student_session()`, `sign_out()`; `start_session` gains the bearer token |
| `src-tauri/src/commands.rs`, `lib.rs` | new IPC commands `begin_sign_in`, `cancel_sign_in`, `get_auth_state`, `sign_out` (refused mid-exam), a tokio poll task, new event `auth://status` |
| `src-tauri/src/error.rs` | `NotSignedIn`, `SignInExpired`, `SignInDenied`, `AccountNotAllowed` |
| `src/screens/link-entry.tsx` + new `src/hooks/use-student-auth.ts` | identity panel: signed-out button → large `user_code` + URL + countdown (optionally an offline-generated QR) → signed-in name/email chip. `canBegin` additionally requires signed-in state |

### API changes for the student surface

- **`apps/web/app/device/page.tsx`** (new) — the verification page, on the
  web origin (same origin as the auth cookie, through the rewrite): names the
  client ("Quizzer Exam desktop app"), warns *"this signs an exam client in
  as you — only continue if the code on your exam screen matches"*, prefills
  from `?user_code=`, offers approve/deny. If the visitor has no session it
  runs the normal Google sign-in first, with `callbackURL` returning here.
- **`apps/api/src/middleware/student-auth.ts`** (new) — `requireStudent` on
  the claim route only: `auth.api.getSession({ headers })`; missing/invalid →
  401 `auth_required`; suspended membership or delisted domain (re-checked at
  claim time — defense in depth on top of the sign-in hooks) → 403
  `student_not_allowed`. Teachers/admins also pass, so staff can trial their
  own exams.
- **[routes/exam.ts](../apps/api/src/routes/exam.ts)** — `POST
  /api/exam/session` gains the middleware; `preview` stays unauthenticated
  (it reveals configuration only, and a student should see *what* they are
  sitting before being asked to sign in).
- **[services/exam.ts](../apps/api/src/services/exam.ts)** — `startSession`
  writes `student_user_id` + `student_ref` (email). Recommended follow-up now
  that sessions carry identity: refuse a second unsubmitted session for the
  same `(token, student_ref)` with the existing `session_conflict` code.

---

## 6. Credential classes: three, mutually inert

| Credential | Lives | Opens | Never opens |
|---|---|---|---|
| **Better Auth session** — cookie (web origin) or bearer (Rust memory) | browser cookie jar / `AuthStore` | web app, `/api/auth/*`, role-gated API routes, the exam-session claim | the exam surface after claim (that is the exam JWT's job) |
| **Exam session JWT** — HS256, aud `quizzer:exam` | Rust `SessionStore` | answer/heartbeat/events/submit/media | teacher, admin, and auth routes (fails `getSession` entirely) |
| **`SERVICE_TOKEN`** — legacy, retired in Phase 4 | web server env | teacher routes during migration only | — |

`env.ts` extends its existing boot refusal: `BETTER_AUTH_SECRET`,
`EXAM_JWT_SECRET`, and `SERVICE_TOKEN` must be pairwise distinct.

---

## 7. Authorization model

### What Better Auth enforces

The OAuth dance itself (state generation/validation persisted in
`verification`, PKCE, code exchange), callback origin / `trustedOrigins` CSRF
checks, session issuance and token hashing, cookie flags (httpOnly,
SameSite=Lax, Secure), session expiry and rolling refresh, sign-out
revocation, device-code lifecycle (single-use, expiry, poll throttling) — and,
because our hooks run *inside* its pipeline, the institutional domain
allowlist at authentication time.

### What the application enforces (all server-side, all in `apps/api`)

| Operation | Enforcement point |
|---|---|
| Quiz CRUD / drafts / publish / media / results | `requireTeacher` in [middleware/auth.ts](../apps/api/src/middleware/auth.ts): session → role ∈ {teacher, admin} → teachers profile. Ownership scoping in services is unchanged (foreign quiz → 404, as today) |
| Configure domains, manage users/roles, revoke sessions | new `requireAdmin` on new `routes/admin.ts` |
| Claim an exam session (identity binding) | new `requireStudent` on `POST /api/exam/session` |
| Take exam / save / heartbeat / submit | existing [exam-auth.ts](../apps/api/src/middleware/exam-auth.ts) — untouched |
| Web route gating | `proxy.ts` (optimistic) and the DAL — **UX only**; the API refuses regardless |

### Role capabilities

| | Admin | Teacher | Student |
|---|---|---|---|
| Sign in with institutional Google | ✔ | ✔ | ✔ |
| Configure allowed domains, institutions | ✔ | — | — |
| Grant/suspend roles, revoke sessions | ✔ | — | — |
| Quiz Maker: create/edit/draft/publish/own quizzes, results | ✔ (has a teachers profile) | ✔ | — |
| Claim + take an exam via a valid link, submit answers | ✔ (for trialing) | ✔ (for trialing) | ✔ |
| View own results (future `GET /api/student/results`) | — | — | ✔ |

### Why role self-elevation is impossible by construction

Roles are rows in `institution_members`. The only code that writes that table
is `routes/admin.ts`, behind `requireAdmin`. No request body anywhere else
carries a role. The role in the session payload is computed server-side by
`customSession` from the membership table on each read — a client editing its
own requests changes nothing the server believes.

---

## 8. Provisioning: hybrid (recommended)

**Students auto-provision.** Any verified Google account on an allowlisted
domain signs in and receives an active `student` membership (per-institution
toggle `auto_provision_students`). Rationale: pre-registering hundreds of
students per exam is operationally unworkable; the domain allowlist already
*is* the institutional gate; and Student is the least-privileged role — it
grants only "claim an exam you hold a valid link for," which the link token
gates anyway.

**Teacher is explicitly granted by an admin.** The grant creates the
membership row and the `teachers` profile row in one transaction. A
domain-wide auto-grant would hand every student an authoring surface and the
answer keys that come with it.

**Admin is never automatic.** The initial admin is established by a one-time,
server-side CLI (`pnpm --filter api auth:bootstrap -- --email=… --institution=…
--domain=…`), which creates the institution, its first allowed domain, and a
*pending role grant* keyed to the exact admin email; that email's first Google
sign-in consumes the grant. The script refuses to run while any admin — as a
membership or an unconsumed grant — exists, so it cannot be replayed; each
environment's database bootstraps independently. There is deliberately no HTTP
route with this power. Service-level guard everywhere else: the last admin of
an institution cannot be demoted or suspended.

*Rejected — fully admin-controlled provisioning* (users authenticate but sit
role-less until approved): stronger control, but it adds an approval queue UI
and delays every student's first exam for little gain, since Student is
already least-privilege. *Rejected — fully automatic* (teachers from domain
too): violates the requirement that role ≠ domain.

---

## 9. Security considerations, case by case

- **OAuth state / CSRF** — Better Auth persists state in `verification` and
  validates it plus PKCE on callback; `trustedOrigins` is pinned to the web
  origin; `baseURL` is configuration, never derived from a Host header. The
  Next rewrite is transparent, so `Origin` headers arrive intact.
- **Session expiration & logout** — DB-backed sessions, 7-day cap, 24-hour
  rolling refresh. Sign-out deletes the row. `cookieCache` is disabled, so
  every check hits the session table and **revocation is immediate**, not
  eventual.
- **Revoked / disabled Google account** — Google refuses the next OAuth; the
  existing session survives until expiry or admin action. Mitigations: the
  7-day cap, and a "revoke sessions" action per member on the admin page.
- **A domain is removed from the allowlist** — one transaction in the admin
  service: delete the `institution_domains` row, set matching memberships to
  `suspended`, and **delete those users' `session` rows** — existing sessions
  die immediately. `user`/`account` rows are retained (FK integrity, audit);
  re-adding the domain re-activates the memberships. New sign-ins are refused
  by `assertStillAllowed`.
- **Students impersonating teachers/admins** — a student's session fails the
  role check in `requireTeacher`; an exam JWT fails `getSession` entirely.
  Three credential classes, three secrets, pairwise-distinct at boot.
- **Clients modifying their role** — no writable path exists (§7).
- **Unauthorized access to quizzes / results** — unchanged ownership scoping
  (`owner_id`) behind `requireTeacher`; the manifest/answer-key split from the
  engine architecture is untouched by auth.
- **Device-code phishing** (attacker requests a code, socially engineers a
  victim into approving) — 10-minute single-use codes; rate-limited
  `/device/code`; the verification page names the client and instructs the
  user to match the code on *their* exam screen. Blast radius is inherently
  small: an approved code yields a student-only session — no grades, no
  answer keys, no teacher surface.
- **Device-code guessing** — the `user_code` is entered by a signed-in human
  on a rate-limited page; the `device_code` (polling secret) is long, random,
  and never leaves Rust.
- **Hostile desktop webview** — the only new IPC outputs are the user code,
  an origin-pinned verification URL, countdowns, and a display name/email.
  New commands are refused in wrong states (`begin_sign_in` mid-exam,
  `sign_out` mid-exam). No identity field exists in any IPC input or API
  body — identity is written server-side at claim time from a
  server-verified token.
- **Google `hd` claim** — UX hint at most; enforcement is always the verified
  email's domain against `institution_domains`.
- **Teacher role assignment / student auto-role** — explicit admin grant /
  automatic from allowed domain, respectively (§8).

---

## 10. Environment & configuration changes

| Where | Additions |
|---|---|
| `apps/api/src/env.ts` + `.env.example` | `BETTER_AUTH_SECRET` (min 32 chars), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_WEB_ORIGIN` (url); extend the boot check to pairwise-distinct secrets. The initial admin comes from the bootstrap CLI, not an env var |
| `apps/web/lib/env.ts` | unchanged in Phase 1; `SERVICE_TOKEN` removed in Phase 4 |
| `turbo.json` | add every new variable to the `env` allowlists on `build`/`lint`/`typecheck`, or Turbo will hash-miss |
| Google Cloud console | one OAuth client; redirect URI `${PUBLIC_WEB_ORIGIN}/api/auth/callback/google` (the device flow needs no second redirect URI — approval happens on the web origin) |
| Desktop build | optional compile-time `QUIZZER_WEB_ORIGIN` (same `option_env!` pattern as `QUIZZER_API_ORIGIN`) for pinning the displayed verification URL |

No `NEXT_PUBLIC_*` variables are introduced; nothing about auth is a
client-side secret.

---

## 11. Phased implementation plan

**Phase 1 — Better Auth core + web sign-in** *(ships alone; teachers keep working)*

- API: new `src/lib/auth.ts`, `src/lib/auth-hooks.ts`, `src/db/auth-schema.ts`
  (CLI-generated); schema additions (institutions, domains, members,
  `teachers.user_id`, `exam_sessions.student_user_id`) + Drizzle migration;
  seed one institution + domain and link the dev teacher; mount the handler in
  `src/app.ts`; env additions.
- Web: rewrite in `next.config.ts`; `lib/auth.ts` becomes the DAL; new
  `lib/auth-client.ts`, `app/login/page.tsx`, `proxy.ts`; cookie forwarding in
  `lib/api-client.ts`; sign-out in `components/app-sidebar.tsx`.
- Migration bridge: `requireTeacher` accepts a session **or** the legacy
  `SERVICE_TOKEN` behind a non-production flag, so the existing route tests
  and dev workflows keep passing mid-stream.

**Phase 2 — Admin surface**

- API: `src/routes/admin.ts` + `src/services/admin.ts` + `requireAdmin`;
  request/response contracts added to
  [packages/quiz-core/src/contracts.ts](../packages/quiz-core/src/contracts.ts).
- Web: `app/(dashboard)/admin/domains/page.tsx`, `.../members/page.tsx`,
  `lib/admin-actions.ts`.
- The domain-removal transaction (suspend + revoke sessions) lands here.

**Phase 3 — Student flow**

- Web: `app/device/page.tsx` verification page.
- API: `src/middleware/student-auth.ts`; wire `requireStudent` into
  `routes/exam.ts`; thread the student through `services/exam.ts` into
  `student_user_id`/`student_ref`; optional `(token, student_ref)`
  session-conflict guard.
- Desktop: `src-tauri/src/auth.rs`; api-client methods; IPC commands + poll
  task + `auth://status`; link-entry identity panel; extend the IPC-boundary
  test to the new credentials.

**Phase 4 — Hardening & cleanup**

- Retire `SERVICE_TOKEN`: remove the legacy path from `requireTeacher`, drop
  it from `apps/web/lib/env.ts` and `api-client.ts`.
- Rewrite `apps/api/src/routes/__tests__/*.test.ts` around a session-minting
  test helper.
- Optional: `GET /api/student/results`; Next's experimental
  `authInterrupts` + `unauthorized()` in the web app.

### Open items — verified during implementation (better-auth 1.7.5)

1. ✅ The device plugin's `/device/code` and `/device/token` endpoints work
   when called on the **API origin** while `baseURL` points at the web origin
   (verified over HTTP: code minting, `invalid_client` refusal,
   `authorization_pending` polling).
2. ✅ The token endpoint accepts `application/json`; the Rust client sends
   JSON.
3. ✅ Sessions created via device-flow redemption go through
   `internalAdapter.createSession`, which fires
   `databaseHooks.session.create.before` — the membership/domain guard runs
   there too.
