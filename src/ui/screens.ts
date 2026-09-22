import { el, icon, button, type IconName } from './dom';
import { type Endpoint, type Profile, type WorkbenchConfig } from '../core/model';
import type { OnceResult } from '../tester/once';

export type ScreenId = 'home' | 'test' | 'mock' | 'intercept' | 'route' | 'chaos' | 'endpoints' | 'import' | 'settings';

export type UIState = {
  screen: ScreenId;
  minimized: boolean;
  observed: number;
  activity: string;
  mockEnabled: boolean;
  mockDelay: number;
  config: WorkbenchConfig;
  storageReady: boolean;
  testerResult?: OnceResult;
  testerHistory: OnceResult[];
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
  addEndpoint: () => void;
  updateEndpoint: (endpoint: Endpoint) => void;
  deleteEndpoint: (id: string) => void;
  updateProfile: (profile: Profile) => void;
  exportConfig: () => string;
  runOnce: (endpointId: string) => void;
  saveProfileAs: (name: string) => void;
  selectProfile: (id: string) => void;
  importConfig: (serialized: string) => string | undefined;
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
function group(className: string, ...children: Node[]): HTMLElement { const element = el('div', className); element.append(...children); return element; }

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

function tester(ctx: Ctx): HTMLElement {
  const screen = el('div', 'aw-col aw-gap12');
  const config = ctx.state().config;
  const title = el('div', 'aw-h', 'Test');
  const selector = el('select', 'aw-sel aw-grow') as HTMLSelectElement;
  for (const endpoint of config.endpoints) { const option = el('option') as HTMLOptionElement; option.value = endpoint.id; option.textContent = endpoint.name; selector.append(option); }
  const run = button('aw-btn aw-pri aw-sm', 'Run Once', () => { if (selector.value) ctx.runOnce(selector.value); }, ctx.signal);
  const result = el('section', 'aw-card aw-cp aw-col aw-gap10');
  const status = el('div', 'aw-hint', config.endpoints.length ? 'Ready for a direct request.' : 'Add an endpoint before running the tester.');
  const detail = el('pre', 'aw-code aw-wrap', 'No result yet.');
  ctx.watch(state => {
    const current = state.testerResult;
    if (!current) return;
    status.textContent = `${current.outcome}${current.status ? ` · HTTP ${current.status}` : ''} · ${current.durationMs} ms${current.error ? ` · ${current.error}` : ''}`;
    detail.textContent = current.body || current.error || 'No response body.';
    detail.append(document.createTextNode(`\n\nChecks\n${current.checks.map(check => `${check.state} · ${check.detail}`).join('\n')}`));
  });
  result.append(el('div', 'aw-cap aw-capl', 'Result'), status, detail);
  const history = el('div', 'aw-col aw-gap4');
  for (const item of ctx.state().testerHistory) history.append(group('aw-row aw-xs', el('span', 'aw-bd aw-s', item.outcome), el('span', 'aw-grow', `${item.status ?? '—'} · ${item.durationMs} ms`)));
  screen.append(title, group('aw-row', selector, run), result, caption('Run history'), history.children.length ? history : el('div', 'aw-empty', 'No runs yet.'), button('aw-btn aw-out aw-sm aw-self', 'Back to Home', () => ctx.go('home'), ctx.signal));
  return screen;
}

function field(label: string, value: string, onChange: (value: string) => void, signal: AbortSignal): HTMLElement {
  const wrapper = el('label', 'aw-fld');
  wrapper.append(el('span', 'aw-lbl', label));
  const input = el('input', 'aw-in aw-mono') as HTMLInputElement;
  input.value = value;
  input.addEventListener('change', () => onChange(input.value), { signal });
  wrapper.append(input);
  return wrapper;
}

function endpointEditor(ctx: Ctx, endpoint: Endpoint): HTMLElement {
  const section = card();
  const method = el('select', 'aw-sel') as HTMLSelectElement;
  for (const value of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    const option = el('option') as HTMLOptionElement; option.value = value; option.textContent = value; option.selected = endpoint.request.method === value; method.append(option);
  }
  const name = el('input', 'aw-in aw-mono') as HTMLInputElement; name.value = endpoint.name;
  const alias = el('input', 'aw-in aw-mono') as HTMLInputElement; alias.value = endpoint.alias;
  const path = el('input', 'aw-in aw-mono') as HTMLInputElement; path.value = endpoint.request.path;
  const host = el('input', 'aw-in aw-mono') as HTMLInputElement; host.value = endpoint.hostKey;
  const body = el('textarea', 'aw-ta') as HTMLTextAreaElement; body.value = endpoint.request.body;
  const save = () => { ctx.updateEndpoint({ ...endpoint, name: name.value.trim() || endpoint.name, alias: alias.value.trim() || endpoint.alias, hostKey: host.value.trim() || 'default', request: { ...endpoint.request, method: method.value as Endpoint['request']['method'], path: path.value || '/', body: body.value, bodyKind: body.value ? 'text' : 'none' }, updatedAt: Date.now() }); ctx.go('endpoints'); };
  const headerName = el('input', 'aw-in aw-mono') as HTMLInputElement; headerName.placeholder = 'Header name';
  const headerValue = el('input', 'aw-in aw-mono aw-grow') as HTMLInputElement; headerValue.placeholder = 'Header value';
  const addHeader = button('aw-btn aw-out aw-sm', 'Add header', () => {
    if (!headerName.value.trim()) return;
    const headers = [...endpoint.request.headers, { name: headerName.value, value: headerValue.value }];
    ctx.updateEndpoint({ ...endpoint, request: { ...endpoint.request, headers }, updatedAt: Date.now() });
    headerName.value = ''; headerValue.value = '';
  }, ctx.signal);
  const headerRows = el('div', 'aw-col aw-gap6');
  for (const header of endpoint.request.headers) headerRows.append(el('div', 'aw-row aw-mono aw-xs', `${header.name}: ${header.value}`));
  section.append(group('aw-row', el('span', 'aw-h', 'Edit endpoint')),
    field('Name', endpoint.name, value => { name.value = value; }, ctx.signal),
    field('Alias', endpoint.alias, value => { alias.value = value; }, ctx.signal),
    field('Path', endpoint.request.path, value => { path.value = value; }, ctx.signal),
    field('Host key', endpoint.hostKey, value => { host.value = value; }, ctx.signal),
    group('aw-fld', el('span', 'aw-lbl', 'Method'), method),
    group('aw-fld', el('span', 'aw-lbl', 'Body'), body),
    group('aw-col aw-gap6', el('span', 'aw-lbl', 'Headers'), headerRows),
    group('aw-row', headerName, headerValue, addHeader),
    button('aw-btn aw-pri aw-sm aw-self', 'Save endpoint', save, ctx.signal));
  return section;
}

function endpoints(ctx: Ctx): HTMLElement {
  const screen = el('div', 'aw-col aw-gap12');
  const config = ctx.state().config;
  const headers = el('section', 'aw-card aw-cp aw-col aw-gap10');
  const globalRows = el('div', 'aw-col aw-gap6');
  for (const header of config.profile.globalHeaders) globalRows.append(el('div', 'aw-row aw-mono aw-xs', `${header.name}: ${header.value}`));
  const globalName = el('input', 'aw-in aw-mono') as HTMLInputElement; globalName.placeholder = 'Header name';
  const globalValue = el('input', 'aw-in aw-mono aw-grow') as HTMLInputElement; globalValue.placeholder = 'Header value';
  const addGlobal = button('aw-btn aw-out aw-sm', 'Add header', () => {
    if (!globalName.value.trim()) return;
    ctx.updateProfile({ ...config.profile, globalHeaders: [...config.profile.globalHeaders, { name: globalName.value, value: globalValue.value }], updatedAt: Date.now(), revision: config.profile.revision + 1 });
    ctx.go('endpoints');
  }, ctx.signal);
  headers.append(group('aw-row', el('span', 'aw-lbl', 'Global headers'), el('span', 'aw-bd aw-s', String(config.profile.globalHeaders.length))), globalRows, group('aw-row', globalName, globalValue, addGlobal));
  const title = el('div', 'aw-row');
  title.append(el('span', 'aw-h', 'Endpoints'));
  title.append(el('span', 'aw-bd aw-s', String(config.endpoints.length)), el('span', 'aw-grow'), button('aw-btn aw-pri aw-sm', 'Add endpoint', () => { ctx.addEndpoint(); ctx.go('endpoints'); }, ctx.signal));
  const list = el('div', 'aw-card aw-list');
  for (const endpoint of config.endpoints) {
    const row = el('div', 'aw-col aw-gap4', '');
    const line = el('div', 'aw-row aw-gap8');
    line.append(el('span', `aw-bd aw-m aw-${endpoint.request.method}`, endpoint.request.method), el('span', 'aw-grow aw-tr', endpoint.name));
    line.append(button('aw-btn aw-gh aw-sm', 'Edit', () => { screen.replaceChildren(headers, title, list, endpointEditor(ctx, endpoint)); }, ctx.signal));
    line.append(button('aw-btn aw-dst aw-sm', 'Delete', () => { ctx.deleteEndpoint(endpoint.id); ctx.go('endpoints'); }, ctx.signal));
    row.append(line, el('div', 'aw-mono aw-xs aw-mu', `${endpoint.hostKey}${endpoint.request.path} · ${endpoint.alias}`)); list.append(row);
  }
  screen.append(headers, title, list, button('aw-btn aw-out aw-sm aw-self', 'Back to Home', () => ctx.go('home'), ctx.signal));
  return screen;
}

function settings(ctx: Ctx): HTMLElement {
  const screen = el('div', 'aw-col aw-gap12');
  const config = ctx.state().config;
  const profileName = el('input', 'aw-in aw-grow') as HTMLInputElement; profileName.value = config.profile.name; profileName.setAttribute('aria-label', 'Name');
  const save = button('aw-btn aw-pri aw-sm', 'Save profile', () => ctx.updateProfile({ ...config.profile, name: profileName.value.trim() || 'Default', updatedAt: Date.now(), revision: config.profile.revision + 1 }), ctx.signal);
  const saved = el('select', 'aw-sel aw-grow') as HTMLSelectElement;
  const activeOption = el('option') as HTMLOptionElement; activeOption.value = config.profile.id; activeOption.textContent = `${config.profile.name} (active)`; saved.append(activeOption);
  for (const snapshot of config.savedProfiles ?? []) { const option = el('option') as HTMLOptionElement; option.value = snapshot.profile.id; option.textContent = snapshot.profile.name; saved.append(option); }
  saved.addEventListener('change', () => ctx.selectProfile(saved.value), { signal: ctx.signal });
  const saveAsName = el('input', 'aw-in aw-grow') as HTMLInputElement; saveAsName.placeholder = 'New profile name';
  const saveAs = button('aw-btn aw-out aw-sm', 'Save as profile', () => { ctx.saveProfileAs(saveAsName.value); ctx.go('settings'); }, ctx.signal);
  const environment = el('select', 'aw-sel aw-grow') as HTMLSelectElement;
  for (const name of Object.keys(config.profile.environments)) { const option = el('option') as HTMLOptionElement; option.value = name; option.textContent = name; option.selected = name === config.profile.activeEnvironment; environment.append(option); }
  environment.addEventListener('change', () => ctx.updateProfile({ ...config.profile, activeEnvironment: environment.value, updatedAt: Date.now(), revision: config.profile.revision + 1 }), { signal: ctx.signal });
  const hostKey = el('input', 'aw-in aw-mono') as HTMLInputElement; hostKey.placeholder = 'host_key';
  const hostOrigin = el('input', 'aw-in aw-mono aw-grow') as HTMLInputElement; hostOrigin.placeholder = 'origin URL';
  const addEnvironment = button('aw-btn aw-out aw-sm', 'Add host', () => {
    if (!hostKey.value.trim() || !hostOrigin.value.trim()) return;
    const environment = config.profile.activeEnvironment || 'default';
    const environments = { ...config.profile.environments, [environment]: { ...(config.profile.environments[environment] ?? {}), [hostKey.value.trim()]: hostOrigin.value.trim() } };
    ctx.updateProfile({ ...config.profile, environments, updatedAt: Date.now(), revision: config.profile.revision + 1 });
  }, ctx.signal);
  const exported = el('textarea', 'aw-ta aw-mono') as HTMLTextAreaElement; exported.readOnly = true; exported.value = ctx.exportConfig();
  const profile = card(); profile.append(group('aw-row', icon('book'), el('span', 'aw-lbl', 'Profiles')), group('aw-row', saved), group('aw-row', profileName, save), group('aw-row', saveAsName, saveAs), el('div', 'aw-xs aw-mu', `Origin-scoped storage · ${ctx.state().storageReady ? 'IndexedDB available' : 'session fallback'}`), button('aw-btn aw-out aw-sm', 'Export profile + endpoints', () => { exported.value = ctx.exportConfig(); }, ctx.signal), exported);
  const environments = card(); environments.append(group('aw-row', icon('book'), el('span', 'aw-lbl', 'Environments')), group('aw-row', el('span', 'aw-xs aw-mu', 'Active environment'), environment), group('aw-row', hostKey, hostOrigin, addEnvironment));
  const core = card(); const limit = el('input', 'aw-in aw-mono') as HTMLInputElement; limit.type = 'number'; limit.value = String(config.profile.settings.bodyLimitKb);
  limit.addEventListener('change', () => ctx.updateProfile({ ...config.profile, settings: { ...config.profile.settings, bodyLimitKb: Math.max(1, Number(limit.value) || 1) }, updatedAt: Date.now(), revision: config.profile.revision + 1 }), { signal: ctx.signal });
  core.append(group('aw-row', icon('gear'), el('span', 'aw-lbl', 'Core')), group('aw-row', el('span', 'aw-xs aw-mu aw-grow', 'Body-check size limit (KB)'), limit));
  screen.append(el('div', 'aw-h', 'Settings'), profile, environments, core, el('p', 'aw-hint', 'Profiles are saved to this page origin. Switching environments changes host mappings, not endpoint paths.'), button('aw-btn aw-out aw-sm aw-self', 'Back to Home', () => ctx.go('home'), ctx.signal));
  return screen;
}

function importScreen(ctx: Ctx): HTMLElement {
  const screen = el('div', 'aw-col aw-gap12');
  const source = el('textarea', 'aw-ta aw-mono') as HTMLTextAreaElement;
  source.setAttribute('aria-label', 'Import JSON'); source.placeholder = 'Paste a native API Workbench JSON export';
  const file = el('input', 'aw-in') as HTMLInputElement; file.type = 'file'; file.accept = '.json,application/json'; file.setAttribute('aria-label', 'Import JSON file');
  file.addEventListener('change', () => { const selected = file.files?.[0]; if (!selected) return; const reader = new FileReader(); reader.addEventListener('load', () => { source.value = String(reader.result ?? ''); }, { signal: ctx.signal }); reader.readAsText(selected); }, { signal: ctx.signal });
  const status = el('p', 'aw-hint', 'Native JSON only. Imported data is validated and never executed.');
  const commit = button('aw-btn aw-pri aw-sm', 'Import JSON', () => { const error = ctx.importConfig(source.value); status.textContent = error ?? 'Imported configuration. Returning to Settings.'; if (!error) ctx.go('settings'); }, ctx.signal);
  screen.append(el('div', 'aw-h', 'Import'), card().appendChild(group('aw-col aw-gap10', source, file, commit, status)), button('aw-btn aw-out aw-sm aw-self', 'Back to Home', () => ctx.go('home'), ctx.signal));
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
  if (id === 'home') return home(ctx);
  if (id === 'test') return tester(ctx);
  if (id === 'endpoints') return endpoints(ctx);
  if (id === 'settings') return settings(ctx);
  if (id === 'import') return importScreen(ctx);
  return planned(ctx, id);
}
