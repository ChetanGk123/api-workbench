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
  ['Launch it in your application', 'Open your development application, sign in, then click the saved bookmark. Close stops Workbench; actions already sent to a server cannot be undone.'],
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
  <g transform="translate(312,217)">
    <rect width="292" height="76" rx="9" fill="#111113" stroke="#27272a"/>
    <circle cx="18" cy="20" r="4" fill="#fbbf24"/>
    <text x="32" y="24" fill="#fafafa" font-family="system-ui,sans-serif" font-size="11" font-weight="600">Breakpoint</text>
    <text x="18" y="44" fill="#a1a1aa" font-family="ui-monospace,Menlo,monospace" font-size="9">POST /api/orders — paused before dispatch</text>
    <rect x="18" y="50" width="58" height="16" rx="5" fill="#fafafa"/>
    <text x="47" y="62" text-anchor="middle" fill="#09090b" font-family="system-ui,sans-serif" font-size="9" font-weight="600">Continue</text>
    <rect x="84" y="50" width="48" height="16" rx="5" fill="none" stroke="#3f3f46"/>
    <text x="108" y="62" text-anchor="middle" fill="#a1a1aa" font-family="system-ui,sans-serif" font-size="9">Abort</text>
  </g>
  <g transform="translate(312,302)">
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
<meta name="description" content="Mock, intercept, route, pause, load-test and import API traffic in your application — a single self-contained bookmarklet for desktop Chrome and Edge. No extension, no backend, no packages.">
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
  .wrap { max-width: 1200px; margin: 0 auto; padding: 0 32px; }
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
  .guide-nav { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 24px 0; }
  .guide { display: grid; gap: 16px; }
  .guide article { scroll-margin-top: 20px; overflow-wrap: anywhere; }
  .guide h3 { font-size: 18px; margin-bottom: 8px; }
  .guide ol { padding-left: 24px; color: var(--z400); font-size: 14px; }
  .guide li + li { margin-top: 8px; }
  .guide strong { color: var(--z200); }
  .guide pre { white-space: pre-wrap; padding: 12px; background: var(--z950); border-radius: 8px; }
  a:focus-visible, button:focus-visible { outline: 2px solid var(--z50); outline-offset: 4px; }
  footer { padding: 40px 0 64px; color: var(--z500); font-size: 13px; }
  footer p { color: var(--z500); }

  html { scroll-behavior: smooth; scroll-padding-top: 32px; }
  .skip { position: absolute; left: 16px; top: -80px; padding: 12px; background: var(--z50); color: var(--z950); z-index: 10; }
  .skip:focus { top: 8px; }
  .bar { height: 80px; }
  .top-nav { display: flex; gap: 28px; margin-left: auto; font-size: 13px; }
  .top-nav a, .guide-nav a { text-decoration: none; color: var(--z400); }
  .top-nav a:hover, .guide-nav a:hover { color: var(--z50); }
  .ver { margin-left: 20px; border: 1px solid var(--z800); padding: 4px 8px; border-radius: 6px; color: var(--z400); }
  section { padding: 80px 0; }
  .eyebrow { display: block; margin-bottom: 20px; font: 11px ui-monospace, monospace; letter-spacing: .14em; text-transform: uppercase; color: var(--z400); }
  .hero { padding: 96px 0 64px; }
  .hero-grid { display: grid; grid-template-columns: 1fr 1.1fr; gap: 48px; align-items: center; }
  h1 { font-size: clamp(40px, 4.7vw, 64px); letter-spacing: -.055em; line-height: 1.04; }
  h1 span { color: var(--z400); }
  h2 { font-size: clamp(28px, 3vw, 40px); line-height: 1.15; letter-spacing: -.04em; margin-bottom: 16px; }
  .lead { font-size: 16px; line-height: 1.8; max-width: 48ch; }
  figure { margin: 0; min-width: 0; }
  .hero .art { margin: 0; }
  figcaption { margin-top: 16px; font: 11px ui-monospace, monospace; color: var(--z400); }
  .install { gap: 12px; }
  .drag, .ghost { border-radius: 8px; padding: 12px 16px; font-size: 13px; }
  .hint { color: var(--z400); max-width: 58ch; }
  .trust { display: flex; flex-wrap: wrap; gap: 12px 32px; margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--z800); color: var(--z400); font-size: 12px; }
  .trust span::before { content: '✓'; margin-right: 8px; color: var(--z200); }
  .section-heading { display: flex; align-items: end; justify-content: space-between; gap: 48px; margin-bottom: 32px; }
  .section-heading p { max-width: 42ch; margin: 0; font-size: 14px; }
  .section-heading h2 { margin: 0; }
  .grid { grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .card { padding: 24px; border-radius: 8px; }
  .card h3 { font-size: 17px; margin-bottom: 8px; }
  .card .ic { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
  .card .ic span { font: 11px ui-monospace, monospace; color: var(--z500); }
  .card a { display: inline-block; margin-top: 20px; text-underline-offset: 5px; font-size: 12px; }
  .install-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: start; }
  .install-layout .art { margin-top: 32px; }
  .workflow { background: var(--z925); }
  .flow { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; align-items: center; gap: 20px; margin-top: 32px; }
  .flow-box { border: 1px solid var(--z700); padding: 24px; border-radius: 8px; background: var(--z950); }
  .flow-box small { display: block; color: var(--z400); margin: 8px 0 0; }
  .flow-box code { display: block; margin-bottom: 16px; font-size: 11px; color: var(--z400); }
  .flow-arrow { color: var(--z400); }
  .guide { gap: 0; }
  .guide article { border: 0; border-top: 1px solid var(--z800); border-radius: 0; background: transparent; padding: 28px 0; display: grid; grid-template-columns: 280px 1fr; column-gap: 48px; }
  .guide article h3 { grid-column: 1; grid-row: 1 / span 4; font-size: 18px; }
  .guide article > :not(h3) { grid-column: 2; margin-top: 0; }
  .guide article p { font-size: 13px; }
  .guide-nav a { border: 1px solid var(--z800); padding: 6px 12px; border-radius: 6px; font-size: 12px; }
  .guide-nav { gap: 8px; }
  .table-scroll { overflow-x: auto; margin: 32px 0; }
  th { color: var(--z400); }
  .fact span, footer, footer p { color: var(--z400); }
  details { padding: 20px 0; border-bottom: 1px solid var(--z800); }
  summary { cursor: pointer; font-weight: 500; }
  details p { margin: 16px 0 0; max-width: 80ch; font-size: 14px; }
  .footer-row { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
  @media (max-width: 900px) {
    .hero-grid, .install-layout { grid-template-columns: 1fr; gap: 32px; }
    .hero figure { max-width: 680px; }
    .hero { padding-top: 64px; }
    .grid { grid-template-columns: repeat(2, 1fr); }
    .guide article { grid-template-columns: 200px 1fr; gap: 24px; }
  }
  @media (max-width: 600px) {
    .wrap { padding: 0 20px; }
    .top-nav { gap: 16px; }
    .top-nav a:first-child, .ver { display: none; }
    .brand { font-size: 13px; }
    section { padding: 48px 0; }
    .grid, .flow { grid-template-columns: 1fr; }
    .flow-arrow { transform: rotate(90deg); justify-self: center; }
    .section-heading { display: block; }
    .section-heading p { margin-top: 16px; }
    .guide article { display: block; }
    .guide article h3 { margin-bottom: 20px; }
    .facts { grid-template-columns: repeat(2, 1fr); }
  }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
</style>
<body>
<a class="skip" href="#main">Skip to content</a>
<header>
  <div class="wrap bar">
    <span class="logo">${icon('code', 16)}</span>
    <span class="brand">API Workbench</span>
    <nav class="top-nav" aria-label="Main navigation"><a href="#features">Features</a><a href="#usage">Guide</a><a href="#install">Install ↗</a></nav>
    <span class="ver">${escapeHTML(version)}</span>
  </div>
</header>

<main id="main">
<section class="hero">
  <div class="wrap">
    <div class="hero-grid">
      <div>
        <span class="eyebrow">Your browser. Your APIs. Your rules.</span>
        <h1>A whole API workbench.<br><span>One bookmark.</span></h1>
        <p class="lead">Build the response you need. Reproduce the failure you can’t catch. Test your APIs right inside the application you’re working on.</p>
        <div class="install">
          <a class="drag" href="${href}" title="Drag this to your bookmarks bar">${icon('box', 18)} API Workbench</a>
          <button class="ghost" type="button" data-copy>${icon('import', 16)} Copy the bookmarklet</button>
        </div>
        <p class="hint" role="status" data-copy-status>Drag the button to your bookmarks bar. <a href="#install">Installation guide ↗</a></p>
      </div>
      <figure>${panelArt()}<figcaption>01 / Illustrated workflow · example requests and results</figcaption></figure>
    </div>
    <div class="trust"><span>No extension required</span><span>Self-contained bookmarklet</span><span>Desktop Chrome &amp; Edge</span><span>No backend or telemetry</span></div>
  </div>
</section>

<section>
  <div class="wrap">
    <span class="eyebrow" id="features">A toolkit for the what-ifs</span><div class="section-heading"><h2>Make every response<br>part of your test.</h2><p>From a missing backend to a hard-to-reproduce error, choose the tool that fits the question.</p></div>
    <div class="grid">
      ${FEATURES.map(([name, title, text], index) => `
      <div class="card">
        <div class="ic">${icon(name)}<span>0${index + 1}</span></div>
        <h3>${title}</h3>
        <p>${text}</p><a href="#use-${({pause: 'breakpoints', run: 'test'})[name] || name}">Explore ${title.toLowerCase()} ↗</a>
      </div>`).join('')}
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="install-layout" id="install"><div><span class="eyebrow">From bookmark bar to workbench</span>
    <h2>Small setup.<br>A full toolkit.</h2>
    <p>Save the complete tool as a bookmark, then launch it where you work. No account or extension to install.</p>
    ${dragArt()}
    <p class="hint">Prefer a manual setup? <a href="bookmarklet.txt">Open the bookmarklet text</a> and paste its entire contents into a new bookmark’s URL field.</p></div>
    <ol class="steps">
      ${STEPS.map(([title, text]) => `<li><h3>${title}</h3><p>${text}</p></li>`).join('')}
    </ol></div>
  </div>
</section>

<section class="workflow">
  <div class="wrap">
    <span class="eyebrow">A first experiment</span>
    <div class="section-heading"><h2>Test the empty state.<br>Without emptying the database.</h2><p>Create an enabled mock for GET /api/orders, set its JSON body to [], activate Mock, then refresh the orders list in your application.</p></div>
    <figure aria-label="Example mock flow: the application requests orders, Workbench responds with an empty JSON array without contacting the server, and the application displays its empty state.">
      <div class="flow">
        <div class="flow-box"><code>01 / YOUR APPLICATION</code><strong>GET /api/orders</strong><small>A normal fetch or XHR request</small></div>
        <span class="flow-arrow" aria-hidden="true">→</span>
        <div class="flow-box"><code>02 / WORKBENCH MOCK</code><strong>200 OK · []</strong><small>Matched call served locally</small></div>
        <span class="flow-arrow" aria-hidden="true">→</span>
        <div class="flow-box"><code>03 / YOUR INTERFACE</code><strong>“No orders yet”</strong><small>Inspect the empty-state experience</small></div>
      </div>
      <figcaption>02 / Example only · use your endpoint’s actual response shape. Deactivate Mock to return to real responses.</figcaption>
    </figure>
  </div>
</section>

<section>
  <div class="wrap">
    <h2 id="usage">How to use API Workbench</h2>
    <p>Open your application, sign in normally, then launch the bookmark. Start by adding, importing or recording an endpoint. Use Test to send it yourself, or activate a rule module and repeat an action in your application.</p>
    <nav class="guide-nav" aria-label="Usage sections">
      <a href="#use-home">Home</a><a href="#use-endpoints">Endpoints</a><a href="#use-test">Test</a>
      <a href="#use-mock">Mock</a><a href="#use-intercept">Intercept</a><a href="#use-breakpoints">Breakpoints</a>
      <a href="#use-route">Route</a><a href="#use-chaos">Chaos</a><a href="#use-results">Results</a>
      <a href="#use-record">Record</a><a href="#use-import">Import</a><a href="#use-settings">Settings</a>
    </nav>
    <p class="note">For Mock, Intercept, Route and Chaos, both the rule and its module must be enabled. Saving a rule alone does not activate the module. Rules affect future supported fetch/XHR calls in this frame; reloads require launching the bookmark again.</p>
    <div class="guide">
      <article class="card" id="use-home" aria-labelledby="guide-home">
        <h3 id="guide-home">Home — choose your workflow</h3>
        <ol>
          <li>Check the current origin and profile so you know which application and configuration you are using.</li>
          <li>Open a module card, or use the quick actions for Endpoints, Record and Import. Check module status and hit counts as you work.</li>
          <li>Minimize to keep the tool running while using the application. Restore it to inspect activity; use Close when finished to shut down the tool.</li>
        </ol>
        <p><strong>First exercise:</strong> add a GET endpoint, run it once, then create a mock for that same path and trigger it from your application.</p>
      </article>
      <article class="card" id="use-endpoints" aria-labelledby="guide-endpoints">
        <h3 id="guide-endpoints">Endpoints — define reusable requests</h3>
        <ol>
          <li>Open Endpoints and choose <strong>Add endpoint</strong>. Enter a name, alias, method and path, such as GET <code>/api/orders</code>.</li>
          <li>Choose the body kind and add headers or a body if needed. Configure the host key and environment mapping when the API uses another origin.</li>
          <li>Add checks, such as an expected status or body content. A response sample is reference data for editing and mocking; it does not send a request.</li>
          <li>Choose <strong>Save endpoint</strong>. Open the endpoint name again to edit it, or select it in Test.</li>
        </ol>
        <p>Eligible cookies come from the browser session. Configure application-specific authorization or CSRF headers yourself; cross-origin requests still follow browser policy.</p>
      </article>
      <article class="card" id="use-test" aria-labelledby="guide-test">
        <h3 id="guide-test">Test — send one request or run a plan</h3>
        <ol>
          <li>For one request, choose <strong>Once</strong>, select an endpoint and click <strong>Run Once</strong>. Inspect the body, headers and checks, or use <strong>Save as response sample</strong>. Once uses Direct execution and bypasses active rules.</li>
          <li>For repeated requests, choose <strong>Load</strong> and select the endpoints to include. Move preparation requests to setup with <strong>To setup</strong>.</li>
          <li>Choose <strong>Flow</strong> for an ordered sequence per iteration, including dependencies such as <code>{{create_order.id}}</code>. Choose <strong>Independent</strong> to repeat endpoints independently; load endpoints cannot depend on each other in this strategy.</li>
          <li>Set iterations, concurrency, batch delay and optional ramp-up. Flow concurrency counts simultaneous iterations; Independent concurrency limits the shared pool of request jobs.</li>
          <li>Choose <strong>Direct</strong> to bypass rules or <strong>Apply active rules</strong> to exercise your mocks, transforms or faults. Review destinations and preflight errors, then choose <strong>Run Load</strong>. Use <strong>Stop</strong> to cancel remaining work.</li>
        </ol>
        <p><strong>Try it:</strong> select one GET endpoint, 3 iterations and concurrency 1. To test a mock, activate Mock and use Load with Apply active rules. These are browser-local measurements using one browser session.</p>
      </article>
      <article class="card" id="use-mock" aria-labelledby="guide-mock">
        <h3 id="guide-mock">Mock — return a response without calling the server</h3>
        <ol>
          <li>Choose <strong>Add rule from endpoint</strong> or <strong>Add ad-hoc rule</strong>. Match a method and URL, for example GET <code>/api/orders</code>.</li>
          <li>Set a static response: status <code>200</code>, header <code>Content-Type: application/json</code> and body <code>{"orders":[]}</code>. Add a delay if you want to inspect a loading state, or use <strong>Use recorded response</strong> for a linked endpoint with a sample.</li>
          <li>For changing responses, select <strong>Response sequence</strong>, add responses such as 503 then 200, and choose whether exhaustion repeats the last response, loops or fails. <strong>Reset position</strong> restarts the sequence.</li>
          <li>Check <strong>Rule enabled</strong>, save, then <strong>Activate</strong> Mock. Trigger the matching application action and inspect the hit count and Matched traffic.</li>
        </ol>
        <p>A selected mock makes no upstream request. Sequence slots are consumed in request-arrival order, including requests that are later aborted. Deactivate Mock to return to normal traffic.</p>
      </article>
      <article class="card" id="use-intercept" aria-labelledby="guide-intercept">
        <h3 id="guide-intercept">Intercept — edit requests and responses</h3>
        <ol>
          <li>Choose <strong>Add rule</strong>, link an endpoint or enter a method and URL matcher.</li>
          <li>In Request, set or remove headers or edit the supported body. In Response, edit headers, replace the body, apply JSON Patch or set a status override; a blank override preserves the original status.</li>
          <li>For a JSON response containing an <code>available</code> field, use this patch in the response Raw JSON editor:</li>
        </ol>
        <pre><code>[{"op":"replace","path":"/available","value":false}]</code></pre>
        <ol start="4">
          <li>Enable the rule, save and <strong>Activate</strong> Intercept. Repeat the application action and inspect the Traffic log for the delivered result and any skipped-transform reason.</li>
        </ol>
        <p>JSON Patch paths must match the actual body. Unsupported or unreadable bodies can skip transformation. Response edits change what the application receives after dispatch; they do not undo server-side effects.</p>
      </article>
      <article class="card" id="use-breakpoints" aria-labelledby="guide-breakpoints">
        <h3 id="guide-breakpoints">Breakpoints — pause and inspect a matching call</h3>
        <ol>
          <li>In an Intercept rule, enable a request or response breakpoint, save the enabled rule and activate Intercept.</li>
          <li>Trigger the matching call. Open the paused-request queue in Intercept and select the paused entry to inspect or edit its supported fields.</li>
          <li>Choose <strong>Continue</strong> to release that call or <strong>Abort</strong> to cancel it. Use <strong>Continue all</strong> to release the queue.</li>
        </ol>
        <p>A request breakpoint pauses before dispatch; a response breakpoint pauses after the server may already have acted. Pauses have deadlines and queue limits, so they do not wait indefinitely.</p>
      </article>
      <article class="card" id="use-route" aria-labelledby="guide-route">
        <h3 id="guide-route">Route — send matched calls to another destination</h3>
        <ol>
          <li>Choose <strong>New page rule</strong>. Set the method, path matcher and optional match origin.</li>
          <li>Enter the <strong>Destination origin</strong>. Preserve the path or set a <strong>Path rewrite</strong>, and choose destination credentials deliberately.</li>
          <li>For example, matching <code>/api/**</code> and rewriting to <code>/sandbox/**</code> sends <code>/api/orders?limit=5</code> to <code>/sandbox/orders?limit=5</code> on the destination origin.</li>
          <li>Enable the rule, save and <strong>Activate</strong> Route. Trigger the request and inspect Routed traffic.</li>
        </ol>
        <p>Routing changes real network destinations. CORS, CSP, cookies and mixed-content restrictions still apply. A request served by a mock does not reach the routed server.</p>
      </article>
      <article class="card" id="use-chaos" aria-labelledby="guide-chaos">
        <h3 id="guide-chaos">Chaos — exercise failure and recovery states</h3>
        <ol>
          <li>Choose a preset or <strong>Add rule</strong>, then match the endpoint you want to affect.</li>
          <li>Select a fault, such as latency, error status, network failure, timeout or malformed JSON. Choose synthetic mode for a fault without upstream dispatch, or real-traffic mode to affect a real call.</li>
          <li>Set probability and the relevant delay or timeout, seed and hit budget. For a first exercise, use a GET endpoint with 100% probability and a short latency.</li>
          <li>Enable and save the rule, then <strong>Activate</strong> Chaos. Repeat the application action, inspect its recovery state and the Fault log, then deactivate the module.</li>
        </ol>
        <p><strong>Request replay</strong> sends real additional copies; it can repeat writes. Real-traffic faults cannot undo a request already received by the server. Synthetic chaos takes precedence over a matching mock.</p>
      </article>
      <article class="card" id="use-results" aria-labelledby="guide-results">
        <h3 id="guide-results">Results — understand and export a run</h3>
        <ol>
          <li>Open Results for the current load run, or open a previous run from run history.</li>
          <li>Review progress, passed and failed outcomes, latency statistics and the per-endpoint breakdown. Inspect errors and checks before interpreting a failed run.</li>
          <li>Choose <strong>JSON</strong> or <strong>CSV</strong> to export the run. To repeat it with changes, return to Test and review the plan before running again.</li>
        </ol>
        <p>Mock responses, injected delays and breakpoints affect observed timings. Use Direct execution when you want measurements without active rule effects; browser-local runs are not server-capacity benchmarks.</p>
      </article>
      <article class="card" id="use-record" aria-labelledby="guide-record">
        <h3 id="guide-record">Record — capture calls from your application</h3>
        <ol>
          <li>Open Record and choose <strong>Start recording</strong> before interacting with the application.</li>
          <li>Perform the action you want to capture, then choose <strong>Stop recording</strong>. Only supported calls made after capture starts are available.</li>
          <li>Review the captured endpoint candidates, select the calls to keep and click a candidate name to edit it.</li>
          <li>Choose <strong>Add to this profile</strong>, or name a new profile and choose <strong>Create profile</strong>. The saved endpoints are now available in Test.</li>
        </ol>
        <p>Repeated calls can collapse into one candidate. Body previews are bounded; the recorder does not capture all browser traffic or browser-owned Cookie headers.</p>
      </article>
      <article class="card" id="use-import" aria-labelledby="guide-import">
        <h3 id="guide-import">Import — turn existing definitions into endpoints</h3>
        <ol>
          <li>Paste JSON, a cURL command or a copied fetch call, or choose a local file. Check the detected format and use the format override if needed.</li>
          <li>Choose <strong>Apply</strong> to parse the draft and open Import review.</li>
          <li>Read warnings, resolve conflicts, select candidates and review the destination profile. Unsupported scripts and unresolved variables need attention before testing.</li>
          <li>Choose <strong>Import selected</strong>, then inspect the endpoints and supply required values before running them. <strong>Use recorded calls</strong> brings captured traffic into this review flow.</li>
        </ol>
        <p>Importing neither sends the imported requests nor executes pasted code. Supported format versions and limitations are listed below.</p>
      </article>
      <article class="card" id="use-settings" aria-labelledby="guide-settings">
        <h3 id="guide-settings">Settings — manage profiles and local data</h3>
        <ol>
          <li>Name and <strong>Save</strong> the current profile, use <strong>Save as copy</strong> for a separate scenario, or select a saved profile and choose <strong>Load</strong>.</li>
          <li>Configure module visibility, traffic-log and recorder limits. Configure page-context sources only when your request templates need them.</li>
          <li>Use <strong>Export profile + endpoints</strong> for a portable profile or <strong>Export all data</strong> for a backup. Review any storage-failure message rather than assuming changes were saved.</li>
          <li>Replace the saved bookmark to update the bundled code. Launch it again after a page reload.</li>
        </ol>
        <p>Saved data belongs to the current origin. Export and import it to move between origins; clearing stored data removes locally saved configuration.</p>
      </article>
    </div>
    <p class="note" style="margin-top:24px"><strong>No rule hits?</strong> Check the method, URL and conditions, the rule’s enabled state and the module’s activation. Higher-priority matches win within a module. Once bypasses rules; use a page action or Load with Apply active rules. Calls from workers, other frames or previously cached transport references can bypass capture.</p>
  </div>
</section>

<section>
  <div class="wrap">
    <h2>Import what you already have</h2>
    <p>Paste it, load the file, or record the page — every source goes through the same review before anything is saved, and importing never sends a request or runs pasted code.</p>
    <div class="table-scroll" tabindex="0" role="region" aria-label="Supported import formats"><table>
      <thead><tr><th>Format</th><th>Spec version read</th><th>Notes</th></tr></thead>
      <tbody>
        ${formats.map(format => `<tr><td>${escapeHTML(format.label)}</td><td><span>${escapeHTML(format.version)}</span></td><td><span>${escapeHTML(format.note)}</span></td></tr>`).join('')}
      </tbody>
    </table></div>
    <p class="note">These are each format's own spec version — the Swagger, OpenAPI, HAR and Postman specs — not API Workbench's version, which is shown at the top of this page. They name the readers the build has. A document declaring a newer version — OpenAPI 3.1, HAR 1.3, a newer Workbench export — is read with the reader listed here and told so, or refused; the newer version itself is not supported. YAML, remote <code>$ref</code> and schema execution are not supported at all.</p>
  </div>
</section>

<section>
  <div class="wrap">
    <span class="eyebrow">Built to stay self-contained</span><h2>Your tools, in your tab.</h2>
    <p>The bookmark contains the code, styles and illustrations it needs. There is no hosted loader, product backend or telemetry. Real API calls still go to their configured servers; an explicit update check contacts the published site.</p>
    <p class="note">Browser rules still apply: CSP can restrict operations, CORS governs cross-origin responses, and cookies follow browser policy. Profiles are saved per origin; export them to move between applications.</p>
    <div class="facts">
      <div class="fact"><b>0</b><span>runtime asset downloads</span></div>
      <div class="fact"><b>${kb(sizes.minifiedBytes)}</b><span>minified bundle</span></div>
      <div class="fact"><b>${sizes.encodedURLLength.toLocaleString('en-US')}</b><span>characters in the bookmark URL</span></div>
      <div class="fact"><b>${icon('shield', 22)}</b><span>no product backend</span></div>
    </div>
  </div>
</section>

<section><div class="wrap"><span class="eyebrow">Before you get started</span><h2>A few useful details.</h2>
<details><summary>Why isn’t my rule matching?</summary><p>Check the method, URL, conditions and priority. Both the rule and its module must be enabled. Trigger a new page request after activation; Once runs bypass rules. Calls from workers, other frames or cached transport references may bypass Workbench.</p></details>
<details><summary>Does it use my application’s session?</summary><p>The browser attaches eligible cookies. Workbench does not read HttpOnly cookies. Bearer tokens and CSRF headers may need explicit configuration; routing to another origin does not transfer your session.</p></details>
<details><summary>How do I update a saved bookmark?</summary><p>Use Check for updates in Settings. If a newer build is available, Copy new bookmarklet copies its code for you to paste into the saved bookmark’s URL. Or replace the bookmark using this page. Reload your application before launching the updated version; saved bookmarks do not update automatically.</p></details>
<details><summary>What happens when I minimize or close it?</summary><p>Minimize keeps active tools running. Close disables Workbench and removes its panel, restoring transport references it still owns. Reloading the page requires launching the bookmark again. Closing cannot undo changes already made on a server.</p></details>
</div></section>
</main>
<footer>
  <div class="wrap">
    <div class="footer-row"><strong>API Workbench</strong><a href="#install">Add to your bookmarks ↗</a></div>
    <p><strong style="color:var(--z200)">Verification status.</strong> Verified by automated checks in desktop Chrome; Edge and saved-bookmark installation checks are still outstanding. The panel wraps <code>fetch</code> and <code>XMLHttpRequest</code> in the top frame only — not iframes, workers, <code>sendBeacon</code>, EventSource or WebSocket.</p>
    <p>Rebuild it yourself with <code>npm run build</code>; <a href="install.html">the manual installer</a> beside this page carries the installation link. Payload probes are available only in the local development build.</p>
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
      label.textContent = ' Copied';
      document.querySelector('[data-copy-status]').textContent = 'Copied — paste into a new bookmark’s URL field, including javascript:.';
    } catch {
      document.querySelector('[data-copy-status]').textContent = 'Copy blocked — drag API Workbench to your bookmarks bar, or use the manual installer below.';
    }
    setTimeout(() => { label.textContent = ' Copy the bookmarklet'; }, 4000);
  });
</script>
</body>
</html>`;
}
