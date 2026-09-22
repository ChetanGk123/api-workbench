import theme from '../design/reference/aw-theme.css';
import css from './panel.css';
import { createPipeline } from './network/pipeline';
import { fetchAdapter } from './network/fetch-adapter';
import { xhrAdapter } from './network/xhr-adapter';

const version = '0.0.1-m0';
const key = '__api_workbench_7f49a1_v1__';
type Instance = { version: string; restore: () => void };
const registry = window as unknown as Record<string, Instance | undefined>;
const existing = registry[key];
if (existing) {
  existing.restore();
  if (existing.version !== version) alert('Another API Workbench version is running. Close it or reload before launching this version.');
} else {
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') => {
    const element = document.createElement(tag);
    element.className = className; element.textContent = text; return element;
  };
  const host = node('div', '');
  host.id = 'api-workbench-m0';
  const root = host.attachShadow({ mode: 'open' });
  // Constructed sheets avoid HTML parsing/Trusted Types and external asset loads.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(theme + css);
  root.adoptedStyleSheets = [sheet];
  const panel = node('section', 'aw-root');
  panel.setAttribute('aria-label', 'API Workbench');
  const header = node('header', 'aw-tb');
  const brand = node('span', 'aw-brand aw-grow', 'API Workbench');
  const body = node('main', 'aw-body');
  const status = node('p', 'aw-hint', 'Mock inactive · current-frame fetch / XHR');
  status.setAttribute('role', 'status');
  const activity = node('pre', 'aw-code', 'No requests observed.');
  let count = 0;
  const pipeline = createPipeline(message => { activity.textContent = `${++count} observed\n${message}`; });
  const listeners = new AbortController();
  const button = (text: string, action: () => void) => {
    const element = node('button', 'aw-btn aw-out aw-sm', text);
    element.type = 'button'; element.addEventListener('click', action, { signal: listeners.signal }); return element;
  };
  const toggleSize = () => { body.hidden = !body.hidden; minimize.textContent = body.hidden ? 'Restore' : 'Minimize'; };
  const minimize = button('Minimize', toggleSize);
  const capturedFetch = window.fetch, capturedXHR = window.XMLHttpRequest;
  const fetchDescriptor = Object.getOwnPropertyDescriptor(window, 'fetch');
  const xhrDescriptor = Object.getOwnPropertyDescriptor(window, 'XMLHttpRequest');
  const wrappedFetch = fetchAdapter(capturedFetch, pipeline);
  const wrappedXHR = xhrAdapter(capturedXHR, pipeline);
  const restore = () => { body.hidden = false; minimize.textContent = 'Minimize'; host.scrollIntoView({ block: 'nearest' }); };
  const instance = { version, restore };
  const close = () => {
    pipeline.close(); listeners.abort(); host.remove();
    if (window.fetch === wrappedFetch) {
      if (fetchDescriptor) Object.defineProperty(window, 'fetch', fetchDescriptor);
      else delete (window as Partial<Window>).fetch;
    }
    if (window.XMLHttpRequest === wrappedXHR) {
      if (xhrDescriptor) Object.defineProperty(window, 'XMLHttpRequest', xhrDescriptor);
      else Reflect.deleteProperty(window, 'XMLHttpRequest');
    }
    if (registry[key] === instance) delete registry[key];
  };
  header.append(brand, minimize, button('Close', close));
  const origin = node('div', 'aw-hint aw-origin', `${version} · ${location.origin}`);
  const card = node('section', 'aw-card aw-cp aw-col');
  card.append(node('div', 'aw-cap', 'Feasibility experiment'), node('code', 'aw-mono', 'GET /api/mock-target'));
  const label = node('label', 'aw-chk');
  const enabled = node('input', ''); enabled.type = 'checkbox';
  label.append(enabled, document.createTextNode('Enable mock · sends no network request'));
  enabled.addEventListener('change', () => {
    pipeline.settings.enabled = enabled.checked;
    status.textContent = enabled.checked ? 'Mock active · GET /api/mock-target' : 'Mock inactive · current-frame fetch / XHR';
    brand.textContent = enabled.checked ? 'API Workbench · Mock on' : 'API Workbench';
  }, { signal: listeners.signal });
  const delayLabel = node('label', 'aw-fld', 'Mock delay (0–10,000 ms)');
  const delay = node('input', 'aw-in'); delay.type = 'number'; delay.min = '0'; delay.max = '10000'; delay.step = '1'; delay.value = '0';
  delay.addEventListener('change', () => {
    pipeline.settings.delay = Math.min(10000, Math.max(0, Math.round(Number(delay.value) || 0)));
    delay.value = String(pipeline.settings.delay);
  }, { signal: listeners.signal });
  delayLabel.append(delay); card.append(label, delayLabel);
  body.append(origin, card, status, activity, node('p', 'aw-hint', 'M0 only. Other traffic passes through. Minimize keeps the mock active; Close stops it.'));
  panel.append(header, body); root.append(panel);
  try {
    window.fetch = wrappedFetch; window.XMLHttpRequest = wrappedXHR;
    document.documentElement.append(host); registry[key] = instance;
  } catch (error) { close(); throw error; }
}
