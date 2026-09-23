# API Workbench work log

## Current state

M0–M9 are implemented and verified in Chrome by automated checks (186 checks). The M0 feasibility
mock is no longer part of the app; its transport evidence runs on ordinary Mock rules. The app version
is `1.0.0`, written only in `package.json` and injected into the bundle by the build. Saved-bookmark
installation and all Edge checks remain outstanding for every milestone. `npm run build` also writes
the public landing page `dist/index.html`.

Current assigned work: M9 (complete import support) complete and verified in Chrome. M10
(integrated release) is next.

### Milestone status

This is the only live status table. Dated entries below are historical records and are not edited
when a later milestone lands.

| Milestone | Status |
| --- | --- |
| M0 — Feasibility | CODE COMPLETE · automated gates PASS in Chrome · saved-bookmark and Edge checks NOT RUN |
| M1 — Foundation and panel | CODE COMPLETE · automated gates PASS in Chrome · saved-bookmark and Edge checks NOT RUN |
| M2 — Transport/rule core | CODE COMPLETE · automated gates PASS in Chrome · browser fixture and build checks verified |
| M3 — Endpoints, profiles and tester | CODE COMPLETE · automated gates PASS in Chrome · saved-bookmark and Edge checks NOT RUN |
| M4 — Recorder | CODE COMPLETE · review flow reworked 2026-09-23 · focused unit and Chrome browser gates PASS · saved-bookmark, Edge and durable recovery checks NOT RUN |
| M5 — Mock and chaos | CODE COMPLETE · all M5 acceptance gates PASS in Chrome · saved-bookmark and Edge checks NOT RUN |
| M6 — Intercept and routing | CODE COMPLETE · all M6 acceptance gates PASS in Chrome (70 checks) · saved-bookmark and Edge checks NOT RUN |
| M7 — Breakpoints | CODE COMPLETE · all M7 acceptance gates PASS in Chrome (88 checks) · saved-bookmark and Edge checks NOT RUN |
| M8 — Flow/Independent runs | CODE COMPLETE · all M8 acceptance gates PASS in Chrome (36 checks) · saved-bookmark and Edge checks NOT RUN |
| M9 — Complete import support | CODE COMPLETE · all M9 acceptance gates PASS in Chrome (38 checks) · saved-bookmark and Edge checks NOT RUN |
| M10 — Integrated release | NOT STARTED |

## 2026-09-23 — Home screen matched to the reference card layout

**Scope.** Home only, against `design/reference/screens/home.html` and a mockup the user supplied.
No transport, storage or rule-evaluation change.

**Changed files.**

- `src/ui/screens.ts` — `moduleCard` rewritten. Each rule module states its rule ratio and its own
  name for a hit, in the reference's wording (`MODULE_STATS`): `rules active · requests matched`
  for Mock, `· responses modified` for Intercept, `rules enabled · routed` for Route, `rules ·
  chaos hits` for Chaos. The card's single action is the module's own switch, Activate or Stop
  (`aw-dst`), once it holds a rule; a module with none keeps the earlier "Manage rules"
  ("Configure" for Chaos), since activating an empty module does nothing. Rules are still edited
  through Open. The Tester
  card carries `<plan> · <included>/<total> in plan · Last run <time>` and no badge, as the
  reference does, and its History button opens the newest run on Results. New exported
  `moduleState` is the one definition of a module's live state.
- `src/ui/shell.ts` — title-bar module indicators (`aw-tbm`/`aw-ind`), one per rule module, dotted
  green while running and amber while paused, hidden entirely for a module with no rules so a fresh
  launch keeps its brand width. Tab dots (`.aw-tt .aw-d`) mark a running module. Both read
  `moduleState`, so the three places cannot disagree.
- `src/ui/dom.ts` — `stop` icon for the Stop button.
- `src/ui/theme.css` — `.aw-card.aw-live` green outline for a running module, and the title-bar
  indicator geometry.
- `tests/ui.spec.mjs` — new check covering the stat lines, Inactive/Paused/Running, the live
  outline, the tab dot, the indicator cluster and Activate/Stop from Home.

**Decisions.**

- The Record quick action stays, making four tiles rather than the reference's three: the Record
  screen has no other entry point, and the user chose to keep it when asked.
- Route does **not** get the reference's amber "Extension required" badge. In this build Route
  rewrites fetch and XHR requests in this frame and works without an extension, so the badge would
  misstate what the module does. It reports Inactive/Paused/Running like the others.
- Run history and Activity stay below Quick actions. They sit below the fold in the mockup, and the
  run history was fixed earlier the same day.
- The Tester card's Run button still navigates to Test rather than dispatching. Starting a plan from
  Home would skip the preflight that the Load view shows before it sends real requests.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0.
- `npm run build` → exit 0. minified 237,853 B, encoded bookmark URL 342,577 characters.
- `npx playwright test` → 186 passed in 1.4 m, Chrome (channel `chrome`), macOS darwin 25.6.0. The
  pre-existing specs needed no selector changes.
- Rendered Home at 480 px and compared against the supplied mockup by screenshot.

**Not run.** Edge — not installed on this machine. Saved-bookmark installation, as before.

**Limitations.** At 480 px with a long profile name the brand still elides ("API Workben…"); the
indicators hold their width because which modules are live outranks the product name. The mockup's
"Last run 10:02:02 AM" uses the browser's locale time, so its format follows the host machine.

**Next task.** M10 (integrated release), unchanged.

## 2026-09-23 — Home run history lists plan runs, not only Once results

**Reported.** Home kept saying "No runs yet. Run an endpoint from Test." after a plan run finished,
while the Activity card on the same screen reported `Run completed: 11 passed of 11 requests`.

**Cause.** Home's `runHistory` watched `state.testerHistory`, which only ever holds direct Once
results. A plan run is published to `state.runs` (`entry.ts:159`), which Home never read.

**Changed files.**

- `src/ui/screens.ts` — `runHistory` renders `state.runs` above `state.testerHistory` and invalidates
  on either, so both kinds of run appear. Empty text is now "No runs yet. Run an endpoint or a plan
  from Test."
- `src/ui/test-screens.ts` — the two row builders behind `planRunHistory` and `onceHistory` are
  extracted and exported as `runRow` and `onceRow`, so Home reuses them instead of a third copy of
  the same markup. `runRow`'s Open now also calls `ctx.go("results")`: setting `openRun` without
  navigating left the reader on the screen they clicked from, since Results is the only screen that
  renders a run. That fixes the Load-run-history disclosure on Test as well.
- `tests/m8.spec.mjs` — new check: run a plan, return Home, expect the run listed as
  `Fixture Plan · flow` with `2/2` and no "No runs yet", then Open lands on Results showing the run.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0.
- `npm run build` → exit 0.
- `npx playwright test` → 185 passed in 1.4 m, Chrome (channel `chrome`), macOS darwin 25.6.0.

**Not run.** Edge — not installed on this machine. Saved-bookmark installation, as before.

**Limitations.** The two lists are concatenated, plan runs first, rather than interleaved by time:
`OnceResult` carries no timestamp, only `RunState.startedAt`. Ordering within each group is newest
first, as before.

**Next task.** M10 (integrated release), unchanged.

## 2026-09-23 — Endpoint count on the Home quick action

**Scope.** The Endpoints quick action only, following `design/reference/screens/home.html`, which
carries `<span class="aw-bd aw-s">1 endpoint</span>` inside that tile. No other screen changed.

**Changed files.**

- `src/ui/screens.ts` — `quickAction` appends a count badge for `endpoints`, fed by `ctx.watch`, so
  saving, deleting or importing an endpoint and switching profile all update it without leaving
  Home. Singular at one.
- `src/ui/theme.css` — `.aw-qa .aw-bd { height: 18px }`, the rule the reference applies inline, so
  the tile keeps its 84 px height.
- `tests/m1.spec.mjs`, `tests/m3.spec.mjs`, `tests/m9.spec.mjs`, `tests/ui.spec.mjs` — the badge is
  inside the button, so the tile's accessible name is now `Endpoints 3 endpoints`. The five
  selectors that clicked it by exact name match the label prefix instead. Two new assertions cover
  the badge: `0 endpoints` on a fresh profile (m1) and `1 endpoint` after the first save (m3).

**Decision.** The count stays inside the button rather than being hidden from assistive technology
with `aria-hidden`. It is information, not decoration, and a screen reader now announces
"Endpoints 3 endpoints, button". The cost is that the tile can no longer be located by an exact
accessible name.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0.
- `npm run build` → exit 0.
- `npx playwright test` → 184 passed in 1.4 m, Chrome (channel `chrome`), macOS darwin 25.6.0.

**Not run.** Edge — not installed on this machine. Saved-bookmark installation, as before.

**Limitations.** Pre-existing and unrelated: `tests/plans.spec.mjs:23` fails when that spec is run on
its own and passes in the full suite. Verified against `b4cd1bb` with these changes stashed, so it is
an ordering dependency in that spec, not a regression from this work.

**Next task.** M10 (integrated release), unchanged.

## 2026-09-23 — Resize from every edge and corner

**Scope.** Panel resizing only. No feature, transport or storage change.

**Changed files.**

- `src/ui/theme.css` — dropped `resize: both` from `.aw-root` (and the now-redundant `resize: none`
  on `.aw-min`), made the panel a positioning context, and added the `.aw-rs-*` grip geometry: 6 px
  edge strips, 16 px corners, corner cursors, and a diagonal-ridge background on the bottom-right
  corner as the visible affordance the native grip used to provide.
- `src/ui/shell.ts` — eight pointer-driven grips appended to the panel. Each records the panel box,
  the host position and the resolved min/max from computed style on `pointerdown`, then applies the
  clamped size on `pointermove`. A west or north grip also moves the host by `startSize - newSize`,
  so the opposite edge stays pinned. The per-drag max is additionally capped by the distance to the
  viewport edge the drag grows toward, so a grip cannot push the panel off-screen and have `place()`
  slide it back under the pointer.
- `tests/m1.spec.mjs` — the resize test now drags each of the eight grips and asserts the size and
  position deltas, plus the pinning behavior at the viewport limit, instead of asserting
  `resize: both`.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0.
- `npm run build` → exit 0. raw 412,805 B, minified 235,645 B, encoded bookmark URL 339,413 characters.
- `npx playwright test` → 184 passed in 1.4 m, Chrome (channel `chrome`), macOS darwin 25.6.0.

**Not run.** Edge — not installed on this machine. Saved-bookmark installation, as before. Touch and
keyboard resizing are untested because neither is implemented.

**Limitations.** Pointer only: there is no keyboard path to resize, which the native grip did not
provide either (`ponytail:` note kept in `theme.css`). The top 6 px of the title bar now resizes
rather than drags. Size is not persisted across launches, unchanged from before.

**Next task.** M10 (integrated release), unchanged.

## 2026-09-23 — Saved test plans (post-M9 change)

**Scope.** `Test.html`'s plan row promised what profiles already have: a plan picker, a rename
control and a save control. Only the rename existed. This adds stored plans.

**Changed files.** `src/core/model.ts` (`WorkbenchConfig.savedPlans`), `src/entry.ts`
(`savePlanAs`, `selectPlan`, and `activate` now carries `savedPlans`), `src/import/commit.ts`
(a native replace carries `savedPlans`), `src/ui/screens.ts` and `src/ui/shell.ts` (plumbing),
`src/ui/test-screens.ts` (picker + rename + save row), `src/ui/dom.ts` (`save` icon geometry from
the reference markup), `tests/plans.spec.mjs` (new), `tests/m1.spec.mjs` (the Test tab now shows
the picker, not a visible name field).

**Behavior.** `config.plan` stays the live plan; `config.savedPlans` holds stored plans, each
carrying the `profileId` that owns it, so the picker lists only the active profile's. Save stores a
copy of the live plan under a name uniquified by `suggestProfileName`, like Save-as for profiles.
Selecting a stored plan makes it live and stores the plan being left as it stands — updated in
place, or appended when it had never been saved — so switching is never a silent loss of edits.
Stored plans survive a profile switch and a native import replace; `exportConfig` still exports the
live plan only.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0.
- `npm run build` → exit 0.
- `npx playwright test tests/plans.spec.mjs` → 2 passed in 2.4 s.
- `npx playwright test` → 184 passed in 1.4 min, Chromium via Playwright 1.63.0, macOS darwin
  25.6.0.

**Not run.** Saved-bookmark installation and all Edge checks, as before. No manual browser pass on
this change beyond the automated specs.

**Limitations.** No delete-plan control: the reference plan row has none, so the picker only grows;
a stored plan is removable only by deleting its profile. Stored plans are not exported or imported.
Plans stored against a profile that is later replaced by a native import stay in storage, unlisted.

**Next task.** The outstanding manual gates (saved bookmark in Chrome and Edge), unchanged by this
work.

## 2026-09-23 — Results screen laid out as `Results.html`

**Reported.** The Results screen did not match `design/reference/screens/Results.html`.

**Change.** The header is the reference's: a bolt-marked `Results: <plan>`, the run-state badge, a
`Flow · 10×1` badge, the progress bar (now an ARIA `progressbar`) and a centred `10 / 10 iterations`
line. The four tiles are coloured as in the reference — Passed green, Failed red (renamed from "Not
passed"), P95 amber when there is a sample — with the `ms` unit in the reference's smaller muted
type. The per-endpoint breakdown is a real `<table>` with the reference's fixed column widths, a
sticky-looking header row, truncating endpoint cells, a wrench marker on setup-phase rows, green
pass / red fail counts and an amber `…ms` P95. `wrench` was added to the icon set for that marker.

**Not changed.** The outcome-breakdown card has no counterpart in the reference but stays, moved
below the table: it carries the run's errors, warnings and the latency-sample caveat. The footer
keeps JSON, CSV, Stop and Run again — Back is already the panel's sub-header control, and the
reference's run-history icon has no destination now that history lives on the Test screen.

**Tests changed with the UI.** `tests/m8.spec.mjs` — the progress line reads `N of M requests`
(was `N of M planned requests`).

**Commands run.** `npm run build` (exit 0, minified 231,894 B, encoded bookmark 333,846 chars),
`npx playwright test` — 182 checks PASS in Chrome 153.0.8010.53, macOS darwin 25.6.0, Node v24.21.0.

**Not run.** Saved-bookmark installation and every Edge check. No visual-regression harness: the
comparison was a screenshot of the rendered panel against the reference HTML.

**Next task.** M10 (integrated release).

## 2026-09-23 — Test screen laid out as `Test.html`

**Reported.** The Test screen did not match `design/reference/screens/Test.html`.

**Change.** The Load view now follows the reference layout: the plan row (status dot + editable plan
name) above a left-aligned Once/Load segment, no in-body `API Tester` title and no duplicate
Endpoints button (Home already reaches Endpoints), Base URLs as the reference's one-line collapsible
with the resolved environment and `(auto)`, and a Load config card of fixed-width label rows —
Strategy, Iterations, Concurrency, `Batch delay` + `ms` (110 px inputs), a separator, and Ramp-up as
the theme's `.aw-sw` switch with its hint. `Tester mode` moved into that card as **Mode**, beside
**On failure**. `Notify on complete` uses the reference tick-box, and the footer reads
`N selected · 10×1`. The panels the reference does not show — Page context, Expression reference and
Load run history — are collapsed disclosures; the preflight card stays visible because it is what
disables **Run Load**.

**Not changed.** Step rows keep the working **To setup**/**To load** control instead of the
reference's `modified` badge and chevron: there is no modified-since-capture state in the model, and
the chevron's endpoint editor is reached from Endpoints. The plan row has no rename/save icon pair,
because v1 stores one plan per profile — the name is edited in place instead. Both need model work,
not layout work.

**Tests changed with the UI.** `tests/m1.spec.mjs` (Test has no in-body title; it asserts the plan
name field instead), `tests/m8.spec.mjs` (footer copy, and the scan test opens the Page context
disclosure first).

**Commands run.** `npm run build` (exit 0, minified 230,094 B, encoded bookmark 331,232 chars),
`npx playwright test` — 182 checks PASS in Chrome 153.0.8010.53, macOS darwin 25.6.0, Node v24.21.0.
An earlier run of the same suite showed three unrelated flakes (`m7` pause deadline, two `m8`
hit-counter checks) that pass on rerun; they are timing-sensitive, not layout-dependent.

**Not run.** Saved-bookmark installation and every Edge check, as for all milestones. No visual
regression harness exists: the comparison was a screenshot of the rendered panel against the
reference HTML.

**Next task.** M10 (integrated release).

## 2026-09-23 — Rule editors: the label follows the linked endpoint

**Reported.** In the mock rule editor, changing **Endpoint** re-synced Method and URL but left the
Label showing the previous endpoint's name.

**Cause.** `endpointPicker` — shared by the mock, chaos and intercept editors — copied the matcher
on pick and nothing else. The label was only ever derived at creation, in each screen's `create()`.

**Change.** The picker now also re-derives the label, in one place for all three editors. A label
the user typed is never overwritten: it moves only when it is empty, still the untouched default
(`New … rule`), equal to the previous endpoint's derived label, or a chaos preset's
`<preset> · <endpoint>` suffix, in which case only the suffix moves.

**Commands run.** `npx tsc --noEmit` (clean), `npm run build`, `npx playwright test` — 182 checks
PASS in Chrome 153.0.8010.53 (one new check in `tests/m5.spec.mjs` covering both the derived and the
hand-written label).

## 2026-09-23 — Import: a contradictory Format override says so

**Reported.** A real OpenAPI 3.1 document (70 paths) was rejected on the Import screen with what
read as "invalid Workbench JSON".

**Cause, reproduced.** Auto-detection reads that document correctly — `Detected: OpenAPI 3.0`,
88 candidates, 0 skipped. The rejection only appears when the **Format** control is set to
`Native schema 1`: the override forces the native reader, which answers "Not a Workbench export: it
needs a profile object and an endpoints array." The message describes the document the reader was
told to expect, so it reads as a broken file rather than a wrong setting.

**Change.** `parseSource` now wraps the read: when an override is in force and the read fails, it
re-detects and, if the source looks like a different format, appends "Format is set to X, but this
source looks like Y. Choose Detect automatically or Y." to the adapter's own message. This covers
every override/format pair, not the one that was reported. The adapters are untouched — an override
still reads with exactly the adapter it names.

**Commands run.** `npx tsc --noEmit` (clean), `npm run build`, `npx playwright test` — 181 checks
PASS in Chrome 153.0.8010.53 (one new check in `tests/m9-core.spec.mjs`).

**Not changed.** OpenAPI 3.1 is still read by the 3.0 reader and reported as such; nothing in the
detection or adapter contract moved.

## 2026-09-23 — Home: the M0 feasibility mock is removed; its evidence now runs on real mock rules

**Decision.** The "Fixture mock · developer controls" card on Home was the M0 transport smoke test,
not a product feature: one hardcoded exact matcher for `GET /api/mock-target` with an empty query,
wired straight to session state instead of a profile rule. The Mock module superseded it in M5, so
the card, its state and the whole legacy rule layer behind it are gone. The activity readout that
shared that card is product surface — it is the only place an opaque cross-origin failure is
explained — so it survives as its own "Activity" card on Home.

**Removed.**
- `src/ui/screens.ts` — `feasibility()`, the `mockEnabled`/`mockDelay` UI state and the `setMock`/
  `setDelay` context members; added `activityLog()` in their place.
- `src/ui/shell.ts` — the `Fixture mock` launcher label and the two forwarded callbacks.
- `src/entry.ts` — the mock toggle/delay handlers and their initial state.
- `src/network/pipeline.ts` — `settings`, the `PipelineRule` list, `addRule`, `clearRules`,
  `decide`, `resolveRule`, `matchLegacyCondition`, `legacyPlan`, `mockBody`, the `PipelineDecision`
  type and the `decision` field threaded through `TraceEvent`, `beginRequest` and the fetch adapter.
  Every request now takes the one plan the rule engine produces.

**Evidence kept, not weakened.** `tests/m0.spec.mjs` still proves the same transport properties, but
its `mock()` helper now authors a real mock rule through the Mock screen and activates the module,
so M0's fetch/XHR/abort/timeout/close evidence runs against shipping code instead of a test-only
matcher. Two assertions changed with the matcher: the panel-visible checks no longer look for the
feasibility checkbox, and the pass-through case uses `/api/not-mocked` because a real rule matches on
pathname and would also serve `/api/mock-target?unmatched=1`. `tests/m2-core.spec.mjs` lost its two
legacy-resolver tests; the engine equivalents (glob, query, headers, method, disabled, priority) are
already covered in `tests/m5-core.spec.mjs`. `tests/m1.spec.mjs` asserts the launcher reports
`Mock active` instead of `Fixture mock active`.

**Commands run.** `npx tsc --noEmit` (clean), `npm run build`, `npx playwright test`.

**Result.** 180 checks PASS in Chrome 153.0.8010.53. Encoded bookmarklet URL 328,418 characters.

**Not run.** Saved-bookmark installation and Edge, unchanged from every earlier milestone.

**Next task.** M10 — integrated release.

## 2026-09-23 — App version: plain semver 1.0.0, single-sourced from package.json

**Scope.** The app version was `0.1.0-m9`, a milestone tag, and it was written twice. It is now
`1.0.0` and lives in one place.

**Changed files.**

- `package.json` — `0.1.0-m9` → `1.0.0`, set by the user.
- `src/entry.ts` — the hardcoded literal is replaced by `__AW_VERSION__`, the value the build
  injects. Its only runtime use is the double-launch check, which is unchanged.
- `src/assets.d.ts` — declares `__AW_VERSION__` so `tsc` typechecks the entry point.
- `scripts/build.mjs` — reads `package.json` once, asserts the version is a plain semver
  (`/^\d+\.\d+\.\d+$/`, so a `-m*` tag fails the build), and passes it to esbuild as a `define`
  as well as to the landing page. The duplicate read further down is gone.
- `scripts/showcase.mjs`, `tests/showcase.spec.mjs` — the landing page's format-table column is
  now "Spec version read", and the note says those are the Swagger/OpenAPI/HAR/Postman spec
  versions, not API Workbench's version. A reader had compared the app's `0.9.0` against the
  table's `2.0`/`3.0` as if they were the same scale.

**Commands and outcomes.**

- `npx tsc --noEmit` → clean.
- `npm run build` → PASS (minified 231412 bytes, encoded URL 333040); `dist/api-workbench.min.js`
  and `dist/index.html` both carry `1.0.0`.
- `npx playwright test` → 180 passed (1.4m); `npx playwright test tests/showcase.spec.mjs` → 2
  passed after the column rename.

**Not run.** Edge and saved-bookmark checks, as in every prior entry.

**Limitations.** `1.0.0` was chosen by the user. It is a version string, not evidence of a release:
M10 (integrated release) is still outstanding, and saved-bookmark installation and every Edge check
remain unrun, so the landing page's "Pre-release" note still stands. The double-launch alert
compares versions between two bundles, so an old saved bookmark still reports `0.1.0-m9` against
this one — which is what that check is for.

**Next task.** M10 — integrated release.

## 2026-09-23 — Import screen: reported versions name the reader, not the document

**Scope.** Text only. The import screen must never display a version the build does not actually
read. Detection previously echoed the version the document declared, so a HAR 1.3 log, an
OpenAPI 3.1 document or a native export declaring schema 2 was announced as
"Detected: HAR 1.3" / "OpenAPI 3.1.0" — a support claim for a version no adapter implements.

**Changed files.**

- `src/import/detect.ts` — `detect()` now reports the reader's version (`3.0`, `1.2`, `schema 1`,
  `Collection v2.1`) in `Detection.version`, and names the declared version in `reason` only, as
  "read with the … reader". The native row of `FORMATS` derives its version from
  `SCHEMA_VERSION` instead of a hardcoded `schema 1`.
- `tests/m9-core.spec.mjs` — new assertion that a 3.1 document, a HAR 1.3 log and a schema 2
  native export each report the reader version with the declared version in the reason.
- `tests/m9.spec.mjs` — the status-line assertion for an `openapi: 3.0.0` document now expects
  `OpenAPI 3.0 read` (the reader), not `OpenAPI 3.0.0 read` (the document).
- `scripts/showcase.mjs` — the landing page's format table header reads "Version read", and a note
  under it states that a document declaring a newer version is read with the reader listed there or
  refused, and that YAML, remote `$ref` and schema execution are not supported at all. The table
  rows themselves were already generated from `FORMATS`, so the native row follows
  `SCHEMA_VERSION` with no separate edit.
- `tests/showcase.spec.mjs` — asserts the "Version read" header and the newer-version note, so the
  landing page cannot drift back into advertising a version no adapter implements.

`Detection.version` is display-only; no adapter selection, parsing or rejection behavior changed.
`parseNative` still refuses a newer schema, and `parseHar` still records its own
"read with the 1.2 reader" diagnostic.

**Commands and outcomes.**

- `npx tsc --noEmit` → clean.
- `npm run build` → PASS (minified 231415 bytes, encoded URL 333043).
- `npx playwright test tests/m9-core.spec.mjs tests/m9.spec.mjs` → 39 passed.
- `npx playwright test tests/showcase.spec.mjs` → 2 passed.
- `npx playwright test` → 180 passed (1.4m), Chromium via Playwright 1.63.0. Re-run after the
  landing-page change → 180 passed (1.4m).

A leftover `node tests/fixtures/server.mjs` from an earlier run held 4173/4174 and made Playwright's
own `webServer` fail to start; the config has no `reuseExistingServer`, so the stale process was
stopped rather than the config changed.

**Not run.** Edge (not installed) and saved-bookmark checks, as in every prior entry.

**Limitations.** Nothing new is supported: an OpenAPI 3.1 document is still read by the 3.0 reader,
so 3.1-only constructs (type arrays for nullability, `webhooks`, `$ref` siblings) are ignored
rather than reported per-field. Adding a real 3.1 reader or YAML input remains unimplemented.

**Next task.** M10 — integrated release.

## 2026-09-23 — Public showcase page in the build

**Scope.** `npm run build` now also writes `dist/index.html`: a hostable landing page describing the
tool with a drag-to-install button carrying the real bookmarklet.

**Changed files.**

- `scripts/showcase.mjs` — the page: hero with the draggable install button and a clipboard
  fallback, an inline-SVG panel mockup and an inline-SVG bookmarks-bar drag illustration, the six
  module cards, the three install steps, the import-format table, the "nothing leaves your browser"
  facts and a pre-release/limitations footer.
- `scripts/build.mjs` — writes `dist/index.html`, records `landingPageBytes` in `dist/sizes.json`,
  and asserts the page references no external asset (`<img>`, `<link>`, `<iframe>`, `<script src>`,
  `@import`, CSS `url(…)`, any `http(s)` target) and still carries the `javascript:` install link.
  The format table is generated from the `FORMATS` registry in `src/import/detect.ts` — compiled
  with esbuild and imported — so the page cannot advertise a format that has no adapter.
- `tests/showcase.spec.mjs` — 2 checks.
- `docs/API_WORKBENCH_BUILD_PLAN.md` — `index.html` added to the required release artifacts.

**Commands and outcomes.**

- `npm run build` → exit 0. Landing page 354,963 B (the bookmark URL is 332,551 of them).
- `npx playwright test tests/showcase.spec.mjs` → 2 passed, Chrome 153.0.8010.53.

**Verification (measured).** Loading the page from `file://` issues exactly one request — the
document itself — so nothing is fetched to render it; the install link's `href` is byte-identical to
`dist/bookmarklet.txt`; the format table has exactly the seven pasteable adapters; and running the
link's decoded source on the fixture page opens the panel.

**Not run.** Dragging the button to a real bookmarks bar, and any hosted deployment. The second
check runs the generated link's source in the page, which is not evidence about saved-bookmark
installation.

**Decisions.** Illustrations are inline SVG rather than screenshots: a binary asset beside the page
would break the single-file property the product is distributed with. The page states the
pre-release status, the Chrome-only verification and the top-frame-only interception scope rather
than implying a finished release.

## 2026-09-23 — M9: complete import support

**Scope.** M9 only: every format listed in `Import.html` with a working adapter, content detection,
the shared normalize → review → commit pipeline, conflict handling and a transactional commit.

**Changed files.**

- `src/import/candidate.ts` — the normalized candidate model every adapter produces: method and URL
  validation, host key and base URL extraction without `new URL()` (so an unresolved `{{var}}`
  survives), alias generation with collision resolution, unresolved-template collection, sensitive
  field marking, and removal of browser-controlled headers into diagnostics.
- `src/import/detect.ts` — content detection and the one list of supported formats and exact
  versions the UI renders. A JSON document with no discriminator is reported, not guessed.
- `src/import/openapi.ts` — Swagger 2.0 and OpenAPI 3.0: servers/schemes/basePath, path, query,
  header, body and formData parameters, request-body examples per media type, 2xx response
  examples, local `$ref` with depth and cycle limits, security requirements as hints.
- `src/import/har.ts` — HAR 1.2: headers, query, postData (text and params), base64 and absent
  response content, timings as metadata. Distinct bodies stay distinct candidates.
- `src/import/postman.ts` — Postman v2.1: nested folders, disabled entries, collection variables,
  raw/urlencoded/formdata/graphql bodies, bearer/basic/API-key auth inheritance, script reporting.
- `src/import/curl.ts` — a shell-free tokenizer (bash and cmd quoting, `\` and `^` continuations,
  `'\''` escapes) and the DevTools flag set; unsupported flags, `@file` references and shell
  substitutions are reported with their character position.
- `src/import/fetch-snippet.ts` — a string-literal scanner plus `JSON.parse` over the balanced
  options object. Code-dependent snippets are refused with a position; nothing is evaluated.
- `src/import/native.ts` — schema validation, migration, rejection of a newer schema, and
  `remap()` for import-as-copy (endpoint ids, rule `endpointId`, plan phases and exclusions).
- `src/import/commit.ts` — conflict matching on request identity, linked rules/plan reporting,
  `applyCandidates` and `applyNative` (new stored profile / merge / replace) as pure functions.
- `src/import/parse.ts` — the one pipeline entry point plus the recorder source, and the 10 MiB
  source limit.
- `src/ui/import-screen.ts` — the rewritten screen: draft that survives Back/Minimize, detection
  line and format override, Choose file with replace-draft confirmation and size guard, Apply with
  a yield and Cancel, the review (counts, destination profile, diagnostics, per-candidate selection,
  editable name, media-type choice, conflict resolution, unresolved and sensitive badges), the
  inline recorder with elapsed time, Clear draft, Export draft and the supported-format list.
- `src/ui/screens.ts` — `importScreen` moved out; `Ctx.importConfig` replaced by
  `Ctx.commitImport`; the Endpoints screen shows the post-commit summary once.
- `src/ui/shell.ts`, `src/entry.ts` — `commitImport` wiring: one durable write, rollback on
  failure, rule engine reset only when the import replaced the live profile.
- `src/core/storage.ts` — `saveConfig(config, durable)`; the dead `importConfig` helper removed.
- `tests/m9-core.spec.mjs` (25 checks), `tests/m9.spec.mjs` (13 checks); `tests/m3|m5|m6|m7|m8|ui`
  install helpers updated to the Apply → review → Import flow.
- `docs/M9_IMPORT.md` — supported formats, accepted cURL/fetch dialects, bounds, conflict rules and
  what is reported rather than translated.
- `package.json`, `src/entry.ts` — version `0.1.0-m9`.

**Commands and outcomes.**

- `npm run build` → exit 0. raw 405,707 B, minified 231,046 B, encoded bookmark URL 332,512
  characters (the 1 MiB size probe still builds).
- `npx playwright test` → **177 passed** in 1.3 min, Chrome 153.0.8010.53, macOS darwin 25.6.0,
  Node v24.21.0. 38 of those are M9 (25 core + 13 browser).

**Verification (measured).** Detection per format and refusal of an undiscriminated JSON document;
OpenAPI/Swagger parameters, `$ref`, examples, operation-id collisions and unresolved path
parameters; HAR distinct bodies, base64 samples, omitted bodies, restricted headers and skipped
entries; Postman folders, inheritance, disabled entries, variables and script reporting;
cURL quoting/escapes/Unicode/continuations, flag positions, `@file` and `$(…)` left literal;
fetch() escapes and refusal of code-dependent snippets with `window.__m9` never set; file and paste
equivalence; oversized and cancelled files leaving the draft intact; replace-draft confirmation;
Keep both / Replace / Skip with the replaced endpoint keeping its id; native new-profile import that
does not activate, merge that skips duplicates, replace, and refusal of schema 99; draft survival
across Back and Minimize; a profile switch blocking the commit until Apply rebuilds the preview;
recorder start/stop promoting only the selected calls; a failed durable write reporting failure,
saving nothing and keeping the review (IndexedDB `put` patched to throw); server hit counters
unchanged across every import, so no imported request is sent while importing.

**Not run.** Saved-bookmark installation and restart persistence; all Edge checks (Edge is not
installed on this machine); YAML OpenAPI, remote `$ref` and Postman environment files (out of scope
by the plan, reported by the adapters as unsupported).

**Limitations.** Multipart bodies are imported as distinguishable text fields, never rebuilt as
multipart; files referenced by cURL, Postman or HAR are never read. The endpoint editor still has no
credentials control, so an imported `credentials: include` is shown in the review and persisted but
can only be changed by re-importing. Background parsing yields once before the parse rather than
chunking inside it; sources are bounded to 10 MiB and the per-format item limits in
`docs/M9_IMPORT.md`.

**Decisions.** Recorded in `docs/M9_IMPORT.md`: one detection/normalize/commit pipeline for every
format including the recorder; candidate identity per adapter (operation path+method, HAR
method+URL+body, Postman folder path) with alias collisions resolved in the preview; conflicts
matched on request identity, never on a display name; Replace preserves the existing endpoint id so
rules and plan references survive; a native new-profile import is stored without being activated
(§8.11) while Replace is the only mode that discards records; commits use a durable write so a
failure can roll back and keep the draft.

**Next task.** M10 — integrated release: cross-module behaviour, the release build and the
outstanding saved-bookmark and Edge verification listed above.

## 2026-09-23 — Mock rule defaults: enabled, indented sample body, short label, label-only hover

**Scope.** Four follow-ups on the user's reports about adding a mock rule. A new rule opened
disabled, "Use recorded response" pasted the recorded body exactly as the server minified it, the
label read `Mock GET /api/v1/table_data/MEMBERSHIP_TYPE`, and hovering a rule row underlined the
whole button, meta line included.

**Changed files.**

- `src/core/model.ts` — `defaultMockRule` sets `enabled: true`. A rule is added to be served, and
  the module's own Activate control is still the gate, so nothing intercepts traffic on its own.
  New `labelFromEndpoint(endpoint)` returns a renamed endpoint's name as is, and shortens one that
  still carries the recorded `METHOD /path` to its last path segment; a trailing numeric id keeps
  its collection (`users/42`) rather than reading as `42`. Chaos, intercept and route rules keep
  `enabled: false` — only the mock default was reported.
- `src/ui/dom.ts` — `prettyJson` is exported. It already backed the Format JSON control; the
  sample copy reuses it instead of a second `JSON.parse`/`stringify` pair.
- `src/ui/rule-screens.ts` — "Use recorded response" writes `prettyJson(recorded.body) ?? body`,
  so a JSON sample lands indented and a non-JSON one is untouched. The three endpoint-derived
  labels call `labelFromEndpoint`: mock and intercept drop their kind prefix, since the screen and
  section already name the module, and chaos keeps its preset name (`Slow API · MEMBERSHIP_TYPE`).
- `src/ui/theme.css` — a rule row's button holds a label and a meta line, and a `text-decoration`
  on the button propagates into both. `.aw-endpoint-name:has(.aw-endpoint-meta)` drops the
  button's own underline on hover and underlines the label child instead. The single-line
  endpoint-name buttons on Record and Endpoints have no meta line and are unchanged.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0.
- `npm run build` → exit 0. raw 329,519 B, minified 189,089 B, encoded bookmark URL 270,411
  characters.
- `npx playwright test` → 139 passed in 1.2 min, Chrome, macOS darwin 25.6.0, Playwright 1.63.0,
  Node v24.21.0.
- Each fix was confirmed to fail before it: with the default and the pretty-print reverted, the new
  UI test reported `unexpected value "unchecked"`; with the CSS reverted, the hover test read
  `underline` on the button itself.

**Checks added.** `tests/m5.spec.mjs` — one test records `/api/m5-from-endpoint`, creates a profile
and adds a rule from that endpoint, then asserts the rule is enabled, the label reads
`m5-from-endpoint` and the pasted body is indented; a second hovers a rule row and asserts the
computed `text-decoration-line` is `none` on the button, `underline` on the label and `none` on the
meta line. `tests/m5-core.spec.mjs` — `labelFromEndpoint` over a recorded name, a recorded name
whose path carries a query, a renamed endpoint and a trailing id.

**Not run.** No Edge check; `:has()` is a Chromium feature shared with Edge, but that is reasoning,
not measurement. No saved-bookmark check.

**Limitations.** The label is derived only when a rule is created from an endpoint; existing rules
keep the labels they were saved with. `labelFromEndpoint` compares the endpoint's name against the
recorded `METHOD /path` form to decide whether it was renamed, so a user who types that exact
string by hand gets the shortened label.

**Next task.** M9 — complete import support, unchanged by this entry.

## 2026-09-23 — M8 Flow and Independent repeat runs

**Scope.** The assigned milestone: the expression grammar and its built-ins, a restricted `$eval`
parser, page-context discovery, the dependency DAG and preflight, Flow and Independent scheduling
with concurrency, ramp-up, delay and cancellation, and the Results screen with latency statistics
and JSON/CSV export.

**Changed files.** New: `src/tester/expressions.ts`, `src/tester/plan.ts`, `src/tester/run.ts`,
`src/tester/results.ts`, `src/tester/context.ts`, `src/ui/test-screens.ts`, `tests/m8-core.spec.mjs`,
`tests/m8.spec.mjs`. Modified: `src/core/model.ts` (the `TestPlan` entity and its bounds),
`src/core/storage.ts` (the plan travels with a profile export), `src/entry.ts` (run lifecycle,
plan persistence, export), `src/tester/once.ts` (rebuilt on the expression engine; `executeOnce`
kept), `src/ui/dom.ts` (the five form primitives moved here from `rule-screens.ts`, plus
`downloadFile`), `src/ui/rule-screens.ts`, `src/ui/screens.ts`, `src/ui/shell.ts`,
`tests/fixtures/page.html` (a `csrf-token` meta tag, so `$meta` can be checked end to end),
`package.json`.

### Behavior

**Expressions.** `{{alias.path}}` reads a producer's response through a bounded own-property path
(`items[0].id` and `items.0.id` are the same path); `__proto__`, `prototype` and `constructor` are
rejected as segments and no getter is invoked. The built-ins from the photographs are all
implemented: `$uuid`, `$timestamp`, `$counter`, `$randomInt`, `$cookie`, `$dom`, `$eval`,
`$localStorage`, `$sessionStorage`, `$meta`, `$context`. Generated values are reserved once per
prepared request, so the same expression twice inside one request is one value; counters are
run-scoped and reserved in scheduler order, and a manual Run Once uses a separate transient session
scope. Values are escaped by where they land — URL component, header (CR/LF stripped), JSON string
content or raw text — and an expression occupying a whole JSON value keeps the producer's type, so
`"id": "{{u.id}}"` sends the number.

**`$eval`.** A hand-written tokenizer and Pratt parser over literals, arithmetic, comparison,
boolean operators, a conditional and bounded binding paths. Statements, assignment, arrow
functions, calls, `window`/`document` and unknown identifiers are refused before any value is
produced. It is not implemented with `eval` or `new Function`; the build's assertion against both
still passes.

**Context discovery.** Scan page lists readable cookies, local and session storage, meta tags, named
form fields and — only under explicitly typed roots — page globals, walking own data-property
descriptors to depth 2 with a 40-entry cap per source. Previews are masked (`sup…e (18 chars)`), a
password field's characters are never previewed, nothing is polled or exported, and a saved binding
is resolved again at dispatch.

**Plan and preflight.** A plan holds phase placement per endpoint, an exclusion list, strategy,
iterations, concurrency, delay, ramp-up, failure policy, tester mode and its bindings, and is stored
with the profile. The preflight builds the reference DAG and refuses to dispatch anything when it
finds a cycle, a missing producer, a setup step reading a load-phase result, a duplicate alias, or —
for Independent — a load step reading another load step; that last error names both remedies (switch
to Flow, or promote the producer to setup). Before dispatch the screen states the planned request
count, the destination origins, the tester mode and which selected endpoints can change data.

**Scheduling.** Flow runs setup once in dependency order, then each iteration over its own copy of
setup output, steps in dependency order, sequentially. Concurrency is simultaneous iterations, not
parallel requests inside one. Independent gives each load endpoint its own queue and admits jobs
round-robin under one global concurrency limit; each `(endpoint, repetition)` has its own context.
Ramp-up admits one worker per 250 ms; delay waits after a worker finishes a job. A failed producer
skips its dependents with a named reason while unrelated steps follow the continue/stop policy;
setup failure blocks the load phase. Stop, the failure policy and switching profiles all end a run
through one signal: owned requests abort and nothing further is scheduled.

**Results.** Outcomes stay distinct (passed, failed checks, network error, timeout, aborted, skipped
dependency, blocked before dispatch) and the Results screen shows the breakdown under the tiles
rather than one "failed" total. P95 is nearest rank (`ceil(0.95 × n) − 1`), averages come from the
underlying samples rather than an average of averages, and a statistic with no samples is shown as
`—` instead of zero. JSON export carries the schema version, the configuration revision, the outcome
counts and written definitions of every timing; CSV quotes separators, quotes and newlines and
prefixes `=`, `+`, `-`, `@`, tab and CR with `'`.

### Verification

- `npm run build` → exit 0. raw 328,698 B, minified 188,550 B, encoded bookmark URL 269,632
  characters (after M7: 266,752 / 154,856 / 220,022).
- `npx playwright test` → **136 passed, 0 failed**, 1.2 min. Of those, M8 adds 24 unit checks
  (`tests/m8-core.spec.mjs`) and 12 Chrome fixture checks (`tests/m8.spec.mjs`).
- Versions: Node v24.21.0, TypeScript 7.0.2, esbuild 0.28.2, Playwright 1.63.0, Chrome
  153.0.8010.53 on macOS (Darwin 25.6.0).
- Measured, not asserted from the UI: the Chrome checks compare the fixture server's own hit
  counters, read over a separate connection outside the page, against the planned counts. A Flow run
  of 3 iterations produced exactly 3 producer hits and one hit each on `/api/m8-child-1..3`, proving
  each iteration used its own producer value. The same plan with the producer promoted to setup
  produced 1 producer hit and 3 hits on `/api/m8-setup-child-1`. An Independent plan reading another
  load endpoint dispatched nothing at all; `/api/m8-indep-seed` was hit 0 times while the error was
  displayed. A blocked built-in produced 0 hits on its endpoint rather than a request with an empty
  header. `$meta` was checked end to end: the request carried the page's `csrf-token` to
  `/api/echo-headers` and the echoed headers satisfied a `body-contains` check.

### Two defects found and fixed during verification

1. The whole-JSON-value pattern excluded `"`, so `"{{$counter("n",1,1)}}"` — a built-in with quoted
   arguments — was substituted as a string instead of keeping its number type. The character class
   cannot cross an expression boundary anyway, so the exclusion was wrong as well as harmful.
2. The Load view was built once and never re-rendered, so moving a step between phases or adding a
   context binding updated stored configuration while the preflight, the footer and the Run button
   stayed stale. The screen now rebuilds the load panel whenever the plan, the live run or the
   endpoint list changes; the scan results and the run history are built once and moved, so a plan
   edit no longer clears a scan in progress and screen watchers are not accumulated per render.

### Not run, and material limitations

- Saved-bookmark installation is still unverified, and it now matters more: the encoded bookmark URL
  is **269,632 characters**, which has passed the 262,144-character payload probe. The build now
  emits only the 1,048,576 probe and warns that the two smaller ones were skipped. Whether Chrome
  and Edge accept a bookmark URL of this size when saved, synced and restarted is untested and is
  the single largest open risk to the distribution model.
- No Edge run. No saved-bookmark run for any milestone.
- The `rules` tester mode (dispatch through the page pipeline instead of the captured transport) is
  implemented and selectable but is not covered by an automated check; every M8 gate above was
  measured in Direct mode.
- Browser completion notification is not implemented. `notifyOnComplete` writes the in-panel
  activity line only, which is the documented default; the optional `Notification` permission path
  was not built.
- Latency samples are capped at 1,000 per endpoint. Past that the count keeps rising while P95 is
  computed over the samples kept; the Results screen says so rather than presenting it as exact.
- Ramp-up uses a fixed 250 ms step with no UI control, matching the reference's single switch.
- Run summaries live in session state only, bounded to 20. They are not persisted to IndexedDB, so
  they do not survive a page reload.
- This is a browser-local repeated-request runner. Event-loop scheduling, tab throttling, connection
  limits and one shared session make its numbers a comparison between runs in this tab, not a
  statement about server capacity.

**Next milestone.** M9 — the complete Import screen: every format in `Import.html`, paste/file
detection, format-specific conversion, review, conflict handling and a transactional commit.

## 2026-09-23 — The delete confirmation is the panel's own dialog

**Scope.** Follow-up on the user's report: the delete confirmation was the host page's native
`confirm()`, which announces the page origin, cannot be themed and sits outside the panel.

**Changed files.**

- `src/ui/dom.ts` — `confirmDialog(host, title, message, confirmLabel, signal)` builds a native
  `<dialog>` inside `.aw-root` and returns a promise. `showModal()` puts it in the top layer, so
  the panel's `overflow: hidden` cannot clip it, and Escape, focus trapping and the backdrop come
  from the element rather than from new code. The form's `method="dialog"` carries the answer in
  `returnValue`, so Cancel, Escape and a torn-down screen all resolve `false`. It is built with
  `createElement`/`textContent` like the rest of the runtime DOM: no HTML parsing. The top layer
  positions against the viewport, so the dialog is centred on the panel after `showModal()` and
  clamped to the viewport, since the panel can be dragged anywhere.
- `src/ui/theme.css` — `.aw-dlg` and `.aw-dlg::backdrop` reuse the `.aw-menu` surface, border,
  radius and shadow.
- `src/ui/screens.ts` — the delete handler awaits the dialog instead of `confirm()`, and re-reads
  the profile id after the answer rather than trusting the id captured before it.
- `tests/ui.spec.mjs` — the delete test drives the panel's dialog: Cancel and Escape delete
  nothing, and the Delete button in the dialog is what commits. It no longer listens for a page
  `dialog` event, which is now evidence that no native dialog is used.

**Commands and outcomes.**

- `npm run build` → exit 0. raw 266,752 B, minified 154,856 B, encoded bookmark URL 220,022
  characters.
- `npx playwright test` → 100 passed in 1.1 min, Chrome, macOS darwin 25.6.0, Node v24.21.0.
- Screenshots taken from the live fixture panel confirmed the button and the dialog render as
  intended; the throwaway spec used for them was deleted.

**Not run.** No Edge check: `<dialog>` and `showModal()` inside a shadow root are Chromium
features shared with Edge, but that is reasoning, not measurement. No check on a host page that
defines its own `dialog` styles — the panel's shadow root should isolate it, untested.

**Limitations.** The dialog is modal to the whole page, not only the panel, which is what
`showModal()` provides. Nothing else in the panel uses it yet; the rule and endpoint deletes are
still immediate.

**Decisions.** A native `<dialog>` rather than a hand-built overlay, so no focus trap, Escape
handler or z-index management is written or maintained.

**Next task.** M8 — Flow/Independent repeat runner, unchanged by this entry.

## 2026-09-23 — Delete a profile

**Scope.** Follow-up on the user's report: profiles could be created, copied, renamed and switched,
but never removed, so a junk or recorded profile stayed in the switcher forever. Endpoints and
rules already had a trash control; profiles had none.

**Changed files.**

- `src/entry.ts` — `deleteProfile(id)` drops the snapshot. Deleting a stored profile leaves the
  live one untouched; deleting the live one activates the next stored profile, or an empty profile
  when it was the last, because the panel cannot sit without one. The five steps every profile
  swap performs (set rules, reset the engine, persist, clear matches, resync stats) are now one
  `activate` helper shared by `selectProfile`, `deleteProfile` and `createProfileFromRecordings`,
  replacing three copies of the same body.
- `src/ui/screens.ts`, `src/ui/shell.ts` — a red, labelled `Delete profile` button beside the
  Settings profile selector, using the theme's existing `aw-dst` destructive style and prepended
  trash icon, as the rule editors do. An icon-only ghost control was tried first and read as
  decoration next to the selector, so it was replaced rather than restyled; no new CSS was added. It is the one destructive action here that carries a
  profile's endpoints and rules with it and has no undo, so it asks for confirmation first and
  says when the deletion will leave an empty profile behind. The selector moved from `labeled` to
  `labeledAction` and now carries its own `aria-label`, since the control sits outside the label.
- `tests/ui.spec.mjs` — dismissing the confirmation deletes nothing; accepting hands the stored
  copy and its endpoints to the panel; the last delete leaves a profile named for the page with no
  endpoints.

**Commands and outcomes.**

- `npm run build` → exit 0. raw 264,354 B, minified 153,408 B, encoded bookmark URL 217,924
  characters.
- `npx playwright test` → 100 passed in 1.0 min, Chrome, macOS darwin 25.6.0, Node v24.21.0. A
  stale fixture server again held port 4173 and was killed before the run.

**Not run.** No Edge or saved-bookmark check, as for every milestone. The confirmation is the host
page's native `confirm()`, following the existing `alert()` on version conflict; it has not been
checked against a page that overrides `window.confirm`.

**Limitations.** Deletion is immediate and unrecoverable — there is no undo and no trash. Only the
active profile can be deleted, since the Settings selector switches profiles on change and so
always names the live one.

**Decisions.** Confirmation by native dialog rather than an in-panel two-step, so no new UI state
exists to keep in sync. Deleting the last profile resets to an empty one instead of being blocked,
which keeps "start over" reachable without a separate control.

**Next task.** M8 — Flow/Independent repeat runner, unchanged by this entry.

## 2026-09-23 — Profile names derived from the host, and unique by construction

**Scope.** Follow-up on the user's instruction, not a milestone: profiles were named `Default`,
`Untitled` or `Recorded <page hostname>`, and nothing stopped two profiles sharing a name. The
active-profile menu and the Settings dropdown render the name alone, so duplicates were
indistinguishable and the export filename inherited the collision.

**Changed files.**

- `src/core/model.ts` — `nameFromHost` turns a host into a base name by dropping `www` and the TLD
  and dash-joining the rest (`krushna.cooksbook.in` → `krushna-cooksbook`); a host with no TLD to
  drop (`localhost`, a bare IP) keeps its own name. A fixed list of second-level suffixes
  (`co`, `com`, `net`, `org`, `ac`, `gov`, `edu`) handles `example.co.uk` — marked `ponytail:`,
  since it is not a public-suffix lookup. `pageProfileName` is the page's base name, falling back
  to `Default` where there is no `location`. `suggestProfileName` appends `-2`, `-3`, … until the
  name is free. `defaultProfile()` now names the first profile after the page.
- `src/entry.ts` — `saveProfileAs` and `createProfileFromRecordings` route the name through
  `suggestProfileName` against every stored name, so a typed duplicate is disambiguated at commit
  rather than only in the prefilled field. This is the single choke point both UI paths use.
- `src/ui/screens.ts` — the recorder prefills the captured API host's name when the page called
  exactly one foreign origin, else the page's own; the suggestion follows the capture buffer only
  while the field still holds the previous suggestion, so a typed name is never overwritten.
  Clearing the Settings name field now keeps the current name instead of reverting to `Default`.
- `tests/profile-names.spec.mjs` — new: the seven host→name rows, the `-2`/`-3` dedupe chain,
  trimming, and the empty-name fallback to the page.
- `tests/m3.spec.mjs` — the profile menu now reads `127.0.0.1` (the fixture host) instead of
  `Default`; the assertion was updated to the new expected value.

**Commands and outcomes.**

- `npm run build` → exit 0 after two strict-TS fixes (`noUncheckedIndexedAccess` on `labels.at(-1)`
  and `foreign[0]`). raw 263,364 B, minified 152,864 B, encoded bookmark URL 217,122 characters.
- `npx playwright test` → 99 passed in 1.0 min, Chrome via `channel: chrome`, macOS darwin 25.6.0,
  Node v24.21.0. A stale `tests/fixtures/server.mjs` held port 4173 and was killed before the run.

**Not run.** No manual browser check of the recorder suggestion against a real multi-host site —
the fixtures serve 127.0.0.1, whose name is the IP, so the host→name rule is covered by unit
assertions only. Saved-bookmark and Edge checks remain outstanding as for every milestone.

**Limitations.** Existing stored profiles keep their old names; nothing migrates or de-duplicates
them retroactively. The second-level suffix list is fixed, so a host under an unlisted multi-part
suffix (for example `example.com.br`) yields `example-com`.

**Decisions.** Uniqueness is enforced at commit rather than by disambiguating the dropdown, which
keeps the name-rendering code untouched; the dedupe suffix is `-2` to match the dash style and keep
export filenames space-free. The recorder's `Recorded ` prefix was dropped so a recorded profile
and a first-run profile on the same site read the same.

**Next task.** M8 — Flow/Independent repeat runner, unchanged by this entry.

## 2026-09-23 — Format JSON: response sample included, control hidden when it has no work

**Scope.** Follow-up to the entry below, on the user's instruction: the endpoint editor's response
sample had no Format control, and the button should only appear when there is something to format.

**Changed files.**

- `src/ui/dom.ts` — `formatJsonButton` now hides itself unless the field holds JSON whose indented
  form differs from what is there, so empty, non-JSON and already-indented content show no control
  and clicking can never be a no-op or a refusal. The `notice` parameter is gone with the refusal
  paths it served. The target may now be a textarea or a `JsonField` (`read`/`write`) so read-only
  text the editor owns can use the same control.
- `src/ui/screens.ts` — the response sample disclosure gained the control; formatting it rewrites
  the draft's `sampleResponse.body`, so Save keeps the indented copy rather than only redrawing it.
- `src/ui/rule-screens.ts`, `src/ui/screens.ts` — call sites dropped the removed argument.
- `tests/ui.spec.mjs` — visibility across empty/invalid/valid/already-formatted states, and a
  recorded endpoint's request body and response sample, including that the formatted sample
  survives Save and reopening.

**Commands and outcomes.**

- `npx tsc --noEmit` -> exit 0.
- `npm test` -> 95 passed, 0 failed. Chrome 153.0.8010.53, macOS darwin 25.6.0, Node v24.21.0,
  Playwright 1.63.0.

**Verification.** In the mock editor the control is absent for an empty body and for `{"a":1,`,
appears for `{"a":1,"b":[2,3]}`, indents it, leaves "Valid JSON." showing, then retires itself.
On a recorded `POST /api/echo` endpoint both the request body and the response sample format, and
the saved endpoint still shows the indented sample after reopening. Screenshot check of both
controls in the endpoint editor.

**Limitations.** Visibility is evaluated on `input`/`change` for textareas and on write for the
sample; nothing else mutates those fields. The chaos fault body remains a single-line input with no
control, as before.

## 2026-09-23 — Format JSON control on every editable JSON field

**Scope.** UI affordance requested while reviewing the mock rule editor: one button that pretty-
prints the JSON a field already holds. No behaviour of the rules, recorder or transport changed.

**Changed files.**

- `src/ui/dom.ts` — `formatJsonButton` and `labeledAction`. The button reformats in place with
  `JSON.stringify(JSON.parse(value), null, 2)`; empty or invalid content is left exactly as typed
  and reported through the field's existing status line, so it cannot discard a body still being
  written. It fires `input` and `change` afterwards because the validity lines and draft bindings
  listen for those, not for assignment, and it starts disabled when its field is disabled.
  `labeledAction` puts the control on the label row, outside the `<label>` element.
- `src/ui/rule-screens.ts` — mock response body (every slot), JSON Patch raw editor, paused-request
  body editor.
- `src/ui/screens.ts` — endpoint request body, Import paste box.
- `tests/ui.spec.mjs` — valid body is rewritten and revalidated, invalid body is untouched with a
  notice, and the same control works on the endpoint request body.

**Commands and outcomes.**

- `npx tsc --noEmit` -> exit 0.
- `npm test` -> 94 passed, 0 failed. Chrome 153.0.8010.53, macOS darwin 25.6.0, Node v24.21.0,
  Playwright 1.63.0.

**Verification.** In the mock editor a minified body becomes indented JSON and the validity line
turns to "Valid JSON."; a truncated body is left byte-for-byte unchanged with "Not valid JSON —
left unchanged." Screenshot check of the label row layout in the mock rule editor.

**Limitations.** The chaos fault body is a single-line text input, so it has no Format control;
formatting it would insert newlines into a one-line field. Read-only JSON (the Settings export box,
recorded response samples) is already pretty-printed or displayed as captured and was not touched.
Formatting a paused request's body changes the bytes that request will send — it is an explicit,
opt-in action on an editable field.

## 2026-09-23 — M4 recorder review flow: own screen, selection and profile creation

**Scope.** Reworked how a capture session becomes configuration, on the user's instruction: the
recorder moves off Home to its own screen, a stopped session is reviewed as selectable endpoint
candidates (all selected by default), each candidate is editable before commit, and the selection
creates a new profile. No other milestone's work was touched.

**Changed files.**

- `src/recorder/promote.ts` (new) — `endpointFromRecording` and `candidatesFrom`. Pure conversion
  from bounded recordings to endpoint drafts: repeated calls to one method and pathname collapse to
  one candidate (latest call wins, count kept), aliases are made unique within the set, `[REDACTED]`
  header values are dropped rather than replayed, request body kind follows the recorded
  content-type, and third-party origins become host keys with an origin map for the new profile's
  environment. A record whose method is outside the endpoint model or whose URL will not parse is
  reported as skipped, not silently converted.
- `src/ui/screens.ts` — new `record` screen (recorder controls, candidate list with checkboxes,
  per-row edit, profile-name field, Create profile footer action); review drafts live in a
  module-level map so an edit survives leaving and re-entering the screen; Home gained a Record
  quick action and lost the recorder panel; Import's recorder entry point is now a link to the
  screen; `endpointEditor` takes optional peers/onSave/onClose so the same editor edits an
  uncommitted draft.
- `src/entry.ts` — `createProfileFromRecordings` replaces the single-record `promoteRecording`. It
  builds a profile whose environment map holds the recorded origins, reassigns endpoint ownership,
  clears rules and cursors like a profile switch, and snapshots the outgoing profile first when it
  is not already saved, so activating the new profile cannot discard unsaved endpoints or rules.
- `src/ui/shell.ts`, `src/ui/dom.ts` — context plumbing for the new action; a `record` icon.
- `tests/m4-core.spec.mjs` (new), `tests/m4.spec.mjs`, `tests/ui.spec.mjs` — unit coverage for the
  converter and browser coverage for capture -> select -> edit -> create profile, including the
  persisted configuration read back from IndexedDB.

**Commands and outcomes.**

- `npx tsc --noEmit` -> exit 0.
- `npm run build` -> exit 0. Final bundle: raw 260,172 B, minified 151,286 B, encoded bookmark URL
  214,772 characters.
- `npx playwright test tests/m4-core.spec.mjs` -> 4 passed, 0 failed.
- `npm test` -> 93 passed, 0 failed. Chrome 153.0.8010.53, macOS darwin 25.6.0, Node v24.21.0,
  Playwright 1.63.0.

**Verification.** Recording three fixture calls (two to one path) yields two candidates with a ×2
repeat marker and both checkboxes checked; unchecking one and creating a profile writes exactly the
selected endpoint to IndexedDB with the new profile's id, the latest recorded query string and the
page origin as the default environment host. Editing a candidate's name and path before commit is
what the created profile receives. Redaction, XHR capture and draft recovery after relaunch still
hold on the new screen.

**Not run.** Saved-bookmark installation, Edge, and manual quota-failure checks.

**Known issue found, not fixed.** `node --test tests/m2-core.spec.mjs` fails on this commit and on
HEAD before it: `src/` uses extensionless relative imports since the Prettier reformat, which
Node's ESM resolver rejects. That file is also outside Playwright's collected set, so its assertions
currently run nowhere. New unit coverage was therefore added under the Playwright runner
(`tests/m4-core.spec.mjs`), matching `m5-core`/`m6-core`/`m7-core`.

**Limitations.** Candidates are grouped by method and pathname only; distinct bodies on the same
path are not kept separately and no transient-query-parameter suggestion is offered. There is no
"add to the current profile" path any more — a capture session always creates a new profile.
Creating a profile consumes the capture buffer (recorder reset) so a second commit cannot duplicate
it. Review drafts are session state and are not written to recovery storage; only the underlying
records are.

**Next task.** M8 Flow/Independent repeat runner.

## 2026-09-23 — M7 breakpoints

**Scope.** M7 only: the paused-request registry, request- and response-stage pauses on both
transports, the paused-request queue with per-entry editors, Continue/Abort/Continue all, the
30-second deadline, the 20-pause queue limit, and disposal. No other milestone's work was touched;
the intercept editor's "breakpoints arrive in M7" placeholder is now the real control.

**Changed files.**

- `src/breakpoints/registry.ts` (new) — `createBreakpoints`. Each pause is one single-use
  continuation resolved exactly once, by the user, the deadline, the caller's abort signal or
  disposal, so no adapter can be left awaiting a promise nothing will settle. A pause carries the
  stage, transport, method/URL, matching rule id/label, the rule revision and profile id it matched,
  the editable snapshot and why a body is not editable when it is not. Over the limit, `pause()`
  resolves immediately with a queue-limit diagnostic and never joins the queue; after `dispose()` it
  resolves immediately with a closed diagnostic.
- `src/core/model.ts` — `InterceptRule.breakpoints?: { request, response }` (optional, so a rule
  saved before M7 pauses at neither stage), `MAX_PAUSED_REQUESTS = 20`, `PAUSE_DEADLINE_MS = 30000`.
- `src/network/rules.ts` — `InterceptPlan` carries `pauseRequest`, `pauseResponse`, `revision` and
  `profileId`, frozen with the rest of the plan at intake. A synthetic winner records
  "breakpoints not applied: a request answered without a dispatch is never paused in v1" in `why`.
- `src/network/pipeline.ts` — `createPipeline(report, breakpoints?)` exposes the registry to both
  adapters and disposes it in `close()` before owned timers settle.
- `src/network/fetch-adapter.ts` — a configured pause forces the wrapper path. The stage 3 pause runs
  inside `dispatch()`, after the request transform and before the single `captured.call`, so an abort
  there dispatches nothing; `counters.dispatched++` moved to the three points that actually dispatch.
  The stage 8 pause runs after the response transform and real-traffic chaos, and its edit is the
  final override, dropping `content-length`/`content-encoding` when it rewrites the body.
- `src/network/xhr-adapter.ts` — the same two stages on the inner native request. Nothing is emitted
  to the page while a request waits, so the event sequence it eventually sees is still the native
  one. A per-send `AbortController` releases a pause whose request the page has already abandoned,
  and an `awaiting` flag keeps the shutdown handler from delivering a second, empty outcome to a
  request the registry is about to resume.
- `src/ui/rule-screens.ts` — `pausedQueue`/`pausedCard` (the queue leads the Intercept screen) and
  `breakpointCard` in the intercept editor. A card shows id, stage, method/URL, transport, rule,
  a live age against the deadline, and a stale line when the rule was edited or deleted or the
  profile switched while the request waited. Cards are reconciled by id, so a state change never
  discards a half-typed edit. A request-stage edit that sets a forbidden header is refused with the
  reason instead of being sent.
- `src/ui/screens.ts`, `src/ui/shell.ts`, `src/entry.ts` — `paused` in `UIState`,
  `continueAllPaused` in `Ctx`, the footer counter and the minimized launcher both report the paused
  count (a pause becomes the launcher's headline, since the page is waiting on the user), version
  `0.1.0-m7`.
- `tests/m7-core.spec.mjs` (new, 6 checks), `tests/m7.spec.mjs` (new, 12 checks).

**Commands and outcomes.**

- `npm run build` → exit 0, with `Payload probes smaller than the bundle were skipped: 131072`.
  raw 250,978 B, minified 146,197 B, encoded bookmark URL 207,587 characters (after M6: 230,863 /
  135,630 / 192,748). The zero-import, no-`eval` and no-external-URL assertions still pass.
- `npm test` (build + Playwright) → **88 passed in 59.7 s**. Chrome 153.0.8010.53, macOS
  darwin 25.6.0, Node v24.21.0, Playwright 1.63.0.

**Verification (measured).** A request-stage pause holds a `POST` with the server's hit counter
unchanged; editing its headers and body in the queue and pressing Continue makes the fixture receive
exactly the edited header and body, with the counter moving by exactly 1. A response-stage pause is
reached only after that single dispatch, shows the header the M6 response transform already applied,
and its status/header/body edit is what the page receives (418 `I'm a Teapot`). Abort at the request
stage rejects the caller with `AbortError` and leaves the counter untouched. Continue all releases
three waiting requests, each dispatching exactly once. A paused XHR has emitted only
`readystatechange:1` and `loadstart:1` while it waits; after both stages are continued the page sees
`[1,2,3,4]` and `loadstart → progress → load → loadend`, with one dispatch. A mocked request is never
paused and the queue stays empty. The minimized launcher reports "1 request paused" with an active
dot. Closing the workbench while a fetch and an XHR are paused lets both complete on the captured
transport, once each, with no hang. An edited rule marks a waiting pause stale without changing its
snapshot. An unanswered pause continued on its own after 30.4 s measured, dispatching the original
unedited request exactly once. A breakpoint authored entirely through the editor (label, URL, the
request-stage checkbox, enable, Save) pauses live traffic. Core checks cover single-use resolution,
the 20-pause limit and its diagnostic, the deadline, caller abort precedence, disposal leaving no
unresolved pause, and the plan's pause flags including the pre-M7 rule with no field.

**Not run.** Saved-bookmark installation and restart persistence; all Edge checks (Edge is not
installed on this machine); screen-reader verification and keyboard-only sweeps of the queue. The
20-pause queue limit is measured in the core spec only, not through 21 live browser requests.

**Limitations.**

1. A request answered without a dispatch — a mock or a synthetic chaos fault — is never paused. The
   editor and the rule trace both say so. Holding such a request would mean pausing inside the
   synthetic delivery path that carries the tested XHR event sequence, which is not worth the risk
   to that sequence in v1.
2. The deadline and the queue limit are constants, not settings. The editor states both values.
3. Replay copies are still prepared from the frozen pre-pause request, so a request-stage edit
   changes the primary request only.
4. A response-stage body is editable only for text-shaped media types; anything else is shown with
   the reason and delivered unchanged.
5. A request-stage pause on a `GET`/`HEAD` has no body to edit, which the card states.
6. The caller's own `xhr.timeout` keeps running while a request is paused, so a long pause can time
   the request out. That is deliberate: caller cancellation always wins over a workbench pause.

**Decisions.**

- **Closing the workbench continues every pause rather than aborting it.** The page's request was
  browser-owned before Workbench touched it, so shutdown hands it back instead of failing it.
- **The deadline continues unchanged and logs that it did**, so an unattended pause can never turn
  into a stuck application request.
- **The request pause sits after the request transform and inside `dispatch()`**; the response pause
  sits after real-traffic chaos. Together they keep the plan's stage order: a manual edit is the last
  explicit override, and nothing upstream happens before a request-stage Abort.
- **Rule edits never mutate a waiting pause.** The entry keeps the revision and profile it matched
  and the queue marks it stale, rather than re-reading configuration that has moved on.
- **The queue lives on the Intercept screen**, with the paused count on the footer of every screen
  and on the minimized launcher. The reference screens have no queue, so this follows plan §8.5.

**Next task.** M8 — Flow/Independent repeat runner: the dependency DAG, the specified built-ins and
restricted expression parser, context discovery, setup/job scopes, concurrency and ramp-up,
cancellation, and P95/history/export.

## 2026-09-23 — M6 intercept and routing

**Scope.** M6 only: request and response transformations (headers, status, literal body
find/replace), RFC 6902 JSON Patch, current-frame routing with a defined rewrite grammar, the
Intercept and Route screens, and the composition order for all four rule modules. Breakpoints stay
unbuilt; the intercept editor says so rather than showing controls that do nothing.

**Changed files.**

- `src/network/patch.ts` (new) — RFC 6902 over RFC 6901. All six operations, `~1`/`~0` unescaping in
  the required order, array indices with no leading zeros plus `-` for append, own-property
  traversal, and `__proto__`/`constructor`/`prototype` segments rejected. Every patch runs on a
  `structuredClone` and commits only if all its operations succeed. `pointers()` lists the pointers
  in a sample document for the editor's path suggestions.
- `src/network/transform.ts` (new) — header line parsing (moved here from `rules.ts`), transform
  compilation, and `applyTransform`, which returns the resulting headers/body/status plus explicit
  `applied` and `skipped` reasons. Forbidden request header names are skipped with a reason rather
  than reported as applied; a status override outside 200–599 is refused; a rewritten body drops
  `content-length` and `content-encoding`.
- `src/core/model.ts` — `InterceptRule` (request and response `Transform`), `RouteRule`, `PatchOp`,
  `FORBIDDEN_REQUEST_HEADERS`/`forbiddenRequestHeader`, `RULE_KINDS`, and defaults. `Rule` is now a
  four-way union.
- `src/network/rules.ts` — module activation covers four kinds; `globSource` is factored out of
  `globToRegExp`; `validateRewrite`, `rewritePathname` and `routeTarget` implement the rewrite
  grammar, preserve the query string, restrict destinations to HTTP(S) and strip `Authorization`
  cross-origin unless the rule keeps it for that destination. `plan()` selects at most one intercept
  and one route rule, applies the response transform to synthetic (mock and chaos) responses at plan
  time, and records every composition decision in `why`.
- `src/network/fetch-adapter.ts` — one wrapper now serves chaos, routing and transforms. The request
  is rebuilt only when a request transform or a route needs it, with the body buffered as bytes so
  binary and form payloads are re-sent byte-for-byte. The response transform runs before
  real-traffic chaos. A routed `TypeError` is reported as one opaque browser failure.
- `src/network/xhr-adapter.ts` — the inner native request now carries the routed URL, the
  transformed request headers and body and the route's credentials; the response transform runs on
  its result before chaos. `responseURL` reports the routed destination. Unsupported `responseType`
  values skip the work with a reason instead of faking a text rebuild.
- `src/ui/rule-screens.ts` — the Intercept and Route screens and editors, including a JSON Patch
  editor whose friendly rows and raw JSON are two views of the same array, a `Load` control that
  suggests pointers from the linked endpoint's sample response, and a live route rewrite preview.
- `src/ui/screens.ts` — `moduleActive` is `Record<RuleKind, boolean>`; Home reports real rule,
  enabled and hit counts for all four modules. The M1 preview scaffolding for Intercept and Route
  (`moduleScreen`, `planned` and their disabled-control helpers, 288 lines) is deleted.
- `src/ui/shell.ts`, `src/entry.ts`, `package.json` — four-module activation plumbing, launcher
  label, version `0.1.0-m6`.
- `tests/m6-core.spec.mjs` (new, 6 checks), `tests/m6.spec.mjs` (new, 12 checks),
  `tests/fixtures/server.mjs` (added `/api/echo-headers`; `/api/echo` is unchanged so the M0
  assertion still holds), `tests/ui.spec.mjs` (the preview test became a real editing test).

**Commands and outcomes.**

- `npm run build` → exit 0, with `Payload probes smaller than the bundle were skipped: 131072`.
  raw 230,863 B, minified 135,630 B, encoded bookmark URL 192,748 characters (after M5: 200,629 /
  120,900 / 172,254). The zero-import, no-`eval` and no-external-URL assertions still pass; the
  route editor's destination placeholder is built from `location.protocol` so no absolute URL
  literal survives minification.
- `npm test` (build + Playwright) → **70 passed in 24.1 s**. Chrome 153.0.8010.53, macOS
  darwin 25.6.0, Node v24.21.0.

**Verification (measured).** Intercept edits status, headers and JSON body of a real fetch and XHR
response after exactly one server hit; a request transform changes the headers and body the fixture
actually received on both transports; a forbidden request header never reaches the wire and the
editor refuses the save with the reason; a patch whose second operation fails delivers the original
body while the header edit still applies; a response transform edits a mocked response with zero
network calls; a route rewrites `/api/m6-from/**` to `/api/m6-to/**` with the query preserved, the
original path's hit counter unchanged and `responseURL` reporting the destination; a cross-origin
route succeeds with `Authorization` stripped and fails when the rule keeps it; a refused route is
reported as an opaque failure that may still have reached the destination; an intercept transform
runs before real-traffic chaos, which wins the final status; an inactive module changes nothing.
Core checks cover pointer escaping and blocked segments, all six patch operations, transactional
rollback, prototype-pollution refusal, transform skip reasons, the rewrite grammar and its
rejections, and one-rule-per-module precedence.

**Not run.** Saved-bookmark installation and restart persistence; all Edge checks (Edge is not
installed on this machine); screen-reader verification; keyboard-only sweeps of the new editors.
Real-network behavior against a third-party host — every route check uses the two local fixture
origins.

**Limitations.**

1. Breakpoints are not built. The intercept editor states that M7 delivers them; no paused-request
   queue exists, so the stage 3 and stage 8 pauses in the pipeline table are still absent.
2. Body transforms apply to text-shaped media types only (`json`, `text`, `xml`, `javascript`,
   `html`, `csv`, form-urlencoded). Anything else is skipped with a reason, never rewritten.
3. A request whose `Request` object already has a used body cannot be rebuilt; the transform is
   skipped and the original request is dispatched.
4. XHR skips intercept, route and chaos work for binary `responseType` values rather than
   reconstructing a text body.
5. A route's "Match origin" left blank matches any origin, which the field's hint states. The
   reference screen's "Blank = current document" wording would need a separate document-origin
   concept the matcher does not otherwise have.
6. Conditions on the Route screen use the same `k=v&k2=v2` matcher as every other rule, not the
   reference screen's JSON maps.

**Decisions.**

- **Response transforms on synthetic responses are applied in `plan()`**, not in the adapters. The
  synthetic response is fully known at plan time, so both transports get identical behavior with no
  duplicated adapter code.
- **One wrapper per transport for chaos, routing and transforms.** The fetch fast path is kept for
  requests that need none of them, so ordinary traffic is still passed through untouched.
- **Request bodies are buffered as `ArrayBuffer`, not decoded text**, when a request has to be
  rebuilt. Text is decoded only to evaluate a transform.
- **Stage 6 before stage 7**: a response transform edits the response, then real-traffic chaos
  replaces it. A breakpoint edit will be the final override in M7.
- **A routed failure is never labelled CORS.** Both adapters report the same sentence: the browser
  gives one opaque failure for CORS, DNS, TLS and network errors, and the destination may still have
  received the request.
- **Cross-origin routes strip `Authorization` by default** and a new cross-origin destination flips
  the editor's credentials to `omit`, rather than inheriting the page's session.
- **`Nullify` stays a convenience** that emits `replace` with `null`; a new operation row starts with
  an empty string value so it does not read back as Nullify.

**Next task.** M7 — breakpoints: the paused-request queue, request- and response-stage pauses with a
30-second deadline and a 20-pause limit, Continue/Abort/Continue-all, and disposal with no
unresolved paused promises and no duplicate upstream requests.

## 2026-09-23 — M5 mock and chaos

**Scope.** M5 only: the persisted rule model, the rule engine (matching, precedence, sequence
reservation, seeded probability, hit budgets), synthetic and real-traffic fault delivery on both
transports, bounded request replay, and the Mock and Chaos screens. Intercept, breakpoints and
routing stay unbuilt and still say so on screen.

**Changed files.**

- `src/core/model.ts` (new types) — `RuleMatcher`, `MockRule`/`MockSlot`, `ChaosRule`/`ChaosFault`
  as a discriminated union, `CHAOS_PRESETS`, `MAX_REPLAY_COPIES = 2`, `matcherFromEndpoint`.
  `WorkbenchConfig.rules` and `ProfileSnapshot.rules` carry them; sequence cursors, hit counts,
  budgets and sample streams are deliberately *not* in the schema.
- `src/network/rules.ts` (new) — `RequestContext`/`createRequestContext` moved here, the glob and
  query/header matchers, `matchRequest`, `byPrecedence`, a mulberry32 sampler, and
  `createRuleEngine()`: the transient store of cursors, hits and samplers plus `plan()`, which
  compiles one immutable `Plan` per request.
- `src/network/pipeline.ts` — imports the matchers instead of duplicating them, owns the engine,
  exposes `setRules`/`setActive`/`onActivity`/`counters`/`scheduleReplay`, and expresses the M0
  feasibility mock and the M2 rule list as ordinary plans so the adapters have one code path.
- `src/network/fetch-adapter.ts` — renders a plan: synthetic status/statusText/headers/body,
  synthetic failures, real-traffic pre-dispatch delay, delivery delay, status replacement,
  malformed JSON, simulated failure, bounded timeout and replay scheduling.
- `src/network/xhr-adapter.ts` — the synthetic delivery now carries a real response object rather
  than one hardcoded body. Real-traffic chaos runs an inner native `XMLHttpRequest` for the actual
  transport while the page's object stays synthetic, so the fault is applied to a real response
  after exactly one dispatch.
- `src/ui/rule-screens.ts` (new) — the Mock and Chaos screens and their rule editors.
- `src/ui/dom.ts` — `card`/`caption`/`group`/`labeled`/`disclosure` moved out of `screens.ts` so
  both screen modules share them without a circular import.
- `src/ui/screens.ts` — `UIState` gains `moduleActive`, `ruleHits`, `ruleCursors`, `matched`; `Ctx`
  gains `saveRule`, `deleteRule`, `toggleRule`, `setModuleActive`, `resetSequence`, `nextRuleSeq`;
  Home's Mock and Chaos cards show real rule/enabled/hit counts and live activation state; `mock`
  and `chaos` route to the new screens.
- `src/ui/shell.ts` — passes the new callbacks through; the minimized launcher names which modules
  are actually intercepting instead of only the fixture mock.
- `src/entry.ts` — rule CRUD with persistence, activation, stats mirroring, and rule handling on
  profile switch and import. Version `0.1.0-m5`.
- `scripts/build.mjs` — a payload probe smaller than the bundle is now skipped and reported rather
  than emitted at the wrong size.
- `tests/m5-core.spec.mjs` (new, 8 checks), `tests/m5.spec.mjs` (new, 11 checks),
  `tests/fixtures/server.mjs` (dropped the outgrown probe artifact), `tests/m1.spec.mjs` and
  `tests/ui.spec.mjs` (updated for screens that are no longer previews).

**Commands and outcomes.**

- `npm run build` → exit 0, with `Payload probes smaller than the bundle were skipped: 131072`.
  raw 200,629 B, minified 120,900 B, encoded bookmark URL 172,254 characters (before M5: 138,537 /
  87,378 / 124,358). The no-external-asset, no-`eval` and zero-import assertions still pass.
- `npm test` (build + Playwright) → **52 passed in 18.8 s**. Chrome 153.0.8010.53, macOS darwin
  25.6.0, Node v24.21.0, @playwright/test 1.63.0, typescript 7.0.2, esbuild 0.28.2.
- `npx playwright test tests/m0.spec.mjs` → 12 passed; every M0 gate still holds.
- `npx tsc` → clean.

**Verification — M5 acceptance gates.**

| Gate | Result | Evidence |
| --- | --- | --- |
| A synthetic winner makes zero network calls | PASS | The fixture server's `/api/stats` counter for the rule's path is unchanged across a mocked `fetch`, a mocked `XHR`, a synthetic-chaos 503 that supersedes a mock, a synthetic network failure, a synthetic timeout and a whole exhausted sequence. Counters are read through Playwright's own request context, never through the wrapped transport. |
| Ordinary real modes dispatch once | PASS | Real-traffic status replacement, malformed-JSON corruption and XHR delivery latency each move the server counter by exactly 1 while the application sees the faulted result. |
| Replay follows its exact configured budget | PASS | `copies: 2, gapMs: 20` produces exactly 3 dispatches; the count is still 3 after a further 300 ms, and the caller received only the primary response (`hit: before + 1`). The engine clamps a configured 9 copies to the documented maximum of 2. |
| Sequence slots are reserved deterministically | PASS | Four sequential requests return 503/503/200/200 (repeat-last); three *concurrent* requests return bodies `n: 1, 2, 3` with no duplicate, because the slot is reserved synchronously at intake before any delay. `loop` and `network-error` exhaustion are covered in the engine unit tests, and exhaustion never falls back to real traffic. |
| Abort wins during waits | PASS | A 3,000 ms mock delay aborted at 60 ms rejects with `AbortError` in under 2 s, makes no network call, and the reserved slot stays consumed — the next request receives slot 2. |
| Rule forms | PASS | A mock rule authored entirely through the UI (label, URL, status 418, body, enable, Save) applies to live traffic and reports `1 hit`. The chaos editor's mode radio, fault-type switch, replay total line and the refusal to save a synthetic replay are covered. |
| Preset compiler | PASS | The six reference presets plus the four "More…" faults build rules; `Slow API` compiles to real-traffic delivery latency of 1,000 ms, as the plan requires. |
| Probability and seed | PASS | 0 % never applies and does not fall through to a lower-priority chaos rule; the same seed replays the same ordered sample stream while a 50 % rule is neither always on nor always off; a hit budget of 2 applies twice and then stops. |
| Composition order | PASS | Synthetic chaos supersedes a mock; real-traffic chaos leaves a mocked response alone and says so in the trace; replay has no synthetic form. |
| Activation and enabling are separate states | PASS | A disabled rule under an active module passes traffic through; enabling it from the list makes the same request synthetic with no new dispatch; deactivating the module returns the frame to captured transport. |
| Persistence | PASS | Rules survive a close and relaunch; module activation does not, so a fresh launch never silently intercepts. Profile switch and native JSON import swap the rule set and reset every cursor, budget and sample stream. |

**Defect found and fixed in existing code.** The M2 matcher's `matchCondition` returned `true`
before testing the URL whenever a rule carried no `condition`, so a condition-less rule matched
every URL of its method. No shipped code called `addRule`, so nothing was broken in a build, but
the M5 engine is built on that matcher. The URL test now runs for every rule.

**Design decisions.**

- **Module activation is session state, not configuration.** Rules persist; activation does not.
  A saved profile therefore cannot cause a fresh bookmarklet launch to start faulting traffic
  before anyone has looked at the panel.
- **One plan per request, compiled synchronously at intake.** Selection, probability sampling and
  sequence reservation all happen before any timer, so a delay, an abort or a concurrent request
  can never change what was already decided.
- **Rule URLs match on pathname; query is a separate condition.** A rule copied from a recorded
  request keeps matching when its captured request id changes. An absolute pattern additionally
  pins the origin. *Deviation:* the plan says relative rules default to the page origin; here a
  relative pattern matches that pathname on any origin, and the editor says to write an absolute
  URL to scope a rule to one host. This keeps the verified M2 matcher contract intact.
- **Real-traffic chaos on XHR uses an inner native request.** The page's object stays synthetic and
  one inner `XMLHttpRequest` carries the transport, so a delivery delay or a rewritten body is
  applied to a real response without a second dispatch and without racing the page's own listeners.
- **A rewritten body drops `content-length` and `content-encoding`** rather than claiming the
  original metadata still describes the payload.
- **Faults that cannot be honoured are skipped with a reason, never faked.** A binary XHR
  `responseType` skips real-traffic chaos; a non-text response body skips malformed-JSON
  corruption; a consumed `Request` body skips replay. Each records a trace line.
- **Replay children never re-enter the pipeline.** They use the captured transport with frozen URL,
  headers and body bytes prepared *before* the primary dispatch, are cancelled by caller abort and
  by closing the workbench, and are not published as traffic — so they cannot trigger further
  mocks, further replay or recorder endpoint suggestions.
- **Exhaustion never sends real traffic.** `repeat-last`, `loop` and a simulated network error are
  the only three outcomes.

**Not run.**

- Saved-bookmark installation, restart persistence and bookmark launch under CSP. Unchanged from
  earlier milestones: the automated launch still injects the decoded source, which is not evidence
  of saved-bookmark behaviour. This matters more now — the encoded bookmark URL is 172,254
  characters, and the 131,072-character payload probe has been outgrown, so the smallest probe
  still available is 262,144.
- All Edge checks. Edge is not installed on this machine.
- Chaos behaviour under the CSP and Trusted Types fixtures; only M0's panel checks cover those pages.
- Keyboard-only and screen-reader passes over the new rule editors.
- Concurrency beyond three simultaneous requests, and seeded repeatability under concurrent arrival
  order — which the plan explicitly does not promise.

**Limitations.**

1. Chaos `timeout` in real-traffic mode aborts the workbench's own dispatch. It cannot roll back
   work the server has already done, and the editor says so.
2. Real-traffic chaos is skipped for an XHR whose `responseType` is `blob`, `arraybuffer` or
   `document`: rebuilding a binary body from text would corrupt it. The skip is recorded in the
   trace; it is not silently applied.
3. Replay is limited to 2 additional copies and to requests with a string or absent body. Streams
   and file bodies are excluded.
4. A synthetic `Set-Cookie` is visible to the caller but cannot update the browser cookie jar; the
   response editor states this.
5. Sequence position and Reset are per rule revision — saving an edited rule restarts its sequence.
   That is deliberate, and the editor names it.
6. Mock response bodies are validated as JSON for information only; invalid JSON is sent as raw
   text rather than blocked.
7. The "Why this rule?" composition trace is recorded on every plan and surfaced through the rule
   trace and the matched-traffic list, but there is no dedicated trace viewer yet.
8. The bundle grew from 87,378 to 120,900 minified bytes. The reference stylesheet still ships
   unminified through esbuild's text loader, which remains the cheapest available saving.

**Next task.** M6 — interception and routing: request/response transforms, RFC 6902 JSON Patch
compiled at save time, restricted-header validation, and the routing rule form, composed into the
existing pipeline order without re-matching after a transform.

## 2026-09-23 — Source reformat (no behaviour change)

`src/entry.ts`, the three `src/network/*` files, `src/ui/dom.ts`, `src/ui/shell.ts` and
`src/ui/theme.css` were reformatted to a Prettier-style layout: double quotes, no semicolons,
wrapped argument lists, arrow parens, `.5` written as `0.5`. Verified formatting-only by comparing
each file against `HEAD` with whitespace, quotes, semicolons, parentheses and commas stripped; the
CSS was compared declaration by declaration.

`npm run build` → exit 0. raw 138,537 B, minified 87,378 B, encoded bookmark URL 124,358
characters — 534 B minified and 1,602 characters larger than before the reformat. `theme.css` is
bundled through esbuild's `text` loader, so its whitespace ships verbatim and the JS minifier never
touches it; formatting the stylesheet therefore costs real payload. Minifying the CSS at build time
would recover it and more. `npx playwright test` → 33 passed in 13.5 s, same versions as above.

## 2026-09-23 — Settings export: single profile, downloaded as a file

**Scope.** Two reported defects in the Settings export control; no milestone work.

**Changed files.** `src/core/storage.ts`, `src/entry.ts`, `src/ui/dom.ts`, `src/ui/screens.ts`,
`tests/ui.spec.mjs`, `tests/m3.spec.mjs`.

**Behavior.** `exportConfig` now emits `{ schemaVersion, profile, endpoints, rules }` for the active
profile only; `savedProfiles` is no longer included. Because a single-profile export carries no
snapshots, the import handler keeps the existing `savedProfiles` when the incoming JSON has none, so
a round trip no longer deletes the user's other profiles. The Export button downloads
`<profile-name>.json` through a detached anchor and an object URL (revoked after 1 s) instead of
filling a read-only textarea; that textarea is removed and the status line names the written file.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0.
- `npm run build` → exit 0.
- `npx playwright test` → 96 passed in 1.0 min, Chrome via Playwright 1.63.0, macOS darwin 25.6.0, Node v24.21.0.

**Verification.** New check `UI export carries only the active profile and its endpoints, and import
keeps the other saved profiles` asserts the absent `savedProfiles`, the exported endpoint set, and
that the `Copy` snapshot survives re-import. `M3` asserts the downloaded filename `QA-profile.json`
and its contents. The two test helpers now read the export off the Playwright download event.

**Not run.** Edge, saved-bookmark installation. No manual download check in a browser outside
Playwright; blob downloads under a host-page CSP `sandbox` directive are untested.

**Next task.** M8 — Flow/Independent repeat runner.

## 2026-09-23 — UI/UX pass against the reference screens (no new features)

**Scope.** Side-by-side comparison of every built screen against `design/reference/screens/*` in
parallel browser pages, then closing the gaps. UI and interaction only: no module behaviour was
added, activated or removed.

**Changed files.** `src/ui/theme.css`, `src/ui/shell.ts`, `src/ui/screens.ts`, `tests/m1.spec.mjs`,
`tests/m3.spec.mjs`, `tests/ui.spec.mjs`.

**Defects found and fixed.**

- Endpoint rows rendered the name as an unstyled user-agent button (a grey block) because
  `.aw-endpoint-name` and `.aw-endpoint-meta` had no rules; `:host { all: initial }` does not reach
  descendants. Both are now styled, with the path indented under the name as in the reference.
- `select`, `input[type=checkbox]` and `input[type=file]` kept their user-agent appearance inside the
  shadow root. Selects and checkboxes now carry the reference look; the chevron and tick are drawn
  with gradients and borders, so the build's no-external-asset assertion still holds. The file input
  is hidden behind a styled `Choose file` label that remains the real control.
- Disabled primary buttons were a 50 %-opacity white fill with dark text — grey on grey, unreadable.
  Disabled controls now drop to the muted surface, and ghost buttons stay flat so a disabled icon
  button no longer outranks the enabled ones beside it.
- `Back` inside the endpoint editor returned to Home, skipping the endpoint list and discarding the
  draft two levels up. The sub-header now carries the endpoint name and `Back` returns to the list.
- The minimized launcher truncated the profile name to `Impo` with no ellipsis: `.aw-sel`'s label is
  a flex box, where `text-overflow` never applies, and a `@container (max-width: 380px)` rule
  clamped it to 64 px — the launcher's content box is exactly 380 px, so the rule always matched.
- Settings showed three adjacent text inputs with accessible names but no visible labels.
- The title-bar profile control was a `<button>` wearing a dropdown chevron that navigated to
  Settings: the affordance promised a profile list and delivered a second copy of the gear button.
  It is now a themed menu listing the active profile and every saved snapshot. Choosing a profile
  switches to it and re-renders the mounted screen; a selection the store refuses re-syncs rather
  than leaving a stale name on screen.

  A native `<select>` was tried first and rejected on review: its popup cannot carry the panel's
  surface, radius, elevation or check marks, so it read as browser chrome sitting on a themed panel.
  `dropdown()` in `src/ui/dom.ts` builds the shadcn-style equivalent — a trigger plus a floating
  `role="menu"` of `menuitemradio` items, with a check mark on the active one. It is mounted beside
  `.aw-root` rather than inside it, because `.aw-root { overflow: hidden }` would clip a menu
  rendered in the panel; `position: fixed` then resolves against the viewport from the trigger's
  rect, flipping above the trigger when there is no room below. Escape, outside `pointerdown`
  (matched through `composedPath()`, since the shadow root hides the real target), `ArrowUp`/`Down`,
  `Home`/`End`, `Enter`/`Space` and `Tab` are handled explicitly, focus opens on the checked item
  and returns to the trigger on close, and `aria-expanded`/`aria-haspopup` track the state. The menu
  closes on navigation, minimize, restore and window resize.

  The menu needed its own type stack: it sits outside `.aw-root`, and `:host { all: initial }`
  resets the font, so it first rendered in the host page's serif. Caught in a screenshot, not by a
  test.

- The Settings profile select was labelled `Active profile` on screen but exposed `Saved profile`
  as its accessible name (WCAG 2.5.3). The `<label>` wrapper now supplies the name.

**Design alignment.**

- `Settings` and `Import` are reached from the title bar, not the tab strip, so they showed a tab
  strip with nothing selected. Every non-tab screen now gets the reference `Back` sub-header, driven
  from `SCREENS[id]`.
- The reference uses the footer as each screen's action bar (`Save`/`Cancel`, `Save rule`/`Delete`).
  Added a `ctx.chrome({ title, onBack, actions })` slot: screens fill the footer, and it resets to
  the build-and-traffic status line on navigation. This replaced the `.aw-editor-footer` sticky hack
  and the duplicated in-body `Back to Home` buttons.
- Home module cards gained the reference shape: status dot badge, a stat line and the module's own
  actions (`Run`/`History`, `Manage rules`, `Configure`).
- Module screens are headed by their product name (`Mock Server`, `API Interceptor`, `API Tester`)
  rather than the short tab label.
- Collapsible sections had no affordance; `disclosure()` now prepends the chevron that the existing
  open-state rotation rule expected. `ruleDisclosure` pointed its chevron the wrong way when open.
- Import format badges are colour-coded and the notes align; Route form fields carry the
  reference placeholders.

**Commands and outcomes.**

- `npm run build` → exit 0. raw 135,647 B, minified 86,844 B, encoded bookmark URL 122,756
  characters. The menu primitive costs about 3.3 KB minified. The no-external-asset and no-`eval` assertions still pass.
- `npx playwright test` → 33 passed in 13.7 s. Chrome 153.0.8010.53, Playwright 1.63.0,
  Node v24.21.0, macOS darwin 25.6.0.
- Scratch harnesses (not committed): a side-by-side capture of all 15 reference screens against the
  live panel with the Geist web font blocked on both sides, and an interaction sweep that clicks
  every enabled body control on all six tab screens and re-checks vertical scroll, horizontal
  overflow, tab order and the resize affordance. Sweep result: no page errors, no failed clicks, no
  horizontal overflow, every screen scrolls vertically, `resize: both` present.

**Tests changed.** `m1.spec` asserted the old chrome (short tab labels, an in-body `Back to Home`,
a body heading on non-tab screens); it now asserts the module titles, the tab strip on tab screens
and the sub-header on the rest. `m3.spec` used `getByLabel('Name')`, which became ambiguous once
the pre-existing uncommitted work added `aria-label` to the other name fields — now matched exactly
— and asserted a body heading on Settings. Its profile assertions targeted a button that is now a
combobox, and `panel select` first-matched the new title-bar control, so both are scoped explicitly.
Added two tests in `ui.spec`: one covering the footer action bar, the retitled sub-header and `Back`
returning to the list; one covering the title-bar profile menu — open/close state, the check mark on
the active item, focus opening on it, `ArrowDown`+`Enter` switching profile and re-rendering the
mounted screen, Escape restoring focus without selecting, outside-click dismissal, and the menu
rendering past the panel's bottom edge to prove it is not clipped.

**Not run.** Saved-bookmark installation and restart persistence — unchanged from earlier
milestones, and the automated launch still injects the decoded source, which is not evidence of
saved-bookmark behaviour. All Edge checks — Edge is not installed on this machine. No manual visual
review on a real page other than the local fixture. No screen-reader or contrast-ratio audit.

**Known remaining gaps against the reference.** These are behaviour the milestones have not built,
not styling defects: no active-module dots on the tabs, in the title bar or in the launcher (no
module can activate yet); the title-bar switcher can only reach profiles held as saved snapshots, so
a profile that was never saved via `Save as profile` disappears from the list once another is made
active — `selectProfile` resolves against `savedProfiles` only, which Settings has always done too;
the in-body selects (endpoint method, environment, Settings' own `Active profile`, the rule-editor
fields) are still native `<select>`s with the gradient chevron, so Settings' profile picker does not
match the title-bar menu directly above it — converting them needs the menu to re-anchor or close on
body scroll, which is a separate pass; no plan selector, load config or phase lists on Test; no populated rule
lists, `Re-analyze`, header `Presets…`, `Promote common` or module toggles in Settings. The select
chevron is a small filled triangle rather than the reference's stroked chevron, because a stroked
one needs an asset the bundle may not reference.

**Next task.** M5 — mock server and chaos rule engines. Wire the rule screens to real storage and
matching, at which point the active-module indicators and rule lists above become implementable.

## 2026-09-23 — M4 recorder (complete)

**Scope.** Added shared-pipeline traffic observation, bounded recorder capture, sensitive-header redaction, reviewable draft records, real fetch response previews, and promotion of selected recordings into existing endpoints.

**Changed files.**

- `src/network/pipeline.ts`, `src/network/fetch-adapter.ts`, `src/network/xhr-adapter.ts` — typed traffic observer contract; real and synthetic fetch/XHR completions publish bounded capture inputs without consuming the caller response.
- `src/recorder/recorder.ts` — session recorder with start/stop/reset/dispose, 100-record ring buffer, 1 MiB recovery envelope, 16 KiB body previews, sensitive-header redaction, and session recovery hydration.
- `src/entry.ts`, `src/ui/shell.ts`, `src/ui/screens.ts` — recorder lifecycle state, Home controls/review rows, and promotion through the existing endpoint model.
- `tests/m2-core.spec.mjs`, `tests/m4.spec.mjs` — recorder unit coverage and Chrome fixture coverage for fetch/XHR capture, review, promotion, authorization redaction and recovery.
- `package.json` — version and description updated to M4.

**Commands and outcomes.**

- `node --test tests/m2-core.spec.mjs` -> 7 passed, 0 failed.
- `npm run build` -> exit 0. Final bundle: raw 94,958 B, minified 60,499 B, encoded bookmark URL 84,449 characters.
- `npx playwright test tests/m4.spec.mjs` -> 3 passed, 0 failed in Chrome 153.0.8010.53.
- `npm test` -> 24 browser tests passed and 9 native unit tests passed; Chrome 153.0.8010.53, macOS darwin 25.6.0, Node v24.21.0, Playwright 1.63.0.

**Verification.** Starting a recorder captures subsequent fetch and XHR calls, stopping leaves a reviewable draft, promotion creates a saved endpoint with the recorded method/path/sample response, sensitive authorization values do not appear in review, and the draft returns after relaunch. Fetch callers still receive their original response while the observer reads a clone; XHR response fields and headers remain native and readable by the page.

**Not run.** Saved-bookmark installation, Edge, configured JSON-path redaction, and manual cross-origin recovery/quota failure checks.

**Limitations.** Configured JSON-path redaction, deduplication suggestions, and the explicit include-tester toggle are still follow-up recorder polish. Tester exclusion uses the reserved `workbench://tester` source marker; the current direct tester remains separate from the page pipeline. Recovery is best-effort session storage and does not claim durable cross-origin storage.

**Next task.** M5 mock and chaos engines: replace the M0 feasibility matcher with profile-backed mock/chaos rules while preserving the shared pipeline and recorder trace contract.

## 2026-09-23 — M3 endpoints, profiles and direct tester (complete)

**Scope.** Completed M3: endpoint/profile CRUD and persistence, active environments and host mappings, direct Once execution, declarative checks, bounded result history, and native JSON export/import.

**Changed files.**

- `src/core/model.ts`, `src/core/storage.ts` — active environment, saved profile snapshots, schema-compatible normalization, IndexedDB persistence and native JSON validation.
- `src/entry.ts`, `src/ui/shell.ts`, `src/ui/screens.ts` — profile selection/save-as, environment host mapping, import workflow, check/result presentation and bounded run history.
- `src/tester/once.ts` — selected-environment resolution and direct native fetch execution.
- `tests/m3.spec.mjs` — M3 CRUD, persistence, authenticated Once, checks/history, profiles, environment mapping and JSON import coverage.

**Commands and outcomes.**

- `node --test tests/m3-tester.spec.mjs` → 2 passed, 0 failed.
- `npm run build` → exit 0; TypeScript and bundle safety assertions passed. Final bundle: raw 83,633 B, minified 54,420 B, encoded bookmark URL 76,168 characters.
- `npx playwright test tests/m3.spec.mjs tests/m0.spec.mjs tests/m1.spec.mjs` → 21 passed in 8.4 s.
  - Chrome 153.0.8010.53, macOS darwin 25.6.0, Node v24.21.0, Playwright 1.63.0.

**Verification.** Endpoint CRUD, same-origin IndexedDB relaunch persistence, saved profile selection, active environment host mapping, native JSON round-trip through the UI, direct page-session Once execution, unresolved-value blocking, header precedence, status/body checks, bounded result history, no configuration-request leakage, and all M0/M1 regressions pass in Chrome.

**Not run.** Saved-bookmark installation, Edge, full IndexedDB migration/failure/quota paths, result export, load/Flow execution, and manual cross-origin environment/CORS checks.

**Limitations.** Profiles are snapshots within one origin and switch the active configuration; import replaces the current configuration after validation but has no conflict-merge workflow. Result history is an in-memory bounded summary and is not yet durable. These are sufficient for M3’s Once path; load/Flow behavior belongs to M8.

**Decision.** Keep direct tester dispatch on the captured native `fetch`, separate from the page interception wrapper, so tester requests preserve native cookie/CORS behavior and do not create page traffic-rule side effects.

**Next task.** M4 recorder: subscribe to the shared pipeline, capture bounded/redacted traffic, preview records and promote selected records into endpoints.

## 2026-09-23 — M3 endpoint and profile foundation (in progress)

**Scope.** M3 endpoint/profile foundation plus the first direct Once tester slice.

**Changed files.**

- `src/core/model.ts` — typed profiles, endpoints, request templates, headers, checks and normalized header merging; stable IDs and defaults.
- `src/core/storage.ts` — origin-keyed IndexedDB repository with schema version 1, runtime validation, session fallback and native JSON export/import helpers.
- `src/entry.ts` — M3 version, config hydration, persistence mutations and protection against async hydration overwriting a first edit.
- `src/ui/screens.ts` — functional Endpoints CRUD/editor, global header entry, Settings profile rename/export and storage status; internal controls remain buttons.
- `src/ui/shell.ts` — passes M3 config actions into screen context.
- `src/network/pipeline.ts` — one activity report per request instead of duplicate resolution/lifecycle reports.
- `src/tester/once.ts` — direct native-fetch execution, current-origin auto-mapping, unresolved variable/host blocking, header precedence, bounded response capture and declarative checks.
- `tests/m3.spec.mjs` — endpoint CRUD, profile export, same-origin relaunch persistence, direct authenticated Once execution and no configuration-request leakage.
- `tests/m3-tester.spec.mjs` — unit coverage for pre-dispatch blocking, header precedence and response checks.
- `scripts/build.mjs`, `tests/fixtures/server.mjs` — raised the smallest full-payload probe from 65,536 to 131,072 characters because the complete M3 bookmark is larger than 65,536.
- `tsconfig.json` — allows explicit `.ts` imports for native Node unit execution.
- `package.json` — version and description updated to M3.

**Commands and outcomes.**

- `node --test tests/m3-tester.spec.mjs` → 2 passed, 0 failed.
- `npm run build` → exit 0; TypeScript and bundle safety assertions passed. Final bundle: raw 77,510 B, minified 50,625 B, encoded bookmark URL 70,911 characters.
- `npx playwright test tests/m3.spec.mjs tests/m0.spec.mjs tests/m1.spec.mjs` → 20 passed in 8.0 s.
  - Chrome 153.0.8010.53, macOS darwin 25.6.0, Node v24.21.0, Playwright 1.63.0.

**Verification.** Endpoint add/edit/delete, profile rename/export, IndexedDB-backed same-origin relaunch persistence, direct Once use of the page session cookie, status/body checks, zero API dispatch from configuration actions, and all M0/M1 transport/panel regression gates pass in the Chrome fixture.

**Not run.** Saved-bookmark installation, Edge, full IndexedDB migration/failure/quota paths, multi-profile switching/import UI, non-default environment selection, response-check detail rows, result history/export and load/Flow execution.

**Limitations.** The current profile editor exposes one active profile and JSON export but does not yet offer multi-profile switching/import UI. The Test screen supports one direct Once request and shows a bounded body summary; it does not yet show individual check rows or saved result history.

**Next task.** Finish M3 profile/environment selection, variable entry and visible check details, then add native JSON import UI and result history before moving to M4.

The milestone status table that used to sit here has moved to **Current state** at the top of this
file, where it is kept correct; this entry keeps only what was true on its own date.

## 2026-09-23 — M2 transport and rule core (verified)

**Scope.** Shared M2 rule resolution, immutable request context, lifecycle trace records, body analysis, cancellation-aware dispatch, and exact-match legacy compatibility for the M0 GET mock while keeping browser request behavior intact.

**Changed files.**

- `src/network/pipeline.ts` — added the shared request pipeline, `PipelineRule` and `PipelineDecision` resolution, deterministic priority ordering, glob/query/header conditions, body analysis, cancellation awareness, and a legacy M0 mock fallback that preserves the exact path-only `GET /api/mock-target` contract.
- `src/network/fetch-adapter.ts` — adapted native `fetch` calls into the shared pipeline and preserved abort handling while allowing synthetic mock responses where the rule decides to block network.
- `src/network/xhr-adapter.ts` — adapted native XHR calls to the same pipeline lifecycle and event semantics, including abort and completion traces.
- `tests/m2-core.spec.mjs` — expanded the unit checks to cover immutable context, lifecycle events, body policy, cancellation semantics, deterministic rule resolution, and disabled/non-matching exclusion.

**Commands and outcomes.**

- `node --test tests/m2-core.spec.mjs && npm run build && npx playwright test tests/m0.spec.mjs` → exit 0.
  - M2 unit suite: 6 passed, 0 failed.
  - build: exit 0, bundle safety assertion passed.
  - M0 browser fixture suite: 12 passed, 0 failed.

**Verification.**

| Gate                                    | Result | Evidence                                                                                                                                 |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| M2 rule resolution and lifecycle        | PASS   | Node tests cover immutable context, cancellation, body policy, deterministic winner selection, and disabled/non-matching rule exclusion. |
| Legacy exact-match compatibility        | PASS   | Reproduced against the browser fixtures: exact `GET /api/mock-target` still matches, while query-string variants do not.                 |
| Bundle safety and build integrity       | PASS   | `tsc` passed and `scripts/build.mjs` accepted the output without the runtime loader / external URL assertion firing.                     |
| Real browser transport regression check | PASS   | Playwright M0 fixture suite passed 12/12 in Chrome 153.0.8010.53.                                                                        |

**Not run.** Full M2 browser-only route/mock/chaos fixture coverage, the later M3+ modules, and saved-bookmark install/manual Edge validation remain outside this slice.

**Limitations.**

1. This is the shared transport foundation; the later route/mock/chaos modules remain separate and are not yet wired into the full UI.
2. The bundle is validated, but the broader M3+ feature matrix remains unimplemented.
3. Edge-specific and manual saved-bookmark checks remain not run.

**Decisions.**

- Keep request evaluation immutable: the matcher and decision logic operate on the original request snapshot and reject any later mutation.
- Preserve legacy M0 behavior only for the exact `GET` + exact `pathname` + empty query/hash case; broader query variations stay non-matching to preserve compatibility and prevent accidental rule broadening.
- Use a single shared pipeline for fetch and XHR so the transport contract is defined in one place rather than duplicated across adapters.
- Keep body inspection bounded and non-destructive; unsupported or oversized payloads are reported as omitted instead of being silently misinterpreted.

**Next task.** Move from the transport core into the next milestone and keep the verified M2 contract intact while expanding the request life cycle to the later route/mock/chaos modules.

## 2026-09-23 — M1 foundation and panel shell

**Scope.** M1 only: typed store, themed panel shell inside the existing shadow root, six-tab screen
navigation, drag, resize, minimize/restore. No engine, storage or rule work — those stay in M2+.

**Changed files.**

- `src/core/store.ts` (new) — typed store. State applies synchronously; subscriber notification is
  coalesced into one animation frame so a busy traffic log cannot force a render per request.
- `src/ui/dom.ts` (new) — `el`/`button`/`iconButton` helpers and the 17 inline SVG icons copied from
  the reference screens. `createElement`/`textContent` only: no HTML parsing, no Trusted Types policy.
- `src/ui/shell.ts` (new) — host element, shadow root, constructed stylesheet, header, tab bar, screen
  mount, footer, minimized launcher, pointer drag with viewport clamping, teardown.
- `src/ui/screens.ts` (new) — `UIState`/`Ctx`/`ScreenId` types, the nine screen definitions, the Home
  screen (M0 feasibility control, module cards, quick actions, run-history empty state) and the shared
  "not built yet" screen for the eight screens whose behavior belongs to M3–M9.
- `src/ui/theme.css` (new, replaces `src/panel.css`) — runtime additions to the untouched reference
  theme: system font stacks, scrollable body and code blocks, resize/drag affordances, focus-visible
  rings, button resets for tabs and quick actions, minimized launcher layout.
- `src/entry.ts` — now bootstraps store + shell and keeps the M0 transport capture, wrapping and
  restore-only-what-we-own teardown unchanged. Version `0.1.0-m1`. Host element renamed
  `#api-workbench-m0` → `#api-workbench`.
- `scripts/build.mjs` — CSS assertion path follows `src/ui/theme.css`; the absolute-URL assertion now
  strips the literal SVG XML namespace before testing; installer link renamed to `API Workbench`.
- `package.json` — version and description.
- `tests/fixtures/page.html` — added `#leak`, a host element reusing `aw-root`/`aw-btn`/`aw-card` class
  names, so style leakage is actually testable.
- `tests/m1.spec.mjs` (new) — six browser checks.
- `tests/m0.spec.mjs` — selector updates only (`#api-workbench`, installer link name, the panel
  selector now excludes the minimized launcher). No assertion was weakened or removed.

**Commands and outcomes.**

- `npm run build` → exit 0. raw 47,412 B, minified 34,042 B, encoded bookmark URL 47,138 characters
  (M0: 27,914 / 20,432 / 27,348).
- `npm test` (build + Playwright) → 18 passed in 6.8 s. Chrome 153.0.8010.53, macOS darwin 25.6.0,
  Node v24.21.0, @playwright/test 1.63.0, typescript 7.0.2, esbuild 0.28.2.
- `npx playwright test tests/m0.spec.mjs` → 12 passed; every M0 gate still passes against the M1 build.

**Verification — M1 gates.**

| Gate                                     | Result | Evidence                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No runtime external assets               | PASS   | Build asserts zero bundle imports and no absolute URL except the inline-SVG XML namespace; M0's zero-request check still passes; panel and code-block `font-family` contain no `Geist`, so the reference screens' web font is never requested.                                                                               |
| Repeated invocation creates one instance | PASS   | Re-run of the M0 double-launch gate: one `#api-workbench` node, `fetch`/`XMLHttpRequest` identities unchanged. Relaunch while minimized restores the panel instead of mounting a second one.                                                                                                                                 |
| No host navigation                       | PASS   | Every tab, header icon button and quick action is a `<button>`; the shadow root contains zero `<a>` elements; after visiting all nine screens `page.url()` is unchanged and no `framenavigated` event fired.                                                                                                                 |
| No style leakage                         | PASS   | Full computed-style strings of `#leak` (which deliberately reuses `aw-root`/`aw-btn`/`aw-card`), `h1`, `#login` and `body` are byte-identical before and after launch; `document.styleSheets`, `document.adoptedStyleSheets` and `document.head` child counts are unchanged; the panel's one sheet lives on the shadow root. |
| Screen navigation                        | PASS   | Six tabs mount their own screen, set `aria-current="page"`, and the four non-tab screens are reachable from the header and from Home.                                                                                                                                                                                        |
| Drag                                     | PASS   | Header drag moves the panel; dragging past the top-left clamps to ≥ 8 px and past the bottom-right keeps the panel fully inside the viewport; a pointer-down on a header control acts instead of dragging.                                                                                                                   |
| Resize                                   | PASS   | Computed `resize` is `both`; `max-width`/`max-height` stay within the viewport; at 340×220 px the header, tab bar and footer are still in the viewport, Close is still visible, and `.aw-body` scrolls (`overflow-y: auto`, `scrollHeight > clientHeight`).                                                                  |
| Minimize                                 | PASS   | Minimize hides the panel and shows the launcher; Restore returns to the screen that was open; the launcher reports `M0 mock active` while the feasibility mock is on, so activity is visible when minimized.                                                                                                                 |
| Typed store batching                     | PASS   | With a `MutationObserver` on the footer, 50 concurrent fetches produce fewer than 50 DOM mutations and the final text still reads `50 requests observed`.                                                                                                                                                                    |

**Not run.** Saved-bookmark installation, restart persistence, bookmark launch under CSP, and the
enlarged payload probes — still no automatable path to the bookmark UI, and the encoded URL is now
47,138 characters, so these matter more than at M0. All Edge checks — Edge is not installed on this
machine. Keyboard-only operation, zoom, small-viewport and host-CSS-interference sweeps beyond the
checks above were not run. No screen-reader verification.

**Limitations.**

1. Eight of the nine screens have no behavior. They state the milestone that will build them; they are
   not placeholder controls that look functional.
2. Resizing uses the native CSS `resize` grip: pointer only, bottom-right corner, no keyboard path.
   Marked with a `ponytail:` comment in `src/ui/theme.css`.
3. Panel position and size are in-memory only; nothing is persisted (storage is M3).
4. The profile selector is a disabled control until M3 supplies profiles.
5. The M0 feasibility mock control still lives on Home with its single exact-URL GET matcher; the real
   mock engine replaces it in M5.
6. No dialogs, drawers or focus management yet, so the "dialogs manage focus locally" contract in the
   plan is untested.

**Decisions.**

- **Tabs and quick actions are buttons, never anchors.** A link inside the panel could navigate the host
  application away; the shadow root is asserted to contain no `<a>` at all.
- **State applies synchronously, notification is batched per animation frame.** Transport settings
  (`pipeline.settings`) are written directly in the event handler so the mock decision can never lag the
  UI by a frame; only display updates wait for the frame.
- **Screens mount on navigation and register `ctx.watch` updaters** that are disposed when the screen is
  replaced. No virtual DOM, and typing in a field is never interrupted by a re-render.
- **Native CSS `resize` instead of custom handles**, with viewport-bounded `max-width`/`max-height`.
- **The reference theme file stays unmodified**; every runtime change lives in `src/ui/theme.css`.
- **Honest screen stubs.** A screen with no engine says which milestone builds it rather than showing
  controls that do nothing.

**Next task.** M2 — transport and rule core: immutable request contexts, the matcher/priority resolver,
body policy, cancellation and bounded trace events, replacing the single-URL M0 matcher.

## 2026-09-23 — M0 feasibility

**Scope.** M0 only: build/installer, shadow-root panel and lifecycle, shared fetch/XHR decision path, local fixtures, verification.

**Changed files.**

- `package.json`, `package-lock.json`, `tsconfig.json`, `playwright.config.mjs` — pinned dev toolchain (typescript 7.0.2, esbuild 0.28.2, @playwright/test 1.63.0), strict TS, no runtime dependencies.
- `scripts/build.mjs` — IIFE bundle, minified bundle with inline CSS, encoded `javascript:` bookmark with `void` completion, installer, size probes, `dist/sizes.json`. Asserts no bundle imports, no `eval`/`new Function`/`import()`/external URL in output, no `url()`/`@import` in CSS inputs, and round-trips an awkward-character encoding sample.
- `src/entry.ts` — single shadow-root panel (theme via constructed stylesheet), version/origin, activity area, mock toggle, bounded 0–10,000 ms delay, minimize/restore, close; idempotent relaunch; close restores only Workbench-owned transport references.
- `src/network/pipeline.ts` — the one decision path plus the owned-pending registry.
- `src/network/fetch-adapter.ts` — pass-through by default; synthetic `Response` and abortable delay for a selected mock; non-string/URL/Request inputs and unparseable URLs go straight to native.
- `src/network/xhr-adapter.ts` — `Proxy` `construct` trap over the captured constructor; real native XHR objects and events; synthetic fields only while a mock is selected; synchronous `send` always native.
- `src/panel.css`, `src/assets.d.ts`.
- `tests/fixtures/server.mjs`, `page.html`, `page.js` — two origins (4173/4174) with `/fixture`, `/login`, `/api/session`, `/api/mock-target`, `/api/slow`, `/api/error`, `/api/echo`, `/api/stats`, CORS allowed/denied routes and CSP + Trusted Types policy pages.
- `tests/m0.spec.mjs` — 12 browser checks.
- `docs/M0_REPORT.md` — evidence, decisions, limitations, outstanding manual steps.

**Commands and outcomes.**

- `npm run build` → exit 0. raw 27,914 B, minified 20,432 B, encoded bookmark URL 27,348 characters.
- `npx playwright test` → 12 passed in 4.9 s, Chrome 153.0.8010.53, macOS darwin 25.6.0, Node v24.21.0.
- `npm run fixture` → serves 127.0.0.1:4173 and :4174.

**Verification.** All automated gates PASS: build, double launch, session/credentials, fetch and XHR pass-through and mock with unchanged server hit counts, fetch abort, XHR abort/timeout matching native sequences, cleanup with earlier- and later-installed wrappers, CORS allowed/denied, zero runtime downloads, and panel operation under `style-src 'none'` + Trusted Types and under `connect-src 'none'`.

**Not run.** Saved-bookmark installation, restart persistence, bookmark launch under CSP, and the enlarged payload probes — no automatable path to the bookmark UI. All Edge checks — Edge is not installed on this machine. Automated launch injects the decoded bookmarklet source and is not evidence of saved-bookmark behavior.

**Limitations.** Top frame only (no iframes, workers, `sendBeacon`, EventSource, WebSocket). One exact-URL GET matcher. XHR conformance covers success/abort/timeout on the mock path only; broader conformance is M2.

**Decisions.** Recorded in `M0_REPORT.md`: single pipeline decision path; `Proxy` construct trap for XHR; constructed stylesheets for CSP/Trusted Types safety; restore-only-what-we-own on close.

**Next task.** Complete the outstanding manual checks listed in `M0_REPORT.md` (saved bookmark in Chrome and Edge, payload probes), then M1 — build tooling, themed panel, navigation, drag/resize/minimize.

## Entry format

After each implementation task, append a dated entry containing:

- Assigned milestone and scope.
- Changed files and implemented behavior.
- Exact commands and actual outcomes.
- Browser versions and manual verification, where performed.
- Required checks not run, failed gates and limitations.
- Decisions made and affected contracts.
- Next concrete task.

Do not mark a milestone complete solely because its source files exist or its UI is visible. Use the acceptance criteria in the build plan and the assigned task.
