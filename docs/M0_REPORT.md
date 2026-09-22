# M0 feasibility report

Date: 2026-09-23 · Platform: macOS (darwin 25.6.0) · Node v24.21.0

## Status after M1 (2026-09-23)

All 12 automated gates below were re-run unchanged against the M1 build and still pass
(Chrome 153.0.8010.53). Two identifiers in this report moved with the M1 shell: the host element
is now `#api-workbench` (was `#api-workbench-m0`) and the installer's first link is named
**API Workbench** (was *API Workbench M0*). The manual checks at the end of this report are still
**NOT RUN**, and the encoded bookmark URL grew from 27,348 to 47,138 characters, so the saved-bookmark
and payload-probe steps matter more, not less.

One build assertion was relaxed in M1: the "no absolute URL in the output" check now strips the literal
`http://www.w3.org/2000/svg` before testing, because inline SVG icons need that XML namespace. It is an
identifier, never fetched; every other `http(s)://` occurrence still fails the build.

## Toolchain

| Tool | Version | Role |
|---|---|---|
| typescript | 7.0.2 | type check only (`noEmit`) |
| esbuild | 0.28.2 | IIFE bundle, minify, inline CSS |
| @playwright/test | 1.63.0 | browser checks |

Pinned in `package.json` and `package-lock.json`. No runtime dependencies.

## Commands and outcomes

```
npm run build            # tsc && node scripts/build.mjs   → exit 0
npx playwright test      # 12 passed (4.9s), Chrome 153.0.8010.53
npm run fixture          # http://127.0.0.1:4173/fixture and :4174
```

`npm test` runs build then tests. The Playwright config starts the fixture server itself; stop any
manually started `npm run fixture` first or port 4173 is already in use.

## Artifacts and measured sizes

| Artifact | Measure |
|---|---|
| `dist/api-workbench.js` | 27,914 raw bytes |
| `dist/api-workbench.min.js` | 20,432 raw bytes |
| `dist/bookmarklet.txt` | 27,348 characters of encoded `javascript:` URL |
| `dist/install.html` | installer with drag link + manual paste instructions |
| `dist/bookmarklet-{65536,262144,1048576}.txt` | inert-padded size probes |

Sizes are uncompressed byte counts from `dist/sizes.json`; no transfer-compressed figure is used.
The encoded URL is ~34% larger than the minified bundle because of percent-encoding.

## Gate results

| Gate | Result | Evidence |
|---|---|---|
| Build | PASS | `npm run build` exit 0; artifacts above; build asserts no bundle imports, no `eval`/`new Function`/`import()`/`http(s)://` in output, no `url()`/`@import` in either CSS input. |
| Actual saved bookmark | **NOT RUN** | Playwright cannot drive Chrome's bookmark UI. Automated launch uses `page.evaluate` of the decoded bookmarklet source and is explicitly *not* saved-bookmark proof. Manual steps below. |
| Double launch | PASS | Second launch restores the same instance: one `#api-workbench-m0` node, `fetch`/`XMLHttpRequest` identities unchanged. |
| Session | PASS | After `/login`, `document.cookie` does not contain `aw_fixture_session` (HttpOnly never read); `/api/session` reports `authenticated: true` via fetch and via XHR; `credentials: 'omit'` reports `false`, so caller credential settings are preserved. |
| Fetch pass-through | PASS | `/api/mock-target` returns `source: "network"`, server hit count +1. `/api/error` surfaces 503. `Request` + `init` precedence preserved (`init.body` overrides, headers kept) against `/api/echo`. |
| Fetch mock | PASS | Real `Response` instance, status 200, body `{source:"workbench",message:"Mock response — café ✓"}` (Unicode intact), hit count unchanged. `/api/mock-target?unmatched=1` still goes to network. |
| XHR pass-through | PASS | `source: "network"`, hit count +1, native event sequence recorded. |
| XHR mock | PASS | Event sequence byte-identical to the observed native one: `readystatechange:1 → loadstart:1 → readystatechange:2 → readystatechange:3 → progress:3 → readystatechange:4 → load:4 → loadend:4`; `status` 200, `Content-Type: application/json`, `event.target === xhr`, `xhr instanceof XMLHttpRequest`, `onload` fired once, `responseType: 'json'` yields a parsed object. Hit count unchanged. |
| Cancellation | PASS | Fetch abort both before send and during a 1,000 ms mock delay rejects with the caller's `reason`; native `/api/slow` abort rejects `AbortError`. XHR abort and timeout during a mock delay produce event sequences equal to the native `/api/slow` abort/timeout sequences, `status === 0`. No hangs; hit counts unchanged. |
| Cleanup | PASS | Close restores the exact captured `fetch`/`XMLHttpRequest`; a wrapper installed *before* Workbench is captured and restored; a wrapper installed *after* Workbench is left in place and Workbench's layer goes inactive; pending owned mock delays settle immediately on close while an in-flight native `/api/slow` still resolves from the network; subsequent fetch and XHR return `source: "network"`. |
| Policy fixtures | PARTIAL / see note | Under `default-src 'none'; script-src 'self'; style-src 'none'; connect-src 'self'; require-trusted-types-for 'script'`: the shadow-root panel renders with theme styling applied (`background rgb(9,9,11)`) — constructed `CSSStyleSheet` + `adoptedStyleSheets` are not subject to `style-src`, and no HTML string is parsed, so Trusted Types is not engaged; same-origin fetch succeeds. Under `connect-src 'none'`: real fetch fails with `TypeError` (browser policy, not a bug) while the mock still returns `source: "workbench"` without a network request. **Launch of a saved bookmark under these policies is NOT RUN** — only the injected-source path was exercised, so this measures runtime operations, not `javascript:` bookmark execution under CSP. |
| Payload experiment | PARTIAL | Actual encoded length 27,348 characters builds and runs. Probe URLs at 65,536 / 262,144 / 1,048,576 characters are generated and served from the installer, but installing and clicking them requires the bookmark UI: **NOT RUN**. No universal bookmark-length limit is claimed. |
| Runtime dependencies | PASS | With a request listener attached, launching the panel and idling 100 ms produced zero page requests. Theme and panel CSS are inlined as text at build time; no font or stylesheet URL exists in the bundle. |
| CORS (second origin) | PASS | `http://127.0.0.1:4174/api/cors-allowed` (ACAO `http://127.0.0.1:4173`, credentials true) readable by fetch and XHR (200); `/api/cors-denied` (no CORS headers) rejects fetch with `TypeError` and drives XHR to `error:4`. No fixture policy was weakened to pass. |

## Design decisions recorded

- **One decision path.** `src/network/pipeline.ts` owns the single `decide(method, url, transport)` call and the
  pending-work registry; both adapters call it. M0 matches exactly one GET URL; general rules are M2.
- **XHR adapter approach: `Proxy` with a `construct` trap over the captured constructor**, returning a genuine
  native `XMLHttpRequest` whose script-visible response fields are overridden per-instance via
  `Object.defineProperty` only while a synthetic response is selected. Chosen over a hand-written class so that
  `instanceof`, `EventTarget` semantics, `upload`, and subclassing keep working. Synchronous `send` is never
  intercepted — it goes straight to the native call. XHR is not routed through fetch.
- **Constructed stylesheets** (`new CSSStyleSheet().replaceSync`) rather than a `<style>` element, which is what
  keeps the panel working under `style-src 'none'` and avoids Trusted Types entirely.
- **Restore only what we own.** Close re-installs the captured references only if `window.fetch`/`window.XMLHttpRequest`
  still hold Workbench's wrappers; otherwise the later wrapper is untouched and the pipeline simply goes inactive.

## Known limitations

1. Edge is not installed on this machine — every Edge gate is NOT RUN.
2. Saved-bookmark installation, restart persistence, and bookmark launch under CSP are NOT RUN (no automatable path).
3. XHR conformance is verified for success, abort and timeout on the mock path only; broad conformance is M2 scope.
4. Only the top frame is hooked. Iframes, workers, `sendBeacon`, EventSource and WebSocket are untouched.
5. The mock matcher is a single exact-URL GET; nothing about rule precedence has been proven.

## Manual checks still outstanding

Run these, then replace the NOT RUN rows above with observed results and browser versions.

```
npm run build
npm run fixture          # leave running
```

1. Open `http://127.0.0.1:4173/install.html`. Drag **API Workbench** (the first link) to the bookmarks bar
   (or create a bookmark and paste all of `dist/bookmarklet.txt`, including `javascript:`). Do not click the
   link on the installer page — that proves nothing about a saved bookmark.
2. Open `http://127.0.0.1:4173/fixture` and click the saved bookmark. Record: does the panel appear, and what is the
   URL length the browser accepted?
3. Click the bookmark again — expect one panel, not two.
4. Click **Log in to local fixture**, then Fetch `/api/session` → `authenticated: true`.
5. Fetch and XHR `/api/mock-target` with the mock off; check `/api/stats` increments.
6. Enable the mock, repeat both; expect the workbench body and **no** change in `/api/stats`.
7. Set mock delay 5000, start a request, press **Cancel current requests**; expect a prompt settle, no hang.
8. Close the panel; repeat step 5 and confirm normal network behavior returns.
9. Restart the browser and click the bookmark again (persistence).
10. Repeat 2–8 on `/policy/strict` and `/policy/blocked`, and in Microsoft Edge.
11. Repeat step 1–2 with each `dist/bookmarklet-*.txt` probe and record which lengths the browser stores and runs.
