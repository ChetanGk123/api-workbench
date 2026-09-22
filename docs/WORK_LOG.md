# API Workbench work log

## Current state

M0 is implemented and verified in Chrome. Saved-bookmark installation and all Edge checks are outstanding.

Current assigned work: complete the outstanding M0 manual checks in `M0_REPORT.md`, then M1.

| Milestone | Status |
|---|---|
| M0 — Feasibility | CODE COMPLETE · automated gates PASS in Chrome · saved-bookmark and Edge checks NOT RUN |
| M1 — Foundation and panel | NOT STARTED |
| M2 — Transport/rule core | NOT STARTED |
| M3 — Endpoints, profiles and tester | NOT STARTED |
| M4 — Recorder | NOT STARTED |
| M5 — Mock and chaos | NOT STARTED |
| M6 — Intercept and routing | NOT STARTED |
| M7 — Breakpoints | NOT STARTED |
| M8 — Flow/Independent runs | NOT STARTED |
| M9 — Complete import support | NOT STARTED |
| M10 — Integrated release | NOT STARTED |

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
