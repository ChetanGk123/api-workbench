# API Workbench work log

## Current state

M0 and M1 are implemented and verified in Chrome by automated browser checks. Saved-bookmark
installation and all Edge checks remain outstanding for both milestones.

Current assigned work: complete the outstanding manual checks in `M0_REPORT.md`, then M2.

| Milestone | Status |
|---|---|
| M0 — Feasibility | CODE COMPLETE · automated gates PASS in Chrome · saved-bookmark and Edge checks NOT RUN |
| M1 — Foundation and panel | CODE COMPLETE · automated gates PASS in Chrome · saved-bookmark and Edge checks NOT RUN |
| M2 — Transport/rule core | NOT STARTED |
| M3 — Endpoints, profiles and tester | NOT STARTED |
| M4 — Recorder | NOT STARTED |
| M5 — Mock and chaos | NOT STARTED |
| M6 — Intercept and routing | NOT STARTED |
| M7 — Breakpoints | NOT STARTED |
| M8 — Flow/Independent runs | NOT STARTED |
| M9 — Complete import support | NOT STARTED |
| M10 — Integrated release | NOT STARTED |

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

| Gate | Result | Evidence |
|---|---|---|
| No runtime external assets | PASS | Build asserts zero bundle imports and no absolute URL except the inline-SVG XML namespace; M0's zero-request check still passes; panel and code-block `font-family` contain no `Geist`, so the reference screens' web font is never requested. |
| Repeated invocation creates one instance | PASS | Re-run of the M0 double-launch gate: one `#api-workbench` node, `fetch`/`XMLHttpRequest` identities unchanged. Relaunch while minimized restores the panel instead of mounting a second one. |
| No host navigation | PASS | Every tab, header icon button and quick action is a `<button>`; the shadow root contains zero `<a>` elements; after visiting all nine screens `page.url()` is unchanged and no `framenavigated` event fired. |
| No style leakage | PASS | Full computed-style strings of `#leak` (which deliberately reuses `aw-root`/`aw-btn`/`aw-card`), `h1`, `#login` and `body` are byte-identical before and after launch; `document.styleSheets`, `document.adoptedStyleSheets` and `document.head` child counts are unchanged; the panel's one sheet lives on the shadow root. |
| Screen navigation | PASS | Six tabs mount their own screen, set `aria-current="page"`, and the four non-tab screens are reachable from the header and from Home. |
| Drag | PASS | Header drag moves the panel; dragging past the top-left clamps to ≥ 8 px and past the bottom-right keeps the panel fully inside the viewport; a pointer-down on a header control acts instead of dragging. |
| Resize | PASS | Computed `resize` is `both`; `max-width`/`max-height` stay within the viewport; at 340×220 px the header, tab bar and footer are still in the viewport, Close is still visible, and `.aw-body` scrolls (`overflow-y: auto`, `scrollHeight > clientHeight`). |
| Minimize | PASS | Minimize hides the panel and shows the launcher; Restore returns to the screen that was open; the launcher reports `M0 mock active` while the feasibility mock is on, so activity is visible when minimized. |
| Typed store batching | PASS | With a `MutationObserver` on the footer, 50 concurrent fetches produce fewer than 50 DOM mutations and the final text still reads `50 requests observed`. |

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
