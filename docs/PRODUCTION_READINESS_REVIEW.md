# API Workbench — production-readiness review

Two passes over the same running build: a senior UI/UX engineer walking every control,
and an end user trying to get a real job done. Findings merge into one prioritised list
in Part 3.

**No code was changed for this review.**

This supersedes `docs/UX_REVIEW.md`, which was written against an older `dist/`.

---

## How this was checked

| | |
|---|---|
| Build | `dist/bookmarklet.txt`, 346,758 B encoded (footer reports `1.0.0`) |
| Host page | `node tests/fixtures/server.mjs` → `http://127.0.0.1:4173/fixture`, second origin `:4174` |
| Browser | Chrome 153.0.8010.53, headed, real mouse and keyboard events, 1600×1000 |
| Launch | The bookmarklet payload decoded from `dist/bookmarklet.txt` and evaluated in the page — byte-identical to what the saved bookmark runs. Saved-bookmark install itself was **not** re-verified here. |
| Data | The fixture's own `http://127.0.0.1:4173/openapi.json` (29 endpoints) imported through the Import screen, then exercised through Test → Once, Test → Load, Mock, Intercept, Route, Chaos, Recorder, Settings. |
| Not run | The repo's own `tests/*.spec.mjs` suite. |

Every finding below was **observed in the running browser**. Where a first reading turned
out to be wrong on re-test, the corrected result is what is recorded — three candidate
findings were dropped this way and are listed in Part 4 so they are not re-raised.

---

# Part 1 — Senior UI/UX engineer pass

## 1.1 The panel cannot be resized, and everything else follows from that

The panel is a fixed **480 × 560 px**. `resize: none`, no drag handle, no maximise
button, no size persisted. It repositions correctly at 1280, 1024 and 800 px viewports
and never leaves the screen — but it never grows either. On a 1600 × 1000 display it
occupies 17% of the available area.

Measured content heights against a **409–421 px** scrollable viewport:

| Screen | Content height | Screens of scrolling |
|---|---|---|
| Import → endpoint selection (29 endpoints) | 3,795 px | 9.0 |
| Endpoints list (29 endpoints) | 2,306 px | 5.5 |
| Home | 1,238 px | 3.0 |
| Settings | 881 px | 2.1 |
| Endpoint editor | 649 px | 1.6 |

The CSS already allows up to `max-width: 1704px`. Nothing lets the user get there.

**Fix:** add a resize grip plus a maximise toggle, and persist width/height/position per
origin. This is the single highest-leverage change in the review — roughly half the
findings below stop being painful once the panel can be 900 px tall.

## 1.2 Dead controls

The brief was "no dead buttons". These are the ones that are genuinely inert.

- **Endpoints → `Presets…` and `Promote common`** — permanently `disabled`, directly
  under `Add header` in the most valuable space on the screen. This was reported in the
  previous review and is still shipping. A "coming later" feature is a backlog item, not
  a UI element. **Delete both.**
- **Results screen with no run → `JSON`, `CSV`, `Stop`** — reached via Home → API Tester →
  **History**. All three are enabled, all three are no-ops: clicked each, no download
  fired, no message appeared, nothing changed. They must be disabled or the footer must
  not render on an empty Results screen.
- **Results screen after a completed run → `Stop`** — still enabled after the run reports
  `completed`. Clicking it does nothing.
- **Import → `Apply` with an invalid draft** — the screen correctly shows
  `Invalid JSON: Expected property name or '}' in JSON at position 2`, and `Apply` stays
  **enabled**. Same for valid JSON of an unrecognised shape
  (`JSON with no recognised format discriminator`). Clicking Apply produces no error, no
  toast, no change. `Apply` is correctly disabled when the box is empty — so the enabled
  state is reachable only when it cannot work.

## 1.3 Misleading controls

- **Home → API Tester → `Run`** does not run anything. It navigates to Test and preloads
  the tester, which then says `Ready for a direct…`. The card already has an `Open` button
  two inches to the left that does effectively the same thing. Either make `Run` run, or
  drop it and keep `Open`.
- **Home → API Tester → `History`** lands on the **Results** screen, which says
  `No run yet. Start one from Test.` — while Home itself, in the card directly below, is
  listing six completed runs under "Run history". `History` should open the run history it
  is named after.
- **Test → `Save plan`** (floppy icon) does not save the current plan. It **creates a
  duplicate**: one click turned `Working Plan` into `Working Plan` + `Working Plan-2`.
  That is "Save as", and it should say so.
- **Module → `Deactivate`** uses a ▷ play glyph. Play means start.
- **Header `Import` icon** is a download-tray arrow (⤓), which in every other tool means
  export or download. The panel's actual export lives elsewhere (Settings).

## 1.4 State that contradicts itself

- **Home card vs. Home list.** The API Tester card reads `Working Plan · 28/28 in plan ·
  **No runs yet**` while the "Run history" section on the same screen, one scroll below,
  lists six runs with statuses and latencies.
- **Home vs. module screen.** After a reload, Home showed Mock Server as
  **`Paused`**; opening the Mock screen showed **`Inactive`** with
  `1 enabled rule will apply once activated`. Two words for one state, and `Paused` appears
  nowhere in the module's own vocabulary.
- **API Tester is badged `Inactive`** on Home, alongside four modules whose `Inactive`
  badge is meaningful because they have an Activate button. The tester has no such
  concept. The badge means nothing there.
- **Footer counter.** `N requests observed` counts only page-originated fetch/XHR. Six
  tester runs left it at `3`. A user who has just run 29 requests and reads "3 requests
  observed" concludes the tool is broken. Either count tester traffic or rename the metric
  to something like "page requests intercepted".

## 1.5 Text and copy

- **Plural agreement is wrong in all four modules:** `1 enabled rule **apply** to this
  frame's fetch and XHR traffic.` Appears on Mock, Intercept, Route and Chaos.
- **Load results name endpoints differently from everywhere else.** The per-endpoint
  breakdown uses OpenAPI `operationId`s — `get_echo`, `post_items_id` — while every other
  screen uses the friendly names the user just reviewed and edited during import
  (`Echo GET`, `Create item`). The results table is where names matter most.
- **Mock / Chaos rule editor labels leak the sequence index into static mode:**
  `Status 1`, `Delay (ms) 1`, `Body 1`, `Fault mode 1` while Response mode is
  `Static response`. The trailing `1` only makes sense in `Response sequence` mode.
- **Endpoint editor `Name` field** has `aria-label="Name"` but a visible label of
  `Profile name` in Settings and `Name` in the endpoint editor. Keep the accessible name
  and the visible label identical.
- `Global headers · 0` does not update when you add a header row — the row is visible and
  empty, the count still says 0.

## 1.6 Navigation and layout

- **Two navigation models coexist.** Most screens use the six-button tab bar. Results,
  Import, Settings, Recorder, Endpoints and every rule editor replace it with a single
  `Back`. On Import there is a `Back` in the header **and** a `Back` filling the sticky
  footer — two identical controls on one screen.
- **Accordion state is not remembered.** Collapsing `Global headers` on Endpoints,
  navigating to Home and back, re-expands it. In a 560 px panel that is ~140 px of
  vertical budget re-lost on every visit. Same for `Base URLs` on Test.
- **Tab switches keep the old scroll position.** Going from Test → Once to Test → Load
  lands mid-page on `Base URLs` rather than at the top of the Load config.
- **Import: nothing scrolls into view after Apply.** The 29-endpoint selection list renders
  entirely below the fold; the only visible change is the footer button becoming
  `Import selected (29)`. Scroll the list into view, or collapse the source textarea once a
  format is detected.
- **`details` elements carry `transition: all`** and do not animate — disclosure snaps.
  Either animate the height properly or drop the transition.
- The intercept rule editor is ~30 controls deep with **two identical `Add operation`
  buttons and two identical `Raw JSON` disclosures** (request section and response
  section), distinguishable only by scroll position.

## 1.7 Accessibility

Good, and worth keeping: focus rings are real (`2px solid #e4e4e7`), tab order is linear
and sensible, every checkbox is wrapped in a `<label>`, icon-only buttons carry
`aria-label`, the profile menu is a correct `role="menu"` with `menuitemradio` children,
arrow-key navigation and Escape both work inside it, and `role="status"` regions exist.

Gaps:

- **Zero heading elements in the entire UI.** `h1`–`h6` count is 0 on every screen. Screen
  titles (`Settings`, `Edit endpoint`, `New intercept rule`) are `<div>`s. Screen-reader
  users get no document outline and no heading navigation. This is the biggest a11y gap.
- **163 focusable controls on the Endpoints screen** (29 rows × 5 buttons plus chrome),
  with no focus containment and no skip link. A keyboard user who tabs into the panel
  cannot get back out to the page without 163 presses.
- **The nav bar is not a tablist.** Six `<button aria-current="page">`. `ArrowRight` on
  `Home` does nothing. Either adopt `role="tablist"` with roving tabindex, or keep buttons
  and accept that they are links.
- **No `prefers-reduced-motion` rule anywhere**, while `transition: all` is applied broadly.
- **No `prefers-color-scheme` rule.** The panel is dark-only and will sit on light host
  pages unchanged. Acceptable as a deliberate product decision, but it should be a stated
  one.
- **Smallest rendered font size is 11 px**, used for badges and hints.
- **No keyboard shortcut at all** — not to open, close, minimise, or focus. `Escape` does
  not dismiss the panel (it correctly dismisses the profile menu). For a tool that lives
  on top of someone else's page, a dismiss key is table stakes.

---

# Part 2 — End-user pass

The job: *"I have a local API and an OpenAPI doc. Get it into the tool and test it."*

## 2.1 Import — the strongest part of the product

Pasting the 6 KB spec produced `Detected: OpenAPI 3.0` in under a second, and Apply
produced a per-endpoint review list with editable names, method badges, resolved paths,
the source `operationId`, and a `sensitive: Authorization` warning on the auth endpoint.
`Import selected (29)` landed all 29 with correct methods, paths and query strings. The
format-help disclosure is honest about what is and is not supported (no YAML, no remote
`$ref`, Postman scripts reported and never run). This is genuinely good work.

Two things a user hits immediately:

- **There is no "import from URL".** The tool is already running inside the page, on the
  same origin as `http://127.0.0.1:4173/openapi.json`, and can fetch it — but the only
  inputs are paste and file picker. The user must open the spec in a tab, select all, copy,
  and paste. Add a URL field; it is a few lines and it removes the worst step in the
  funnel.
- **Reviewing 29 endpoints means 9 screens of scrolling** with no search and no
  collapse-by-tag, even though every row already carries a tag (`default`) that could group
  them.

## 2.2 Endpoints — where the workflow stalls

29 endpoints, 2,306 px of list, **no search or filter field**. The fixture's own
playground page — the demo page next to the tool — has `Find an endpoint… /` with a
keyboard shortcut. The product does not.

Two data-loss problems, both reproduced with real mouse clicks:

- **Deleting an endpoint is instant.** One click on the trash icon took the list from 28 to
  27. No confirmation, no undo, no toast. The trash icon sits immediately beside the pencil
  in a dense row of four icons. Recovery is re-importing the whole spec.
  This is inconsistent with **Delete profile**, which *does* show a proper inline confirm
  popover naming what will be removed. Apply that pattern here.
- **Unsaved endpoint edits are discarded silently.** Typed a new name into the endpoint
  editor, pressed `Back`, no warning, edit gone.

Also missing at this level: duplicate an endpoint, multi-select, bulk delete, reorder by
drag (only single-step Move up / Move down).

## 2.3 The endpoint editor

Clean and well laid out. Three gaps:

- **Checks are a raw JSON textarea.** Assertions are authored as
  `[{"kind":"status","value":{"min":200,"max":299}}]` inside a `<details>`. This is the
  feature that turns the tool from a request runner into a test tool, and it is gated
  behind hand-written JSON with no schema hint, no validation feedback and no builder.
- **GET and HEAD endpoints still show a Body textarea.** The demo playground next to it
  correctly disables the body for those methods and says `GET and HEAD requests have no
  body.` The product should match.
- Response sample says `Record a request to capture one` — but running the endpoint from
  Test does not populate it, and the Recorder is a separate flow.

## 2.4 Running one request — the response viewer is the weak point

A single run works and is fast (`passed · HTTP 200 · 4 ms`). What you get back is a
monospace box with the raw body and **nothing else**. The Result region contains zero
controls. Measured against six response types:

| Endpoint | What the user sees |
|---|---|
| `Binary response` (64 KB octet-stream) | 65,536 literal `a` characters rendered as text, no size, no type, no truncation notice |
| `Large JSON response` (256 KB) | Raw unformatted JSON, same treatment |
| `xml` | `<item><id>1</id>…</item>` raw, no formatting |
| `invalid-json` | `{"broken":` — truncated body, still reported `passed` |
| `Delayed response` | Correct, `1505 ms` |
| `cors-denied` | `passed · HTTP 200` |

Missing, all of which the demo playground beside it already has: response headers,
content type, byte size, pretty-print, wrap toggle, and a copy button. Also missing: a
view of the **request that was actually sent** — a POST went out with a 34-byte body the
user never authored and cannot inspect.

`passed` also over-claims. It means "the one default status check passed". With no
assertions authored, everything says `passed`, including the endpoint that returned
malformed JSON.

**Run history rows are not clickable.** They show `passed · xml · 200 · 2 ms` and cannot
be opened. There is no timestamp. A response you saw thirty seconds ago is unrecoverable.

## 2.5 Load testing — the best-finished screen

`Run Load` across 29 endpoints completed in ~6.5 s and produced a genuinely good report:
`Passed 27 / Failed 2`, avg and P95 latency tiles, a per-endpoint table with
pass/fail/avg/min/max/P95, an outcome breakdown separating `Failed checks` from
`Network error`, and the honest footnote *"Browser-local timings from one tab: not a
server capacity measurement."* `JSON` and `CSV` both downloaded real files
(`Working-Plan-run-muf38xm2.json` / `.csv`).

The gap: **`Failed 2` is a dead end.** Table rows are not clickable (`cursor: auto`, no
handler). There is no way to see which request failed or why. That is the first thing
anyone clicks on a results table.

And `Run again` on the Results screen fired a full 28-request run — including `DELETE
item` and `Reset test items and counters` — **from a screen that said "No run yet"**, with
no confirmation. A destructive re-run should at least name what it is about to do.

## 2.6 Modules — Mock, Intercept, Route, Chaos

Mock was verified end to end and works correctly: created a rule from the `Echo GET`
endpoint (method and URL prefilled from the linked endpoint, with a clear note that
editing either detaches it), saved, then a page `fetch('/api/test/echo')` returned
`{"mocked":true}` with status 200, the rule showed `1 hit`, and the request appeared under
Matched traffic. The honesty of the copy throughout is a real asset —
*"A selected mock makes no upstream request. Exhaustion never falls back to real
traffic"*, and the Route module's explicit list of browser restrictions it cannot change.

Issues:

- **Chaos presets fill `URL` with `/api/`** and give no indication whether that is a
  prefix, a glob or an exact match, and no preview of which of the user's 29 endpoints it
  would hit. The Mock editor's placeholder suggests `/api/**`, so the preset's own value
  does not follow the documented pattern syntax. Add a live "matches N endpoints" hint.
- **`Route` vs `Page Routing`** — the tab says Route, Home says Page Routing, and the body
  text says it routes *"this frame's fetch and XHR requests"*, which is not page routing.
  Pick one name and make it describe what it does.
- **Module activation does not survive a reload.** Intercept, Route and Chaos were all
  Active before a page reload and all came back Inactive with `0/0 rules`. Mock came back
  with its rule intact but deactivated. Rules persist; activation does not. Either persist
  activation or say clearly that activation is per-session.

## 2.7 The Recorder — one sharp edge

Recording captured three calls including one cross-origin to `:4174`, deduplicated by
method+path, showed the right host keys, and redacted sensitive headers as promised.

Then: **`Create profile` with the name field left empty silently switched the active
profile.** No validation, no confirmation, no explanation. The 28 imported endpoints
vanished from view, replaced by the 3 recorded ones, under an auto-generated name
`127.0.0.1-2`. Nothing on screen said "you are now in a different profile".

Two further gaps:
- **You cannot add recorded endpoints to the profile you are already in.** Create-a-new-
  profile is the only destination. That is the wrong default for the common case.
- **There is no global recording indicator.** You can start recording, navigate to Home,
  and see nothing anywhere in the chrome telling you it is still running.

There are also **two recorder UIs**: the Record screen, and a duplicate "Session recorder"
card with its own Start/Stop at the top of the Import screen, which also has an
`Open recorder screen` link to the other one. Pick one.

## 2.8 Persistence and data safety

| Survives page reload / panel close | |
|---|---|
| Endpoints, global headers, rules | **Yes** |
| Profiles, plans, environments | **Yes** |
| Module activation | **No** (Mock returns as "Paused", the other three as Inactive) |
| Run history | **No** — six runs, gone |
| Load results | **No** — a completed 29-request report is unrecoverable |

A load run that takes six seconds and produces a report you would paste into a ticket
cannot be re-opened after a reload. Export to JSON/CSV is the only way to keep it, and
nothing tells the user that before they navigate away.

**Cross-origin naming collision:** launching on `:4174` shows a profile named
`127.0.0.1` — the same name as the `:4173` profile — with 0 endpoints. Storage is
origin-scoped by design and Settings says so, but the profile chip does not include the
port, so a user with two local ports sees an identically-named empty profile and
reasonably concludes the data is lost. Include the port in the default profile name.

## 2.9 Lifecycle — clean

Worth recording as verified-good, because it is the part most bookmarklets get wrong:

- `Close` removes the host element and **restores native `fetch`** (verified:
  `Function.prototype.toString` reports native code afterwards).
- Re-launching the bookmarklet while the panel is already open is **idempotent** — one
  host element, no duplicate state.
- Cold launch takes ~1.5 s.
- The panel drags by its header, repositions on viewport resize, and never leaves the
  screen down to 800 × 600.

---

# Part 3 — Prioritised list

### P0 — block release

1. **Remove the dead controls.** `Presets…` and `Promote common` on Endpoints. `JSON`,
   `CSV` and `Stop` on an empty Results screen. `Stop` after a completed run.
2. **Confirm destructive endpoint deletion.** Reuse the existing Delete-profile confirm
   popover. Add undo if cheap.
3. **Guard unsaved endpoint edits** on `Back` / `Cancel`.
4. **Disable `Apply` while the import draft is invalid or unrecognised**, or make it
   surface the error it already computed.
5. **Fix Home → `History`** so it opens the run history that Home itself is displaying.
6. **Validate the Recorder's `Create profile`** — require a name, and tell the user their
   active profile is about to change.
7. **Fix `1 enabled rule apply`** in all four modules.

### P1 — before calling it production quality

8. **Make the panel resizable** and persist the size. Half of Part 1 dissolves with this.
9. **Add search/filter to the Endpoints list** and to the import selection list.
10. **Rebuild the response viewer**: status, content type, byte size, headers, pretty-print
    for JSON/XML, a binary summary instead of 64 KB of `a`, a copy button, and a view of
    the request that was sent.
11. **Make load-result rows and run-history rows clickable** so a failure can be inspected.
12. **Persist run history and the last load result** with the rest of the profile.
13. **Persist module activation**, or state plainly that it is session-scoped.
14. **Add headings (`h1`–`h3`)** to every screen title.
15. **Let the Recorder add into the current profile.**
16. **Rename `Save plan`** to `Save as` / `Duplicate plan`, or make it save in place.
17. **Confirm `Run again`** when it will re-fire destructive methods.

### P2 — consistency and polish

18. Remember accordion open/closed state; reset scroll to top on tab change; scroll the
    import selection list into view after Apply.
19. One navigation model. Remove the duplicate `Back` on Import; remove either the
    Import-screen recorder card or the Record screen.
20. Use friendly endpoint names in the load-results breakdown.
21. Drop the `1` suffix from static-mode response fields in the Mock/Chaos editors.
22. `Escape` dismisses (or minimises) the panel; add an open/close keyboard shortcut and
    `/` to focus endpoint search once it exists.
23. Rename the footer counter, or make it count tester traffic too.
24. Fix `Deactivate`'s play icon and the download-glyph `Import` icon.
25. Add "import from URL".
26. Disable the Body field for GET/HEAD in the endpoint editor, as the demo page does.
27. Add a live "matches N endpoints" hint to rule URL patterns; make chaos preset URLs use
    the documented `/api/**` syntax.
28. Settle on one name for Route / Page Routing.
29. Include the port in default profile names.
30. Add a global recording indicator in the chrome.
31. Add `prefers-reduced-motion`; decide and document the dark-only stance.
32. Give the nav bar `role="tablist"` with arrow-key support, or accept it as a link bar.
33. Duplicate-endpoint action; multi-select and bulk delete.

---

# Part 4 — Checked and correct (do not re-raise)

Three findings were raised on a first pass and **withdrawn after re-testing with real
mouse events**. They are recorded so they are not filed again:

- **The header profile switcher works.** It opens on click, `aria-expanded` toggles
  correctly, the menu is a proper `role="menu"` with `menuitemradio` items, arrow keys move
  between profiles, and `Escape` closes it. The first test was driving a hidden
  `div[aria-label="Active profile"]` that shares the label with the button.
- **`Delete profile` works and is properly guarded.** It opens an inline confirm popover
  reading *"'127.0.0.1-2' and its endpoints and rules are removed"*, with Cancel and
  Delete. Confirmed a real deletion end to end.
- **"Add rule from endpoint" prefills correctly** — label, method and URL all come from the
  linked endpoint.

Also verified working and worth protecting in any refactor: OpenAPI 3.0 detection and
import of 29 endpoints; mock interception of real page fetch traffic; the load runner and
its report; JSON/CSV export; profile export (`127.0.0.1.json`); recorder capture with
redaction and cross-origin coverage; `Save profile` → `Profile saved.` confirmation;
focus rings; label-wrapped checkboxes; `aria-label`s on icon buttons; clean teardown and
idempotent re-launch.

---

# Part 5 — Not covered

- Saved-bookmark installation from `dist/install.html` (the payload was launched directly).
- Edge, Firefox, Safari; any non-Chrome engine.
- The Intercept breakpoint pause/continue flow end to end (the editor was inspected; no
  request was actually paused and resumed).
- Route rule execution; Chaos rule execution (both editors were opened, neither rule was
  saved and fired).
- HAR, Postman, cURL and `fetch()` import adapters — only OpenAPI 3.0 was exercised.
- Large-profile performance (hundreds of endpoints).
- The repo's `tests/*.spec.mjs` suite.
