# API Workbench work log

## Current state

M0–M5 are implemented and verified in Chrome by automated browser checks (52 checks). Saved-bookmark
installation and all Edge checks remain outstanding for every milestone.

Current assigned work: M5 mock and chaos complete and verified in Chrome. M6 (interception,
JSON Patch and routing) is next.

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

| Milestone                           | Status                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| M0 — Feasibility                    | CODE COMPLETE · automated gates PASS in Chrome · saved-bookmark and Edge checks NOT RUN                                    |
| M1 — Foundation and panel           | CODE COMPLETE · automated gates PASS in Chrome · saved-bookmark and Edge checks NOT RUN                                    |
| M2 — Transport/rule core            | CODE COMPLETE · automated gates PASS in Chrome · browser fixture and build checks verified                                 |
| M3 — Endpoints, profiles and tester | CODE COMPLETE · automated gates PASS in Chrome · saved-bookmark and Edge checks NOT RUN                                    |
| M4 — Recorder                       | CODE COMPLETE · focused unit and Chrome browser gates PASS · saved-bookmark, Edge, XHR and durable recovery checks NOT RUN |
| M5 — Mock and chaos                 | NOT STARTED                                                                                                                |
| M6 — Intercept and routing          | NOT STARTED                                                                                                                |
| M7 — Breakpoints                    | NOT STARTED                                                                                                                |
| M8 — Flow/Independent runs          | NOT STARTED                                                                                                                |
| M9 — Complete import support        | NOT STARTED                                                                                                                |
| M10 — Integrated release            | NOT STARTED                                                                                                                |

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
