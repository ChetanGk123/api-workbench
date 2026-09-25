# API Workbench

A self-contained browser bookmarklet for testing APIs, recording requests, mocking responses, and debugging network behavior inside the application you are working on.

API Workbench opens a floating panel in the current page. Its code and styles live inside the bookmark: no extension, backend, hosted JavaScript loader, or runtime packages are required. Desktop Chrome and Microsoft Edge are the target browsers.

## What you can do

| Feature | Use it to |
| --- | --- |
| API tester | Save endpoints, configure headers and environments, send requests, and inspect responses and checks. |
| Test plans | Run requests once or repeatedly, with Flow dependencies or Independent execution, concurrency, and cancellation. |
| Recorder | Capture supported page fetch/XHR traffic and turn requests into reusable endpoints. |
| Mock | Return synthetic responses, configure response sequences, and add delays. |
| Intercept | Transform request/response headers and bodies, override response status, and pause at breakpoints. |
| Route | Rewrite destinations and paths for supported requests in the current frame. |
| Chaos | Exercise latency, failures, and bounded request replay. |
| Profiles | Save configuration on the current origin and export/import it for transfer. |

Import native Workbench JSON, HAR 1.2, Postman collections v2.1, Swagger 2.0 JSON, OpenAPI 3.0 JSON, cURL commands, or literal `fetch()` snippets. Imports are reviewed before application; imported scripts are not executed. See [supported formats and limitations](docs/M9_IMPORT.md).

## Build and install

For development, use **Node.js 24**, npm, and desktop Chrome. Node is only needed to build and test the project, not to run an installed bookmarklet.

```sh
git clone https://github.com/ChetanGk123/api-workbench.git
cd api-workbench
npm ci
npm run build
npm run server
```

The repository is public; cloning needs no access grant.

1. Open [the local landing page](http://127.0.0.1:4173/index.html) or [the installer](http://127.0.0.1:4173/install.html).
2. Show your browser's bookmarks bar and drag the **API Workbench** link onto it.
3. Open the application you want to test, then click the saved bookmark.
4. Use **Minimize** to hide the panel while keeping the tool active, or **Close** to shut it down.

You can also open `dist/install.html` directly without starting the local server. For manual installation, copy the entire contents of `dist/bookmarklet.txt`, including `javascript:`, into a bookmark's URL field.

**Updates:** **Check for update** in Settings reads the published version from `package.json` on the public repository and reports when a newer one exists. The check needs the host page's content security policy to permit the request; when it cannot be read, the panel falls back to comparing against the newest build that has launched on this origin. A bookmarklet cannot rewrite a saved bookmark, so updating is still manual: rebuild or open the install page, replace the bookmark with the new link, and reload the application before launching it.

## Try it locally

With `npm run server` running, open [the API playground](http://127.0.0.1:4173/fixture) and launch your saved bookmark there. The fixture serves two origins on ports **4173** and **4174**, with requests for authentication, errors, delays, redirects, streaming, and CORS behavior.

For a first test:

1. Save [the fixture's OpenAPI JSON](http://127.0.0.1:4173/openapi.json), then import it through Workbench's **Import** screen.
2. Review and apply the endpoints.
3. Send an echo request from **Test** and inspect its response.
4. Create and activate a mock for that endpoint, then send a matching request from the playground.

The fixture uses dummy authentication and in-memory data. Stop it with `Ctrl+C`; restarting resets its data. See the [test server guide](docs/TEST_SERVER.md) for routes and example workflows.

## Development and verification

| Command | Purpose |
| --- | --- |
| `npm ci` | Install the locked development dependencies. |
| `npm run build` | Type-check, bundle, generate installers, and check for unintended runtime assets. |
| `npm run server` | Start the local API playground on ports 4173 and 4174. |
| `npm run fixture` | Alias for the same local server. |
| `npm test` | Rebuild and run the complete Playwright suite. |
| `npx playwright test tests/showcase.spec.mjs tests/m0.spec.mjs` | Run installer and transport smoke checks against the existing build. |

Tests use installed Google Chrome by default and start their own fixture server. Stop any manually started server first so the test ports are free. To run against installed Microsoft Edge from a POSIX shell:

```sh
AW_BROWSER=msedge npm test
```

Browser tests that inject the bookmarklet source do **not** prove saved-bookmark installation, URL retention, or persistence across browser restarts. Those checks must also be performed through the actual browser bookmark UI.

## Generated files

`npm run build` writes to `dist/`, which is excluded from Git.

| File | Contents |
| --- | --- |
| `index.html` | Self-contained landing page, usage guide, and install link. |
| `install.html` | Standalone installation and update instructions. |
| `bookmarklet.txt` | Complete encoded `javascript:` bookmark URL. |
| `api-workbench.js` | Readable standalone IIFE bundle. |
| `api-workbench.min.js` | Minified standalone bundle with inline styles. |
| `sizes.json` | Measured bundle sizes and encoded bookmark length. |
| `install-probes.html`, `bookmarklet-*.txt` | Local payload-size experiments; excluded from the published site. |

## Deployment

[GitHub Actions](.github/workflows/deploy.yml) builds every push and pull request with `npm ci` and `npm run build`, then uploads the generated public files as an artifact. Successful builds on `main` are configured to deploy through GitHub Pages. Browser tests are separate from this deployment workflow.

**Hosting status, 25 September 2026:** the repository was made public and Pages is enabled with GitHub Actions as its source, which cleared the earlier plan restriction. The site is at `https://chetangk123.github.io/api-workbench/`, with the installer at `install.html`.

Once hosting is enabled, pushing committed changes to `main` will update the landing page and installer. It will not replace bookmarks users have already saved. See [deployment setup and rollback instructions](docs/DEPLOYMENT.md).

## Browser boundaries

- Interception covers supported `window.fetch` and asynchronous XHR calls made after launch in the current frame. Cached transport references, other frames, workers, WebSockets, and browser resource loads are outside this scope.
- Synchronous XHR remains on the native pass-through path.
- Browser cookie, CORS, CSP, and other network restrictions still apply. Routing does not create a proxy or bypass those restrictions.
- Profiles belong to the host page's origin. Export/import is needed to transfer them between origins; storage is not an isolated secret vault.
- Navigation or a full reload requires launching the bookmark again.
- Bookmark size and installation behavior vary by browser and installation path. Measure the encoded URL and verify real saved-bookmark behavior before treating a build as release-ready.

The repository contains implemented features and automated checks, but outstanding browser compatibility and release gates remain. Consult the [work log](docs/WORK_LOG.md) and [feasibility report](docs/M0_REPORT.md) for measured evidence and checks not run.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/entry.ts` | Bookmarklet startup and lifecycle. |
| `src/network/` | Shared interception pipeline, fetch/XHR adapters, rules, and transformations. |
| `src/tester/`, `src/recorder/`, `src/breakpoints/` | Request execution, capture, and pause handling. |
| `src/import/` | Import detection, parsing, review, and commit. |
| `src/core/`, `src/ui/` | Models, state, persistence, and native DOM/shadow-root UI. |
| `scripts/` | Bundle and landing-page generation. |
| `tests/` | Playwright checks and controlled local fixtures. |
| `design/reference/` | Original screens and zinc theme. |
| `docs/` | Build plan, evidence, format contracts, and operational guides. |

Before contributing, read [AGENTS.md](AGENTS.md) and the [build plan](docs/API_WORKBENCH_BUILD_PLAN.md). Preserve the self-contained distribution, bounded capture/storage, and shared interception layer; record verification and outstanding limitations in the work log.
