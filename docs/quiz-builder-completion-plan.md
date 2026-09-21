# Quiz Builder Completion Batch — Plan

> **Status: complete.** This is the tracking document for the batch; the stage
> checklist at the bottom is updated as stages land. Companion to
> [quiz-maker-engine-architecture.md](./quiz-maker-engine-architecture.md).

## Context

A scoped review of the quiz builder identified ten missing features within the authoring
surface's scope, to be implemented as one planned batch.

Confirmed scope decisions:
- New question types: **all four** — numeric, fill_in_blank, matching, ordering.
- Per-question explanation: **teacher-only** (rubric pattern; stripped at publish).

---

# Part A — Four new question types + explanationDoc

## A0. Cross-cutting decisions
- **numeric**: `correctValue: z.number().finite().optional()` (optional so drafts save
  half-built) + `tolerance: z.number().min(0)` (absolute; 0 = exact) + `unit?: string(≤20)`
  (display-only). Student answer stays a raw **string** (existing AnswerValue arm).
- **fill_in_blank**: separate `blanks: {id, acceptedAnswers: string[](≤20 each ≤200)}[](≤50)`
  + `caseSensitive: boolean`; the prompt is ordinary rich text (teachers write `___` where
  responses go), students fill numbered inputs below it. No inline ProseMirror blank nodes.
  Student answer = positional `string[]` (existing arm).
- **matching**: `pairs: {leftId, rightId, leftText(≤500), rightText(≤500)}[](≤50)` +
  `distractors: {id, text}[](≤20)` (extra right items matching nothing). Plain text both
  sides in v1 (rights render in a Select); wire shape (`manifestChoiceSchema`) leaves the
  rich upgrade open. `rightId` is minted at **authoring** time (never derivable from leftId,
  never minted at projection — project() must stay pure/byte-identical).
  Student answer = **new fourth `answerValueSchema` arm** `z.record(z.string(), z.string())`
  (leftId → rightId). Deliberate: the record arm turns `answerAsRichDoc`'s unguarded final
  `return value` into a compile error, forcing the guard.
- **ordering**: `items: {id, labelDoc}[](≤50)` **authored in correct order**; projects into
  the existing manifest `choices` field (images + desktop scanning + OptionListEditor come
  free). Student answer = `string[]` of item ids (existing arm).
- **De-correlation** (leak prevention through ordering, not key names): matching
  `right_items` and ordering `choices` are projected sorted by item id via a new
  `sortById()` in `types/logic.ts` (bytewise compare, never localeCompare, so apps/web
  preview and apps/api publish stay byte-identical). Ids are random → presented order is
  stable per version and uncorrelated with the answer.
- Rust/api/db answer paths need **zero changes**: answers cross IPC and land in jsonb as
  opaque JSON.

## A1. quiz-core (`packages/quiz-core/src`)
- `question.ts`: `explanationDoc: richDocSchema.optional()` added to `baseQuestionFields`
  (teacher-only comment); four kind schemas + `QUESTION_KINDS` entries + discriminatedUnion
  members + `createQuestion` cases (never-check enforces). Defaults: numeric
  `{tolerance: 0}` (no correctValue key); FITB `{blanks: [createBlank()], caseSensitive: false}`;
  matching `{pairs: [createMatchPair(), createMatchPair()], distractors: []}`; ordering
  `{items: [createOrderingItem() ×3]}`. New helpers beside `createOption`: `createBlank`,
  `createMatchPair` (mints leftId+rightId), `createDistractor`, `createOrderingItem`.
- New `types/numeric.ts`, `types/fill-in-blank.ts`, `types/matching.ts`, `types/ordering.ts`
  (register in `types/registry.ts`; `satisfies` enforces). Issue codes:
  - numeric: `no_correct_value` (field `correctValue`)
  - FITB: `no_blanks`; `empty_blank` (field `blanks.${i}.acceptedAnswers`)
  - matching: `too_few_pairs` (<2); `empty_pair_side` (`pairs.${i}.leftText|rightText`);
    `empty_distractor`; `duplicate_left_item`; `duplicate_right_item` (case-insensitive
    trimmed collision across pair rights AND distractors — ambiguous right column)
  - ordering: `too_few_items` (<2); `empty_item` (image satisfies emptiness via
    `richDocHasImage`); `duplicate_item`
  - Optional cleanup: shared `promptIssue(q)` helper for the now-8× `empty_prompt`.
- `manifest.ts` — `manifestQuestionSchema` additions (all optional; **no field name may
  contain substrings `correct`/`answer`/`rubric`** — Rust greps raw session JSON):
  `unit?: string`, `blank_count?: int ≥1`, `left_items?: ManifestChoice[]` (authored order),
  `right_items?: ManifestChoice[]` (pairs+distractors id-sorted, indistinguishable).
- Projections: numeric → `baseManifest(q, [])` + `unit` when non-empty; FITB →
  `blank_count = blanks.length` (positional answers; safe, manifests are immutable per
  version); matching → `left_items` authored order, `right_items` id-sorted; ordering →
  `baseManifest(q, sortById(items.map(manifestChoice)))`.
- `answer-key.ts` union additions: `{kind:"numeric", correctValue, tolerance}` ·
  `{kind:"fill_in_blank", acceptedAnswers: string[][], caseSensitive}` ·
  `{kind:"matching", correctPairs: Record<string,string>}` ·
  `{kind:"ordering", correctOrder: string[]}`. `toAnswerKey` for numeric returns null only
  when correctValue undefined (unreachable post-gate).
- `project.ts` FORBIDDEN_KEYS additions: explanation/explanationDoc/explanation_doc,
  correctValue/correct_value, tolerance, acceptedAnswers/accepted_answers,
  correctPairs/correct_pairs, correctOrder/correct_order, pairs, distractors, blanks,
  caseSensitive/case_sensitive. (Not `items` — too generic; ordering's secret is the
  *order*, covered by a projection test.)
- `manifest.ts` `answerAsRichDoc`: guard the record arm
  (`!("type" in value) || value.type !== "doc"` → `emptyRichDoc()`).

## A2. quiz-ui (`packages/quiz-ui/src/answer-controls.tsx`)
Four new `AnswerSection` cases (the switch has NO exhaustiveness check — checklist). All use
the `readOnly = answer.readOnly === true || answer.onChange === undefined` idiom + defensive
narrowing (stored answers can predate a kind switch):
- `NumericAnswer`: InputGroup, `inputMode="decimal"`, raw string in/out, `unit` suffix addon.
- `FillInBlankAnswer`: `blank_count` numbered labelled inputs; emits dense positional array.
- `MatchingAnswer`: per left item a `Select` over `right_items` (aria-label = left label);
  emits `{...rec, [leftId]: rightId}`; record narrowing = non-null object, not array,
  `type !== "doc"`; readOnly renders the chosen label as plain text.
- `OrderingAnswer`: display order = stored ids ∩ manifest choices, then unmentioned ids in
  manifest order (tolerates stale/republished sets); rows = position number + `RichText`
  label (thread `resolveImageSrc`); Move up/down buttons emit the full array; readOnly hides
  buttons. (dnd optional later; buttons are the accessible baseline.)
No debounce changes (numeric/FITB fire per keystroke — same as essay today).

## A3. web editors (`apps/web/lib/quiz/types/`)
New `numeric.tsx`, `fill-in-blank.tsx`, `matching.tsx`, `ordering.tsx` QuestionTypeDefs
(`createDefault: () => createQuestion(kind)`). Icons: `Hash`, `TextCursorInput`,
`ArrowLeftRight`, `ListOrdered`.
- numeric: Correct value / Tolerance (±) / Unit inputs (essay dashed-panel style; local
  draft + `toBound`-style commit).
- FITB: Case-sensitive checkbox; blank rows ("Blank N" + comma-separated accepted answers,
  split/trim on commit); add/remove blank; hint about `___` in the prompt.
- matching: pair rows `[left | → | right | delete]` + "Add pair" (mints both ids) +
  distractor sub-list ("Shown mixed into the right column; match nothing").
- ordering: **reuse `OptionListEditor`** via new `selection: "one" | "many" | "none"` mode
  (`"none"` hides correct-marking UI and correct-count footer); adapt items↔ChoiceOption
  (add `correct: false` in, strip it out before onChange — strictObject rejects strays).
- `registry.tsx`: entries + ICONS (compile-enforced) + **TYPE_MENU_ORDER (silent!)** —
  insert the four between multiple_choice and essay.
- `question-type-select.tsx`: `lossFor()` cases (discard N pairs / N items / blanks+responses /
  correct value+tolerance); `convert()` must carry `explanationDoc` conditionally (today it
  would silently drop it).

## A4. explanationDoc (rubric pattern ×4)
Optional base-field with teacher-only comment; `baseManifest` never reads it (add the
deliberate-omission comment); FORBIDDEN_KEYS entries (above) + `"explanation"` added to the
Rust raw-JSON grep; editor UI = collapsible "Answer explanation (teacher only)" in
`question-editor.tsx` between AnswerSection and the footer — **extract essay's rubric
collapsible into a shared `TeacherOnlyDocEditor`** (apps/web/components/quiz/) and reuse for
both. No validation.

## A5. Rust (`apps/desktop/src-tauri/src`)
- `session.rs`: `QuestionKind` += `Numeric, FillInBlank, Matching, Ordering` (before
  `#[serde(other)] Unsupported`). `Question` += `unit: Option<String>`,
  `blank_count: Option<u32>`, `left_items: Vec<Choice>` (default), `right_items: Vec<Choice>`
  (default) — struct is not deny_unknown_fields → forgetting = silent drop.
- `collect_image_ids`: also scan `left_items`/`right_items` label_docs (future-proof).
- `api/mock.rs`: `question()` helper gains the four fields (compiler catches); extend
  `fixture_exam` with one question per new kind (numeric w/ unit, FITB blank_count 2,
  matching 3 left/4 right, ordering 4 items) for `tauri:dev:mock`.
- Tests: contract test asserts all **eight** kinds; the two tests using `"matching"` as the
  fake future kind (session.rs `future_manifest`-style test + quiz-ui
  question-view.test.tsx) re-point to `"hotspot"`; leak-grep gains `explanation`,
  `tolerance`, `accepted_`.
- Regenerate `tests/fixtures/session-response.json` **last**: publish an 8-kind quiz (essay
  20/200, matching w/ distractor, formatted prompt), capture `POST /api/exam/session`,
  redact JWT.

## A6. Silent-if-forgotten checklist (each gets an explicit task/test)
1. answer-controls switch (else: "needs a newer app" notice)
2. TYPE_MENU_ORDER (else: kind unreachable in menu)
3. lossFor() (else: destructive switch without warning)
4. convert() keeping explanationDoc
5. toAnswerKey returning a real key (else: silently human-graded)
6. answerAsRichDoc record guard (compile-caught via record-arm choice — do the union first)
7. Rust Question struct fields
8. collect_image_ids for left/right items
9. FORBIDDEN_KEYS additions
10. fixture regeneration
11. "matching" → "hotspot" placeholder tests (both)
12. quiz-core `__tests__/fixtures.ts` generators (property test coverage)
13. Rust leak-grep substrings

## A7. Tests
quiz-core: every new issue code fires/clears; per-kind manifest shapes; no-leak projection of
fully-populated questions (incl. explanationDoc) — serialized manifest contains none of
correctValue/tolerance/acceptedAnswers/pairs/distractors/blanks/explanation; de-correlation
(right_items & ordering choices ≠ authored order, == id-sort; project() twice → deep-equal);
answerAsRichDoc(record) → empty doc; property-test fixtures for all 8 kinds.
quiz-ui: per-kind control tests incl. stale-value narrowing + readOnly; unknown-kind test →
"hotspot". web: TYPE_MENU_ORDER completeness test (guards #2); explanation collapsible;
lossFor/convert. api: publish 8-kind quiz → manifest fields present; raw session JSON free of
forbidden substrings; record-shaped answer accepted. Rust: 8-kind contract, fixture drift,
image-scan of right_items, extended leak-grep.

---

# Part B — Editor UX batch (nine features)

## B1. Undo/redo + delete confirmation
- New pure wrapper `apps/web/lib/quiz/history.ts` around the untouched `editorReducer`:
  `HistoryState {past, present, future, lastEditKey}`, `HISTORY_LIMIT = 100`.
  Rules: inner no-op → same HistoryState object (identity invariant preserved — past/future
  store the exact EditorState objects the inner reducer produced); selection-only change
  (doc identity unchanged) → replace present, no push, reset lastEditKey; structural change →
  push (cap 100), clear future; **coalescing** via pure `lastEditKey`
  (`setTitle`/`setDescription`/`updateQuestion:${id}` runs collapse into one entry — no
  clocks, replay-safe); `replaceDoc` → delegate then **clear both stacks** (server
  authority); undo/redo swap snapshots (undo back to the published doc restores the very
  object, so the "Publish changes" identity compare clears).
- `quiz-editor.tsx`: `useReducer(historyReducer, ...)`, `state = history.present`; header
  gets `canUndo/canRedo/onUndo/onRedo`; window keydown effect for Cmd/Ctrl+Z /
  Shift+Cmd+Z / Ctrl+Y that **skips typing targets** (extract `isTypingTarget` from
  theme-provider.tsx into `apps/web/lib/is-typing-target.ts`; Tiptap owns its own undo).
- Header: two ghost icon Buttons (`Undo2`/`Redo2`, disabled states, title shows shortcut)
  left of SaveIndicator.
- Delete confirm: `question-actions.tsx` gains AlertDialog (quiz-row-actions pattern) +
  `questionLabel` prop from question-editor ("'{label}' will be removed. You can undo with ⌘Z.").
- Tests: new `history.test.ts` (undo restores same doc object via toBe; redo round-trip;
  no-op returns same HistoryState; selection excluded but structural selection restored;
  replaceDoc clears; cap eviction; coalescing + reset). question-editor test: delete dialog
  confirm/cancel. `reducer.test.ts` untouched.

## B2. Duplicate quiz (server-side, with media copy)
- **quiz-core**: new `clone.ts` (exported): `cloneQuestion` moves here from
  `apps/web/lib/quiz/clone.ts` (web file becomes a re-export or imports update);
  `mapRichDocMediaIds(doc, map)` (rewrites image-node mediaIds in promptDoc, option
  labelDocs, AND rubricDoc/explanationDoc); `collectMediaIds(doc)`;
  `cloneQuizDoc(doc, mediaIdMap)`.
  **Integration with Part A: `cloneQuestion` must re-mint the new kinds' nested ids too —
  blank ids, pair leftId/rightId, distractor ids, ordering item ids.**
- **api** `services/quizzes.ts` `duplicateQuiz(teacherId, quizId)`:
  1) read source (owner-scoped, not archived) → 404;
  2) collect referenced mediaIds, map each to `crypto.randomUUID()`;
  3) **S3 CopyObjectCommand first** (failure = orphaned bucket garbage, never a quiz with
     404ing images — inverse of the upload path's order, comment why);
  4) one transaction: insert quiz (`"${title} (copy)"` truncated to 200 on column + doc,
     status draft, docVersion 0, draftDoc = cloneQuizDoc) + new quiz_media rows;
  5) return QuizDetail.
  Route: `POST /api/quizzes/:id/duplicate` → 201 (inside requireTeacher).
- **web**: `quizApi.duplicate(id)`; `duplicateQuizAction` (revalidate /quizzes);
  quiz-row-actions "Duplicate" item (lucide `Files`), toast + refresh, stay on dashboard.
  **Opportunistic: wire the dead `renameQuizAction`** — "Rename" item + small Dialog.
- Tests (real Postgres+Garage): id re-mint (no shared question/option ids); image copy —
  copy's doc references NEW mediaId, `GET /api/media/:newId` streams identical bytes, and
  archiving the source leaves the copy's image servable; stranger 404; title truncation;
  cloned doc passes quizDocSchema. quiz-core clone tests (media rewrite incl. labels +
  rubric/explanation; unmapped ids untouched).

## B3. Rail search
`question-rail.tsx` only; filter is view state. `entries = questions.map((question, index) =>
({question, index}))` so badges keep **original** numbering; filter on
`toPlainText(promptDoc)`; InputGroup search field (quizzes-view precedent) between header and
list; count badge `n/total` while filtering; **drag disabled while filtering** (grip becomes
inert same-width span; onReorder no-op guard); `virtualize` keys off visible length; empty
state "No questions match". Tests: hides non-matches; original numbering; grips absent while
filtering; clear restores; empty state.

## B4. Bulk-add options via multi-line paste
`option-list-editor.tsx`: fix "Add option" to route through `emit()` (currently bypasses
withSyncedAlts); parent `pasteInto(index, text)` — split `/\r?\n/`, trim, drop empties;
<2 lines → not intercepted; fills the current option only if empty (never clobbers typed
text), splices the rest after it as `createOption(line)` (correct: false); cap at 50 (schema
max) with a toast note; one `emit()`. `OptionRow` gets `onPaste?: (text) => boolean`; input's
onPaste calls it and preventDefaults on true. Toast "Added N options". Tests: 3-line paste
into empty → 3 options, one onChange; paste into non-empty preserves + appends after;
single-line untouched; cap; images preserved via withText.

## B5. Media reuse picker
- **api**: `quizMediaItemSchema`/`listQuizMediaResponseSchema` in quiz-core `media.ts`;
  `listQuizMedia(teacherId, quizId)` in services/media.ts (ownership check, createdAt desc,
  ISO timestamps); route `GET /api/quizzes/:id/media`.
- **web**: `quizApi.listMedia`; `listQuizImagesAction`; new
  `components/quiz/image-picker-dialog.tsx` + `useImagePicker(quizId, resolveImageSrc)`
  returning `{pickImage, dialog}` (promise-resolver ref; thumbnail grid via the immutable
  proxy; empty + error states). `QuestionMedia` context gains one imperative member
  `pickImage?: () => Promise<{mediaId} | null>` (NOT a list method — one dialog serves both
  call sites). question-editor instantiates the hook, renders `{dialog}`, passes
  `onPickImage` to the prompt editor; option rows get a second `Images` ghost button when
  `pickImage` exists → `withImage(doc, mediaId)`.
- **quiz-ui** `rich-text-editor.tsx`: optional `onPickImage?: () => Promise<{mediaId}|null>`
  prop; when provided (teacher surface only), one more toolbar Toggle ("Insert existing
  image") that awaits and inserts. Essay answer editor passes neither prop.
- Scope note: picker lists ONLY this quiz's media — cross-quiz reuse would 404 for students
  (exam media joins on the version's quizId); that scoping is a security property.
- Tests: api list (rows, exclusion of other quiz, stranger 404, empty). quiz-ui: toggle only
  with prop; resolve inserts node; null inserts nothing. web: dialog renders + resolves.

## B6. Description field
- Reducer: `setDescription` action mirroring setTitle (no-op guard vs `?? ""`; empty string
  drops the key so untouched docs stay byte-identical).
- UI: settings sheet gains `description`/`onDescriptionChange` props (header forwards);
  `Textarea` (exists unused in packages/ui), maxLength 2000, first field in the sheet, hint
  "Shown to students on the exam link page. Don't put answers here."
- Surfacing rides the **manifest** (versions store only manifest+key):
  `examManifestSchema.description: z.string().optional()`; `project()` sets it when
  non-blank; `previewExamResponseSchema.description?`; `previewExam` passes it through;
  landing page: `resolveLink` leftJoins the active version and pulls
  `manifest->>'description'`; `page()` renders it escaped via hono/html (update the "only
  untrusted value is the title" comment). Desktop link-entry (cheap): Rust PreviewResponse
  `description: Option<String>` (serde default) + `LinkPreview.exam.description?` + render in
  the config card. Rust ExamManifest does NOT need it.
- Tests: reducer (change/no-op/key-drop); project (set/blank-omitted/leak-pass); api preview
  carries it after publish; landing HTML contains it escaped (script-bearing description
  renders inert).

## B7. shuffleOptions toggle + real shuffle enforcement (options AND questions)
- (a) Toggle: new `shuffle-options-switch.tsx` (Switch + label "Shuffle options"); rendered
  via a new `footerExtra?: ReactNode` slot in OptionListEditor's add-option row; used by
  single-choice.tsx + multiple-choice.tsx; rides updateQuestion (no reducer change).
- (b) Manifest: `manifestQuestionSchema.shuffle_options: z.boolean().default(false)`
  (shuffle_questions precedent); `baseManifest` sets false; choice kinds override with
  `q.shuffleOptions`; true_false stays false deliberately.
- (c) Rendering (quiz-ui): new `shuffle.ts` — `hashString` (FNV-1a), `mulberry32`,
  `seededShuffle(items, seed)` (Fisher-Yates over a copy), exported. `QuestionView`/
  `AnswerSection`/`ChoiceAnswer` gain optional `shuffleSeed?: string`; ChoiceAnswer memoizes
  `seededShuffle(choices, `${seed}:${question.id}`)` when `shuffle_options`.
  **Per-mount useState-once alone is insufficient** — QuestionView remounts per navigation;
  the seed must live in the shell. Question order: preview-shell + desktop exam.tsx each
  hold a `useState`-once random seed, memoize `seededShuffle(manifest.questions, seed)` when
  `shuffle_questions`, iterate that array, pass `shuffleSeed` down. (Desktop caveat to note
  in a comment: order reshuffles on app restart; SessionSnapshot exposes no stable session
  field today — acceptable v1.)
- (d) Rust: `Question.shuffle_options: bool` (serde default) — **mandatory or the webview
  never sees the flag**; set true on one mock choice question; mirror in desktop types.ts.
- Tests: project true/false per kind; shuffle.ts determinism/completeness; question-view
  seeded order render; preview-shell shuffle_questions complete-set + stable across
  re-render; Rust snapshot round-trip of shuffle_options.

## B8. Total points in the editor header
`quiz-editor-header.tsx` only (already receives full doc):
`doc.questions.reduce((sum, q) => sum + q.points, 0)` as muted tabular-nums text after the
status badges ("N pts", shown always). No schema/reducer change.

## B9. Preview from the current question
**Id-based, not index-based** (B7 shuffles preview display order — an index would land
wrong). Header gains `selectedId: string | null` prop (from state.selectedId); Preview link
`/quizzes/${quizId}/preview?q=<id>` (encodeURIComponent). Preview page adds
`searchParams: Promise<{q?: string | string[]}>` (Next 16 Promise), normalizes, passes
`initialQuestionId` to PreviewShell, which lazily initializes
`at = questions.findIndex(x => x.id === initialQuestionId)` (≥0 else 0) against the
**display-order** array. Unknown/stale id → 0. Tests: deep-link lands on the question;
unknown id → first; works with shuffle_questions on (assert by prompt text).

---

# Integration notes (Part A ↔ Part B)

- `cloneQuestion`/`cloneQuizDoc` (B2) must re-mint Part A's nested ids (blanks, pair
  left/right ids, distractor ids, ordering item ids) and map mediaIds inside
  explanationDoc too.
- `OptionListEditor` is touched by A3 (`selection: "none"` mode), B4 (paste + emit fix) and
  B7 (`footerExtra`) — land as sequential small diffs, A3's mode first.
- `answer-controls.tsx` is touched by A2 (four controls) and B7 (shuffleSeed threading) —
  A2 first.
- B6/B7 manifest fields + A1 manifest fields land together in one quiz-core schema pass.
- The 8-kind Rust fixture regeneration (A5) happens after EVERYTHING (it captures
  description + shuffle_options too).

# Stage checklist

- [x] **Stage 0**: this document committed to `docs/`.
- [x] **Stage 1 — quiz-core schema pass**: A1 (kinds, keys, FORBIDDEN_KEYS, answer arm) +
      B6/B7 manifest fields + B2 clone.ts + B5 media contracts (+ tests).
- [x] **Stage 2 — quiz-ui**: A2 controls + B7 shuffle.ts/seed threading + B5 onPickImage
      (+ placeholder-test repoint) (+ tests).
- [x] **Stage 3 — web editor core**: B1 history/undo/delete-confirm first, then A3/A4
      editors + registry + TeacherOnlyDocEditor, then B3/B4/B6a/B7a/B8/B9 small diffs
      (+ tests).
- [x] **Stage 4 — api**: B2 duplicate + B5 media list + B6 landing/preview description
      (+ tests vs real Postgres+Garage).
- [x] **Stage 5 — Rust**: A5 struct/enum/mock + B6d PreviewResponse.description +
      B7d shuffle_options (+ tests).
- [x] **Stage 6 — fixture regeneration** (8-kind published quiz, capture, redact) + full
      verification + commits per stage.

# Verification

- `docker compose up -d && ./infra/garage/init.sh` (test prerequisites), then
  `pnpm typecheck && pnpm lint && pnpm test` (quiz-core, quiz-ui, api against real
  Postgres+Garage, web).
- `cargo test` and `cargo test --features mock-api` in apps/desktop/src-tauri.
- Live e2e: author a quiz using all 8 kinds + images (uploaded and reused via picker) +
  explanation + description + shuffles on; exercise undo/redo, delete-confirm, rail search,
  bulk paste, duplicate (verify the copy's images serve after archiving the source), total
  points, preview-from-question; publish; `POST /api/exam/session` manifest carries the new
  fields and NO forbidden substrings (`correct`, `answer`, `rubric`, `explanation`,
  `tolerance`, `accepted_`); sit the exam in `pnpm --filter desktop tauri:dev` and answer
  every kind; check `/e/<token>` shows the escaped description.
