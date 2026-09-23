/**
 * The public landing page, written by `npm run build` to `dist/index.html`.
 *
 * It is one self-contained file: the zinc palette is inlined, every illustration is inline SVG and
 * the install link carries the whole bookmarklet. Nothing is fetched at runtime, so the page can be
 * hosted anywhere (or opened from disk) and still install the tool.
 */

const escapeHTML = text =>
  String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll("'", '&#39;');

const kb = bytes => `${Math.round(bytes / 1024)} KB`;

const FEATURES = [
  ['mock', 'Mock server', 'Serve a static or sequenced response for a matched request: status, headers, body, delay, or a forced network error or timeout.'],
  ['chaos', 'Chaos', 'Latency, random latency, 5xx, malformed JSON, dropped connections and request replay — sampled by probability, with a seed and a budget.'],
  ['intercept', 'Intercept & route', 'Rewrite headers, JSON-patch bodies and change status on the way out or back, or send matched calls to another origin.'],
  ['pause', 'Breakpoints', 'Pause a matched request before it is dispatched or after it returns, edit it in the panel, then continue or abort it.'],
  ['run', 'Flow & load runs', 'Run endpoints as a chained flow or as independent repeats, with concurrency, ramp-up, per-step checks and exported results.'],
  ['import', 'Imports', 'Bring endpoints in from the formats you already have — or record this frame’s traffic and promote the calls you pick.'],
];

const STEPS = [
  ['Show the bookmarks bar', 'In Chrome or Edge press ⌘⇧B (macOS) or Ctrl+Shift+B (Windows, Linux).'],
  ['Drag the button up', 'Drag "API Workbench" onto the bar. It becomes an ordinary bookmark — no extension, no install prompt, no permissions.'],
  ['Click it on any page', 'The panel opens in a shadow root over that page and wraps fetch and XHR for that frame. Click Close and the page is left as it was.'],
];

const ICONS = {
  mock: '<path d="M4 7h16M4 12h10M4 17h7"/><circle cx="18" cy="16" r="3"/>',
  chaos: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  intercept: '<path d="M3 7h6l3 5 3-5h6M3 17h6l3-5"/><circle cx="20" cy="17" r="2"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  run: '<path d="M4 18V9M10 18V5M16 18v-6M22 18H2"/>',
  import: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16"/>',
  shield: '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 5l-2 14"/>',
  box: '<path d="M3 8 12 3l9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
};

const icon = (name, size = 20) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

/** The panel, drawn rather than screenshotted: an image file would not be self-contained. */
const panelArt = () => `
<svg class="art" viewBox="0 0 640 400" role="img" aria-label="The API Workbench panel docked over a page, showing module cards and a matched request">
  <defs>
    <linearGradient id="page" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#18181b"/><stop offset="1" stop-color="#0c0c0e"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3f3f46" stop-opacity=".9"/><stop offset="1" stop-color="#18181b" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="640" height="400" rx="14" fill="url(#page)"/>
  <rect x="1" y="1" width="638" height="398" rx="14" fill="none" stroke="#27272a"/>
  <g fill="#27272a"><circle cx="26" cy="24" r="4"/><circle cx="42" cy="24" r="4"/><circle cx="58" cy="24" r="4"/></g>
  <rect x="80" y="16" width="380" height="16" rx="8" fill="#18181b"/>
  <text x="94" y="28" fill="#52525b" font-family="ui-monospace,Menlo,monospace" font-size="10">https://app.example.com/orders</text>
  <g opacity=".5" fill="#18181b">
    <rect x="24" y="56" width="240" height="14" rx="4"/><rect x="24" y="80" width="300" height="10" rx="4"/>
    <rect x="24" y="98" width="260" height="10" rx="4"/><rect x="24" y="116" width="280" height="10" rx="4"/>
    <rect x="24" y="150" width="150" height="10" rx="4"/><rect x="24" y="168" width="220" height="10" rx="4"/>
  </g>
  <rect x="300" y="44" width="316" height="336" rx="12" fill="#09090b" stroke="#3f3f46"/>
  <rect x="300" y="44" width="316" height="60" fill="url(#glow)" opacity=".35"/>
  <g transform="translate(314,58)">
    <rect width="20" height="20" rx="5" fill="#fafafa"/>
    <path d="M5 14 10 5l5 9" fill="none" stroke="#09090b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="30" y="14" fill="#fafafa" font-family="system-ui,sans-serif" font-size="12" font-weight="600">API Workbench</text>
    <rect x="182" y="2" width="72" height="16" rx="8" fill="#18181b" stroke="#27272a"/>
    <text x="192" y="14" fill="#a1a1aa" font-family="system-ui,sans-serif" font-size="9">app-example</text>
  </g>
  <line x1="300" y1="92" x2="616" y2="92" stroke="#27272a"/>
  <g transform="translate(312,104)">
    <rect width="292" height="26" rx="7" fill="#18181b" stroke="#27272a"/>
    ${['Home', 'Test', 'Mock', 'Route', 'Chaos', 'Results'].map((label, index) => `
    <g transform="translate(${4 + index * 47.5},3)">
      <rect width="45" height="20" rx="5" fill="${index === 2 ? '#09090b' : 'none'}" stroke="${index === 2 ? '#3f3f46' : 'none'}"/>
      <text x="22.5" y="14" text-anchor="middle" fill="${index === 2 ? '#fafafa' : '#71717a'}" font-family="system-ui,sans-serif" font-size="9">${label}</text>
    </g>`).join('')}
  </g>
  <g transform="translate(312,142)">
    <rect width="292" height="66" rx="9" fill="#111113" stroke="#27272a"/>
    <circle cx="18" cy="20" r="4" fill="#22c55e"/>
    <text x="32" y="24" fill="#fafafa" font-family="system-ui,sans-serif" font-size="11" font-weight="600">Mock server</text>
    <rect x="218" y="12" width="60" height="18" rx="9" fill="#09090b" stroke="#3f3f46"/>
    <text x="248" y="25" text-anchor="middle" fill="#fafafa" font-family="system-ui,sans-serif" font-size="9">Active</text>
    <text x="18" y="46" fill="#a1a1aa" font-family="system-ui,sans-serif" font-size="9.5">2 rules · 14 requests served · sequence 2 of 3</text>
    <rect x="18" y="52" width="260" height="4" rx="2" fill="#27272a"/>
    <rect x="18" y="52" width="170" height="4" rx="2" fill="#52525b"/>
  </g>
  <g transform="translate(312,220)">
    <rect width="292" height="66" rx="9" fill="#111113" stroke="#27272a"/>
    <circle cx="18" cy="20" r="4" fill="#fbbf24"/>
    <text x="32" y="24" fill="#fafafa" font-family="system-ui,sans-serif" font-size="11" font-weight="600">Breakpoint</text>
    <text x="18" y="44" fill="#a1a1aa" font-family="ui-monospace,Menlo,monospace" font-size="9">POST /api/orders — paused before dispatch</text>
    <rect x="18" y="50" width="58" height="16" rx="5" fill="#fafafa"/>
    <text x="47" y="62" text-anchor="middle" fill="#09090b" font-family="system-ui,sans-serif" font-size="9" font-weight="600">Continue</text>
    <rect x="84" y="50" width="48" height="16" rx="5" fill="none" stroke="#3f3f46"/>
    <text x="108" y="62" text-anchor="middle" fill="#a1a1aa" font-family="system-ui,sans-serif" font-size="9">Abort</text>
  </g>
  <g transform="translate(312,298)">
    <rect width="292" height="66" rx="9" fill="#111113" stroke="#27272a"/>
    <text x="18" y="22" fill="#a1a1aa" font-family="system-ui,sans-serif" font-size="9.5">Recent traffic</text>
    ${[['GET', '/api/orders', '200', '#22c55e'], ['POST', '/api/orders', 'mocked 201', '#a1a1aa'], ['GET', '/api/me', '500 chaos', '#f87171']].map(([method, path, note, tone], index) => `
    <g transform="translate(18,${32 + index * 12})">
      <text fill="${tone}" font-family="ui-monospace,Menlo,monospace" font-size="8.5">${method}</text>
      <text x="30" fill="#71717a" font-family="ui-monospace,Menlo,monospace" font-size="8.5">${path}</text>
      <text x="256" text-anchor="end" fill="#52525b" font-family="ui-monospace,Menlo,monospace" font-size="8.5">${note}</text>
    </g>`).join('')}
  </g>
</svg>`;

/** The install gesture: a bookmarks bar with the button being dragged onto it. */
const dragArt = () => `
<svg class="art art-sm" viewBox="0 0 640 200" role="img" aria-label="The API Workbench button dragged onto the browser bookmarks bar">
  <rect width="640" height="200" rx="14" fill="#0c0c0e"/>
  <rect x="1" y="1" width="638" height="198" rx="14" fill="none" stroke="#27272a"/>
  <rect x="24" y="24" width="592" height="30" rx="8" fill="#18181b" stroke="#27272a"/>
  ${['Docs', 'Jira', 'Staging', 'Grafana'].map((label, index) => `
  <g transform="translate(${40 + index * 78},32)">
    <rect width="66" height="14" rx="4" fill="#27272a" opacity=".6"/>
    <text x="8" y="11" fill="#71717a" font-family="system-ui,sans-serif" font-size="9">${label}</text>
  </g>`).join('')}
  <rect x="352" y="30" width="2" height="18" rx="1" fill="#fafafa"/>
  <g transform="translate(300,104)">
    <rect width="150" height="34" rx="8" fill="#fafafa"/>
    <path d="M18 24 24 12l6 12" fill="none" stroke="#09090b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="40" y="22" fill="#09090b" font-family="system-ui,sans-serif" font-size="12" font-weight="600">API Workbench</text>
  </g>
  <path d="M372 104 C 366 88, 360 70, 356 56" fill="none" stroke="#52525b" stroke-width="1.5" stroke-dasharray="4 4"/>
  <path d="m352 50 4 8 5-7" fill="none" stroke="#52525b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="470" y="126" fill="#71717a" font-family="system-ui,sans-serif" font-size="11">drag, don't click</text>
</svg>`;

export function showcasePage({ bookmark, sizes, formats, version }) {
  const href = escapeHTML(bookmark);
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>API Workbench — a whole API workbench in one bookmark</title>
<meta name="description" content="Mock, intercept, route, pause, load-test and import API traffic on any page you can open — a single self-contained bookmarklet for desktop Chrome and Edge. No extension, no backend, no packages.">
<style>
  :root {
    --z50:#fafafa; --z200:#e4e4e7; --z400:#a1a1aa; --z500:#71717a; --z700:#3f3f46;
    --z800:#27272a; --z900:#18181b; --z925:#111113; --z950:#09090b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--z950); color: var(--z50); line-height: 1.6;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; color: var(--z200); }
  .wrap { max-width: 980px; margin: 0 auto; padding: 0 20px; }
  header { border-bottom: 1px solid var(--z800); }
  .bar { display: flex; align-items: center; gap: 10px; height: 60px; }
  .logo { width: 26px; height: 26px; border-radius: 7px; background: var(--z50); color: var(--z950); display: grid; place-items: center; }
  .brand { font-weight: 600; letter-spacing: -.01em; }
  .ver { margin-left: auto; color: var(--z500); font-size: 12px; font-family: ui-monospace, Menlo, monospace; }
  section { padding: 64px 0; border-bottom: 1px solid var(--z800); }
  h1 { font-size: clamp(32px, 6vw, 52px); line-height: 1.1; letter-spacing: -.03em; margin: 0 0 16px; }
  h2 { font-size: 24px; letter-spacing: -.02em; margin: 0 0 8px; }
  h3 { font-size: 15px; margin: 0 0 4px; }
  p { margin: 0 0 16px; color: var(--z400); }
  .lead { font-size: 18px; max-width: 62ch; }
  .install { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 28px 0 10px; }
  .drag {
    display: inline-flex; align-items: center; gap: 10px; padding: 13px 22px; border-radius: 10px;
    background: var(--z50); color: var(--z950); font-weight: 600; text-decoration: none;
    cursor: grab; box-shadow: 0 1px 2px rgba(0,0,0,.6);
  }
  .drag:active { cursor: grabbing; }
  .ghost {
    display: inline-flex; align-items: center; gap: 8px; padding: 12px 18px; border-radius: 10px;
    border: 1px solid var(--z700); background: var(--z900); color: var(--z50); font: inherit; font-weight: 500; cursor: pointer;
  }
  .ghost:hover { border-color: var(--z500); }
  .hint { font-size: 13px; color: var(--z500); margin: 0; }
  .art { width: 100%; height: auto; display: block; margin: 40px 0 0; border-radius: 14px; }
  .art-sm { margin-top: 24px; }
  .grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
  .card { padding: 20px; border: 1px solid var(--z800); border-radius: 12px; background: var(--z925); }
  .card p { margin: 0; font-size: 14px; }
  .card .ic { color: var(--z400); margin-bottom: 12px; }
  ol.steps { counter-reset: step; list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; }
  ol.steps li { counter-increment: step; padding: 18px 20px 18px 56px; border: 1px solid var(--z800); border-radius: 12px; background: var(--z925); position: relative; }
  ol.steps li::before {
    content: counter(step); position: absolute; left: 18px; top: 18px; width: 24px; height: 24px; border-radius: 7px;
    background: var(--z900); border: 1px solid var(--z700); display: grid; place-items: center; font-size: 12px; color: var(--z200);
  }
  ol.steps p { margin: 0; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--z800); vertical-align: top; }
  th { color: var(--z500); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
  td:first-child { white-space: nowrap; font-weight: 600; }
  td span { color: var(--z400); }
  .facts { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin-top: 24px; }
  .fact { padding: 16px 18px; border: 1px solid var(--z800); border-radius: 12px; background: var(--z925); }
  .fact b { display: block; font-size: 22px; letter-spacing: -.02em; }
  .fact span { font-size: 12.5px; color: var(--z500); }
  .note { border-left: 2px solid var(--z700); padding: 2px 0 2px 16px; }
  footer { padding: 40px 0 64px; color: var(--z500); font-size: 13px; }
  footer p { color: var(--z500); }
</style>
<header>
  <div class="wrap bar">
    <span class="logo">${icon('code', 16)}</span>
    <span class="brand">API Workbench</span>
    <span class="ver">${escapeHTML(version)}</span>
  </div>
</header>

<section>
  <div class="wrap">
    <h1>A whole API workbench<br>in one bookmark.</h1>
    <p class="lead">Mock responses, inject faults, rewrite or reroute calls, pause a request mid-flight, run a flow under load and import the endpoints you already have — on any page you can open, without installing anything.</p>
    <div class="install">
      <a class="drag" href="${href}" title="Drag this to your bookmarks bar">${icon('box', 18)} API Workbench</a>
      <button class="ghost" type="button" data-copy>${icon('import', 16)} Copy the bookmarklet</button>
    </div>
    <p class="hint">Drag the button to your bookmarks bar — clicking it here only runs it on this page. Desktop Chrome and Edge.</p>
    ${panelArt()}
  </div>
</section>

<section>
  <div class="wrap">
    <h2>What it does</h2>
    <p>Six modules over one interception layer, so every rule sees the same request.</p>
    <div class="grid">
      ${FEATURES.map(([name, title, text]) => `
      <div class="card">
        <div class="ic">${icon(name)}</div>
        <h3>${title}</h3>
        <p>${text}</p>
      </div>`).join('')}
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <h2>Install in three steps</h2>
    <p>It is a bookmark. There is nothing to approve, update or uninstall.</p>
    <ol class="steps">
      ${STEPS.map(([title, text]) => `<li><h3>${title}</h3><p>${text}</p></li>`).join('')}
    </ol>
    ${dragArt()}
  </div>
</section>

<section>
  <div class="wrap">
    <h2>Import what you already have</h2>
    <p>Paste it, load the file, or record the page — every source goes through the same review before anything is saved, and importing never sends a request or runs pasted code.</p>
    <table>
      <thead><tr><th>Format</th><th>Spec version read</th><th>Notes</th></tr></thead>
      <tbody>
        ${formats.map(format => `<tr><td>${escapeHTML(format.label)}</td><td><span>${escapeHTML(format.version)}</span></td><td><span>${escapeHTML(format.note)}</span></td></tr>`).join('')}
      </tbody>
    </table>
    <p class="note">These are each format's own spec version — the Swagger, OpenAPI, HAR and Postman specs — not API Workbench's version, which is shown at the top of this page. They name the readers the build has. A document declaring a newer version — OpenAPI 3.1, HAR 1.3, a newer Workbench export — is read with the reader listed here and told so, or refused; the newer version itself is not supported. YAML, remote <code>$ref</code> and schema execution are not supported at all.</p>
  </div>
</section>

<section>
  <div class="wrap">
    <h2>Nothing leaves your browser</h2>
    <p class="note">The bookmarklet is the whole product: one bundle inside the bookmark URL. It has no backend, no telemetry, no CDN and no packages to fetch at runtime, so a page with a strict CSP or an offline laptop is not a special case. The panel lives in its own shadow root, and closing it restores the transport it wrapped.</p>
    <div class="facts">
      <div class="fact"><b>0</b><span>network requests to run it</span></div>
      <div class="fact"><b>${kb(sizes.minifiedBytes)}</b><span>minified bundle</span></div>
      <div class="fact"><b>${sizes.encodedURLLength.toLocaleString('en-US')}</b><span>characters in the bookmark URL</span></div>
      <div class="fact"><b>${icon('shield', 22)}</b><span>your traffic stays in the tab</span></div>
    </div>
  </div>
</section>

<footer>
  <div class="wrap">
    <p><strong style="color:var(--z200)">Pre-release.</strong> Verified by automated checks in desktop Chrome; Edge and saved-bookmark installation checks are still outstanding. The panel wraps <code>fetch</code> and <code>XMLHttpRequest</code> in the top frame only — not iframes, workers, <code>sendBeacon</code>, EventSource or WebSocket.</p>
    <p>Rebuild it yourself with <code>npm run build</code>; <code>install.html</code> beside this page carries the raw link and the payload probes.</p>
  </div>
</footer>

<script>
  // Progressive enhancement only: the drag-to-install path needs no script at all.
  document.querySelector('[data-copy]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const url = document.querySelector('.drag').getAttribute('href');
    const label = button.lastChild;
    try {
      await navigator.clipboard.writeText(url);
      label.textContent = ' Copied — paste it into a new bookmark';
    } catch {
      label.textContent = ' Copy blocked — use the drag button instead';
    }
    setTimeout(() => { label.textContent = ' Copy the bookmarklet'; }, 4000);
  });
</script>
</html>`;
}
