# Quiz Maker Engine — architecture & implementation plan

> **Status: implemented.** Everything below is built; see
> [Repository status](#repository-status) for the per-package state. Code
> blocks show the intended shape, which the current files follow.

Quizzer is a lockdown exam system in three parts:

```
Teacher                      Server                    Student
apps/web  ──── HTTP ────►  apps/api  ◄──── HTTPS ───  apps/desktop
authoring UI               Hono + Postgres            Tauri kiosk client
```

A teacher authors a quiz, publishes it, and gets a link. A student pastes that
link into the desktop client, which claims an exam session and renders the quiz
inside a window that resists leaving the exam environment.

This document covers the **Quiz Maker Engine** — the authoring side and the
contract it publishes into.

---

## Repository status

| Path | State |
|---|---|
| `apps/desktop` | **Built.** Lockdown, IPC, session handling, proctor events, and the exam screen rendering through `packages/quiz-ui`, one question per page. 23 `cargo test`s, including a drift check against a real captured API response. |
| `packages/ui` | **Built.** shadcn `base-nova` primitives on Base UI. Consumed by both `apps/web` and `apps/desktop`. |
| `packages/quiz-core` | **Built.** Domain types, rich-text allowlist, `project()` / `extractKey()` / `validateQuiz()`, 37 tests. |
| `apps/api` | **Complete for this phase.** Hono on :3000, seven tables migrated, error envelope, two separate auth surfaces, full quiz CRUD, publish/unpublish with token minting, the public `/e/:token` landing page, and all five exam endpoints. |
| `apps/web` | **Built.** Next.js 16 on :3001. Sidebar shell, quiz list, and the editor: rich-text prompts, all four question types, drag reordering, autosave over HTTP with conflict and failure states, the quiz-settings sheet, preview, and the publish dialog with copy-link and unpublish. |
| `packages/quiz-ui` | **Built and in use by both apps.** `RichText`, `QuestionView` and the Tiptap `RichTextEditor`, 68 tests. The teacher's preview and the student's exam screen are the same component, and so are the prompt editor and the essay answer editor. |

---

## Two constraints that shape everything

**1. The student's question UI *is* the teacher's preview.** How a question
renders in `apps/web` is how it renders in `apps/desktop`; only the answer
controls differ. That makes the renderer a shared package rather than two
implementations that drift apart.

**2. `apps/api` owns all data.** `apps/web` holds no database connection — its
Server Actions are HTTP clients. `apps/api` also serves the desktop's exam
endpoints *and* the `/e/<token>` link route.

Everything below follows from those two, plus one inherited invariant: the
published quiz payload **never contains a correct answer**.

---

## Target layout

```
packages/
  quiz-core/    types · zod contracts · project() · extractKey() · validateQuiz()
                rich-text schema.  Pure TS — no DB, no React, no framework.
  quiz-ui/      RichText · QuestionView.  Pure React — no Next, no Tauri.
  ui/           shadcn/base-nova primitives (exists)
apps/
  api/          Hono.  Drizzle + Postgres.  Exam endpoints, teacher CRUD,
                and the /e/<token> landing page.           → port 3000
  web/          Next 16.  Authoring UI.  HTTP client to api. → port 3001
  desktop/      Tauri.  Rust owns networking; webview renders quiz-ui.
```

> ### Port assignment is not cosmetic
> The desktop pins its backend origin **at compile time** and defaults to
> `http://localhost:3000` (see [`session.rs`](../apps/desktop/src-tauri/src/session.rs)).
> Because `apps/api` serves the link route, **`apps/api` must run on 3000** and
> `apps/web` moves to 3001. Get this backwards and every locally generated link
> is rejected offline, before a single request is sent.

Who runs what:

| | `quiz-core` | `quiz-ui` |
|---|---|---|
| `apps/api` | authoritative — validate, project, extract key | — |
| `apps/web` | advisory — live validation, local preview projection | authoring preview |
| `apps/desktop` | — (Rust mirrors the contract) | exam rendering |

---

## Core design: two models, one projection

```
QuizDoc  (authoring model — HAS correct answers, never leaves apps/api)
   │
   ├── project() ──► ExamManifest  (student model — CANNOT hold an answer)
   │                                 served to desktop, and to web's preview
   └── extractKey() ──► AnswerKey  (grading model — server-only, never shipped)
```

`project()` lives in `packages/quiz-core` and is the **only** code path that
produces a manifest. The `ExamManifest` type has no field an answer could land
in, mirroring how the Rust `Question` struct is deliberately shaped.

The alternative — one model with a `correct` flag and a `delete` before send —
is one forgotten field away from shipping the answer key to every student.

`apps/web` may call `project()` locally to render its preview (it already holds
the draft in memory, so no round trip), but the manifest a student receives is
**always** the one `apps/api` produced.

---

## Question types

Three separate concerns, so that adding a type never touches the editor shell.

**A. Authoring registry** — `apps/web/lib/quiz/types/registry.tsx`, teacher-side only:

```ts
export interface QuestionTypeDef<T extends BaseQuestion = BaseQuestion> {
  kind: QuestionKind
  label: string
  icon: LucideIcon
  createDefault(): T
  Editor: FC<{ question: T; onChange: (q: T) => void }>
}
```

**B. Shared renderer** — `packages/quiz-ui`, used by web preview *and* desktop exam:

```tsx
export function RichText(props: {
  doc: RichDoc | undefined          // absent when plain text lost nothing
  fallback?: string                 // question.prompt, always populated
}): ReactNode
// Maps ProseMirror nodes to React elements. The one implementation of the
// never-render-HTML rule, instead of one per app.

export function QuestionView(props: {
  question: ManifestQuestion        // no answer key in this type
  index: number
  total: number
  answer: AnswerControls            // the ONLY per-app part
}): ReactNode

export type AnswerControls = {
  value?: AnswerValue               // string | string[]
  onChange?: (value: AnswerValue) => void
  readOnly?: boolean
}
```

Two deliberate departures from the original sketch:

- **The control is derived from `question.kind`, not passed in.** A caller-supplied
  `mode` would be a second source of truth that can disagree with the manifest,
  and there is no case where a multiple-choice question should render as
  anything else.
- **`readOnly`, not `disabled`.** A preview should look like the exam, not like
  a form that has been switched off.

`QuestionView` renders the header, the prompt and the answer control, and
nothing else. The timer, the lockdown badge, the submit button and per-question
save state are exam chrome: they have no meaning in a preview, and putting them
here would grow a prop for every difference between the two apps.

An unknown `kind` renders a plain "this needs a newer version of the exam app"
notice, mirroring `#[serde(other)]` on the Rust side, and an unknown rich-text
node renders as nothing. Neither is reachable through `quiz-core`, whose schema
is strict, but the desktop reads this JSON off a network, and a student mid-exam
should lose one question rather than the whole paper.

A lint rule in the package forbids importing `next/*` or `@tauri-apps/*`, since
either compiles fine in the app that owns it and breaks the other one at
runtime. Its lint script runs with `--max-warnings 0`, because the repo's shared
ESLint base includes `eslint-plugin-only-warn` and the guard would otherwise
report the mistake and exit zero.

**C. Pure logic** — `packages/quiz-core`, per kind: `validate`, `toManifest`, `toAnswerKey`.

`single_choice` and `multiple_choice` share one `<OptionListEditor>`
parameterised by `selection: "one" | "many"` — radio vs checkbox is a prop, not
a duplicated component.

---

## Data model

### Authoring document (JSONB)

```ts
type QuizDoc = {
  schemaVersion: 1
  title: string
  description?: string
  settings: { durationS: number; allowBacktracking: boolean; shuffleQuestions: boolean }
  questions: Question[]          // array order IS the display order
}

type BaseQuestion = { id: string; kind: QuestionKind; promptDoc: RichDoc; points: number }

type TrueFalseQuestion      = BaseQuestion & { kind: "true_false"; correct: boolean }
type ChoiceOption           = { id: string; labelDoc: RichDoc; correct: boolean }
type SingleChoiceQuestion   = BaseQuestion & { kind: "single_choice";   options: ChoiceOption[] }
type MultipleChoiceQuestion = BaseQuestion & { kind: "multiple_choice"; options: ChoiceOption[] }
type EssayQuestion          = BaseQuestion & { kind: "essay"; minWords?: number;
                                               maxWords?: number; rubricDoc?: RichDoc }
```

One question per page is the only mode, so there is no `onePerPage` flag.
`allowBacktracking` controls whether **Previous** is enabled.

Questions are an **array in one JSONB column**, not a normalized table:
reordering is an array splice, nested options need no join, and a draft saves in
one write. Published versions are immutable snapshots and student responses live
in their own tables, so normalizing the draft buys nothing.

### Postgres schema (Drizzle) — `apps/api/src/db/schema.ts`

```
teachers        id, name, email, created_at
quizzes         id, owner_id → teachers, title, status('draft'|'published'|'archived'),
                draft_doc jsonb, active_version_id → quiz_versions, doc_version int,
                created_at, updated_at
quiz_versions   id, quiz_id, version_no, manifest jsonb, answer_key jsonb,
                published_at, published_by          -- IMMUTABLE, append-only
exam_links      token PK, quiz_id, opens_at, closes_at, revoked_at, created_at
exam_sessions   id, token, version_id, student_ref, started_at, expires_at,
                submitted_at, receipt_id, idempotency_key, last_seen_at
exam_answers    session_id, question_id, value jsonb, client_seq, updated_at
proctor_events  id, session_id, seq, kind, at_client, at_server, detail
```

The schema stays inside `apps/api`. `apps/web` imports **domain types from
`quiz-core`**, never the Drizzle schema.

---

## Draft / published versioning

```
Draft ──publish──► Published (v1)
  ▲                    │
  └──── edit ──────────┘   edits go to draft_doc; v1 stays frozen
              republish ──► Published (v2), active_version_id → v2
```

- Editing a published quiz **never mutates a version**. It writes `draft_doc`
  and sets a derived `hasUnpublishedChanges`.
- The token points at the **quiz**, not a version, so republishing keeps links
  already handed to students working.
- **`exam_sessions.version_id` is pinned at session start.** A student who began
  on v1 finishes on v1 even if the teacher republishes mid-exam. One column
  carries that entire guarantee.
- Unpublishing sets `revoked_at`; the desktop then receives `revoked`.

---

## Wire contract

The desktop's renderer is being rewritten against `quiz-ui`, so the contract is
designed for clarity rather than backwards compatibility. Intended shape of
[`session.rs`](../apps/desktop/src-tauri/src/session.rs):

```rust
#[serde(rename_all = "snake_case")]
pub enum QuestionKind {
    TrueFalse,
    SingleChoice,
    MultipleChoice,
    Essay,              // replaces ShortText
    #[serde(other)]
    Unsupported,        // future kinds degrade to one skipped question,
}                       // instead of poisoning the whole manifest

pub struct Question {
    pub id: String,
    pub kind: QuestionKind,
    pub prompt: String,                  // plain-text fallback, always populated
    #[serde(default)] pub prompt_doc: Option<RichDoc>,   // constrained ProseMirror JSON
    #[serde(default)] pub choices: Vec<Choice>,
    #[serde(default)] pub points: u32,
}
```

`#[serde(other)]` is what actually unlocks extensibility across the boundary.
Without it, shipping any new question kind breaks every older client outright.

`prompt` stays populated on every question (derived by concatenating the doc's
text nodes) so a client ignoring `prompt_doc` still renders something correct.

### Rich text, safely

Tiptap is configured to a **closed allowlist**, not StarterKit defaults:

- Nodes: `doc, paragraph, text, bulletList, orderedList, listItem, codeBlock, hardBreak, image`
- Marks: `bold, italic, underline, code`
- Excluded: links, headings, tables, blockquote, horizontal rule

The `image` node is the one nodetype beyond text, and it carries **only an
opaque `mediaId`** (plus alt text) - never a URL, and its Tiptap extension has
no `parseHTML`, so an image pasted from the open web maps to nothing. The bytes
live in Garage (S3-compatible, `docker compose up -d && ./infra/garage/init.sh`)
and only `apps/api` talks to it: teachers upload through
`POST /api/quizzes/:id/media` and the editor displays via apps/web's
same-origin `/api/media/:id` proxy, while the desktop's Rust process fetches
`GET /api/exam/media/:id` (session-JWT-authed, scoped to the session's quiz) at
session start and hands the webview data URIs - the webview has no network. A
failed fetch loses one picture, not the exam.

A Zod schema in `quiz-core` validates the node tree against that allowlist in
`apps/api` at publish time; unknown nodes or marks are rejected. `quiz-ui`'s
`RichText` then maps nodes to React elements. **No HTML string is ever
produced**, so the XSS invariant holds by construction in both apps at once.

The editor's extension list (`apps/web/lib/rich-text/extensions.ts`) is built by
explicit inclusion, never StarterKit-minus-things: a denylist silently grows
every time StarterKit gains an extension. `lib/rich-text/tiptap.test.ts` pins
the two descriptions of the allowlist together — it drives a real editor and
fails if its output stops satisfying `richDocSchema`.

Documents are stored in ProseMirror's own serialisation, so no conversion step
sits between the editor, the database and the exam client. Two consequences
worth knowing: marks are objects (`marks: [{ "type": "bold" }]`, not
`["bold"]`), and node attributes live under `attrs` (`orderedList` carries
`{ start, type }`, `codeBlock` carries `{ language }`).

Student answers stay plain text for now — `AnswerValue = string | string[]`
already works end to end and is far simpler to grade and diff.

---

## Validation

Two tiers. **Drafts save while invalid** — a half-built question must not block
autosave. Validation gates *publish only*.

| Scope | Rule |
|---|---|
| Quiz | title non-empty, ≤200 chars; ≥1 question; `durationS` > 0 |
| Every question | prompt has ≥1 non-empty text node; `points` ≥ 0 |
| `true_false` | exactly one of True/False marked correct |
| `single_choice` | ≥2 options; **exactly one** correct; no empty or duplicate labels |
| `multiple_choice` | ≥2 options; **≥1** correct; warn (not block) if *all* are correct |
| `essay` | prompt non-empty; `minWords ≤ maxWords` when both set |

`validateQuiz(doc) → Issue[]`, each `{ questionId, field, severity, message }`.

It runs **twice, on purpose**: in `apps/web` for instant rail dots and a
click-through issue list, and again in `apps/api` at publish as the authoritative
gate. The client's verdict is a UX affordance, never a control.

---

## Authoring UI

```
apps/web
  app/(dashboard)/layout.tsx                     shell, mock user menu
  app/(dashboard)/quizzes/page.tsx               quiz list
  app/(dashboard)/quizzes/[id]/edit/page.tsx     the Quiz Maker
  app/(dashboard)/quizzes/[id]/preview/page.tsx  student-shell preview
  lib/api-client.ts                              typed fetch wrapper over apps/api
  lib/auth.ts                                    getCurrentTeacher() mock seam
```

Next 16 note: `params` is a `Promise` and must be awaited.

Two panes, deliberately not three:

```
┌──────────────────────────────────────────────────────────────┐
│ ‹ Quizzes  [Quiz title — inline editable]   ● Draft          │
│                        Saved 2s ago · Preview · Publish      │
├───────────────┬──────────────────────────────────────────────┤
│ QUESTIONS  12 │  Question 3                    [type ▾] [⋯]  │
│               │                                              │
│ ⠿ 1 ◉ True/F  │  ┌────────────────────────────────────────┐ │
│ ⠿ 2 ☰ Multi   │  │ B I U • 1. <>   (Tiptap toolbar)       │ │
│ ▶ 3 ◉ Single ●│  │ Which of these are prime numbers?      │ │
│ ⠿ 4 ¶ Essay   │  └────────────────────────────────────────┘ │
│               │                                              │
│ + Add question│  ANSWER OPTIONS          ○ One   ◉ Many      │
│               │  ⠿ ☑ 7                                  ⋯   │
│               │  ⠿ ☐ 9                                  ⋯   │
│               │  ⠿ ☑ 13                                 ⋯   │
│               │  + Add option                                │
│               │                                              │
│               │  Points [2]   Required [✓]                   │
└───────────────┴──────────────────────────────────────────────┘
```

The left rail carries drag handles, a type icon and a validation dot.
Per-question settings sit inline at the bottom of the editor card; quiz-level
settings (duration, backtracking, shuffle) live in a sheet behind a Settings
button, so the default view stays uncluttered.

```
QuizEditorProvider            (useReducer over QuizDoc + autosave)
├─ QuizEditorHeader           title, status pill, SaveIndicator, Preview, PublishDialog
├─ QuestionListRail           DndContext + SortableContext
│  ├─ QuestionListItem ×n     drag handle, icon, validation dot
│  └─ AddQuestionMenu         built from the authoring registry
└─ QuestionEditorPane
   ├─ QuestionTypeSelect      registry-driven; warns on lossy switch
   ├─ RichTextEditor          Tiptap, constrained schema
   └─ <registry[kind].Editor>
      └─ OptionListEditor     shared by single_choice + multiple_choice
```

### State, autosave and reordering

No state library. One `useReducer` over `{ doc, selectedId }`
([`lib/quiz/reducer.ts`](../apps/web/lib/quiz/reducer.ts)) — the state is a
single document owned by a single screen, so Zustand or Jotai would earn
nothing. Selection lives in the same reducer because almost every structural
edit moves it: adding selects the new question, deleting lands on a neighbour.

The reducer is pure, in two senses that both matter:

- Ids are minted by the caller and arrive inside the action, so React may replay
  it. `cloneQuestion` (the Duplicate action) therefore sits outside it.
- It returns the **same `doc` object** when a change touches nothing. Autosave
  watches `state.doc` by identity, so selecting a question is not an edit, and
  neither is a controlled input re-emitting the value it was given.

- **Autosave** ([`lib/quiz/use-autosave.ts`](../apps/web/lib/quiz/use-autosave.ts)):
  800 ms debounce → `saveDraftAction` → `PUT /quizzes/:id/draft`. Because this is
  a network hop, it needs what an in-process write did not: retry with backoff
  (1s, 2s, 4s, 8s, then it waits to be asked), a visible failure state, and a
  `beforeunload` guard while anything is unsaved. One request at a time: an edit
  made mid-flight folds into the next debounce rather than racing the first.
- **Concurrency**: `docVersion` travels with the request; `apps/api` answers
  **409**, surfaced as "edited in another tab" with a Reload. A conflict is
  terminal, never retried: the version the edit was based on is gone, so the
  same body can only fail again.
- **Failure reporting**: `saveDraftAction` returns its failures rather than
  throwing, because a thrown Server Action reaches the client as an opaque
  message in production, and the editor has to tell a stale version apart from
  an API that is merely down.
- **Reordering**: `@dnd-kit/sortable` with `verticalListSortingStrategy`, shared
  by the rail and the option list
  ([`components/quiz/sortable.tsx`](../apps/web/components/quiz/sortable.tsx)).
  The grab handle is a real focusable `<button>` driving a `KeyboardSensor`:
  reordering is the only way to change question order, so a drag-only
  implementation would put it out of reach without a mouse. Order is array
  position; no `position` column to drift out of sync.

### Preview

`/quizzes/[id]/preview` renders `project(draftDoc)` through the **same
`QuestionView` the desktop exam screen uses**. One question per page, because
that is the only mode the exam client has.

The projection runs in the page rather than being fetched: a preview shows the
*draft*, which by definition has not been published and has no manifest on the
server yet. `project()` is pure and is the same function `apps/api` runs at
publish, so what the teacher sees is what gets shipped. It also means every
preview exercises `assertNoAnswerLeak`, so a leak surfaces during authoring
rather than after a class has the link.

Two things the preview deliberately does *not* imitate: there is no countdown,
and Submit is inert. A timer would either be a lie or would run a teacher out of
time reading their own questions, and a preview that could file a result would
be a way to pollute real ones. Answers live in local state and go nowhere.

---

## Publishing and quiz links

```
POST /api/quizzes/:id/publish
  1. validateQuiz(draftDoc)          → 422 with Issue[] if any error
  2. manifest  = project(draftDoc)
  3. answerKey = extractKey(draftDoc)
  4. assertNoAnswerLeak(manifest)     ← runtime guard, not just a test
  5. INSERT quiz_versions (immutable)
  6. UPSERT exam_links token (reuse existing token on republish)
  7. UPDATE quizzes SET status='published', active_version_id=…
```

**Token**: `crypto.randomBytes(24).toString("base64url")` → 32 chars of
`[A-Za-z0-9_-]`, inside the desktop's 16–128 validation. Unique constraint with
retry on collision.

**Link**: `${PUBLIC_API_ORIGIN}/e/${token}`, read from config — **never from the
request host**. The desktop pins its origin at compile time and rejects anything
else offline, so a link minted on a preview deployment is refused by every
client. The same rule applies to the landing page's own copy of the address: it
is rebuilt from configuration rather than echoed from `c.req.url`, so a
forwarded or spoofed `Host` cannot print an address a student would trust.

**One token per quiz, for the life of the quiz.** Republishing keeps it, so a
link already written on a whiteboard keeps working and resolves to the new
active version. Unpublishing sets `revoked_at`; publishing again clears it and
restores the same link.

**`GET /e/:token`** is the only public route in the service. It returns a small
HTML page and, deliberately, almost nothing else: the quiz title and an
instruction to open the link in Quizzer Exam. The manifest lives behind
`POST /api/exam/session`, which needs a credential this page does not have.
It sends `Cache-Control: no-store` and `X-Robots-Tag: noindex` — an exam link in
a search index would be a quiet disaster — and it is the one place in the system
that builds an HTML string, so the teacher-authored title goes through
`hono/html`, which escapes it.

**Deleting a quiz revokes its link explicitly**, in the same transaction as the
archive, rather than relying on the `archived_at` filter in whatever query reads
the link next. A deleted quiz whose link still resolves because one join forgot
a `WHERE` clause is not a failure anyone notices until a student sits the exam.

---

## API surface (`apps/api`, Hono)

Two audiences, two auth schemes, deliberately separate.

**Teacher surface** — called only from `apps/web` Server Actions (server to server):

```
GET    /api/quizzes              list for current teacher
POST   /api/quizzes              create
GET    /api/quizzes/:id          full draft doc
PUT    /api/quizzes/:id/draft    autosave (doc_version in body → 409 on conflict)
POST   /api/quizzes/:id/publish  validate → version → token
POST   /api/quizzes/:id/unpublish
DELETE /api/quizzes/:id          soft delete
```

**Exam surface** — called only from the desktop's Rust process:

| Endpoint | Owns |
|---|---|
| `POST /api/exam/session` | token → active version, mint session JWT, pin `version_id`, return manifest |
| `POST /api/exam/answer` | upsert by `(session, question_id)`, drop stale `client_seq` |
| `POST /api/exam/heartbeat` | authoritative `expires_at`, `revoked` flag |
| `POST /api/exam/events` | append proctor events with a **server** receipt time |
| `POST /api/exam/submit` | idempotent per `idempotency_key` — a retry replays the same receipt |

`GET /e/:token` returns a small HTML page telling the student to open the link in
Quizzer Exam. It must **not** leak the manifest.

Implementation notes:

- `@hono/zod-validator` against the contracts in `quiz-core`, so request shapes
  and domain types cannot drift.
- One error middleware emits `{"error":{"code":"…"}}` for every failure.
  **A bad token must return `invalid_token`, not `invalid_link`** — the Rust
  mapping in [`error.rs`](../apps/desktop/src-tauri/src/error.rs) collapses
  anything unrecognised to `server_error`, leaving the student with a useless
  message.
- **Two JWT audiences with separate secrets.** An exam session token must never
  authorize teacher CRUD. This is the main new attack surface the split creates.
- **No CORS needed.** Web calls the API from its server; the desktop calls from
  Rust. Nothing calls it from a browser, so leave CORS off rather than opening it
  "just in case".
- Service auth seam while auth is mocked: `Authorization: Bearer <SERVICE_TOKEN>`
  plus `X-Teacher-Id`. When real auth lands, web forwards the user's JWT and
  `getCurrentTeacher()` reads it — one file changes on each side.

Rules the server must own because the client cannot: never send correct answers,
score server-side only, enforce `expires_at` against the server clock, make
submit idempotent. Deliberately *not* enforced: one active session per token —
the whole class shares one link, so a second session on the same token is the
second student, not a conflict. (The desktop still refuses to replace a live
session on the same device.)

---

## Desktop boundary

```
Teacher (web) ──HTTP──► apps/api ◄──HTTPS── Rust (desktop)
                           │                    │
                    publish│                    │ paste link
                           ▼                    ▼
                      version + token    parse offline, origin check
                           │                    │
                           └── manifest ────────┘  (no answer key)
                                  │
                       packages/quiz-ui renders it
                       in BOTH web preview and desktop exam
```

The boundary is `ExamManifest` plus the endpoints above. **`packages/quiz-core`
is the TypeScript source of truth; the Rust structs mirror it by hand** — no
generated client, because the Rust side is the security boundary and should not
import a schema it does not control. A published-manifest JSON fixture is checked
into `apps/desktop` and asserted by `cargo test` to catch drift.

Groundwork already landed: `apps/desktop` depends on `@workspace/ui`, its
duplicated `button.tsx` and `lib/utils.ts` are gone, and its `index.css` imports
`@workspace/ui/globals.css` while binding bundled `@fontsource-variable`
families to the same `--font-*` tokens `next/font` fills in on the web side. The
webview has no network access, so fonts must stay bundled. `vite.config.ts`
dedupes `react`/`react-dom` so a symlinked workspace package cannot pull in a
second React. `packages/quiz-ui` follows the same shape and must import neither
`next/*` nor `@tauri-apps/*`.

See [`apps/desktop/README.md`](../apps/desktop/README.md) for what the lockdown
layer does and — importantly — what it cannot enforce.

---

## Edge cases

**Authoring**
- Question type switched after authoring → lossy; confirm dialog naming what will be lost.
- Publish with zero correct answers → blocked, with click-through to the question.
- All options correct → warning, not a block; it is legitimate.
- Duplicate or empty option labels → blocked; an empty option is invisible to the student.
- Reorder while autosave is in flight → reducer is the source of truth; the in-flight save is superseded by the next debounce.
- Two tabs on one quiz → `doc_version` 409 surfaces "edited elsewhere".
- Very long quizzes → rail virtualizes past ~100 questions.

**Service split**
- `apps/api` unreachable mid-edit → autosave retries with backoff, editor stays usable, banner shows unsaved state; never silently drop edits.
- Exam JWT presented to a teacher endpoint → rejected by audience check.
- `apps/web` started on port 3000 by habit → links point at the wrong origin and the desktop rejects them offline. Pin ports in the dev scripts.
- `quiz-core` version skew between web and api → both are workspace deps of the same version; CI typechecks the whole graph.

**Exam lifecycle**
- Teacher republishes mid-exam → session pinned to its start version; unaffected.
- Link opened in a browser → landing page only; must not leak the manifest.
- Essay questions have no machine answer key → `answerKey: null`; needs a manual grading queue (future phase).
- Token collision → unique index + retry.
- Deleting a published quiz → soft delete only; versions and receipts must survive.

---

## Adding a question type

*Matching*, *Ordering*, *Numeric*, *Fill-in-the-blank* all follow the same path:

1. `quiz-core` — `validate` / `toManifest` / `toAnswerKey` for the kind.
2. `quiz-ui` — a branch in `QuestionView`, or a new `AnswerControls` mode.
3. `apps/web` — an `Editor` and one authoring-registry key.
4. Rust — one `QuestionKind` variant. Older clients degrade to a skipped
   question thanks to `#[serde(other)]`.

Nothing in the editor shell, rail, autosave, validation runner, publisher,
preview or exam screen changes.

---

## Roadmap

| Phase | Deliverable |
|---|---|
| 1 | `packages/quiz-core`: types, zod contracts, `project()`, `extractKey()`, `validateQuiz()` + leak tests |
| 2 | `apps/api` skeleton: Hono on **:3000**, Drizzle schema + migrations, error middleware, auth seam |
| 3 | Teacher CRUD endpoints + `apps/web` api-client and `getCurrentTeacher()` seam |
| 4 | shadcn components into `apps/web` (`input textarea card select dialog sheet dropdown-menu tabs badge tooltip sonner`) |
| 5 | Quiz list + create; `apps/web` on **:3001** |
| 6 | Authoring registry + four type editors + `OptionListEditor` |
| 7 | Editor shell, reducer, autosave over HTTP, dnd-kit reordering |
| 8 | Tiptap with the constrained schema + Zod validator |
| 9 | `packages/quiz-ui`: `RichText` + `QuestionView` |
| 10 | Publish flow, token minting, copy-link, `/e/:token` page, preview route |
| 11 | Exam endpoints in `apps/api` against the real schema |
| 12 | *(desktop)* swap exam screen to `quiz-ui`; `essay` kind + `#[serde(other)]`; one-per-page |

---

## Verification

```bash
docker compose up -d                            # Postgres on :5433
cp apps/api/.env.example apps/api/.env.local    # first run only
pnpm --filter api db:migrate                    # apply migrations
pnpm --filter api db:seed                       # dev teacher for the mock auth seam

pnpm typecheck && pnpm lint && pnpm test        # whole graph, catches core/ui drift
pnpm --filter api dev                           # MUST be :3000 — the desktop's pinned origin
pnpm --filter web dev                           # :3001
```

Smoke-test the API:

```bash
curl localhost:3000/health
curl -H "Authorization: Bearer dev-service-token-change-me" \
     -H "X-Teacher-Id: 00000000-0000-4000-8000-000000000001" \
     localhost:3000/api/me
```

> `apps/api`'s tests run against a **real** database through `app.request()`, so
> `docker compose up -d` and `db:migrate` must have run first. `pnpm test` fails
> without them. `packages/quiz-core`'s tests are pure and need nothing.

**Unit** — `project()` strips every correct answer (property test over generated
docs); `validateQuiz()` covers each rule above; the rich-text Zod schema rejects
a doc containing a `script` or `image` node; an exam JWT is rejected by the
teacher middleware.

**End to end, the run that actually matters:**

1. Start `apps/api` (:3000) and `apps/web` (:3001).
2. Author a quiz with all four question types; reorder; save draft; publish.
3. Copy the link — assert the shape `http://localhost:3000/e/<32 chars>`.
4. Open that link in a browser → landing page, **and no manifest in the response body**.
5. `pnpm --filter desktop tauri:dev` (**without** `mock-api`, so it hits the real API).
6. Paste the link → the exam renders the authored questions, one per page,
   through the same `QuestionView` the preview used.
7. **Inspect the manifest response and confirm no correct-answer field is
   present.** This is the invariant the whole design exists to protect.
8. Answer and submit → receipt returns; a retried submit replays the *same* `receipt_id`.
9. Edit and republish mid-session → the in-flight session still shows the original version.

---

## Invariants that must not regress

1. **The manifest never carries an answer key.** Guarded by `project()`'s return
   type, a runtime `assertNoAnswerLeak`, and `the_manifest_never_carries_an_answer_key`
   in `cargo test`.
2. **Prompts are never rendered as HTML.** `RichText` maps nodes to React
   elements; no code path produces an HTML string from quiz content, and there
   is no `dangerouslySetInnerHTML` in `packages/quiz-ui`. Guarded by the
   "never produces HTML from quiz content" tests in
   [`rich-text.test.tsx`](../packages/quiz-ui/src/rich-text.test.tsx), which
   render a prompt containing `<script>` and assert no element was created.
3. **The session credential never crosses the IPC boundary.** Guarded by
   `the_session_credential_never_crosses_the_ipc_boundary` in `cargo test`.
   The credential is a JWT with its own secret and its own audience
   (`quizzer:exam`); `env.ts` refuses to boot if that secret equals
   `SERVICE_TOKEN`, and `readExamToken` pins the algorithm rather than reading
   it from the token's own header.
4. **Grading happens server-side only.** The client is not a security boundary;
   see [`apps/desktop/README.md`](../apps/desktop/README.md).
5. **The quiz link origin comes from config, never a request host.**
6. **A session finishes on the version it started.** `exam_sessions.version_id`
   is written once and read back on every request; republishing mid-exam adds a
   version and moves only new sessions. Guarded by "pins the version, so
   republishing does not move a student mid-exam" in `apps/api`, which checks
   the consequence a student would see rather than a value captured before the
   change.
7. **The Rust structs still fit what the server sends.** `cargo test` parses a
   real captured `/api/exam/session` response
   ([session-response.json](../apps/desktop/src-tauri/tests/fixtures/session-response.json)),
   so a field renamed on the TypeScript side fails there rather than in front of
   a student.

Before merging anything that touches the publish path or the exam payload:

```bash
cd apps/desktop/src-tauri && cargo test
```
