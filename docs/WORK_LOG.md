# API Workbench work log

## 2026-09-25 — Check for update can see a new bookmark that never took over

**Reported.** package.json bumped to 1.0.1, rebuilt, the new bookmarklet saved as a bookmark — and the
1.0.0 panel already open on the page still answered *"Up to date: no build newer than 1.0.0 has run on
this origin."*

**That was correct, and useless.** The check is not a network request and cannot be: the product ships
as a self-contained bookmarklet with no loader or backend, and a build gate asserts zero runtime
downloads. It compares this build against `version:<origin>` in IndexedDB — the newest build that has
**launched** here — and 1.0.1 had never launched, so there was nothing to find. Worse, the one action
the user takes to make it known, clicking the new bookmark on that page, hit the already-running guard,
showed the version dialog and recorded nothing: the newer build ran on this origin and left no trace.

**Change.** The launch guard in `src/entry.ts` now records the launching build when it is newer than the
instance already running, before showing the dialog. `compareVersions` moves to module scope so the
guard can use the same ordering the check does. The running panel's next **Check for update** then reads
1.0.1 and says a newer build has run here.

**And the button stops implying a network call.** A line under it: *"Compares this bookmark against the
newest build that has launched on this origin. Nothing is requested from the network: launch the new
bookmarklet here once, then check again."* — which is also the instruction that makes it work.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0. `npm run build` → exit 0 at version **1.0.1**, minified 277,833 B.
- `npx playwright test` → **239 passed in 2.1 min**, Chrome, macOS darwin 25.6.0, Node v24.21.0. One new
  test in `tests/settings.spec.mjs` winds the origin's note back to 0.9.0, makes the running instance
  claim that version, launches the real build over it, dismisses the dialog and asserts the stored note
  is now the build under test — read from `package.json`, so the next version bump does not break it.

**Still not possible, stated.** A build that has never launched on an origin cannot be discovered from
that origin. This detects a stale bookmark once the new one has been clicked here, which is the case
that was reported; it is not an update feed.

## 2026-09-25 — Results hides Stop once there is nothing to stop, and Test opens on Load

**Two reports.**

**Stop outlived the run.** The Results footer carried a static Stop button, so a completed run — and
any run reopened from history — still offered to stop something. It is now hidden unless
`run.state === "running"`, updated from the store rather than built once. Hidden rather than disabled:
the Load view disables its Stop because a run is about to start there, but on a finished result the
control does not apply at all, and a permanently dead button is the defect 1.1 removed.

**Test opens on Load.** It opened on Once unless a run happened to be in flight. Load is where the
screen's work is — the plan, its phases, the preflight and the run — and Once is the quick single send
beside it, chosen rather than landed on.

**One exception, because the change would otherwise break something I built.** Run on an Endpoints row
sends the request and navigates to Test to show its result; opening on Load would have left the user on
a plan with their result out of sight. `openTestOn("once")` is set by that row and consumed by the next
render, so the view follows the reason for the visit and every other arrival opens on Load.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0. `npm run build` → exit 0, minified 277,637 B.
- `npx playwright test` → **238 passed in 2.0 min**, Chrome, macOS darwin 25.6.0, Node v24.21.0.
  - New: Stop is visible mid-run, stops the run, and is hidden on both the stopped run and the
    completed one after Run again; Test opens on Load, a row's Run lands on Once with its result, and
    the next ordinary visit is back on Load.
  - **Eleven existing tests changed.** They reached the Once view by opening Test, which used to land
    there; each now selects Once first. The failures were the change working, not breaking: every one
    was a test asserting the old default.

## 2026-09-25 — Latency is banded, and P95 explains itself

**Reported from a screenshot of a 29-endpoint breakdown.** Two problems in one table: **P95** was an
unexplained column heading, and 1 ms and 1506 ms were both plain white, so the reader did the
comparing. P95 was also the one column with a colour — amber whenever it had a value, which said
nothing about the value.

**Bands.** Green under 300 ms, amber to 1000 ms, red above it, applied to Avg, Min, Max and P95 alike,
and to the Avg and P95 summary tiles above the table, which had the same always-amber bug.

**Colour is never the only signal.** Every timing cell carries its band in words in a `title` —
`1303 ms · over 1000 ms` — so the reading survives a colour-blind reader, a greyscale screenshot and a
screen reader. A cell with no sample stays muted and says so.

**P95 says what it is** in two places: the column header's tooltip, and a line under the table —
*"P95 is the 95th percentile — 19 of every 20 samples were at least that fast."* Every other column
header gained a tooltip too, including what Fail counts (a failed check, an error, a timeout, an abort
or never having run). The existing nearest-rank definition from `TIMING_NOTES` is kept in the header
tooltip, so the exported JSON and the panel agree.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0. `npm run build` → exit 0, minified 277,367 B.
- `npx playwright test` → **236 passed in 1.9 min**, Chrome, macOS darwin 25.6.0, Node v24.21.0. One new
  test in `tests/m8.spec.mjs` runs a fast endpoint and a 1200 ms one and reads the **computed colours**
  back — `rgb(74, 222, 128)` and `rgb(248, 113, 113)` — then asserts the spoken band in each cell's
  title and the P95 explanation in the header and under the table.
- Screenshot read back with three endpoints at 15 ms, 503 ms and 1303 ms: green, amber and red in the
  same column.

**Thresholds are fixed, not configurable.** 300 ms and 1000 ms are ordinary web-latency bands; they are
two constants at the top of the breakdown, not settings, until someone needs them to be.

## 2026-09-25 — Every tab screen says what it is for

**Scope.** Follow-on from the Test heading below: the same one-line description on all six tab screens.

**Change.** `MODULE_DESCRIPTION` in `src/ui/rule-screens.ts` gives Mock, Intercept, Route and Chaos a
line under the title, and `moduleHeader` renders it between the name and the Activate button. Each
module screen now reads in one order — **name, what it is for, the control, what it is doing** — and
the last of those is the existing status hint, which is state rather than description and stays where
it was. Home takes a description too, naming the origin it is showing.

- Mock — answers matching requests from the panel instead of the server, with a status, headers and
  body you set.
- Intercept — edits matching requests and responses in flight, and can pause one at a breakpoint.
- Route — sends matching requests to a different origin or path, without touching the page's own code.
- Chaos — adds latency, failures and error statuses to matching traffic.
- Home — every module for this origin, what each is doing, and the ways into endpoints, recording and
  import.

**Home has no title block,** only the description: it is the index rather than a tool, and a "Home"
heading would repeat the tab just pressed.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0. `npm run build` → exit 0, minified 275,510 B.
- `npx playwright test` → **235 passed in 1.9 min**, Chrome, macOS darwin 25.6.0, Node v24.21.0. One new
  test walks all six tabs and asserts the description is the **first** hint on each screen, so it leads
  rather than trailing the controls, and that a module screen still carries its state hint as well.
- All six descriptions printed from the running panel and read back, plus screenshots of Home, Mock and
  Chaos.

## 2026-09-25 — The Test screen introduces itself

**Reported from screenshots.** Every rule module screen opens with a tile, its name and a line saying
what it does — `moduleHeader` in `src/ui/rule-screens.ts`. Test opened straight onto the plan picker,
the one screen that never said what it was.

**Change.** A heading in `testScreen`: the flask tile, **API Tester**, and one line —
*"Sends requests yourself and checks what comes back: Once for a single request, Load for a plan of
many."* No status chip, deliberately: a rule module's chip reports whether it is touching traffic, and
Test has nothing to activate. Built inline rather than extracted from `moduleHeader`, which carries an
activate button and module state that Test has no use for.

**Found while looking at it.** With no result yet, **Copy body**, **Save as response sample** and **Add
status check** rendered enabled. Their handlers return early with no result, so all three were live-
looking controls that did nothing — the defect 1.1 removed elsewhere, reintroduced by the 2.4 entry
above, which only set `disabled` inside `refresh()` and `refresh()` does not run before the first
result. They now start disabled and the first result enables them.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0. `npm run build` → exit 0, minified 274,908 B.
- `npx playwright test` → **234 passed in 1.9 min**, Chrome, macOS darwin 25.6.0, Node v24.21.0. One new
  test in `tests/ui.spec.mjs`: the heading reads API Tester with its description, the three result
  actions are disabled before any run, and Copy body is enabled after one.
- Screenshots of the Test and Mock screens taken and read back, to compare the two headers.

## 2026-09-25 — Load runs can save a response sample too

**Scope.** User request: Once has **Save as response sample**; Load had nothing like it.

**Why it needed a change below the UI.** `StepResult` carries an outcome, a status and timings, never
a body — deliberately, since a load run produces thousands of them. So there was nothing on a finished
run to save. `EndpointStats` now keeps one `response` per endpoint: the **last** real one (passed or
failed-check, so an HTTP response rather than a transport error), bounded at 16 KiB, which is the cap
the traffic log already uses. One per endpoint, newest wins, so a run of 3 iterations × 29 endpoints
holds 29 bodies, not 87.

**Results shows them.** A Response samples card under the outcome breakdown lists each endpoint that
returned one, with its status and whether the body was truncated. Saving writes the status, headers and
body onto the endpoint — the same shape Once writes, so the 2.3 editor and a mock's "Use recorded
response" read it the same way.

**Reviewed on a screenshot of a 29-endpoint run, then reworked.** Saving one row at a time is not a
workflow at that length, and the only feedback was a status line below the whole list, off-screen from
the row just clicked. Three changes, all in the card:

- **Save all (N)** in the card header saves every row that does not already hold this run's response,
  and counts what is left. It reads **All saved** and disables itself when there is nothing to do.
- **Each row states where it stands.** A row whose endpoint already holds this run's exact response
  shows a green **Saved** badge instead of a button. A row whose endpoint holds a *different* sample
  offers **Replace sample**, because "has a sample" and "has this run's sample" are different answers.
  An endpoint deleted since the run says **Endpoint removed** and does nothing.
- The status line moved **above** the list, under the card's own heading, so a bulk save reports where
  the eye already is.

**Then: the request side, and labels.** Reported next — the revealed block showed two unlabelled boxes,
so which one held the headers and which the body was left to the reader, and there was no sign of what
had been sent to produce the response. `OnceResult` now carries `requestHeaders` — the headers the
tester actually sent, after the global merge and template resolution, not the configured ones — and the
run retains them beside the response. The revealed block is three labelled sections: **Request headers
sent**, **Response headers**, **Response body**. Each header box is addressable by its own label, so a
screen holding one per endpoint can still be read.

**Before that: the response itself.** Reported next — the card offered to save a response it never showed, so
saving one was a guess. Each row now carries an expand button, `Show the response <alias> returned`,
which reveals the retained headers and the body, indented when it is JSON through the same `prettyJson`
the Once result uses. A truncated body says so where it is read, not only in the row. The button stays
after a save, because a stored row is still worth looking at, and the revealed block is labelled
`Response <alias> returned` so it can be addressed on a screen holding one per endpoint.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0. `npm run build` → exit 0, minified 277,655 B.
- `npx playwright test` → **233 passed in 1.9 min**, Chrome, macOS darwin 25.6.0, Node v24.21.0. One new
  test in `tests/m8.spec.mjs`: a two-endpoint run offers `Save all (2)`; saving one row turns that row
  into a Saved badge with no button left on it and drops the header count to 1; Save all then reports
  what it saved, reads `All saved` and disables; and the stored profile carries the status, a
  `content-type` header and the body for every endpoint.
- Four screenshots taken and read back: the mixed state (one row saved, three offering to save), the
  all-saved state, a revealed response, and the labelled three-section form showing `x-fixture: sent`
  under Request headers sent and `content-type` under Response headers.

**Bound, stated.** A retained body is capped at 16 KiB and the card says so; a longer response is marked
truncated rather than silently cut. Run summaries live in `UIState`, not in the stored configuration,
so these bodies are never written to IndexedDB.

**Not run.** Saved-bookmark installation and all Edge checks.

## 2026-09-25 — Landing-page usage guide

**Scope.** User-requested enhancement to generated `dist/index.html`; no runtime feature changes or milestone completion claims.

**Changed files.** `scripts/showcase.mjs` adds a linked guide covering Home, Endpoints, Test, Mock, Intercept, Breakpoints, Route, Chaos, Results, Record, Import and Settings. Includes concrete examples, rule activation, Once versus Load execution, and troubleshooting. Uses static HTML and the existing zinc palette, with no added dependencies or fetched assets. `docs/WORK_LOG.md` records verification. Rebuilt `dist/index.html` (generated artifact).

**Commands and measured outcomes.**

- `npm run build` — PASS; TypeScript and standalone asset checks passed. Landing page 430,803 bytes; encoded bookmark 392,937 characters at verification time.
- `npx playwright test tests/showcase.spec.mjs` — final run PASS, 2 tests in 1.4 seconds. Initial sandbox attempt could not bind port 4173; first unrestricted retry found the port occupied. An intermediate `npx playwright test tests/showcase.spec.mjs --config=/tmp/aw-showcase.config.mjs` (temporary configuration using the existing server) passed the file-page check but failed the fixture check after that server stopped. The final standard invocation started its own fixture and passed both checks.
- `node --input-type=module` with an inline Playwright check — PASS outside the sandbox: all 12 usage links resolve to unique articles with at least three steps; guide has no horizontal overflow at 390px. Chrome 153.0.8010.53, Node v24.21.0. Captured `/tmp/api-workbench-guide.png` at 1280×900 and visually checked Test/Mock typography, spacing and wrapping. The sandboxed browser launch was blocked.
- `git diff --check` — PASS.

**Not run / limitations.** Full runtime regression suite, Edge and actual saved-bookmark installation were not run for this static guide change. The bookmark-source fixture test is not saved-bookmark evidence. Existing runtime edits were left untouched. No milestone gates were advanced.

**Next milestone.** M10 integrated release and outstanding real saved-bookmark/Edge verification.

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

## 2026-09-25 — Closing, relaunching and version skew stop being silent (UX review 2.8)

**Scope.** `UX_REVIEW.md` 2.8, all three bullets. This completes Part 2 of the review.

**Close asks when there is something to lose.** The `×` stopped a run in flight and released every
request held at a breakpoint, both correctly and both without a word. It now confirms when
`run.state === "running"` or anything is paused, and the dialog names what will happen — how far the
run got, and how many held requests go back to the page. With nothing in flight it still closes on one
click, so the guard costs nothing in the ordinary case.

**Relaunching an open panel is visible.** Re-clicking the bookmark called `restore()`, which only
un-minimises: on an already-open panel nothing happened. `restore()` now also re-clamps the panel into
the viewport (`place`) and pulses its outline through an `aw-attn` class, dropped to a static outline
under `prefers-reduced-motion`.

**The version-mismatch alert is gone.** A tool that avoids touching the host page everywhere else
finished on a browser-modal `alert()`. The running instance now carries an optional `notify(title,
message)` that shows it in the panel's own dialog. Optional deliberately: a new build launched over an
older one finds no `notify` there and falls back to `alert`, which is the only thing that can work
against a build that shipped before this change.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0. `npm run build` → exit 0, minified 272,569 B.
- `npx playwright test` → **232 passed in 1.9 min**, Chrome, macOS darwin 25.6.0, Node v24.21.0.
  Three new tests: closing over a held request asks, Cancel leaves both the panel and the request
  alone, and confirming still releases it so the page's fetch settles at 200; closing with nothing in
  flight does not ask; relaunching adds `aw-attn` and a different version announces itself in the panel
  with `window.alert` never called. Two existing M7 close tests now confirm the dialog — they cover what
  happens after the yes, which is unchanged.

**Still open.** The `node:test` file whose failures the suite ignores, and its pre-existing recorder
failure.

**Not run.** Saved-bookmark installation and all Edge checks. The reduced-motion fallback is written
against `prefers-reduced-motion` but was not exercised with the setting on.

**Next task.** Part 2 is complete. What remains from the review is Part 1: 1.3 navigation (the tab strip
hidden on five screens, a Back button whose `aria-label` always says "Back to Home", inconsistent
Escape, no unsaved-edit guard), 1.5 naming, and 1.6 accessibility — plus the deferred items: endpoint
grouping, bulk delete, the query-parameter editor, and making the `node:test` files fail the run.

## 2026-09-25 — A refused write is no longer silent, and a backup carries everything (UX review 2.7)

**Scope.** `UX_REVIEW.md` 2.7, the section the review calls its most serious. Four of its seven bullets
were real; three had already been fixed since the review was written.

**Writes no longer fail silently.** `saveConfig`'s non-durable path updated memory and then swallowed
the IndexedDB error, so in a private window, with site data blocked, or out of quota, every edit looked
saved, and the whole configuration vanished on reload. It now propagates: `persist()` in `entry.ts`
records the outcome as `UIState.persistenceError`, cleared by the next write that lands. A banner
between the sub-header and the body — chrome, so it is on every screen and scrolls with none of them —
says what failed and that the work is only in this tab, with **Export now** beside it. Amber, not red:
the session still works, it is just not durable.

**A bug of my own on the way there.** The banner was first updated from `apply()`, which only runs on
minimize and restore, not on store changes. Injecting a failing write showed the handler running and
the banner staying hidden; three probes chased the wrong layer before instrumenting `persist()` proved
the error path fired. The update belongs in the store subscriber, where it is now.

**A backup carries everything.** `exportConfig` serialises one profile, which is right for sharing and
wrong for backup: a user with five profiles could back up one. `exportAll` in `src/core/storage.ts`
carries the live profile, its endpoints, rules and plan, plus every `savedProfiles` and `savedPlans`
entry, behind **Export all data** in Settings. **Restore all data** reads one back through
`restoreAllData`, which validates before it writes, writes **durably** so a reported success is a
written one, and replaces the live configuration, the rule engine and the tester state together. It
confirms first, naming the file and what it replaces.

**Storage usage** is reported from `navigator.storage.estimate()`, the only honest source for it, and
says so plainly when the browser does not provide it.

**The body-check limit says whose it is.** It sits under a card headed Core but lives at
`profile.settings.bodyLimitKb`; the card now names the active profile and says switching profiles
switches the limit.

**Already fixed, verified not redone.** The storage status line the review quotes
(`Origin-scoped storage · IndexedDB available`) no longer exists. `Clear stored data` exists and
confirms. The body limit is already clamped at 1,000,000 in both the input and the handler. Destructive
actions now confirm across the panel — Clear draft, endpoint delete, plan delete, Reset recorder and
Clear stored data — which was one bullet's complaint.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0. `npm run build` → exit 0, minified 270,810 B.
- `npx playwright test` → **229 passed in 1.8 min**, Chrome, macOS darwin 25.6.0, Node v24.21.0.
  Two new tests in `tests/settings.spec.mjs`: with every IndexedDB write refused, the banner appears,
  names the error, survives navigation and downloads an export from its own button, and a fresh launch
  with writes working shows no banner; a backup exports with `savedProfiles` and `savedPlans`, and after
  Clear stored data a restore brings the second profile back. One existing assertion was reaching for
  any text matching `this origin` and now names the About card's status line.

**Not done.** The review's note that there is "no import path that restores saved profiles" is answered
by Restore all data, not by teaching the Import review to take many profiles: the review screen is built
around one profile and its conflict resolution, and a backup restore is a replace, not a merge.

**Still open.** The `node:test` file whose failures the suite ignores, and its pre-existing recorder
failure.

**Not run.** Saved-bookmark installation and all Edge checks. The banner is verified with injected write
failures, not in a real private window or a browser with site data blocked.

**Next task.** UX review 2.8 — lifecycle: Close is unguarded while a run is in flight and while
breakpoints hold paused requests.

## 2026-09-25 — The recorder keeps what you choose, where you choose it (UX review 2.6)

**Scope.** `UX_REVIEW.md` 2.6, all three bullets.

**Recorded endpoints can join the profile already open.** The Record screen's only commit was
`createProfileFromRecordings`, which always mints a profile: recording three calls on a page you
already have a profile for forced a profile you did not want. **Add to this profile** sits beside the
new-profile field and calls the new `addRecordingsToProfile`, which appends the chosen endpoints to the
live profile, renames an alias that collides with one already there rather than overwriting it, merges
the recorded hosts into the active environment without disturbing a mapping the profile already has,
and adds only the bindings the plan does not already carry. The 2.1 entry kept the Import path for the
same capability; this is the same thing offered where the recording happens.

**A review row deletes the captures behind it.** Rows had only checkbox exclusion while Endpoints rows
had Delete — the review's "two list patterns for the same mental model". A row now carries a trash
button beside Edit. It drops the recordings themselves through the new `recorder.remove()` and
`removeRecordings`, not just the row: the review list is rebuilt from the capture buffer on every
capture, so a row removed from the list alone would come back, and captured traffic the user deleted
should not sit on in the buffer. The key that decides which captures belong to a row is now
`candidateKey()` in `src/recorder/promote.ts`, used both where candidates are grouped and where they
are deleted, rather than the same template string written twice.

**Reset recorder asks first,** naming how many captures and that every edit to the review goes with
them. A single row is not behind a dialog: it removes captured traffic, which the page can produce
again, where Reset discards the whole draft including hand edits.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0. `npm run build` → exit 0, minified 267,203 B.
- `npx playwright test` → **227 passed in 1.8 min**, Chrome, macOS darwin 25.6.0, Node v24.21.0.
  Two new tests in `tests/m4.spec.mjs`: recorded endpoints join the open profile, which stays `default`
  and ends two endpoints long with distinct aliases; a row delete drops its captures and the capture
  count falls with it, and Reset asks, keeps on Cancel and clears on confirm. One existing test now
  confirms the reset dialog.

**Still open.** The `node:test` file whose failures the suite ignores, and its pre-existing `M4 recorder`
failure — which is in `m2-core.spec.mjs`, not in the `m4.spec.mjs` touched here.

**Not run.** Saved-bookmark installation and all Edge checks.

**Next task.** UX review 2.7 — Settings, persistence and data safety, which the review calls its most
serious defect: the storage status line cannot report a failure, and writes fail silently.

## 2026-09-25 — Test → Load: a filter, a real ramp field, and a plan you can delete (UX review 2.5)

**Scope.** `UX_REVIEW.md` 2.5, all four bullets.

**The phase lists filter, and bulk include acts on what is listed.** `Include all` / `Exclude all` sit
on the phase heading and a search box filters the steps, using `matchesFilter` — the same rule the
Endpoints screen uses, moved from `src/ui/screens.ts` to `src/core/model.ts` so both screens share it
rather than importing one UI module into another (that would have made `screens.ts` and
`test-screens.ts` mutually circular). The filter text lives in a module-scoped record, because the
Load view is rebuilt from the store on every plan edit and an Include toggle **is** a plan edit; typing
in the box redraws only that list, since typing is not a plan edit.

**Ramp-up is a number with a unit.** It was a toggle beside the sentence `Admit a worker every 250 ms`,
which the review read as a button with a sentence for a caption — the 250 was a constant, not a
setting. `TestPlan.rampStepMs` is new and optional, `run.ts` waits `plan.rampStepMs ?? RAMP_STEP_MS`,
and the row is now a switch, a label, a number field and `ms per worker`, in the shape of Iterations and
Batch delay above it. The switch and the field carry different accessible names — a second control
called "Ramp-up" would be the Add header mistake again.

**The save button says what it does.** `savePlanAs` always mints a new id and de-duplicates the name,
so the disk button never overwrote anything: it is **Save as new plan**. There is no "Save" to confuse
it with, because an edit to the live plan is persisted as it is made and `selectPlan` writes the plan
being left back to storage.

**A stored plan can be deleted.** New `deletePlan` through `Ctx`, the shell and `entry.ts`, behind the
same confirmation as an endpoint delete, disabled while the live plan has never been stored. Deleting
the live plan moves to another stored plan, or to a fresh default: the picker is never left empty.

**The green dot is gone.** It was hardcoded `aw-dot aw-g`, always green whatever the state. The review
asked for a legend; there was nothing to explain.

**A runtime bug I introduced and caught.** `refreshPlans()` reads the new delete button to decide
whether it can be enabled, and it was being called before that `const` existed — a temporal dead zone
error that blanked the whole Test screen. It surfaced as 19 failing tests, and a probe reading
`pageerror` named it: `ReferenceError: Cannot access '$' before initialization`. The first refresh now
runs after the buttons are built.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0. `npm run build` → exit 0, minified 265,646 B.
- `npx playwright test` → **225 passed in 1.8 min**, Chrome, macOS darwin 25.6.0, Node v24.21.0.
  Three new tests in `tests/plans.spec.mjs`: delete asks, Cancel keeps and deleting the live plan leaves
  another in its place; ramp-up is disabled until the switch is on and the step it sets survives an
  export; the load filter narrows and Exclude all leaves a filtered-out step alone. Three existing
  assertions follow the renamed save button.
- Screenshot of the Load view taken and read back: the ramp row lines up with Batch delay above it and
  the bulk buttons sit on the phase heading.

**Still open.** The `node:test` file whose failures the suite ignores, and its pre-existing `M4 recorder`
failure.

**Not run.** Saved-bookmark installation and all Edge checks.

**Next task.** UX review 2.6 — the recorder.

## 2026-09-25 — The two Add header buttons say which list they add to

**Reported from a screenshot.** Test → Once showed two identical **Add header** buttons and read as a
duplicated control. They are two lists — the profile's globals and the selected endpoint's own — but
nothing said so: `headerFields()` ends each list with its own button, so the second list's heading
landed directly under the first list's button and read as a caption for it. Both buttons also carried
the same accessible name in one region, so a screen reader announced one control twice.

**Change.** `headerFields()` takes an `addLabel`, and every call site names its list: **Add global
header** for the profile's, **Add endpoint header** for an endpoint's, on Test, on Endpoints and in the
endpoint editor, so the same list is called the same thing everywhere. Each group on the Test card is
boxed with the reference theme's existing `.aw-inset`, so a heading, its rows and the button that adds
to them read as one block.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0. `npm run build` → exit 0, minified 264,048 B.
- `npx playwright test` → **222 passed in 1.8 min**, Chrome, Node v24.21.0. Five existing assertions
  now name the button they meant; one of them had been reaching for `.last()` to disambiguate, which
  is the same defect showing up in the tests.
- Measured at the 480 px default: the buttons are 147 px and 163 px wide, on their own rows, and the
  card lays out without overflow. Screenshot taken and read back.

**Note for 1.5.** This is one instance of the naming problem that section lists. The rest of it —
`Add ad-hoc rule` versus `Add rule`, `Manage rules` versus `Configure`, `Echo GET` versus `get_echo` —
is untouched.

## 2026-09-25 — The Once result reports the whole response (UX review 2.4)

**Scope.** `UX_REVIEW.md` 2.4, which asks for the run output to stop being worse than the fixture
page's own viewer.

**Already done, and not redone.** The review lists "pretty-printing of the JSON body" as missing. It
landed on 2026-09-24 ("Read-only JSON bodies are shown indented"); `refresh()` already renders
`prettyJson(body) ?? body`. Verified, not changed.

**Response headers.** `OnceResult` never carried them, so the panel could not have shown them. They are
captured in `src/tester/once.ts` as delivered and rendered in a **Response headers** disclosure under
the body, hidden when a request produced no response at all.

**Response size.** Also new on `OnceResult`: the decoded body's byte length, measured before the
profile's display limit truncates it, and shown beside the duration as `B` / `KiB` / `MiB`. A body that
was cut for display says so, so a size larger than the text on screen is explained rather than
confusing.

**Copy body.** Copies the indented text as shown, because that is what a reader means by "this
response". A browser that refuses clipboard access says so and tells the user to select and copy —
it never fails silently.

**Save as response sample** writes the status, headers and body onto the endpoint, so the sample the
2.3 editor shows is filled from a real run instead of typed. **Add status check** appends a check for
the status just observed, and says so if that check already exists rather than adding a duplicate.

**Not done: Re-run.** The review asks for it on the result. The **Run Once** button sits directly above
the result with the same endpoint already selected, so a second button would be the same click one row
lower. Left out deliberately.

**Accessibility, incidentally.** The body box is now labelled `Response body`. It had no name, and with
a second `pre.aw-code` in the same card the tests could no longer say which box they meant — which is
exactly the ambiguity a screen-reader user had all along.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0, no output. TypeScript 7.0.2.
- `npm run build` → exit 0. raw 463,232 B, minified 263,971 B, encoded bookmark URL 380,861 characters.
- `npx playwright test` → **222 passed in 1.8 min**, Chrome, macOS darwin 25.6.0, Node v24.21.0.
  - New: a run reports `HTTP 200` and a size, its headers list `content-type`, Copy body puts the body
    on the clipboard (read back through `navigator.clipboard.readText` with granted permissions), and
    Save as sample plus Add status check both land in an exported profile.
  - Changed: two existing assertions that said `pre.aw-code` inside the result card now say
    `Response body`; a second `pre` in that card made the old locator ambiguous.

**Still open.** `tests/m2-core.spec.mjs` runs under `node:test`: Playwright imports it, prints its
results and ignores them, and `M4 recorder subscribes to bounded, redacted traffic` has been failing
since before this work while the suite exits 0.

**Not run.** Saved-bookmark installation and all Edge checks. The clipboard path is verified in Chrome
with permissions granted by the test; a real user's first copy may show a browser permission prompt,
which was not exercised.

**Next task.** UX review 2.5 — Test → Load: no filter or select-all over the phase list, ramp-up
rendered as a sentence-shaped button, an indistinguishable Save/Save as pair, no way to delete a stored
plan, and an unexplained green dot.

## 2026-09-25 — Checks become editable, and the editor stops inferring (UX review 2.3)

**Scope.** `UX_REVIEW.md` 2.3. Four of its five bullets; the query-parameter editor is not done, for
the reason below.

**Checks are editable.** The review called view-only assertions the biggest single gap on its list.
`checkFields()` in `src/ui/dom.ts` is built like `headerFields()` — it edits a copy and hands the whole
list back on every change — and covers all five kinds the evaluator supports:

- **status**, as one exact code or, by filling the second field, an inclusive range. Emptying it turns
  a range back into a single status.
- **header**, name with an optional value; blank means "present with any value", which is what
  `evaluateCheck` already did with `value: undefined`.
- **body-contains**, one text field.
- **json**, a path plus `exists` / `equals` / `type`. `type` offers the four `typeof` names, because the
  evaluator compares `typeof actual === check.value` and a free-text field there is a silent failure.
  `equals` compares with `Object.is`, so its field is read as JSON when it parses (`5` is the number 5,
  `true` a boolean, `null` null) and literally when it does not; a string that would re-parse as
  something else is written back quoted, so the field round-trips exactly.
- **duration**, max milliseconds.

Changing a row's kind replaces the whole check rather than keeping fields from the old shape. The
disclosure's count follows the list as it is edited.

**Body kind is chosen, not inferred.** The save path read
`bodyKind: body.value ? (was === "none" ? "text" : was) : "none"`, so a JSON body typed into a new
endpoint was silently stored as text. There is now a Body kind select, and picking JSON or
form-urlencoded adds the matching `Content-Type` **only when the endpoint has not set one** — an
existing header is the user's and is left alone.

**The response sample is editable.** It was a `<pre>` with a Format JSON button that wrote into a draft
you could not type into. It is a textarea now. Formatting an empty sample used to mint one with
`status: 0`; emptying the field now removes the sample instead.

**The sub-header follows the Name field** as it is typed, instead of keeping the name the editor was
opened with.

**Not done: the query-parameter editor.** A params table has to round-trip through the Path field, and
that means re-encoding a path that may hold `{{alias.path}}` templates and hand-written escaping.
Getting that wrong corrupts a working endpoint, and typing the query into the path works today. It
stays an open item from 2.3 rather than a risky rewrite of the one field that currently cannot break.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0, no output. TypeScript 7.0.2.
- `npm run build` → exit 0. raw 461,565 B, minified 262,202 B, encoded bookmark URL 378,294 characters.
- `npx playwright test` → **221 passed in 1.8 min**, Chrome, macOS darwin 25.6.0, Node v24.21.0.
  - New: checks load into fields, a range becomes an exact status, an added check fails the next run and
    its failure is reported by name; body kind and its content type survive an export; a written sample
    formats and saves, and an emptied one leaves no `sampleResponse` behind.
  - Changed: `UI Format JSON is available on a recorded endpoint body and its response sample` reads the
    sample as a textarea value rather than `pre.aw-code`.

**Still open.** `tests/m2-core.spec.mjs` runs under `node:test`, so Playwright imports it, prints its
results and ignores them — `M4 recorder subscribes to bounded, redacted traffic` has been failing since
before this work and the suite still exits 0. Unchanged by this entry.

**Not run.** Saved-bookmark installation and all Edge checks.

**Next task.** UX review 2.4 — the run output: an unformatted body, and checks reported as a one-line
summary.

## 2026-09-25 — Endpoints gets a filter, a Run button and a Delete that asks (UX review 2.2)

**Scope.** `UX_REVIEW.md` 2.2. Four of its six bullets are addressed; two are deliberately not, with
reasons below.

**Filter.** A search field above the list, hidden until there are two endpoints. Every
whitespace-separated term must appear in `method name alias path`, so `get echo` narrows where `get`
alone would not. The count badge reads `N of M` while filtering. `src/ui/screens.ts`.

**The list redraws, the screen does not.** A filter, a move and a delete now rebuild only the list
element. Moving one endpoint was 28 `ctx.go("endpoints")` calls, each a full screen rebuild.

**Reordering is refused while filtered.** A filtered list hides the neighbour a move would swap with,
so Move up/down are disabled with the filter set and say why in their title.

**Delete asks first,** naming the endpoint, through the same `confirmDialog` used elsewhere. The review
called a one-click Delete beside Edit the most likely accidental data loss in the product.

**Run on the row.** A play button per row runs that endpoint and opens Test. The Once selector now
follows the result it is showing: `refresh()` sets it from `testerResult.endpointId` and redraws the
headers card, so arriving from an Endpoints row does not leave the picker naming a different endpoint
than the result below it. `src/ui/test-screens.ts`.

**Not done, deliberately.** *Grouping by tag, path prefix or method* — the filter covers the same need
(`get /pets` is a group), and grouping is a layout design the review does not specify. *Multi-select and
bulk delete* — real work, and the case for it is pruning a large import, which is better served where
per-row include checkboxes and Select all / Clear already exist: the Import review screen. Neither is
started; both remain open items from 2.2.

**A regression of mine, found and fixed.** `tests/m2-core.spec.mjs` uses `node:test`, not Playwright.
Playwright's `testMatch: '*.spec.mjs'` imports it, so its cases run at collection time and print to
stdout — and Playwright reports "No tests found" for that file and **exits 0 whatever they do**. Under
that blind spot, the `location.origin` shortening added to `pipeline.ts` in the 2026-09-25 activity-log
entry was failing three of its cases (`location` does not exist in Node). It is now guarded with
`typeof location === "undefined"` and those three pass.

**A pre-existing failure, not fixed here.** The fourth case in that file, `M4 recorder subscribes to
bounded, redacted traffic and disposes cleanly`, fails at commit `02cf980`, before any of this work —
verified by checking out that tree's `src/` and re-running. It is unrelated to 2.2 and left alone, but
it is a failing gate that the suite's exit code hides. **Both of these deserve their own task: make the
`node:test` files fail the run, then fix that case.**

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0, no output. TypeScript 7.0.2.
- `npm run build` → exit 0. raw 452,878 B, minified 257,293 B, encoded bookmark URL 370,941 characters.
- `npx playwright test` → **218 passed in 1.7 min, exit 0**, Chrome, macOS darwin 25.6.0, Node v24.21.0.
  Three new tests: the filter and its refusal to reorder; Delete asks and Cancel keeps; Run sends and
  opens Test on that endpoint. Two existing tests now confirm the delete dialog (`m3`, `ui`).
- One earlier full run failed `UI Home Activity lists the observed requests` once and passed it in
  isolation and on two further full runs. The cause was not identified; the assertion read the rendered
  log once instead of polling it, and now polls, which removes the race whatever it was.
- Measured, endpoint row with five icon buttons: at the 480 px default the name field is 220 px; at the
  320 px minimum width it is 60 px and truncates with its `title` intact. No horizontal overflow at
  either width.

**Not run.** Saved-bookmark installation and all Edge checks.

**Next task.** UX review 2.3 — the endpoint editor: checks are read-only, rendered as a `<pre>` of JSON.

## 2026-09-25 — Import stops being a recorder, and its review is no longer below the fold (UX review 2.1)

**Scope.** `UX_REVIEW.md` 2.1, all three bullets. The import flow itself was called the best part of
the product and is unchanged; these are the two problems around it plus the missing confirmation.

**The recorder card is gone, the one thing only Import could do is not.** The review's fix was "drop
the card". Dropping it whole would have deleted a capability, not just a duplicate entry point: the
Record screen's only commit is `createProfileFromRecordings`, which always creates a **new** profile,
while the Import card's Stop button ran `parseRecordings` into the draft, which is the only path that
merges recorded calls into the **active** profile. So the three duplicated controls (Start recording,
Stop recording, Open recorder screen) are deleted, and the bridge survives as one button in the input
card's action row beside Choose file: **Use recorded calls (N)**, disabled when nothing is captured.
Recording is now started only from Home or the Record screen. `src/ui/import-screen.ts`; the per-second
status interval went with the card.

**Apply now scrolls its review into view.** `showReview()` sets `.aw-body`'s `scrollTop` directly
rather than calling `scrollIntoView`, which can walk up to the document and scroll the host page —
something a bookmarklet must never do. Called after a successful Apply and after Use recorded calls.

**Clear draft asks first.** It discarded a pasted spec on one click while loading a file over a draft
already confirmed. It now uses the same `confirmDialog`, and still clears without a prompt when there
is no draft to lose.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0, no output. TypeScript 7.0.2.
- `npm run build` → exit 0. raw 450,889 B, minified 256,297 B, encoded bookmark URL 369,487 characters
  (smaller than before: the card cost more than the button).
- `npx playwright test` → **215 passed in 1.7 min**, Chrome, macOS darwin 25.6.0, Node v24.21.0.
  - New: `M9 Import is not a third recorder, and its review is not left below the fold` — the three
    recorder buttons are absent, Use recorded calls is disabled with nothing captured, and after Apply
    the body has scrolled (`scrollTop > 0`) with the review in its top half and the host page's own
    scroll position untouched.
  - Changed: `M9 the recorder promotes only the selected captured calls` now starts recording on the
    Record screen and promotes from Import, which is the preserved path stated above.
  - Changed: `M9 the same source imported from a file and from a paste` confirms the Clear draft
    dialog.

**Deviation from the review, stated plainly.** 2.1 says "drop the card; keep Record as a quick action
and a Home card". Dropped is the card and all three duplicate entry points; kept is one button, because
the alternative silently removes merging recordings into the current profile. If that capability is not
wanted, deleting `useRecorded` and the `recorder` entry in `FORMATS` finishes the review's version.

**Not run.** Saved-bookmark installation and all Edge checks. The review's other 2.1 observation — that
the reference block is long — is addressed by scrolling past it, not by collapsing it into a
`<details>`; the "Supported formats" card still renders below the review, where it was already.

**Next task.** UX review 2.2 — Endpoints: no search, no grouping, one-step reordering, no bulk actions,
and a one-click Delete with no confirmation, which the review calls the most likely accidental data
loss in the product.

## 2026-09-25 — The panel opens taller and remembers where it was left (UX review 1.4)

**Scope.** `UX_REVIEW.md` 1.4: the panel opened at 480x560 and every launch discarded the size and
position the user had chosen.

**Opening size.** `src/ui/theme.css` — `height: min(720px, calc(100vh - 96px))` in place of a flat
`560px`. `max-height` is unchanged at `calc(100vh - 16px)`, so this raises the opening size only; a
drag can still take the panel to the full viewport. The `- 96px` keeps the panel off the bottom of a
short screen rather than swallowing it.

**Remembered geometry.** Stored per origin, never in the profile.

- `src/core/storage.ts` — `readPanelGeometry()` / `recordPanelGeometry()` under a `geometry:<origin>`
  key beside the existing `version:<origin>` note, for the same stated reason: it belongs to the
  origin, not to a profile, and must not travel through export, import or a profile switch.
  `clearStoredConfig()` now deletes it too. The two IndexedDB single-key helpers the launch version
  already used are generalised into `readKey`/`writeKey`, so this adds no third copy of that dance.
  Stored geometry is validated on read (`Number.isFinite` on all four fields): a corrupt record must
  not place the panel at `NaN`.
- `src/ui/shell.ts` — a new `onGeometry` option, called when a header drag or a resize grip settles,
  and `setGeometry()` to apply a remembered one. A pointerup that never moved is not a write, so
  clicking the header does not touch storage. The minimized launcher shares the position but not the
  size and is deliberately not recorded: a hidden panel measures 0 x 0.
- `src/entry.ts` — reads the geometry after `mount()`, so a slow or failed read costs a reposition
  rather than the panel's appearance.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0, no output. TypeScript 7.0.2.
- `npm run build` → exit 0. raw 451,623 B, minified 256,848 B, encoded bookmark URL 370,262 characters.
- `npx playwright test` → **214 passed in 1.7 min**, Chrome, macOS darwin 25.6.0, Node v24.21.0.
  Two new tests in `tests/ui.spec.mjs`: a resize and a drag survive a reload and relaunch; a launch
  that only clicked the header writes no geometry and opens at the default. The existing compact-panel
  test now derives the expected opening height from the viewport instead of asserting 560.

**Measured, at 1600x1000 (the review's own viewport).** The panel now opens 480x720, as the review
asked. Home's content is 1039 px against a 577 px body, so it still scrolls: cards fully visible go
from **3 of 7 at 560 px to 4 of 7 at 720 px**. The extra height helps and does not fix the density;
Home carries 1039 px of content in a 480 px-wide column, and some of that growth is the new Activity
log from the 1.2 entry above. Making Home fit is a layout question the review does not prescribe and
was not attempted here.

**Not run.** Saved-bookmark installation and all Edge checks, as for every milestone. The endpoint-list
density after importing the 29-endpoint `openapi.json` was not re-measured: three attempts at driving
that import from a throwaway probe failed on the review screen's controls, and the measurement is not
needed to land the change. Geometry is not written when the tab closes mid-drag — the IndexedDB write
is asynchronous, which the new test waits for explicitly rather than assuming.

**Next task.** UX review 1.3 — navigation: keep the tab strip mounted on every screen, give Back a
truthful `aria-label`, make Escape consistent across the five editors, and guard unsaved edits.

## 2026-09-25 — The Activity card becomes a real request log (UX review 1.2)

**Scope.** `UX_REVIEW.md` 1.2, all three bullets.

**`settings.enabledModules` — no change, the finding is stale.** The review read it as written but
never read. It is read now: `moduleEnabled()` in `src/core/model.ts` drives the tab strip
(`shell.ts:268,270`), the Home module cards and quick actions (`screens.ts:573,578`) and the
Settings toggles that write it (`screens.ts:926`). The module switches landed after the review was
written. Removing it would delete a working feature, so it stays.

**`replaceProfile()` — deleted.** `src/core/storage.ts`, zero callers, and it took a `config`
argument it ignored while saving a config with no `savedProfiles` or `plan`. Its two now-unused type
imports went with it.

**The Home Activity card is now the request log.** It was a `<pre>` holding `"{n} observed"` and the
single most recent message, overwritten by the next request.

- `src/entry.ts` — `activity` is a bounded list (`ACTIVITY_LIMIT = 50`, newest first) instead of one
  string. `report()` stamps each entry with `Date.now()`.
- `src/ui/screens.ts` — `UIState.activity` is `ActivityEntry[]`; the card renders one `HH:MM:SS`
  line per entry and the count moves to the caption (`Activity · N observed`), so the box is log and
  nothing else. It stays a `<pre class="aw-code">`, which already scrolls past 160 px and carries the
  platform resize handle, so no new markup or CSS.
- `src/network/pipeline.ts` — the trace message now carries the URL, without which a log of
  `fetch GET · request` repeated 50 times says nothing. A same-origin URL is logged as its path; a
  cross-origin one is left whole, because the destination is the point.

The pipeline's own 64-entry `trace` array is unchanged and still the structured record; this is the
view of it the panel was missing.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0, no output. TypeScript 7.0.2.
- `npm run build` → exit 0. raw 449,931 B, minified 256,059 B, encoded bookmark URL 369,081 characters.
- `npx playwright test` → **212 passed in 1.7 min** (211 + one new), Chrome, macOS darwin 25.6.0,
  Node v24.21.0. New test: `tests/ui.spec.mjs` "UI Home Activity lists the observed requests, newest
  first" — three fetches produce three stamped lines, newest first, and the caption counts them.
- Measured before the change, for comparison: three fetches left `3 observed` and the one line
  `fetch GET · request`.

**Fixture-server dependency found.** Two M8 tests (`a Flow iteration passes its own producer value`,
`a setup step runs once for the run`) build request paths out of the fixture server's live hit
counter — `/api/m8-child-{{seed.hit}}` — and then assert on `m8-child-1..3`. They pass only against a
freshly started `tests/fixtures/server.mjs`; run against a server that already served that suite they
hit `m8-child-4..6` and fail. Reproduced both ways. `server.mjs` has no reset endpoint (the separate
`/api/test/reset` only clears `test-api.mjs` state). Not fixed here, not caused by this change.

**Not run.** Saved-bookmark installation and all Edge checks, as for every milestone. The 50-entry cap
is not covered by a test; it is a `.slice(0, 50)` on one line.

**Next task.** UX review 1.3 — navigation: keep the tab strip mounted on every screen, give Back a
truthful `aria-label`, make Escape consistent across the five editors, and guard unsaved edits.

## 2026-09-24 — The two dead header buttons are gone (UX review 1.1)

**Scope.** `UX_REVIEW.md` 1.1: `Presets…` and `Promote common` sat under the global headers card
on Endpoints, permanently `disabled`, explaining themselves only through a `title` tooltip that a
disabled control rarely shows.

**Change.** Both buttons and the `unavailable()` helper that existed only to build them are deleted
from `src/ui/screens.ts`. Nothing else referenced either. Header presets and common-header promotion
stay in `API_WORKBENCH_BUILD_PLAN.md` as work, not as inert UI.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0, no output. TypeScript 7.0.2.
- `npm run build` → exit 0. raw 449,440 B, minified 255,734 B, encoded bookmark URL 368,652 characters.
- `npx playwright test` against the already-running fixture server (a temporary config with
  `webServer: undefined`, because port 4173 was held by an existing `npm run fixture`) →
  **211 passed in 1.8 min**, Chrome, macOS darwin 25.6.0, Node v24.21.0.

**Not run.** Saved-bookmark installation and all Edge checks, as for every milestone.

**Next task.** UX review 1.2 — remove `settings.enabledModules`, remove the uncalled
`replaceProfile()`, and decide what replaces the one-line Home **Activity** card.

## 2026-09-24 — Headers are visible and editable where a request is run

**Scope.** The Test screen ran an endpoint without showing what it would send. Headers lived only
in the endpoint editor and on the profile, two screens away from the Run button.

**Change.** A collapsed **Headers** card on both Test views, with a badge for the number the
request will carry.

- **Once** — the profile's global headers and the selected endpoint's own, both editable, the
  second relabelled as the selector changes. The badge is the merged total, so a global replaced by
  a same-named endpoint header is counted once.
- **Load** — the global headers, which every planned request carries, and a line saying an
  endpoint's own headers are edited on Endpoints.

Edits write to the profile and to the endpoint, so a run sends exactly what the card shows; there
is no per-run override state that a run could ignore.

**Refactor.** `headerFields` moved from `screens.ts` to `dom.ts` and takes an `AbortSignal` rather
than a `Ctx`, which is all it ever used. Importing it from `screens.ts` would have created a real
import cycle, since `screens.ts` imports the Test screens.

**Two bugs found while building, both fixed.**

- The first version called `draw()` from the save callback, which replaced the input being typed
  into: the header name committed and the value was silently lost. The wire assertion caught it
  (`"header": null`, stored value empty). A save now only retotals the badge.
- The Load card is built once and moved into each render, like the page-context and history cards:
  writing a global header re-renders the plan, which would otherwise close the card mid-edit.

**Tests.** `tests/ui.spec.mjs` — a header typed on the Test screen comes back in the echo
response as `"header": "from-test-screen"`; the badge reads the merged total; changing the selector
shows the other endpoint's headers; and a Load-view edit persists into the exported profile with
the card still open. Both tests scope to `details:visible`, since the hidden view's card stays in
the DOM.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0, `npm run build` → exit 0.
- `npx playwright test` → 211 passed in 1.7 m on a freshly started fixture server, Chrome
  (channel `chrome`), macOS darwin 25.6.0, Node v24.21.0.

**Not run.** Edge, saved-bookmark installation.

**Limitations.** Load shows profile-wide headers only; a plan step's own headers are still edited on
Endpoints. Header removal in the card deletes the row rather than marking `removed`, so suppressing
a global header for one endpoint still needs the endpoint editor.

**Next task.** M10 — integrated release.

## 2026-09-24 — A recorded credential replays from the page, and is still never stored

**Scope.** Follow-up to the entry below, after the user confirmed the missing header was
`Authorization`. Naming the dropped header was not enough: a recorded endpoint should send the
request that was recorded.

**Approach.** The recorder sees the real header value at capture — redaction happens on the way to
storage — so it now locates that value among the page's `localStorage`, `sessionStorage` and cookie
entries and keeps only its address: `{ source, key, prefix }`. Nothing secret is written: the
prefix is the scheme word, such as `Bearer `. `endpointFromRecording` rebuilds a traced header as
`Bearer {{$context("local_app_access_token")}}`, the candidate carries the matching
`ContextBinding`, and creating a profile from the review seeds the new plan's bindings with them,
so the template resolves from the first run.

**Guards.** The stored value must be a *suffix* of the header and the remaining prefix must match
`/^[A-Za-z]* ?$/`, so a secret cannot end up inside the prefix. Values shorter than 8 characters are
not matched. `Cookie` and `Set-Cookie` are never rebuilt this way — the browser attaches cookies
itself and `document.cookie` cannot read an HttpOnly one anyway. A credential that cannot be traced
keeps the previous behaviour: dropped, and named in the review as not found on the page.

**Changed files.** `src/recorder/recorder.ts` (`CredentialSource`, page lookup, `credentials` on a
`Recording`), `src/recorder/promote.ts` (traced headers become templates, `Candidate.bindings`),
`src/tester/context.ts` (`nameFor` exported so a binding name matches Scan page's), `src/ui/
screens.ts` (review wording, bindings passed on profile creation), `src/entry.ts`
(`createProfileFromRecordings` seeds the plan's bindings).

**Tests.** `tests/m4.spec.mjs` — records a real bearer-authenticated call against the fixture's
`/api/test/auth`, creates a profile from the review, replays with Run Once and requires
`HTTP 200` with `"authenticated": true`; then asserts the stored header is the template, the plan
holds the binding, and the raw token appears nowhere in the stored configuration.
`tests/m4-core.spec.mjs` — a recording carrying `credentials` produces the template header, the
binding, and an empty `dropped`.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0, `npm run build` → exit 0.
- `npx playwright test` → 209 passed in 1.7 m on a freshly started fixture server, Chrome
  (channel `chrome`), macOS darwin 25.6.0, Node v24.21.0.

**Not run.** Edge, saved-bookmark installation. Tracing is exercised against a token held as a
plain string in `localStorage`; a token wrapped inside a JSON blob, or held only in a closure, is
by design not traced and falls back to the named-and-dropped notice.

**Next task.** M10 — integrated release.

## 2026-09-24 — A recorded credential that cannot be replayed now says so

**Reported.** On a real site, running a recorded `POST /api/v1/birthday_list` returned
`You're not authorised to access., try logging in.` while the page's own call succeeded, read as
the tool reporting something other than what the backend sent.

**Finding — not a reporting defect.** The panel showed what that request received. The request
differed: the recorder redacts `authorization`, `cookie`, `set-cookie`, `proxy-authorization`,
`x-api-key` and `x-auth-token` (`recorder.ts`), and `endpointFromRecording` drops a redacted header
rather than replaying the marker, so the replay is unauthenticated. The reported endpoint name
carries the recorder's `METHOD pathname` form, so it came from a capture. The API answers with
HTTP 200 and an error envelope, so the status check passes and the run reads as `passed`.

**Reproduced** against the fixture's bearer-protected `/api/test/auth`: the page's own call returns
200 `{"authenticated":true}`; the same call recorded, promoted and replayed returns 401 with
`request.headers: []`.

**Workaround verified end to end.** Scan page → Local storage → Use on the token, then an
`Authorization: Bearer {{$context("local_aw_demo_token")}}` header on the endpoint: Run Once
returns 200 with the authenticated body. The binding resolves at dispatch, so no credential is
stored and a rotated token still works.

**Change.** `Candidate` carries `dropped: string[]` — the header names the capture redacted, unioned
across the calls that collapse into one endpoint — and the recorder review prints them on that row:
`authorization recorded but not stored. Add it as a header — {{$context("…")}} reads the live value
at send.` Rows with no credential say nothing. The redaction and the drop are unchanged: a
credential is still never written to a profile. Reusing `HeaderValue.removed` was rejected — a
removed local header also suppresses a global header of the same name, which would silently strip a
profile-wide `Authorization`.

**Tests.** `tests/m4-core.spec.mjs` — the existing redaction check now also asserts the candidate
names the dropped header, plus a new check that repeated calls report each credential once, that
non-credential headers still arrive, and that a request without credentials reports none.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0, `npm run build` → exit 0.
- `npx playwright test` → 207 passed in 1.7 m on a freshly started fixture server, Chrome
  (channel `chrome`), macOS darwin 25.6.0, Node v24.21.0.

**Not run.** Edge, saved-bookmark installation. The reporting user's own site was not inspected:
the mechanism is reproduced locally and their endpoint's origin is inferred from its recorder-shaped
name, so that their case is this case is a strong inference, not a measurement.

**Open.** The notice appears at capture time. The confusion happens at replay time, where the
endpoint no longer knows what was dropped; carrying it onto the endpoint would make the Once result
able to say it too. Not built — offered to the user.

**Next task.** M10 — integrated release.

## 2026-09-24 — The result box resizes, and holds the response alone

**Reported.** The Once result box could not be made taller, and the `Checks / passed · status 200`
trailer inside it was not wanted.

**Resizing.** `.aw-code` carries the platform's own `resize: vertical` handle. The 160px cap moved
to `.aw-code:not([style*="height"])`, so a box sizes to its content until the handle is dragged —
at which point the browser writes a height into the element's style attribute, the selector stops
matching and the cap is gone. Without that split the handle could only shrink a box, since
`max-height` would keep winning over the dragged `height`. No script, and every read-only code box
gains it: the Once result, a traffic log's stored body, the saved response sample and the activity
log. Measured: 115px at rest with `max-height: 160px`, 358px after a height is set with
`max-height: none`.

**Checks trailer.** `src/ui/test-screens.ts` renders the response body alone. A passing run's
outcome is already the status line above it (`passed · HTTP 200 · 7 ms`). What that line does not
carry is *which* check failed, so failed checks — and only failed ones — now render as red lines
under the box rather than as text appended to the response.

**Tests.** `tests/ui.spec.mjs` — the body is indented and contains no `Checks`; a run whose only
check cannot pass reports exactly one red line outside the body and nothing inside it; the box is
`resize: vertical`, capped at 160px at rest and uncapped once a height is set.
`tests/m3.spec.mjs` asserted the old trailer and now asserts its absence.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0, `npm run build` → exit 0.
- `npx playwright test` → 206 passed in 1.7 m on a freshly started fixture server, Chrome
  (channel `chrome`), macOS darwin 25.6.0, Node v24.21.0.

**Not run.** Edge, saved-bookmark installation. The resize handle is exercised by setting the
height the browser would set; a real pointer drag on the native handle was not automated.

**Next task.** M10 — integrated release.

## 2026-09-24 — Read-only JSON bodies are shown indented

**Scope.** The Once result printed the response body exactly as it arrived, so a one-line JSON
payload wrapped across the card. Editable JSON fields already had `formatJsonButton`; a read-only
display has nothing to press, so it formats itself.

**Change.** `src/ui/test-screens.ts` (Once result) and `src/ui/rule-screens.ts` (the traffic log's
stored response body) render `prettyJson(body) ?? body` — the helper already in `dom.ts`. It
returns null for anything that is not JSON or is already indented, so a non-JSON body is shown
exactly as it arrived and nothing is re-stringified twice. The endpoint sample response was left
alone: it is an editable draft field with its own Format control, and formatting there is a saved
edit rather than a display choice.

**Test.** `tests/ui.spec.mjs` — a Once run against the fixture asserts the rendered body matches
`/\{\n\s+"source"/`, which the server's single-line JSON cannot.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0, `npm run build` → exit 0.
- `npx playwright test tests/ui.spec.mjs` → 16 passed.
- `npx playwright test tests/settings.spec.mjs tests/m3.spec.mjs tests/m5.spec.mjs tests/m6.spec.mjs`
  → 38 passed.
- The clean full-suite run recorded with the previous entry was 203 passed.

**Next task.** M10 — integrated release.

## 2026-09-24 — Red badges collapsed into the radio dot `aw-rd` also names

**Reported.** A failed Run Once drew its `network-error` outcome as red text spilling across the
run-history row instead of a badge.

**Cause.** `design/reference/aw-theme.css` gives `.aw-rd` two meanings: the red badge tone at
line 69, and the 16×16 radio-dot geometry at line 122. The second wins, so every red badge in the
app rendered as a 16px circle with its text overflowing, and every `p.aw-hint.aw-rd` error line
rendered as a circle too. `.aw-quick` already restated the geometry for one case — the Remove
operation button — which was the same collision fixed once, locally.

**Fix.** `src/ui/theme.css` restates the geometry for the two shapes that are not that radio:
`.aw-bd.aw-rd` (pill: auto width, 20px high, red border and tint restored) and `p.aw-rd` (plain
block text). The reference sheet stays unmodified, as the build requires. This repairs the run
history row, a failed plan step's badge, the mock rule row's non-2xx status badge, and the error
paragraphs on Results and Import.

**Test.** `tests/ui.spec.mjs` — a profile pointed at a port nothing listens on makes Run Once fail
for real, then the row's badge is measured: `scrollWidth <= clientWidth` (its text fits) and
`clientWidth > clientHeight` (a pill, not a circle). Verified to fail without the fix
(scrollWidth 44 against clientWidth 14) and pass with it.

**Also reported: Run Once failing while Load runs pass.** Not a defect in the panel. Earlier in the
session the long-running fixture server on 4173 was stopped so the suite could start a fresh one —
`tests/m8.spec.mjs` asserts on absolute hit counts and only passes against a server that has not
served those paths yet. A browser tab still open against the stopped server keeps working for
anything a mock or rule answers, while Run Once dispatches on the captured transport and gets a
refused connection, reported as `network-error · Failed to fetch` in a few milliseconds. Reproduced
the reported flow against a running server — importing `openapi.json` and running `Echo GET` Once
returns HTTP 200 — and restarted the fixture server.

**Commands and outcomes.**

- `npm run build` → exit 0.
- `npx playwright test tests/ui.spec.mjs` → 15 passed, including the new check.
- `npx playwright test` → 203 passed in 1.7 m on a freshly started fixture server. An earlier run
  against a warm server failed four checks (`m7` ×2, `m8` ×2); `m7` passed on rerun and the `m8`
  pair are the absolute-hit-count artifact described above.

**Note for future runs.** A fixture server is now running outside the test runner, so
`npx playwright test` cannot start its own on 4173. Stop it first, or run with a config that sets
`webServer.reuseExistingServer` — but `m8` needs a server that has not yet served its paths.

**Next task.** M10 — integrated release.

## 2026-09-24 — Recorder recovery card removed from Settings

**Scope.** The card added earlier the same day is gone at the user's request. Settings now opens on
Profiles. Everything that existed only to feed it went with it, rather than being left as state
nothing reads: `UIState.recorderBytes` / `recorderRestored`, the recorder's `restored` counter and
its getter, and the `.aw-alertcard` / `.aw-dot8` rules in the theme.

**Kept.** The Recorder row in Modules — its switch, Max captures and Include tester traffic — and
the recorder's `bytes` / `limit` / `setLimit` API, which the cap and its test still use. The Record
screen keeps its own recorder controls, including the Reset that the removed card duplicated.

**Changed files.** `src/ui/screens.ts` (card deleted, state fields dropped, import narrowed),
`src/entry.ts` (recorder store fields dropped), `src/recorder/recorder.ts` (`restored` removed),
`src/ui/theme.css`, `tests/settings.spec.mjs` (the card's two checks removed; the recorder-off
check now proves the recording stopped from the Record screen instead of the card),
`tests/recorder-core.spec.mjs`.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0.
- `npm run build` → exit 0.
- `npx playwright test tests/settings.spec.mjs tests/recorder-core.spec.mjs tests/ui.spec.mjs` →
  26 passed.
- `npx playwright test` → 202 passed in 1.6 m, Chrome (channel `chrome`), macOS darwin 25.6.0,
  Node v24.21.0. Two checks fewer than the 204 before this change: the removed card's own.

**Not run.** Edge, saved-bookmark installation.

**Next task.** M10 — integrated release.

## 2026-09-24 — The recorder becomes real in Settings: live recovery card and its own module row

**Scope.** Follow-up to the Settings build-out. The Recorder recovery card printed fixed copy and
an always-enabled button, and the recorder was the one switchable surface with no row in Modules.

**Recovery card now reports the recorder, not a paragraph.** `recorder.ts` exposes `bytes`,
`restored`, `limit` and its bounds (`BODY_LIMIT`, `RECOVERY_LIMIT`, `DEFAULT_RECORD_LIMIT`), and the
card reads them through the store: a Recording/Stopped/Idle badge, `N of <limit> requests held`,
`N KB of 1024 KB resume storage`, the truncation bound quoted from the constant that applies it,
and a line naming how many records came back from this tab's earlier session. Reset is disabled
when there is nothing recording and nothing held, so the button cannot report a reset that did
nothing.

**Recorder is a module row.** A switch in Modules bound to `enabledModules.record`, with
**Max captures** (`settings.recorderLimit`, applied by `recorder.setLimit`, which drops the oldest
immediately when lowered) and **Include tester traffic** (`settings.recorderIncludeTester`). Off
hides Home's Record quick action, redirects the Record screen Home and stops an active recording.
`shell.go` now gates any switched-off surface, not only tabs.

**Include tester traffic was dead and is now real.** The recorder skipped
`url.startsWith('workbench://tester')`, a scheme nothing in the codebase ever emits, so the flag
filtered nothing. A run in `rules` mode dispatches through the page's wrapped fetch, so `entry.ts`
marks those calls with `TESTER_MARK` — an unknown member of the fetch init, which the platform
ignores, so the request that leaves the page is still the one the plan describes — the fetch
adapter carries it into `RequestContext.fromTester`, and the recorder filters on that. Direct-mode
runs and Run Once use the captured transport and never reach the recorder at all.

**Changed files.** `src/recorder/recorder.ts`, `src/network/rules.ts` (`TESTER_MARK`,
`RequestContext.fromTester`), `src/network/fetch-adapter.ts`, `src/entry.ts` (recorder limit sync,
tester mark, recorder state in the store), `src/core/model.ts` (`recorderLimit`,
`recorderIncludeTester`), `src/ui/screens.ts` (live card, Modules row, Home quick-action gating),
`src/ui/shell.ts` (gate any surface).

**Tests.** New `tests/recorder-core.spec.mjs` — 3 checks against the recorder with a fake pipeline:
the limit trims to the newest and `bytes` follows the kept records, lowering the limit drops the
oldest at once, tester traffic is filtered unless asked for, and a reset reports nothing held.
`tests/settings.spec.mjs` grows 3 browser checks: the card's figures follow real captures, Max
captures caps the draft, and switching the recorder off closes the Record screen and stops a
recording.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0.
- `npm run build` → exit 0.
- `npx playwright test` → 204 passed in 1.7 m, Chrome (channel `chrome`), macOS darwin 25.6.0,
  Node v24.21.0.

**Not run.** Edge, saved-bookmark installation. The tester-traffic filter is covered at the
recorder's own boundary (a `fromTester` event) and by the marking code being the only producer; a
full load-run-while-recording browser check was not added.

**Limitations.** `Include tester traffic` only affects plan runs in *Apply active rules* mode,
because that is the only tester traffic that enters the pipeline. The resume-storage figure is the
recorder's own byte accounting, not what `sessionStorage` reports.

**Next task.** M10 — integrated release.

## 2026-09-24 — Settings built out to `Settings.html`, controls included

**Scope.** The Settings screen carried profiles, environments, a body limit and nothing else,
while `design/reference/screens/Settings.html` specifies six cards. The user chose the full
option: every control in the reference, working, rather than a layout-only match. Nothing in the
reference is rendered inert.

**What each new control actually does.**

- **Recorder recovery** — stops the recorder and discards its draft (`stopRecording` +
  `resetRecorder`). The reference copy said bodies over 16K are omitted; `recorder.ts` truncates
  them, so the card says truncated.
- **Profiles** — select · Load · Delete, an inset Name field with Save, and Export, as the
  reference lays them out. Selecting no longer switches profiles: Load does, so reading the list
  cannot throw away the live profile's unsaved endpoints and rules.
- **Modules** — the switches drive `profile.settings.enabledModules`, which until now was written
  to every profile and read by nothing. A module switched off loses its tab, its Home card and its
  activation, and the Endpoints sub-header drops its Test shortcut with the Test module.
- **Max traffic / chaos log entries** — `settings.logLimits` per module. `entry.ts` trims the
  shared activity log per module rather than at one global 50, so a noisy mock cannot push the
  intercept log out, and each module's screen shows what its own cap keeps. Hit counts are
  unaffected: the cap trims the log, not the counting.
- **Store response bodies in traffic log** — off by default because it makes the panel observe
  traffic, which is what makes the adapters clone and read every response. On, the body is attached
  to the newest intercept entry for that rule and URL, bounded by the profile's body limit, and the
  traffic row grows a `Response body` disclosure.
- **Core** — body-check limit kept, now clamped at 1,000,000 KB instead of unbounded.
- **Page context globals** — reuses the existing `scanPage(["global"], roots)` scanner rather than
  a second one. Roots are stored per profile and seed Test → Scan page. Previews stay masked.
- **About** — Version, the reference's `Not cached (inline bookmarklet)` line, and the newest build
  recorded for the origin. **Check for update** compares this build against a `version:<origin>`
  note written at launch beside the config: an inline bookmarklet fetches nothing, so there is no
  manifest to ask, but a bookmark older than the newest build that has run here is a stale copy and
  the check says so. **Clear stored data** deletes this origin's configuration and version note and
  restarts the panel on an empty profile, behind a confirmation.

**Deliberate deviations from the reference, and why.**

- The reference's single **Save** cannot both rename the live profile and fork a copy; both are
  real behaviours the app had. The inset keeps Save (stores the live profile under this name,
  which is also how it is renamed) and adds **Save as copy**.
- **Clear cache** is labelled **Clear stored data**. Nothing is cached — the reference's own line
  says so — and the honest action behind that button removes saved profiles, so the label says
  what it removes.
- An extra **Newest** row in About reports the recorded build, which is what the update check
  compares against.
- The **Environments** card is not in the reference and was kept; host mapping has nowhere else to
  live.

**Changed files.** `src/core/model.ts` (settings fields, `DEFAULT_LOG_LIMIT`, `moduleEnabled`,
`logLimit`), `src/core/storage.ts` (`clearStoredConfig`, `readLaunchVersion`,
`recordLaunchVersion`), `src/network/rules.ts` (`RuleActivity.body`), `src/entry.ts` (per-module
log trimming, response-body capture, `saveProfile`, `checkForUpdate`, `clearStoredData`, launch
version), `src/ui/screens.ts` (the Settings screen, Home module gating), `src/ui/shell.ts` (tab
gating), `src/ui/rule-screens.ts` (per-module log cap and body disclosure in the traffic log),
`src/ui/test-screens.ts` (scan roots seeded from Settings), `src/ui/dom.ts` (`switchBox`, six
reference icons), `src/ui/theme.css` (Modules card, widths, alert card).

**Tests.** New `tests/settings.spec.mjs` — 8 checks: module gating survives a relaunch, the log cap
trims the log but not the hit count and Reset restores 50, response bodies appear only while the
setting is on, Reset recorder clears the draft, Save + Load round-trips a profile with its
endpoints, the update check reports a newer recorded build, Clear stored data asks first and then
empties IndexedDB, and Page context globals lists a masked value and seeds Test's scan. Updated
`tests/m3.spec.mjs`, `tests/ui.spec.mjs`, `tests/m9.spec.mjs` for the split Save / Save as copy and
the explicit Load.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0.
- `npm run build` → exit 0. raw 441,386 B, minified 251,707 B, encoded bookmark URL 362,923
  characters.
- `npx playwright test` → 198 passed in 1.7 m, Chrome (channel `chrome`), macOS darwin 25.6.0,
  Node v24.21.0.
- A leftover fixture server from an earlier session was holding 4173 with accumulated hit counters;
  `tests/m8.spec.mjs` only passes against a fresh server, so it was stopped and every run since
  starts its own.

**Not run.** Edge, saved-bookmark installation. No visual-regression gate: the screen was compared
by eye against `design/reference/screens/Settings.html` from a screenshot of the running panel.

**Limitations.** The update check can only report what this origin has seen; a bookmark that has
never run here reads as the newest. Response-body capture correlates a traffic event to the newest
activity entry with the same rule and URL, so two identical in-flight requests can attach in the
order the bodies resolve. Module gating hides screens but does not stop an already-active module
mid-flight beyond switching it off.

**Next task.** M10 — integrated release.

## 2026-09-24 — Rule rows laid out as the module reference screens

**Scope.** The rule rows on Mock, Intercept, Chaos and Route did not match
`Mock.html` / `Intercept.html`. They inherited `.aw-endpoint-meta`'s 54px indent,
which exists so the Endpoints list can hang a path under a first-line method
badge; a rule row carries its own method badge on the meta line, so the line was
pushed in under nothing. Fixed at the shared row, not per screen.

**Changed files.**

- `src/ui/rule-screens.ts` — `ruleRow` now uses `aw-rule-row` (reference padding
  `10px 8px 10px 12px`, 10px gap) and adds `aw-rule-meta` to the meta line; the
  URL no longer grows, so the summary badge sits beside it as the reference shows
  rather than hard right; the delete control is the reference's `×` at `aw-sm`;
  the URL carries a `title` for the truncated text. `summary` may now return a
  node, and Mock returns the reference's `→ 200` (green under 400, red at or
  above it) as a fragment so the badge is a meta-line child and cannot be clipped
  by a shrinking wrapper. Section and traffic headings drop `aw-grow`, putting
  the count badge next to its label as every reference screen has it.
- `src/ui/theme.css` — added `.aw-rule-row` and `.aw-rule-meta`.
  `.aw-endpoint-row` / `.aw-endpoint-meta` are unchanged, so Endpoints, the
  recorder review and the import preview keep their 8px padding and 54px indent.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0.
- `npm run build` → exit 0. raw 422,334 B, minified 240,903 B, encoded bookmark
  URL 347,277 characters.
- `npx playwright test` → 190 passed in 1.6 m, Chrome (channel `chrome`), macOS
  darwin 25.6.0, Node v24.21.0. Run against an already-running fixture server via
  a scratch config with `reuseExistingServer`, because port 4173 was occupied by a
  session outside this one; test files themselves were unmodified.

**Verification.** Mock and Intercept screenshotted from the running panel with a
throwaway spec (deleted afterwards) and compared against the reference screens:
badge flush with the label, URL truncating, `→ 200` intact at the row's end.

**Not run.** Edge, saved-bookmark installation. No visual-regression gate exists;
the comparison was by eye against `design/reference/screens/`.

**Limitations.** The rule row still shows a hit count and, on Intercept/Chaos/
Route, a summary badge that the reference rows do not carry — existing behaviour,
deliberately kept. Meta text is `aw-xs` (12px) where the reference sets 11px
inline.

**Next task.** M10 — integrated release.

## 2026-09-24 — Playground links to the landing page

Updated both installation links in `tests/fixtures/page.html` to `/index.html`.
Added `index.html` to the explicit generated-artifact allowlist in
`tests/fixtures/server.mjs`, serving `dist/index.html` with the existing HTML MIME
type. Updated `docs/TEST_SERVER.md`. The older installer remains available for
existing feasibility checks and size-probe links; generated files were not edited.

Verification: `node --check tests/fixtures/server.mjs && git diff --check` passed
(exit 0). `npm run server` could not start because another server already owns
4173 (`EADDRINUSE`); the earlier agent-owned session had ended. Restart the current
server to load the added route. No tests, build, or browser verification run for
this small link change, per the user's preference. M10 remains the next milestone.

## 2026-09-24 — Fixture page redesign

**Scope.** Replaced the plain fixture page with a zinc-themed API playground.
The sidebar lists all 29 operations from the server's OpenAPI definition plus
10 original compatibility fixtures, grouped and searchable. Selecting a request
fills editable method, URL, headers and example body without resetting sidebar
scroll or keyboard focus. Includes origin/credentials selection, Fetch and native
XHR dispatch, timeout/cancel controls, response body/headers/events views, JSON
coloring, binary preview, timing/size, copy, and OpenAPI download. Original session,
style-isolation and policy controls remain available in a disclosure section.

**Changed files.** `tests/fixtures/page.html`, `page.js`, and new `page.css` implement
the page; `tests/fixtures/server.mjs` serves the stylesheet and embeds the catalog
into the existing same-origin script; `tests/fixtures/test-api.mjs` exports its
existing OpenAPI generator for reuse. `docs/TEST_SERVER.md` documents the controls
and limits. This work-log entry records the evidence. On resuming the task, the
page implementation was already present in commit `2f72f0c`; it was preserved.

**Commands and measured results.**

- `node --check tests/fixtures/page.js && node --check tests/fixtures/server.mjs && node --check tests/fixtures/test-api.mjs && git diff --check`
  — exit 0, including after the endpoint-selection fix.
- `lsof -nP -iTCP:4173 -sTCP:LISTEN` identified the existing listener.
  `ps -p 94010 -o pid=,ppid=,command=` required approved escalation and confirmed
  `node tests/fixtures/server.mjs`. `kill -TERM 94010 && npm run server`, also
  approved, restarted that fixture to load the new routes. Startup printed both
  origins; the server was left available for the user's live playground session.
- `/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --version`
  — Google Chrome 153.0.8010.53.
- Manual Chrome UI review at `/fixture`: 39 requests displayed; GET echo via Fetch
  returned 200 (705 B, displayed 13 ms); selecting POST supplied JSON headers/body;
  POST echo via XHR returned 200 (909 B, displayed 10 ms) with the submitted message.
  Events showed native ready states and load/loadend. Endpoint search for `bearer`
  reduced the sidebar to the authentication request. Desktop screenshots were
  visually inspected before and after response delivery. These timings describe
  individual local interactions, not benchmarks.

**Limits and checks not run.** No automated tests added or run, following the
user's instruction. No full endpoint sweep, mobile viewport, Edge, policy-page
regression, bookmark installation, build, or full Workbench integration checks.
Response display is capped at 64 KiB. Fetch captures at most 1 MiB before cancelling
the remainder; XHR retains native arraybuffer buffering. XHR's credentials-omit
choice is rejected explicitly because it cannot suppress same-origin cookies.
Policy pages retain their CSP, so their stylesheet remains intentionally blocked.
No external packages, fonts or runtime assets were added to the bookmarklet.

**Next milestone.** M10 remains next; this is development infrastructure only.
Use the already-running server at `http://127.0.0.1:4173/fixture`. When stopped,
restart with `npm run server`; do not launch a second copy against occupied ports.

## 2026-09-24 — Importable local server file

Created root `openapi.json` from the running local server's `/openapi.json`, then
formatted it with two-space JSON indentation. Includes OpenAPI 3.0.3 operations,
body/header/parameter examples and base URL `http://127.0.0.1:4173`.

Command: `curl --fail --silent --show-error http://127.0.0.1:4173/openapi.json -o openapi.json`.
The sandbox attempt could not connect; the approved retry succeeded (exit 0).
A Node `--input-type=module` script read the file with `JSON.parse`, formatted it
with `JSON.stringify(spec, null, 2)`, and printed its operation count and server URL
(exit 0). No tests or browser import checks run, per the user's instruction.
Import via Workbench's Import screen and select `openapi.json`; the local server
must be running to send the imported requests. M10 remains the next milestone.

## 2026-09-24 — Local API playground

**Scope.** User-requested development server for exercising Workbench methods and
features. This extends existing fixture infrastructure; no product milestone or
bookmarklet runtime behavior changed. User subsequently requested no tests.

**Changed files.** `package.json` adds `npm run server`; `tests/fixtures/server.mjs`
mounts isolated `/api/test/` routes, `/openapi.json`, and redirects `/` to the existing
fixture page. New `tests/fixtures/test-api.mjs` supplies method echo, bounded in-memory
CRUD, fake session/bearer auth, statuses, delays, redirects, body formats, streams,
disconnects, CORS, counters/reset and OpenAPI examples. New `docs/TEST_SERVER.md`
documents startup, routes, import and feature exercises; `START_HERE.md` links it.

**Commands and measured results.**

- `node --check tests/fixtures/test-api.mjs && node --check tests/fixtures/server.mjs && node --version && npm --version && git diff --stat`
  — exit 0; Node v24.21.0, npm 11.19.0; both syntax checks passed.
- `npm run server` — first attempt failed with sandbox `EPERM` on 127.0.0.1:4173.
  Retried with approved escalation; both ports started and printed fixture/API URLs.
- `node --check tests/fixtures/test-api.mjs && node --check tests/fixtures/server.mjs && git diff --check && git status --short`
  — exit 0 after the final API edit; syntax and whitespace checks passed.
- Stopped the initial process with Ctrl+C and ran `npm run server` again with the
  approved permission to load the final source; left running for manual use.

**Checks not run and limitations.** No tests added or run, per the user's latest
instruction. No endpoint, browser, build, saved-bookmark or Edge verification in
this task; startup/syntax evidence does not prove endpoint or Workbench behavior.
Routes and examples above describe implementation, not measured HTTP outcomes.
Node built-ins only; loopback HTTP, dummy authentication, two permitted local
origins, 1 MiB request limit, 1000 items per origin, in-memory state. Echo preserves
multipart/binary bytes without parsing uploads. Browser-forbidden TRACE/CONNECT
are outside the intended fetch/XHR exercises. OpenAPI is supplied; other import
formats continue to use existing Workbench functionality.

**Next milestone.** M10 remains next; outstanding saved-bookmark and Edge gates
are unchanged. Manual playground use: `npm run server`, then
`http://127.0.0.1:4173/fixture`; import `http://127.0.0.1:4173/openapi.json` as a file
or pasted JSON. Build remains `npm run build` when installer artifacts are needed.

## 2026-09-24 — The live test plan gets one identity, and edits commit against it

**Reported.** `tests/plans.spec.mjs:23` failed about half the time: an edit made to a stored plan
came back as its pre-edit value after switching away and back. Two real defects were behind it,
neither of them a test artifact.

**Defect 1 — the live plan had no stable identity.** `planOf` falls back to
`defaultTestPlan(profileId)`, which mints a **new id on every call**, and the initial configuration
carried no plan. Until the first plan edit persisted one, every read invented a different plan:
`refreshPlans` and `renderLoad` each minted their own inside the same render, so the picker, the
form and `selectPlan` were addressing three different plans. Traced by reading the persisted
configuration out of IndexedDB after each step, which showed the "Working Plan" id changing between
two consecutive reads.

**Defect 2 — a control wrote back a render-time snapshot of the whole plan.** Ten handlers in the
Load view did `ctx.updatePlan({ ...plan, field: value })` with `plan` captured when the form was
drawn. The form is rebuilt from the store, so a commit landing after the live plan changed wrote
the old plan back whole. Instrumenting `numberField` and `renderLoad` caught it directly: after
selecting the copy but before the repaint, editing iterations produced
`live = Working Plan:06fqg2=9` — the plan that had just been switched *away from*, made live again
with the edit that belonged to the copy. The switch was silently undone and the edit landed on the
wrong plan.

**Changed files.**

- `src/entry.ts` — `withPlan()` guarantees a live configuration carries its plan, applied where a
  configuration enters the store: the initial one, the one read from storage, a committed import,
  and `persist()`, which covers every mutation. `planOf`'s fallback stays as a guard but no longer
  fires in the running app.
- `src/ui/test-screens.ts` — `editPlan(ctx, live => change)` reads the live plan at commit time and
  applies the change to it. All ten snapshot writes now go through it, including the two that build
  on a collection (`excluded`, `phases`, `bindings`), which now read that collection from the live
  plan too. Three call sites already used this pattern by hand; it is now the only pattern.
- `tests/plans.spec.mjs` — a new check pins defect 1: the live plan's id survives leaving and
  re-entering the Load view, a trip through Home, and saving a copy. It fails on the code before
  this change and passes after. The existing test now takes each option by exact name rather than
  by position (the live plan is listed first, so positions move as the live plan changes) and waits
  for the rename field, which the picker sync writes in the same callback that rebuilds the form,
  to show the plan just selected. Two plans can hold identical numbers, so no field of theirs can
  say which one is mounted; without that wait the test typed into the outgoing form.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0.
- `npm run build` → exit 0.
- `npx playwright test tests/plans.spec.mjs` → 8 consecutive green runs; the same test failed about
  half the time before.
- `npx playwright test` → **190 passed**, no failures, in 1.6 m, Chrome (channel `chrome`), macOS
  darwin 25.6.0.

**Not run.** Edge — not installed on this machine. Saved-bookmark installation, as before.

**Limitations.** The Load form is still rebuilt whole whenever the plan changes, so an edit typed
within the same frame as a plan switch can be dropped before it commits — the value is not written
anywhere wrong, it is simply not written. A person cannot type that fast; a driver can. Fixing that
means keeping the form's controls alive across a re-render instead of replacing them, which is a
larger change and is not attempted here.

## 2026-09-24 — Edit intercept rule laid out as `InterceptRule.html`

**Scope.** The intercept rule editor, against the reference screen. Two shared helpers changed with
it, which carries the same correction to the Mock, Chaos and Route editors whose references use the
same styling.

**Changed files.**

- `src/ui/dom.ts` — `cardHeading()`. Every reference screen heads a card with `.aw-h` at 13px, not
  the uppercase rule-off caption that separates sections; the editors were using the caption.
- `src/ui/theme.css` — `.aw-cardh`, the inline widths the reference sets on the status and scope
  controls, `.aw-gap6`, and `.aw-quick`. The last one restates width and radius because `aw-rd` is
  two things in the reference sheet — the red badge tone and the 16px radio dot — so a red badge
  button collapses to a circle without it.
- `src/ui/rule-screens.ts`:
  - Breakpoints card: "Break on request" / "Break on response", no Optional badge, and the pause
    limits compressed from a paragraph to one line. The reference card has no note at all, but the
    queue size and the deadline are not guessable from two checkboxes.
  - `transformCard` returns one card per stage in the reference's order: status override, set
    headers, remove headers, **JSON Patch**, body find/replace. The patch editor was a separate
    card below; it is now a field inside the stage's card, which is where the reference puts it.
  - Status override is 110px with a `—` placeholder and its note beside it. The model stores "keep
    the original" as 0, and the field now shows that state as blank, as the reference draws it.
  - Labels lost their stage prefix ("Set headers", not "Response set headers") since the card
    heading already says the stage. The controls keep the prefixed `aria-label`, so both the
    accessibility tree and the existing tests still address them unambiguously.
  - `patchEditor` gained the reference's four one-click adds — Replace, Remove, Add, Nullify — and
    moved raw JSON into a `Raw JSON` disclosure. Load and the "Paths from <endpoint> · N paths"
    hint are on the response stage only, which is where they mean something: the paths are read
    from the linked endpoint's sample response.
  - `conditionFields`: "Headers", not "Match headers", as every rule reference labels it.
- `tests/m6.spec.mjs` — opens the raw-JSON disclosure before using the textarea, addresses the
  dashed "Add operation" button exactly now that one-click adds exist, and covers the new buttons:
  Nullify appends a `replace` with a null value and Remove appends a `remove`.
- `tests/m7.spec.mjs` — the breakpoint checkbox is addressed by its new label.

**Kept, against the reference.** The replace-scope select (First match / All matches) and the
literal-replacement note have no place in the reference's two-column row, so they sit below it in
the same field-and-hint shape the reference uses for the status override. The patch editor's live
operation count and problem report stay under the disclosure: the reference mock has nothing to
validate.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0.
- `npm run build` → exit 0.
- `npx playwright test tests/m6.spec.mjs tests/m7.spec.mjs` → 24 passed.
- `npx playwright test` → 189 passed in 1.6 m, Chrome (channel `chrome`), macOS darwin 25.6.0,
  after the unrelated fixture fallout described below was fixed. Before that: 188 passed, 1 failed.
- Rendered the editor at 512 px against the supplied reference image.

**Not run.** Edge — not installed on this machine. Saved-bookmark installation, as before.

**Fallout from another change in flight, fixed here on request.** `tests/m3.spec.mjs:56` was
failing because the playground fixture is being rebuilt in parallel (`984b173` plus uncommitted
edits to `tests/fixtures/page.html`, `page.js` and `server.mjs`). The redesign moved "Log in to
local fixture" inside a closed `<details>`, and a closed `<details>` keeps its content out of the
accessibility tree, so `getByRole` never resolved it. Diagnosed by stashing the fixture work: out,
the test passed; in, it failed, with the panel source identical either way.

The test now opens the tools section by its own summary first, selecting it as
`details:has(#login)` rather than by class, and skips the click when the section is already open.
That survives both the current page and a page that later ships the section open, and it leaves
the fixture files — which are mid-edit and belong to that change — untouched.
`npx playwright test` → **189 passed**, no failures.

## 2026-09-24 — Notify on complete raises a dialog

**Asked for.** "Notify on complete" only wrote an activity line, which is invisible to the person
the setting is for: someone who has looked away from the panel. It now interrupts with a modal.

**Changed files.**

- `src/ui/dom.ts` — `confirmDialog` takes an options argument: `cancelLabel`, and a `notice` tone
  whose confirm button is primary rather than destructive and takes the initial focus. The two
  existing destructive call sites are untouched and keep focusing Cancel.
- `src/ui/shell.ts` — `announceRun(title, message)` on the shell. It restores a minimized panel
  first, then opens the modal; choosing "View results" goes to Results, which already holds the
  finished run because the completion handler publishes it as `openRun` before notifying.
  "Dismiss" closes and changes nothing.
- `src/entry.ts` — the completion handler still writes the activity line (the record) and now also
  calls `announceRun` when `plan.notifyOnComplete` is set. The message names the plan, how many of
  how many requests passed, how many did not (`failedCount`), and the number of run errors.
- `tests/m8.spec.mjs` — three checks: the dialog does not appear when the box is unchecked and
  appears with the pass line and a lone "Close" when it does, because running from Load lands on
  Results; a run that finishes after the reader has left Results offers both buttons, with Dismiss
  staying put and View results going to the run; and a run that finishes while the panel is
  minimized restores the panel and shows the dialog there.

**Decision.** The dialog is unconditional when the box is checked, but its buttons are not. Running
from the Load view already lands on Results, so the first version's "View results" and "Dismiss"
did the same thing there — reported, and corrected the same day. Where the run is already on
screen the dialog reports with a single "Close"; everywhere else it offers "View results" beside
"Dismiss". `confirmDialog` takes `cancelLabel: null` for the one-button form rather than growing a
second dialog helper.

The first test of this did not catch the dead button: it asserted that "View results" ends on
Results, which was already true before the click. The replacement leaves Results during the run
and checks that Dismiss stays where it is while View results moves.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0.
- `npm run build` → exit 0.
- `npx playwright test` → 188 passed, 1 failed in 1.6 m, Chrome (channel `chrome`), macOS darwin
  25.6.0. The failure is `tests/plans.spec.mjs:23`, unrelated and pre-existing (see below).
- Rendered the dialog on a real run and checked it against the panel's surface and buttons.

**Not run.** Edge — not installed on this machine. Saved-bookmark installation, as before.

**Limitations.** The dialog is modal within the page, so a run that completes while the reader is
typing in the panel takes focus. It is raised once per run and never for a run the user stopped
before it finished notifying.

**Open, unrelated.** `tests/plans.spec.mjs:23` fails intermittently and predates every change in
this session (it fails on `59ef56d` with the session's changes stashed). It is not a flaky
selector: the assertion is that an edit made to a stored plan (9 iterations) survives switching
away and back, and the value that comes back is the pre-edit 5. That looks like a real loss of a
stored plan's edit on switch, in the code added by "Save test plans the way profiles are saved".
Not investigated further; it is reported rather than filed away.

**Next task.** M10 (integrated release), unchanged.

## 2026-09-23 — A native import switches to the profile it creates

**Reported.** "Import is not working": after importing a profile the panel still showed the old
one, with no endpoints. Nothing was broken — the import stored the profile and said so, but left
the previous profile live, so Home kept reporting `0/0 in plan`.

**Changed files.**

- `src/import/commit.ts` — `applyNative`'s `new-profile` mode now installs the imported snapshot as
  the live profile. The outgoing profile is snapshotted into `savedProfiles` first when it is not
  already stored, the same guard `createProfileFromRecordings` uses, so switching cannot discard an
  unsaved profile. The mode returns both `stored` and `activated`, so `commitImport` performs the
  full activation (stop the run, reset rule state, clear matched traffic).
- `src/ui/import-screen.ts` — the mode reads "Add as a new profile and switch to it"; the preview
  says the copy is made active and names the profile that stays in the list; the commit message is
  `Switched to "<name>" with N endpoints.` and the screen now lands on Endpoints, as the other
  modes do, instead of staying put with a "select it in Settings" notice.
- `docs/API_WORKBENCH_BUILD_PLAN.md` §8.11 — the clause "Importing a profile never automatically
  activates it" is replaced: importing as a new profile activates it and keeps the outgoing profile
  in the list. The user's instruction takes precedence over the earlier plan text, and the
  reversibility requirement behind it is met by preserving the outgoing profile.
- `tests/m9-core.spec.mjs` — the unit test for `applyNative` now asserts that the copy is live, that
  `activated` and `stored` name the same snapshot, that both profiles are listed, and that a live
  profile which is already stored is not snapshotted twice.
- `tests/m9.spec.mjs` — the browser test that asserted non-activation now asserts the switch: the imported
  profile becomes active with its endpoints on screen, the previously live profile is still in the
  title-bar menu, and selecting it restores its single endpoint. The merge half is unchanged and
  runs from the restored profile.

**Commands and outcomes.**

- `npx tsc --noEmit` → exit 0.
- `npm run build` → exit 0.
- `npx playwright test` → 186 passed in 1.4 m, Chrome (channel `chrome`), macOS darwin 25.6.0.
- Reproduced with the user's own export, `krushna-cooksbook-2.json` (107,810 B, 11 endpoints),
  through the file picker: the review renders, the commit reports `Switched to
  "krushna-cooksbook-2" with 11 endpoints`, the title bar shows that profile and Endpoints lists
  all 11. No page errors.

**Not run.** Edge — not installed on this machine. Saved-bookmark installation, as before.

**Limitations.** `replace` still discards the live profile without snapshotting it; that is what the
mode says it does. Only `new-profile` gained the safety net.

**Next task.** M10 (integrated release), unchanged.

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

## 2026-09-25 — GitHub deployment setup

- Added `.github/workflows/deploy.yml`: build every push/PR with Node 24, `npm ci`, and `npm run build`; upload only public artifacts; deploy main through Pages.
- Updated `scripts/build.mjs`: public installer instructions and relative bookmark download; retained experimental links in local `install-probes.html`.
- Added `docs/DEPLOYMENT.md` with publishing, update, rollback, and hosting prerequisites.
- Created private `ChetanGk123/api-workbench` and configured origin. GitHub Pages activation failed with HTTP 422 because the current plan does not support Pages for this private repository. No live hosting claimed.
- Commands: `npm ci && npm run build` passed; `npx playwright test tests/showcase.spec.mjs tests/m0.spec.mjs` passed all 15 tests after retrying outside the sandbox (initial fixture bind failed with EPERM); `git diff --check` passed. Node v24.21.0, npm 11.19.0, Chrome 153.0.8010.53, gh 2.101.0.
- Latest working-tree build: 277,728 minified bytes; 400,742 encoded bookmark characters. Existing unrelated working-tree edits were preserved; deployment commits only this task's files/log entry.
- Remote verification: commit `9e9aa63` pushed with `git push -u origin main`; `gh run view 36106547457 --repo ChetanGk123/api-workbench --json status,conclusion,jobs` confirms the Ubuntu build, locked install, bundle checks and artifact upload passed. Deployment failed at configure-pages because Pages could not be enabled. Not run: live-site verification, saved-bookmark UI installation, Edge, full browser suite. Hosting destination remains pending the user's choice.
- Next: resolve hosting eligibility/destination, push and verify the hosted installer and a subsequent automatic update. This task does not mark M10 or outstanding bookmark feasibility gates complete.

## 2026-09-25 — Repository README

- Added `README.md` covering the implemented feature areas, import contracts, build/install/update steps, fixture walkthrough, commands, generated artifacts, deployment status, browser boundaries, and repository layout.
- Verified instructions against `package.json`, `playwright.config.mjs`, `scripts/build.mjs`, the fixture routes, import documentation, and the deployment workflow. A Python standard-library link check verified all relative README links resolve; `git diff --check` passed.
- Documentation only: no build, browser tests, saved-bookmark installation, or deployment rerun; no runtime behavior changed. Existing local edits and staged work were preserved.
- Next: resolve the private-repository Pages plan restriction and complete hosted-site and real saved-bookmark verification. No product milestone is marked complete by this documentation change.
