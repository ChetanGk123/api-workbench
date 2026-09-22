# M0 — Bookmarklet feasibility

## Goal

Prove the riskiest browser behavior with a small working bookmarklet and a controlled local fixture. The complete UI and import system are later milestones. This task does not reduce the full v1 scope.

## Read first

- `AGENTS.md`
- `docs/API_WORKBENCH_BUILD_PLAN.md`, especially sections 3–7 and 11–13.
- `design/reference/aw-theme.css`
- `design/reference/screens/home.html` and `Minimized.html` for the initial shell.
- The other reference screens to understand the eventual module boundaries.

Inspect existing implementation before scaffolding. Reuse suitable existing project conventions. For a new repository, set up strict TypeScript, an IIFE build and browser fixtures. Pin the selected compatible development tools through a lockfile. Do not add runtime dependencies.

## Required implementation

### A. Build and installation

Produce these generated artifacts under `dist/`:

- `api-workbench.js`: readable standalone IIFE.
- `api-workbench.min.js`: self-contained minified bundle with inline CSS.
- `bookmarklet.txt`: full `javascript:` bookmark value, with correct encoding and a void completion value.
- `install.html`: local installer with a bookmark link and manual installation instructions.

Report raw bundle bytes, minified bytes and encoded bookmark URL length separately. Do not use compressed transfer size to claim the bookmark fits. Include build checks for unintended runtime asset imports/URLs and inspect runtime network activity.

### B. Minimal panel and lifecycle

Create one shadow-root panel using the supplied theme, with:

- Name/version and current origin.
- A simple activity/status area.
- Mock on/off and a bounded delay setting for one fixture endpoint.
- Minimize/restore and Close.

A repeated launch restores the same instance. Close disables the tool, resolves owned pending work and removes its UI/listeners/timers. Restore captured APIs only when the tool still owns their installed references. If a different wrapper was installed later, keep that wrapper intact and make Workbench's delegated layer inactive.

The mock starts inactive. Do not implement all navigation screens for this milestone.

### C. Fetch and XHR experiment

Capture the existing transport references once. Observe the fixture's fetch and asynchronous XHR requests. Demonstrate one shared request decision path for ordinary pass-through, synthetic response and abortable delay.

Mock one configured fixture URL with status 200 and a small JSON body. A mock must return a usable fetch Response and provide the relevant XHR fields/events. The fixture server's hit count must remain unchanged for both.

Verify unmatched requests continue normally. Preserve the caller's session/credentials settings. Keep synchronous XHR on a native pass-through path. Do not route all XHR behavior through fetch as a shortcut.

For XHR, record the chosen adapter approach and verify the basic success, abort and timeout state/event sequences. M2 will broaden conformance coverage; do not claim M0 proves full XHR compatibility.

### D. Controlled local fixture

Create a local development fixture, separate from the shipped bookmarklet. A fixture server is allowed as test infrastructure and is not a runtime dependency of the product.

Provide two origins and routes equivalent to:

| Route | Purpose |
|---|---|
| `/fixture` | Page with native fetch/XHR buttons and visible outcomes. |
| `/login` | Creates a test session cookie; use a local test account/state only. |
| `/api/session` | Confirms whether the eligible session cookie arrived. |
| `/api/mock-target` | Returns known JSON and increments a server-side hit counter. |
| `/api/slow` | Delays a response for cancellation tests. |
| `/api/error` | Returns a known HTTP error status. |
| `/api/stats` | Reports per-route hit counts. |
| Policy fixture pages | Apply controlled CSP script/style/connect policies and Trusted Types requirements. |

Add a second-origin API with allowed and denied CORS configurations to document what the browser permits. Never weaken a fixture policy during a test just to make the result pass. Name the observed policy and result accurately.

### E. Verification and reporting

Automate meaningful browser checks where available. Real saved-bookmark installation must also be exercised. If the environment cannot automate the browser bookmark UI or lacks Edge, provide exact manual steps and mark those checks NOT RUN. Do not fabricate successful manual verification.

Create `docs/M0_REPORT.md` with actual evidence:

| Required gate | Evidence to record |
|---|---|
| Build | Exact command, exit status and generated artifacts. |
| Actual bookmark | Browser/version, installation method, URL length and launch/restart result. |
| Double launch | One panel and one hook instance remain. |
| Session | Test endpoint confirms eligible cookie receipt without the tool reading HttpOnly cookie values. |
| Fetch pass-through | Expected response and one server hit. |
| Fetch mock | Synthetic response and zero new server hits. |
| XHR pass-through | Expected response/state events and one server hit. |
| XHR mock | Synthetic fields/events and zero new server hits. |
| Cancellation | Fetch abort and XHR abort/timeout settle during delay without hanging. |
| Cleanup | Normal requests work after close; later third-party wrappers remain intact. |
| Policy fixtures | Record which launch/style/network operations succeed or fail, with exact policy. |
| Payload experiment | Record behavior at the actual bundle size and deliberately enlarged sizes; do not infer a universal bookmark limit. |
| Runtime dependencies | No workbench code/font/style downloads during launch or idle. |

Use PASS, FAIL or NOT RUN, and include observations. Distinguish a known unsupported browser policy from an engine bug. Actual encoded size and bookmark behavior are measured per installation path.

## Completion boundary

Complete the M0 code and all checks available in the environment. If required checks fail, fix the implementation within the agreed constraints. If a feasibility issue remains, record the concrete failure and its impact rather than changing scope silently.

Stop at the M0 report. Do not start the full import parsers, recorder UI, persistent profiles, load runner or later feature screens during this task. The next assigned milestone is M1 once the feasibility evidence is accepted and outstanding required checks are complete.

Update `docs/WORK_LOG.md` with the status, changed files, verification results and remaining work. Finish with exact local startup, build and test commands so the user can reproduce the result.
