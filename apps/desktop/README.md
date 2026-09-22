# Quizzer Exam — desktop client

A lockdown exam client. A student pastes a quiz link, the app claims an exam
session from the companion backend, and the exam is taken inside a kiosk window
that resists leaving the exam environment.

The companion Next.js app (`apps/web`) is the teacher side — authoring,
monitoring, and the API this client talks to.

---

## Read this first

**This app is not a security boundary.** It is a student-facing client. Everything
below raises the effort of cheating and produces an audit trail; none of it
survives a student with administrator rights, a second device, or a phone
camera pointed at the screen.

Design consequences that follow from that, and which must not be undone:

- The backend is authoritative. It scores, it owns the deadline, it decides what
  a submission means.
- Question payloads never contain correct answers.
- The session credential lives in the Rust process and never crosses into the
  webview.
- Tampering with frontend state changes what's on screen and nothing else.

---

## Architecture

```
quiz link ──► Rust: parse + validate ──► reqwest ──► backend API
                     │                                   │
                     ▼                                   ▼
          Mutex<Option<ExamSession>>  ◄───────── exam JSON (no answer key)
                     │  IPC commands only
                     ▼
          local React UI  (origin: tauri://localhost, always)
```

The webview renders a locally bundled UI and has **no network access at all** —
the CSP denies `connect-src` beyond Tauri's own IPC, and no HTTP plugin is
installed. Every call to the backend originates in Rust. This is what makes the
navigation policy a one-line allowlist instead of a filter that has to be
right every time.

| Path | Role |
|---|---|
| `src-tauri/src/session.rs` | Link parsing, exam state, the session credential |
| `src-tauri/src/api/` | Backend contract; `live.rs` and a `mock.rs` fixture |
| `src-tauri/src/commands.rs` | The entire IPC surface |
| `src-tauri/src/lockdown/` | Kiosk layer, one module per platform |
| `src-tauri/src/events.rs` | Buffered, sequence-numbered proctor audit log |
| `src-tauri/src/guard.js` | Injected before page scripts; the weakest layer |
| `src/screens/` | Link entry, exam, submitted, per-failure error screens |

---

## What lockdown actually enforces

Verified against the crate sources in use (Tauri 2.11, tao 0.35, wry 0.55), not
assumed.

### Both platforms

Fullscreen, undecorated, non-resizable, always-on-top, hidden from the taskbar,
minimise/maximise/close disabled, screen-capture protection
(`contentProtected`), DevTools compiled out of release builds, page zoom and
browser extensions disabled, and navigation restricted to the bundled app
origin.

### macOS — `NSApplicationPresentationOptions`

This is a real OS mechanism, not keystroke interception. Apple's own
descriptions of the flags we set:

| Flag | Effect |
|---|---|
| `DisableProcessSwitching` | "Cmd+Tab UI is disabled." |
| `DisableForceQuit` | "Cmd+Opt+Esc panel is disabled." |
| `DisableSessionTermination` | Power key panel, Restart / Shut Down / Log Out |
| `DisableHideApplication` | Cmd+H |
| `HideDock` + `HideMenuBar` | Dock and menu bar entirely unavailable |
| `DisableAppleMenu` | Apple menu items disabled |

Two things drive the implementation: the options apply only while the app is
frontmost and macOS clears them when it isn't (so they are re-applied on every
focus gain), and an invalid flag combination raises an ObjC exception (so the
call is wrapped and degrades to a reduced set rather than crashing mid-exam).

Cmd+Q is removed separately, by trimming the app menu — presentation options
alone do not remove a menu item's accelerator. The menu cannot be emptied
outright, though: on macOS **Cmd+X/C/V/A are themselves Edit-menu key
equivalents**, so an app with no Edit menu has no clipboard shortcuts in its
text fields — which breaks the first thing a student does, pasting their quiz
link. The app therefore ships an Edit menu and nothing else: no Quit, no Close,
no Minimise, no Hide.

Copy is safe to leave in. `guard.js` blocks text selection outside editable
fields, so Cmd+C reaches a student's own answers and not the question paper.

We use **simple fullscreen**, not native fullscreen. Native fullscreen allocates
a macOS Space, which would *re-enable* Ctrl+←/→ and the three-finger swipe.

### Windows — `WH_KEYBOARD_LL`

Windows gives an unprivileged process no equivalent API, so the only in-process
lever is a low-level keyboard hook. It needs no administrator rights and
genuinely swallows:

Win (either), Alt+Tab, Alt+Shift+Tab, Alt+Esc, Ctrl+Esc, Ctrl+Shift+Esc
(Task Manager), Alt+F4, F11.

The hook runs on its own thread with a message pump, because a low-level hook
only fires while its installing thread pumps messages.

### Deliberately not used: `tauri-plugin-global-shortcut`

It is built on `RegisterHotKey` (Windows) and Carbon `RegisterEventHotKey`
(macOS). Neither is permitted to claim Alt+Tab, Cmd+Tab or the Windows key.
Registering them there appears to work and silently does nothing — worse than
not trying, because it looks like protection.

### Cannot be enforced — tell proctors this

- **Ctrl+Alt+Del.** The Secure Attention Sequence is handled by the kernel
  precisely so no user-mode process can suppress it. There is no workaround in
  a normal desktop app.
- **Ctrl+Cmd+Q** (macOS lock screen), the hardware power button, forced reboot.
- A **second device** or a phone camera.
- A user with **administrator rights**, who can kill the process or attach a
  debugger.
- macOS **Accessibility / Screen Recording** tools the student grants themselves.
- A VM running the client.

When any measure fails to apply on a given machine, it is reported in the
`exam://lockdown` payload, shown to the student under "Exam mode", and logged
to the server as a `lockdown_degraded` event.

---

## The layer that actually holds: OS kiosk

The in-app measures are defence in depth. For an exam that matters, deploy on a
dedicated account with an OS-supported kiosk mechanism:

**Windows** — [Assigned Access](https://learn.microsoft.com/en-us/windows/configuration/assigned-access/)
(single-app kiosk) or **Shell Launcher**, configured so `Quizzer Exam.exe`
replaces `explorer.exe` as the shell for the exam account. This removes the
desktop, taskbar and Start menu entirely, rather than intercepting the keys that
reach them. Pair with Group Policy disabling Task Manager to blunt Ctrl+Alt+Del.

**macOS** — a managed exam account under MDM, with configuration profile
restrictions on app launching (`com.apple.applicationaccess`), Spotlight, and
Screen Recording / Accessibility permissions. macOS has no Assigned Access
equivalent, so the presentation-options lockdown plus a locked-down account is
as far as the OS goes.

---

## Focus policy

`WindowEvent::Focused(false)` is the single most reliable signal that a student
left the exam — it fires regardless of *how* they left, including via the routes
we cannot block. On each occurrence the app:

1. records a `focus_lost` event with a sequence number and timestamp,
2. forces the window back to the foreground,
3. increments a strike counter shown to the student and to the proctor.

The exam is **never terminated client-side**. OS notifications, installer
popups and display changes all produce false positives; ending an honest
student's exam over one would be worse than logging it. Termination is the
server's and the proctor's decision.

---

## Backend contract

This client expects `apps/web` to provide:

```
POST /api/exam/session   { token, client_version, platform }
                      -> { session_jwt, exam: { id, title, duration_s,
                           questions: [{ id, kind, prompt, choices[], points }] },
                           server_time, expires_at }
POST /api/exam/answer    { question_id, value, client_seq }
POST /api/exam/heartbeat { elapsed_s } -> { expires_at, server_time, revoked }
POST /api/exam/events    { events: [{ seq, kind, at, detail }] }
POST /api/exam/submit    { idempotency_key } -> { receipt_id, submitted_at,
                                                  question_count }
```

All but the first authenticate with `Authorization: Bearer <session_jwt>`.
The first - the claim - authenticates as the *student* instead, with the
Better Auth session token from the sign-in below; `/api/exam/preview` stays
unauthenticated. Failures return `{"error": {"code": "..."}}` using codes from
`src-tauri/src/error.rs`.

Student sign-in uses the OAuth device flow against Better Auth on the same
origin (`/api/auth/device/code`, `/api/auth/device/token`,
`/api/auth/get-session`, `/api/auth/sign-out`). The flow lives in
`src-tauri/src/auth.rs`, holds the session token and device code in Rust under
the same rule as the exam JWT, and pins the verification address to the
compile-time `QUIZZER_WEB_ORIGIN` (default `http://localhost:3001`) before
showing it to the student.

**Rules the server must own**, because the client cannot:

- Never send correct answers in the question payload.
- Score server-side only.
- Enforce `expires_at` against the server's clock; the client's is reported but
  not trusted (a skew over two minutes is logged as `clock_tampering`).
- Make `submit` idempotent per session — a retry must replay the same receipt,
  not create a second attempt.
- Allow one active session per token.
- Record its own receipt time for every proctor event; the client `at` field is
  advisory.
- Treat a gap in event sequence numbers, or a client that stops heartbeating, as
  a signal in its own right.

---

## Development

```bash
pnpm install

# UI work: fixture backend, kiosk layer skipped so your machine isn't taken over.
pnpm --filter desktop tauri:dev:mock

# Lockdown work: fixture backend with the kiosk layer actually engaged.
# On macOS this really does disable Cmd+Tab - have a way back (see below).
pnpm --filter desktop tauri:dev:kiosk
```

Those wrap `tauri dev --features mock-api [-- -- --unlocked]`. The `--unlocked`
flag is ignored by release builds, so it cannot be used to soften a real exam.

**Getting out of a kiosk dev session**: submit the exam (lockdown releases on
submit), or kill the process from another machine / an already-open terminal —
`pkill -f target/debug/desktop`. On macOS, presentation options are restored by
the OS when the process dies, so a kill is always recoverable.

### Fixture links

Begin requires a signed-in student first. With `--features mock-api` the
device flow approves itself after a couple of polls - press "Sign in", watch
the code panel, and the fixture student arrives a few seconds later without a
browser.

With `--features mock-api`, paste `http://localhost:3000/e/<token>`:

| Token | Exercises |
|---|---|
| `mockexamtoken000000001` | A normal 45-minute exam |
| `mockexamtoken000000007` | A 2-minute exam, for testing deadline auto-submit |
| `mockexamtoken000000002` | `expired` |
| `mockexamtoken000000003` | `already_submitted` |
| `mockexamtoken000000004` | Opens in 26 hours: the waiting card, and `not_yet_open` at Begin |
| `mockexamtoken000000008` | Opens in 30 seconds, to watch the wait end and Begin turn itself on |
| `mockexamtoken000000005` | `revoked` |
| `mockexamtoken000000006` | `network_unavailable` |
| anything else | `invalid_link` |

### Building for Windows

Build on Windows. Cross-compiling from macOS gets as far as type-checking
(`cargo check --target x86_64-pc-windows-msvc`) but cannot produce a binary:
`tauri-winres` needs `llvm-rc` to embed the icon and version resource.

### Building for a real deployment

The backend origin is compiled in and links from any other origin are rejected
before a single byte is sent:

```bash
QUIZZER_API_ORIGIN=https://exams.school.edu \
QUIZZER_WEB_ORIGIN=https://quizzer.school.edu \
  pnpm --filter desktop tauri build
```

`QUIZZER_WEB_ORIGIN` is where sign-in verification happens; a device-code
response pointing anywhere else is refused before the address reaches the
student.

### Tests

```bash
cd src-tauri
cargo test --features mock-api   # full suite, incl. the IPC command layer
cargo test                       # link parsing, navigation policy, event queue
```

The command-layer tests run through Tauri's mock IPC runtime, so they cover the
real `#[tauri::command]` wiring. Two of them are invariants worth keeping green:
`the_session_credential_never_crosses_the_ipc_boundary` and
`the_manifest_never_carries_an_answer_key`.
