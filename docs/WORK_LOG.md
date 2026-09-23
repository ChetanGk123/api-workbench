# API Workbench work log

## Current state

M0–M7 are implemented and verified in Chrome by automated checks (96 checks). Saved-bookmark
installation and all Edge checks remain outstanding for every milestone.

Current assigned work: M7 breakpoints complete and verified in Chrome, plus the M4 recorder review
flow rework (own screen, selection, per-candidate editing, profile creation). M8 (Flow/Independent
repeat runner) is next.

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
| M8 — Flow/Independent runs | NOT STARTED |
| M9 — Complete import support | NOT STARTED |
| M10 — Integrated release | NOT STARTED |

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
