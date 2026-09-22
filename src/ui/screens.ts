import { el, icon, button, type IconName } from './dom';

export type ScreenId = 'home' | 'test' | 'mock' | 'intercept' | 'route' | 'chaos' | 'endpoints' | 'import' | 'settings';

export type UIState = {
  screen: ScreenId;
  minimized: boolean;
  observed: number;
  activity: string;
  mockEnabled: boolean;
  mockDelay: number;
};

export type Ctx = {
  version: string;
  state: () => Readonly<UIState>;
  go: (screen: ScreenId) => void;
  /** Runs now and after every state change; disposed when the screen is replaced. */
  watch: (listener: (state: Readonly<UIState>) => void) => void;
  setMock: (enabled: boolean) => void;
  setDelay: (ms: number) => void;
  signal: AbortSignal;
};

type Screen = {
  label: string;
  icon: IconName;
  tab: boolean;
  reference: string;
  milestone: string;
  summary: string;
  points: readonly string[];
};

const SCREEN_DATA = {
  home: { label: 'Home', icon: 'home', tab: true, reference: 'home.html', milestone: 'M1',
    summary: 'Module status, profile, counters and quick actions.', points: [] },
  test: { label: 'Test', icon: 'flask', tab: true, reference: 'Test.html · Results.html', milestone: 'M3, M8',
    summary: 'API tester: Once and load modes, Flow and Independent strategies, results and export.',
    points: ['Setup and load phases with dependency ordering', 'Iterations, concurrency, delay and ramp-up', 'Latency statistics, run history, JSON/CSV export'] },
  mock: { label: 'Mock', icon: 'server', tab: true, reference: 'Mock.html · MockRule.html', milestone: 'M5',
    summary: 'Mock server: endpoint-linked and standalone rules with zero upstream traffic.',
    points: ['Method and URL matching with conditions and priority', 'Response status, body, headers and response sequences', 'Activation state, hit counts and matched traffic'] },
  intercept: { label: 'Intercept', icon: 'shuffle', tab: true, reference: 'Intercept.html · InterceptRule.html', milestone: 'M6, M7',
    summary: 'Request and response transformations on this frame’s traffic.',
    points: ['Header, body and status edits plus JSON Patch', 'Transform outcome log with a rule trace', 'Request and response breakpoints (M7)'] },
  route: { label: 'Route', icon: 'route', tab: true, reference: 'Route.html', milestone: 'M6',
    summary: 'Routes this frame’s fetch/XHR requests; browser restrictions apply.',
    points: ['Origin and path matching with path rewrite', 'Credentials handling, conditions and priority', 'CORS, cookies and mixed-content rules still apply'] },
  chaos: { label: 'Chaos', icon: 'flame', tab: true, reference: 'Chaos.html · ChaosRule.html', milestone: 'M5',
    summary: 'Synthetic and real-traffic faults with bounded request replay.',
    points: ['Fault presets, probability sampling and delays', 'Endpoint-derived rules and hit counts', 'Explicit bounded replay of real requests'] },
  endpoints: { label: 'Endpoints', icon: 'book', tab: false, reference: 'Endpoints.html · EndpointEdit.html', milestone: 'M3',
    summary: 'Endpoint CRUD, headers, environments and checks.',
    points: ['Request editor with response sample and checks', 'Global headers, presets and host mappings', 'Promotion from recorded traffic (M4)'] },
  import: { label: 'Import', icon: 'download', tab: false, reference: 'Import.html', milestone: 'M9',
    summary: 'File and paste import for every format in the Import screen.',
    points: ['Native JSON, HAR 1.2, Postman 2.1, Swagger 2.0, OpenAPI 3.0', 'cURL and copied fetch calls', 'Review preview, conflict handling, no imported code runs'] },
  settings: { label: 'Settings', icon: 'gear', tab: false, reference: 'Settings.html', milestone: 'M3, M4, M10',
    summary: 'Profiles, storage, module visibility, limits and version information.',
    points: ['Profile management and origin-scoped storage', 'Body and log limits, recorder recovery', 'Bundled version; replace the bookmark to update'] },
} as const satisfies Record<ScreenId, Screen>;

export const SCREENS: Record<ScreenId, Screen> = SCREEN_DATA;
export const TABS = (Object.keys(SCREEN_DATA) as ScreenId[]).filter(id => SCREENS[id].tab);

const MODULES = [
  { id: 'test', title: 'API Tester', milestone: 'M3' },
  { id: 'mock', title: 'Mock Server', milestone: 'M5' },
  { id: 'intercept', title: 'API Interceptor', milestone: 'M6' },
  { id: 'route', title: 'Page Routing', milestone: 'M6' },
  { id: 'chaos', title: 'Chaos Engineering', milestone: 'M5' },
] as const;

function card(): HTMLElement {
  const section = el('section', 'aw-card aw-cp aw-col aw-gap12');
  return section;
}

function caption(text: string): HTMLElement { return el('div', 'aw-cap aw-capl', text); }

/** The M0 feasibility control: one exact GET matcher, kept until the M5 mock engine replaces it. */
function feasibility(ctx: Ctx): HTMLElement {
  const section = card();
  const head = el('div', 'aw-row');
  const badge = el('span', 'aw-bd');
  const dot = el('span', 'aw-dot');
  badge.append(dot, document.createTextNode('Inactive'));
  head.append(el('span', 'aw-cap aw-grow', 'Feasibility experiment · M0'), badge);
  const target = el('code', 'aw-mono aw-xs', 'GET /api/mock-target');

  const toggle = el('label', 'aw-chk');
  const checkbox = el('input');
  checkbox.type = 'checkbox';
  checkbox.checked = ctx.state().mockEnabled;
  checkbox.addEventListener('change', () => ctx.setMock(checkbox.checked), { signal: ctx.signal });
  toggle.append(checkbox, document.createTextNode('Enable mock · sends no network request'));

  const field = el('label', 'aw-fld');
  field.append(el('span', 'aw-lbl', 'Mock delay (0–10,000 ms)'));
  const delay = el('input', 'aw-in');
  delay.type = 'number'; delay.min = '0'; delay.max = '10000'; delay.step = '1';
  delay.value = String(ctx.state().mockDelay);
  delay.addEventListener('change', () => { ctx.setDelay(Number(delay.value)); delay.value = String(ctx.state().mockDelay); }, { signal: ctx.signal });
  field.append(delay);

  const status = el('p', 'aw-hint');
  status.setAttribute('role', 'status');
  const activity = el('pre', 'aw-code aw-wrap', 'No requests observed.');

  ctx.watch(state => {
    badge.lastChild!.textContent = state.mockEnabled ? 'Mock active' : 'Inactive';
    dot.className = state.mockEnabled ? 'aw-dot aw-g' : 'aw-dot';
    status.textContent = state.mockEnabled ? 'Mock active · GET /api/mock-target' : 'Mock inactive · current-frame fetch / XHR';
    activity.textContent = state.observed ? `${state.observed} observed\n${state.activity}` : 'No requests observed.';
    if (checkbox.checked !== state.mockEnabled) checkbox.checked = state.mockEnabled;
  });
  section.append(head, target, toggle, field, status, activity);
  return section;
}

function moduleCard(ctx: Ctx, module: (typeof MODULES)[number]): HTMLElement {
  const section = card();
  const row = el('div', 'aw-row aw-gap10');
  const tile = el('div', 'aw-tile');
  tile.append(icon(SCREENS[module.id].icon));
  const text = el('div', 'aw-grow aw-col aw-gap2');
  const title = el('div', 'aw-row');
  const badge = el('span', 'aw-bd');
  badge.append(el('span', 'aw-dot'), document.createTextNode(`Not built · ${module.milestone}`));
  title.append(el('span', 'aw-h', module.title), badge);
  text.append(title, el('div', 'aw-xs aw-mu', SCREENS[module.id].summary));
  const open = button('aw-btn aw-gh aw-sm', 'Open', () => ctx.go(module.id), ctx.signal);
  open.append(icon('right'));
  row.append(tile, text, open);
  section.append(row);
  return section;
}

function quickAction(ctx: Ctx, id: ScreenId): HTMLElement {
  const action = button('aw-qa', '', () => ctx.go(id), ctx.signal);
  action.append(icon(SCREENS[id].icon, 'aw-i20'), el('span', '', SCREENS[id].label));
  return action;
}

function home(ctx: Ctx): HTMLElement {
  const screen = el('div', 'aw-col aw-gap12');
  const modules = el('div', 'aw-col aw-gap12');
  for (const module of MODULES) modules.append(moduleCard(ctx, module));
  const quick = el('div', 'aw-g3');
  for (const id of ['endpoints', 'import', 'settings'] as const) quick.append(quickAction(ctx, id));
  const runs = el('div', 'aw-empty', 'No runs yet. The tester arrives in M3.');
  screen.append(feasibility(ctx), caption('Modules'), modules, caption('Quick actions'), quick, caption('Run history'), runs);
  return screen;
}

function planned(ctx: Ctx, id: ScreenId): HTMLElement {
  const screen = el('div', 'aw-col aw-gap12');
  const section = card();
  const head = el('div', 'aw-row aw-gap10');
  const tile = el('div', 'aw-tile');
  tile.append(icon(SCREENS[id].icon));
  const badge = el('span', 'aw-bd aw-am', `Not built · ${SCREENS[id].milestone}`);
  const text = el('div', 'aw-grow aw-col aw-gap2');
  text.append(el('div', 'aw-h', SCREENS[id].label), el('div', 'aw-xs aw-mu', SCREENS[id].summary));
  head.append(tile, text, badge);
  const list = el('ul', 'aw-plan');
  for (const point of SCREENS[id].points) list.append(el('li', 'aw-xs aw-mu', point));
  section.append(head, list);
  const note = el('p', 'aw-hint', `M1 delivers the panel shell only. This screen has no behavior yet; reference design: ${SCREENS[id].reference}.`);
  screen.append(section, note, button('aw-btn aw-out aw-sm aw-self', 'Back to Home', () => ctx.go('home'), ctx.signal));
  return screen;
}

export function renderScreen(ctx: Ctx, id: ScreenId): HTMLElement {
  return id === 'home' ? home(ctx) : planned(ctx, id);
}
