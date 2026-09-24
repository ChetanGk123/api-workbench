# API Workbench — production-readiness review

Two passes over the same build: a senior UI/UX engineer reading the panel against its
own code, and an end user trying to get a job done with it. Findings are merged into
one prioritised list at the end.

**No code was changed for this review.**

## How this was checked

| | |
|---|---|
| Build | `npm run build` → `dist/bookmarklet.txt` (1.0.0, 240,570 B minified) |
| Host page | `node tests/fixtures/server.mjs` → `http://127.0.0.1:4173/fixture` |
| Browser | Chrome 153 (headless, `channel: "chrome"`), 1600×1000 viewport |
| Method | Ad-hoc Playwright scripts that launch the bookmarklet source on the fixture page, walk every screen, enumerate every visible control with its accessible name and disabled state, and screenshot each state. The repo's own `tests/*.spec.mjs` suite was **not** run. |
| Data | The fixture's real `openapi.json` imported through the Import screen (29 endpoints), then exercised via Endpoints → Test → Once. |

Everything marked **[measured]** was observed in the running browser. Everything marked
**[code]** was read in the source and not separately reproduced in the browser. Nothing
here is a guess about behaviour that was not checked one of those two ways.

---

# Part 1 — Senior UI/UX engineer pass

## 1.1 Dead controls

The brief was "no dead buttons". There are two, and they are in the most valuable
real estate on the Endpoints screen, directly under **Add header**:

- `src/ui/screens.ts:700` renders `Presets…` and `Promote common` through a helper
  whose entire job is to ship a disabled button:

  ```
  src/ui/screens.ts:265  function unavailable(label, reason) {
                           control.disabled = true
                           control.title = reason
  ```

  The reasons are the strings `"Header presets are coming later"` and
  `"Common-header review is coming later"`. **[measured]** Both render greyed and
  permanently inert; the explanation is a `title` tooltip on a disabled element,
  which most users never see.

  **Fix:** delete both until they do something. A feature that is "coming later" is
  not a UI element, it is a backlog item. If discoverability of the roadmap matters,
  that belongs in the landing page, not in the panel.

## 1.2 Dead state and dead code

- `src/core/model.ts:44,103` — `settings.enabledModules` is written into every profile
  and persisted to IndexedDB. **[code]** It is read by nothing. Grep returns only the
  type declaration and the default value. Remove it, or the first person to add module
  gating will assume it already works.
- `src/core/storage.ts` — `replaceProfile()` is exported and has zero callers. **[code]**
- `src/ui/screens.ts:576–582` — the Home **Activity** card is a `<pre>` holding
  `"{n} observed\n{last message}"`. **[measured]** It shows one line: the most recent
  event. It is not a log, and there is no request log anywhere else in the tool. For a
  product whose footer counts "N requests observed", having nowhere to see those N
  requests is the single largest missing surface.

## 1.3 Navigation

- **The tab strip vanishes on five of eleven screens.** `src/ui/shell.ts:276–279` hides
  `nav` and shows a Back sub-header whenever `SCREENS[id].tab` is false — Endpoints,
  Record, Import, Settings and Results. **[measured]** After importing a spec you land
  on Endpoints with no Test/Mock/Intercept/Route/Chaos tabs at all; the only way out is
  the Back chevron. Automated navigation broke on exactly this, which is a good proxy
  for a user losing the nav.

  **Fix:** keep the tab strip mounted on every screen and let the sub-header carry Back
  in addition to it, not instead of it. The panel is ~470 px wide with room for both.

- **The Back button lies to screen readers.** `src/ui/shell.ts:283` sets
  `aria-label="Back to Home"` on every navigation. `ctx.chrome({ onBack })` at
  `src/ui/shell.ts:215–219` reassigns the click target but never touches the label.
  **[code, confirmed by reading both call sites]** So in the endpoint editor, all four
  rule editors and the run detail view, the control is announced as "Back to Home"
  while it actually returns to the list it came from.

  **Fix:** have `chrome()` set the label alongside the target, e.g.
  `back.setAttribute("aria-label", \`Back to ${label}\`)`.

- **Escape is inconsistent.** `src/ui/screens.ts:690` binds Escape→cancel on the
  endpoint editor. The four rule editors (`rule-screens.ts:486, 722, 1357, 1560`) bind
  nothing. **[code]** Same visual shape, different keyboard contract.

- **Escape discards without asking.** The endpoint editor's Escape calls `cancel()`
  directly — no unsaved-changes guard. A half-written request body is gone on one
  keystroke. Same for Back and Cancel.

- **No way to reach the panel from the keyboard.** The host is appended to
  `document.documentElement` (`shell.ts` `mount()`), so it lands at the end of the page's
  tab order. On a real app that is dozens of Tab presses. There is no shortcut to focus
  or toggle the panel, and no global Escape to minimise it.

## 1.4 Layout and density

**[measured, screenshots in the session scratchpad]** At the default size the panel is
roughly 470×545 on a 1000 px-tall viewport — it uses about half the available height and
then scrolls internally.

- **Home** fits three and a half of its four module cards. Quick actions, Run history and
  Activity are all below the fold.
- **Endpoints after importing 29 endpoints** shows **two and a half rows**. The list
  viewport is about 150 px tall.

There is also no geometry persistence: `UIState` has no width/height/x/y, and `mount()`
always re-places the panel at `innerWidth - width - 16, 16`. **[code]** Every launch
resets a resize the user made last time.

**Fix:** default to something like 480×720 clamped to the viewport, and persist size and
position with the config. This is the highest ratio of perceived quality to effort in the
whole list.

## 1.5 Naming and pattern consistency

Same action, four different labels **[measured]**:

| Screen | Ad-hoc rule button | From-endpoint button |
|---|---|---|
| Mock | `Add ad-hoc rule` | `Add rule from endpoint` |
| Intercept | `Add rule` | `From endpoint` |
| Chaos | `Add rule` | `From endpoint` |
| Route | `New page rule` | *(none — Route has no from-endpoint path at all)* |

Other drifts:

- Home module cards: Mock/Intercept/Route say **Manage rules**; Chaos says **Configure**.
- Home module cards: Mock/Intercept/Route carry an `Inactive` status chip; **API Tester
  does not**, so the top card reads as a different kind of object than the three below it.
- The same endpoint is called `Echo GET` in the Test → Once picker and `get_echo` in the
  Test → Load phase list. Display name in one view, alias in the other, same screen.
- Import review rows render the resolved example URL `/api/test/items/1` while the row's
  accessible name says `/api/test/items/{id}`.
- Run history appears on both Home and Test with different empty copy: *"No runs yet. Run
  an endpoint or a plan from Test."* vs *"No runs yet. Run an endpoint from Test."*
- Settings has two adjacent save controls with near-identical wording: `Profile name` +
  **Save profile**, then *Save current config as a new profile* + **Save as profile**.

## 1.6 Accessibility

Good already: shadow root with a constructed stylesheet, `role="status"` on ~15 live
regions, native `<details>` for disclosures, a real `<dialog>` for confirmations, arrow/
Home/End/Escape handling in the profile menu, `aria-current="page"` on the active tab.

Gaps:

- The Back-button label bug above (1.3) is the one real defect.
- The profile menu uses `role="menu"` / `menuitemradio` for what is a value selector.
  `listbox`/`option` (or a plain `<select>`, which the rest of the panel already uses) is
  the matching pattern. Minor, but it means two different a11y patterns for the same
  interaction in one product.
- `dropdown.open()` returns early when `choices.length === 0` (`dom.ts:220`), leaving
  `aria-expanded="false"` and giving no feedback. A click that does nothing and says
  nothing.
- Icon-only buttons are 28×28 (title bar, row actions) and 32×32 (plan rename/save).
  Fine for a desktop-only tool, but worth writing down as a deliberate decision rather
  than leaving it implicit.
- The endpoint row's check count is an icon plus a bare number with a `title`; the count
  has no visible label, so "1" next to a list glyph is unreadable without hovering.

---

# Part 2 — End-user pass

Task: *"I have an OpenAPI spec for the API this page talks to. Get it in, send a request,
assert something, then mock one endpoint."*

## 2.1 Import — the best part of the product

Paste spec → **Format JSON** appears → **Apply** → *"Detected: OpenAPI 3.0"* → a review
list of 29 candidates with per-row include checkboxes, editable names, a `sensitive:
Authorization` flag on the auth endpoint, and a **Select all / Clear** pair, then
**Import selected (29)**. It landed on Endpoints with *"29 endpoints added."* **[measured]**
This flow is genuinely good and needs nothing but the two fixes below.

Two problems:

- **The review appears below a very long reference block.** The Import screen stacks a
  recorder card, the paste box, the format picker, then the full "Supported formats"
  table, and only then the review. In a ~400 px tall body, Apply appears to do nothing
  until you scroll past the whole reference. **Fix:** collapse the reference into a
  `<details>` once a draft exists, or scroll the review into view on Apply.
- **The recorder does not belong on the Import screen.** `Start recording / Stop
  recording / Open recorder screen` sits at the top of Import **[measured]**, giving the
  recorder three entry points (Home quick action, this card, and its own screen). The
  recorder is not an import format. **Fix:** drop the card; keep "Record" as a quick
  action and a Home card.
- **Clear draft has no confirmation** (`import-screen.ts:415`) — one click destroys a
  pasted spec. (Loading a *file* over a draft does confirm, at `:140`. Inconsistent.)

## 2.2 Endpoints — where the workflow stalls

29 endpoints in a 150 px list **[measured]** with:

- **No search or filter.** Compare the fixture page next to it, which has a search box
  bound to `/`.
- **No grouping** by tag, path prefix or method.
- **Reordering is one step at a time.** Each row has Move up / Move down
  (`screens.ts:719–722`). Moving the 29th endpoint to the top is 28 clicks and 28 full
  screen re-renders (`ctx.go("endpoints")` on every move).
- **No multi-select, no bulk delete.** Importing a 200-operation spec and then pruning it
  is not a workflow that exists.
- **Delete is one click with no confirmation and no undo** (`screens.ts:725`). Delete sits
  immediately next to Edit, both 28 px wide, both grey icons. **[measured]** This is the
  most likely accidental data loss in the product.
- **No Run/Send on the row.** To send one request you go Endpoints → Back → Test tab →
  pick it out of a 29-item native `<select>` → Run Once.

## 2.3 The endpoint editor — the functional gaps that matter most

- **Checks are read-only.** `screens.ts:684` renders them as
  `<pre>{JSON.stringify(endpoint.checks, null, 2)}</pre>` inside a disclosure. **[code,
  confirmed by grep: no check editor exists anywhere in `src/ui/`]** There is no UI to
  add, edit or remove an assertion. The build plan advertises *"Request editor with
  response sample and checks"* and `docs/TEST_SERVER.md` instructs the user to *"configure
  expected error statuses explicitly"* — which the UI cannot do. For a testing tool,
  view-only assertions is the biggest single gap on this list.
- **Body kind cannot be chosen.** `screens.ts:663` infers it:
  `bodyKind: body.value ? (endpoint.request.bodyKind === "none" ? "text" : ...) : "none"`.
  **[code]** So a body typed into a new endpoint is always `text` — there is no JSON /
  form-urlencoded / raw selector, and no matching `Content-Type` is set. Typing a JSON
  body into a fresh POST silently produces a text body.
- **No query-parameter editor.** Query strings are typed into the Path field
  (`/api/test/status?code=503`). **[measured]** No params table, no per-param enable/
  disable, no encoding help.
- **The response sample is half-editable.** There is a **Format JSON** button that writes
  into the draft (`screens.ts:676–681`), but the sample itself is a `<pre>`, not a
  textarea. You can reformat a sample you cannot write. Worse, formatting when no sample
  exists creates one with `status: 0`.
- **The sub-header title does not follow the Name field.** `ctx.chrome({ title: endpoint.name })`
  runs once at render (`screens.ts:688`). **[code]** Rename an endpoint and the header
  keeps the old name until you leave and re-enter.

## 2.4 Running a request — the output is the weak point

**[measured]** `Run Once` on `Echo GET` produced: `passed · HTTP 200 · 15 ms`, then the
raw response body as one unformatted wrapped line, then `Checks: passed · status 200`.

What is missing, all of which the *fixture page's own* response viewer already has:

- Response **headers** — not shown at all.
- Response **size** — not shown.
- **Pretty-printing** of the JSON body. The editor has a `formatJsonButton`; the result
  viewer does not use it.
- A **copy** button.
- **Re-run**, or "save this response as the sample", or "turn this into a check".

The tool's core output surface is measurably worse than the test fixture built to
exercise it. **Fix this before anything else on the polish list** — it is the screen a
user looks at most.

## 2.5 Test → Load

- 29 endpoints all land in the LOAD PHASE with an Include toggle and a **To setup**
  button each. No select-all, no filter. **[measured]**
- **Ramp-up** renders as a button whose caption is the sentence *"Admit a worker every
  250 ms"*. **[measured]** It reads as a static label, not a control. Make it a labelled
  number input with a unit suffix, like Iterations and Batch delay beside it.
- The plan picker row is `Working Plan` + two icon-only buttons (pencil = Rename plan,
  disk = Save plan). "Save" vs "Save as" is not distinguishable, and **there is no way to
  delete a stored plan** anywhere in the UI. **[measured]**
- A green dot sits left of the plan select with no legend. **[measured]**

## 2.6 Recorder

- **A recording can only become a new profile.** `screens.ts:530–539` always calls
  `createProfileFromRecordings` then jumps to Endpoints. **[code]** There is no "add these
  to the current profile". Recording three calls on a page where you already have a
  profile forces a profile you did not want.
- **Reset recorder** wipes every capture and every draft edit with no confirmation
  (`screens.ts:439`).
- Recorder rows have no Delete — only checkbox exclusion — while Endpoints rows do.
  Two list patterns for the same mental model.

## 2.7 Settings, persistence and data safety

This is where the most serious defect is.

- **The storage status line can never report a failure.**
  `settings` prints `Origin-scoped storage · ${storageReady ? "IndexedDB available" : "session fallback"}`
  (`screens.ts:860`). `storageReady` is set false only by
  `loadConfig().catch(...)` in `src/entry.ts`. But `loadConfig()`
  (`src/core/storage.ts:49–59`) wraps its IndexedDB read in `try { … } catch { }` and
  always resolves with a default config. **[code]** It cannot reject, so the fallback
  branch is unreachable and the panel always claims IndexedDB is available.
- **Writes fail silently.** `saveConfig(config, durable = false)`
  (`storage.ts:63–71`) updates the in-memory map, then `try { await writeToIndexedDb(copy) } catch { }`.
  Every normal edit — endpoints, rules, profile, plan — goes through the non-durable path
  via `persist()` in `entry.ts`. **[code]**

  Taken together: in a context where IndexedDB writes fail (private window, blocked site
  data, quota exhaustion, a locked DB), **every change looks saved, the status line says
  "IndexedDB available", and the entire configuration is lost on reload with no warning
  at any point.** This is the one finding on this list that destroys user work silently.

  **Fix:** surface the actual last-write outcome, not a load-time flag. Track a
  `persistenceError` in the store, set it from the `saveConfig` catch, and show a
  persistent banner ("Changes are not being saved — export your profile") plus a nudge to
  Export. Keep the in-memory fallback; just stop lying about it.

- **Export is partial.** `exportConfig()` (`storage.ts:75`) serialises
  `{ schemaVersion, profile, endpoints, rules, plan }` and drops `savedProfiles` and
  `savedPlans`. **[code]** The button is honestly labelled *Export profile + endpoints*,
  but it is also the only backup mechanism, and there is no import path that restores
  saved profiles. A user with five profiles can back up one.
- **Body-check size limit (KB) has no maximum.** `screens.ts:868–869` sets `min = "1"` and
  no `max`; the change handler is `Math.max(1, Math.round(Number(limit.value) || 1))`.
  **[code]** Meanwhile the shared `numberField` helper (`dom.ts:500–506`) clamps at
  1,000,000 everywhere else. Entering `99999999` here yields a ~95 GB read limit in
  `src/tester/once.ts:132`. Clamp it, and reuse `numberField`.
- **The body limit is per-profile but presented as global.** It lives under a card headed
  **Core** (`screens.ts:877`) yet is stored at `config.profile.settings.bodyLimitKb`.
  Switching profiles silently changes it.
- **Delete profile** is the *only* destructive action that confirms (`screens.ts:832`).
  Every other one does not.
- **No "clear all data"** and no storage-usage indicator.

## 2.8 Lifecycle

- **Close is unguarded.** The `×` calls `close()` immediately (`entry.ts`): it stops any
  run, disposes the pipeline, resumes every paused breakpoint (`breakpoints/registry.ts:150–153`)
  and unpatches `fetch`/`XMLHttpRequest`. **[code]** The unpatching and the paused-request
  resume are both correct and careful. But a user closing mid-load-run, or with three
  requests held at a breakpoint, gets no warning that they are releasing them. Confirm
  when `run` is active or `paused.length > 0`.
- **Re-clicking the bookmark when the panel is already open is a silent no-op.**
  `entry.ts:35–36` calls `existing.restore()`, which only un-minimises. If the panel is
  open but scrolled out of view or behind the user's attention, nothing visibly happens.
  Flash the panel border or re-place it at its anchor.
- **Version mismatch uses a native `alert()`** (`entry.ts:38`). A tool that goes to
  lengths to avoid touching the host page ends with a browser-modal dialog. Use the
  panel's own `confirmDialog`.

---

# Part 3 — Prioritised list

### P0 — block release

| # | Finding | Where |
|---|---|---|
| 1 | Config writes fail silently; the storage status line's failure branch is unreachable, so lost work is never reported | `core/storage.ts:49–71`, `ui/screens.ts:860`, `entry.ts` |
| 2 | Checks/assertions are read-only JSON — no way to add or edit an assertion | `ui/screens.ts:684` |
| 3 | Two permanently disabled "coming later" buttons ship in the UI | `ui/screens.ts:265, 700` |
| 4 | Delete endpoint / delete rule / reset recorder / clear draft: one click, no confirm, no undo | `screens.ts:439, 725`; `rule-screens.ts:227, 478, 714, 1349, 1552`; `import-screen.ts:415` |
| 5 | Result viewer shows no headers, no size, no formatting, no copy — weaker than the test fixture's own viewer | `ui/test-screens.ts` |
| 6 | Body kind is inferred, never chosen; a typed JSON body is sent as `text` with no `Content-Type` | `ui/screens.ts:663` |

### P1 — fix before calling it production quality

| # | Finding | Where |
|---|---|---|
| 7 | Endpoints list: no search, no grouping, no bulk select, reorder only one step at a time | `ui/screens.ts:707–733` |
| 8 | Default panel size too small (2.5 endpoint rows visible); size and position not persisted | `ui/shell.ts` `mount()`, `UIState` |
| 9 | Back button always announces "Back to Home" regardless of where it goes | `ui/shell.ts:215–219, 283` |
| 10 | Tab strip disappears on Endpoints / Record / Import / Settings / Results | `ui/shell.ts:276–279` |
| 11 | `bodyLimitKb` unbounded; and stored per-profile while presented as global | `ui/screens.ts:868–877` |
| 12 | Export drops `savedProfiles` and `savedPlans`; no full backup/restore path | `core/storage.ts:75` |
| 13 | Recorder can only create a new profile, never append to the active one | `ui/screens.ts:530–539` |
| 14 | No query-parameter editor; query strings typed into the Path field | `ui/screens.ts:686` |
| 15 | Editors discard unsaved changes on Escape/Back/Cancel with no guard | `ui/screens.ts:690` |
| 16 | Close is unguarded during an active run or with paused requests | `entry.ts` `close()` |
| 17 | No request log anywhere, despite the footer counting observed requests | `ui/screens.ts:576–582` |

### P2 — consistency and polish

| # | Finding |
|---|---|
| 18 | Four labels for one action: `Add ad-hoc rule` / `Add rule` / `New page rule`; `Add rule from endpoint` / `From endpoint` |
| 19 | Chaos card says **Configure**; the other three say **Manage rules** |
| 20 | API Tester card has no status chip; the other three module cards do |
| 21 | `Echo GET` in the Once picker vs `get_echo` in the Load phase list — same endpoint, same screen |
| 22 | Import review row shows `/items/1` while its accessible name says `/items/{id}` |
| 23 | Run history duplicated on Home and Test with different empty-state copy |
| 24 | Route is the only module with no from-endpoint rule path |
| 25 | Two near-identical save-profile controls in Settings |
| 26 | Recorder card on the Import screen — wrong IA, third entry point to recording |
| 27 | Import review renders below the full "Supported formats" reference; Apply looks inert |
| 28 | Ramp-up is a button captioned like a label; no plan delete; unexplained green dot on the plan picker |
| 29 | Escape bound only in the endpoint editor, not in the four rule editors |
| 30 | Profile menu uses `role="menu"`/`menuitemradio` for a value selector; empty menu click is a silent no-op |
| 31 | Endpoint sub-header title does not follow the Name field while editing |
| 32 | Response sample can be reformatted but not written; formatting an absent sample creates one with `status: 0` |
| 33 | Version-mismatch uses native `alert()`; re-launching an open panel is a silent no-op |
| 34 | Dead code/state: `settings.enabledModules` (never read), `replaceProfile()` (no callers) |
| 35 | No keyboard route into the panel; no global Escape to minimise; endpoint check-count badge has no visible label |

---

# Part 4 — Not defects

Worth recording so they are not "fixed" by mistake:

- **The shadow root, constructed stylesheet and inline SVG icons.** No external requests,
  no HTML parsing, no Trusted Types policy. This is the right architecture for a
  bookmarklet and it is executed cleanly.
- **`close()` restores `fetch`/`XMLHttpRequest` via the captured property descriptors and
  only when they still hold this instance's wrappers** (`entry.ts`). Careful work.
- **Paused breakpoints are resumed on dispose** (`breakpoints/registry.ts:150–153`) rather
  than abandoned. Correct.
- **Module activation is session state, never persisted** — a fresh launch cannot silently
  intercept traffic (`ui/screens.ts:37`). Right default.
- **The import pipeline** — detect, preview, per-row review, explicit commit, "changes
  nothing until Import selected", sensitive-header flagging. Best flow in the product.
- **~15 `role="status"` live regions, `aria-current` on tabs, native `<dialog>` and
  `<details>`.** The accessibility baseline is above average; the gaps listed above are
  specific, not systemic.

---

# Part 5 — Suggested order of work

1. **Data safety** — surface write failures (P0-1), add confirmations to the four
   destructive actions (P0-4), guard close during runs/pauses (P1-16), make export whole
   (P1-12).
2. **Make the tool finishable** — the check editor (P0-2), body-kind + Content-Type
   (P0-6), the result viewer (P0-5), a params editor (P1-14).
3. **Make it usable at scale** — endpoint search/filter/bulk actions (P1-7), bigger
   persisted panel (P1-8), a request log (P1-17).
4. **Remove what does not work** — the two dead buttons (P0-3) and the dead
   state/code (P2-34).
5. **Consistency sweep** — one vocabulary for rules, one for endpoint naming, one
   back-label contract, one keyboard contract (P1-9, P1-10, P1-15, P2-18 through P2-35).

---

# Part 6 — What this review did not cover

Recorded honestly, per `AGENTS.md`:

- **Only Chrome 153 headless, one viewport (1600×1000).** No Edge, no headed Chrome, no
  narrow or short viewport, no zoom levels, no `prefers-reduced-motion`, no forced-colors.
- **Bookmarklet installation was not tested.** The panel was launched by evaluating the
  decoded bookmarklet source on the page. Per `AGENTS.md`, that is explicitly not evidence
  of saved-bookmark behaviour.
- **The repo test suite was not run** (the user asked that tests not be run during this
  session), so nothing here confirms or contradicts existing spec results.
- **Not exercised end to end in the browser:** the four rule editors' save/match paths,
  breakpoints pausing real traffic, Load runs, chaos presets, Route across the 4173/4174
  pair, Results export, and the non-OpenAPI import adapters (HAR, Postman, cURL, fetch,
  native). Findings about those screens are marked **[code]** and come from reading the
  source, not from watching them run.
- **No screen-reader pass** (VoiceOver/NVDA), no automated axe run, and no colour-contrast
  measurement against the zinc theme.
- **No performance measurement** — the 29-endpoint list re-renders the whole screen on
  every reorder (`ctx.go("endpoints")`), which is noted as a design smell, not a measured
  regression.
