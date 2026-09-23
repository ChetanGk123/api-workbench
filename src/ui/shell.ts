import theme from '../../design/reference/aw-theme.css';
import additions from './theme.css';
import { el, icon, iconButton } from './dom';
import type { Store } from '../core/store';
import { SCREENS, TABS, renderScreen, type Ctx, type ScreenId, type UIState } from './screens';

export type ShellOptions = {
  version: string;
  store: Store<UIState>;
  setMock: (enabled: boolean) => void;
  setDelay: (ms: number) => void;
  onClose: () => void;
  addEndpoint: Ctx['addEndpoint'];
  updateEndpoint: Ctx['updateEndpoint'];
  deleteEndpoint: Ctx['deleteEndpoint'];
  updateProfile: Ctx['updateProfile'];
  exportConfig: Ctx['exportConfig'];
  runOnce: Ctx['runOnce'];
  saveProfileAs: Ctx['saveProfileAs'];
  selectProfile: Ctx['selectProfile'];
  importConfig: Ctx['importConfig'];
  startRecording: Ctx['startRecording'];
  stopRecording: Ctx['stopRecording'];
  resetRecorder: Ctx['resetRecorder'];
  promoteRecording: Ctx['promoteRecording'];
};

export function createShell(options: ShellOptions) {
  const { store } = options;
  const listeners = new AbortController();
  const signal = listeners.signal;

  const host = el('div');
  host.id = 'api-workbench';
  const root = host.attachShadow({ mode: 'open' });
  // A constructed sheet avoids HTML parsing, Trusted Types and any external asset request,
  // and keeps every rule inside the shadow root.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(theme + additions);
  root.adoptedStyleSheets = [sheet];

  const panel = el('section', 'aw-root');
  panel.setAttribute('aria-label', 'API Workbench');
  const launcher = el('section', 'aw-root aw-min');
  launcher.setAttribute('aria-label', 'API Workbench (minimized)');
  launcher.hidden = true;

  const minimize = () => { store.set({ minimized: true }); apply(); };
  const restore = () => { store.set({ minimized: false }); apply(); };
  const close = () => options.onClose();

  const logo = () => { const badge = el('div', 'aw-logo'); badge.append(icon('bolt')); return badge; };
  const profile = () => {
    const select = el('button', 'aw-sel aw-profile');
    select.type = 'button';
    select.setAttribute('aria-label', 'Active profile');
    select.title = 'Open profile settings';
    select.addEventListener('click', () => go('settings'), { signal });
    select.append(el('span', '', 'Default'), icon('selector', 'aw-i12'));
    return select;
  };

  // Header
  const header = el('header', 'aw-tb');
  header.append(logo(), el('span', 'aw-brand', 'API Workbench'), el('div', 'aw-grow'), profile(),
    iconButton('aw-btn aw-gh aw-ic aw-sm', 'gear', 'Settings', () => go('settings'), signal),
    iconButton('aw-btn aw-gh aw-ic aw-sm', 'download', 'Import', () => go('import'), signal),
    iconButton('aw-btn aw-gh aw-ic aw-sm', 'minus', 'Minimize', minimize, signal),
    iconButton('aw-btn aw-gh aw-ic aw-sm', 'close', 'Close', close, signal));

  // Tabs: internal navigation only, never a host-page link.
  const nav = el('nav', 'aw-tabs');
  nav.setAttribute('aria-label', 'Modules');
  const list = el('div', 'aw-tl');
  const tabs = new Map<ScreenId, HTMLButtonElement>();
  for (const id of TABS) {
    const tab = el('button', 'aw-tt');
    tab.type = 'button';
    tab.append(icon(SCREENS[id].icon), document.createTextNode(SCREENS[id].label));
    tab.addEventListener('click', () => go(id), { signal });
    tabs.set(id, tab);
    list.append(tab);
  }
  nav.append(list);

  const body = el('main', 'aw-body');
  const footer = el('footer', 'aw-foot');
  const counter = el('span', 'aw-xs aw-mu aw-grow aw-tr');
  footer.append(el('span', 'aw-bd aw-s', options.version), counter);
  panel.append(header, nav, body, footer);

  // Minimized launcher
  const launcherState = el('span', 'aw-bd');
  const launcherDot = el('span', 'aw-dot');
  launcherState.append(launcherDot, document.createTextNode('No active modules'));
  launcher.append(logo(), el('span', 'aw-brand', 'AW'), launcherState, el('div', 'aw-grow'), profile(),
    el('div', 'aw-vsep'),
    iconButton('aw-btn aw-gh aw-ic aw-sm', 'expand', 'Restore', restore, signal),
    iconButton('aw-btn aw-gh aw-ic aw-sm', 'close', 'Close', close, signal));
  root.append(panel, launcher);

  // Screen mounting: watchers registered by a screen are dropped when it is replaced.
  let screenWatchers: Array<() => void> = [];
  const ctx: Ctx = {
    version: options.version,
    state: () => store.state,
    go: id => go(id),
    watch: listener => { listener(store.state); screenWatchers.push(store.subscribe(listener)); },
    setMock: options.setMock,
    setDelay: options.setDelay,
    signal,
    addEndpoint: options.addEndpoint,
    updateEndpoint: options.updateEndpoint,
    deleteEndpoint: options.deleteEndpoint,
    updateProfile: options.updateProfile,
    exportConfig: options.exportConfig,
    runOnce: options.runOnce,
    saveProfileAs: options.saveProfileAs,
    selectProfile: options.selectProfile,
    importConfig: options.importConfig,
    startRecording: options.startRecording,
    stopRecording: options.stopRecording,
    resetRecorder: options.resetRecorder,
    promoteRecording: options.promoteRecording,
  };

  function go(id: ScreenId) {
    if (store.state.minimized) restore();
    store.set({ screen: id });
    for (const dispose of screenWatchers.splice(0)) dispose();
    for (const [tabId, tab] of tabs) {
      tab.classList.toggle('aw-on', tabId === id);
      if (tabId === id) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
    }
    body.scrollTop = 0;
    body.replaceChildren(renderScreen(ctx, id));
  }

  // Position: fixed host, viewport-clamped, kept on both drag handles.
  const position = { x: 0, y: 0 };
  const place = (x: number, y: number) => {
    const box = host.getBoundingClientRect();
    position.x = Math.min(Math.max(x, 8), Math.max(8, window.innerWidth - box.width - 8));
    position.y = Math.min(Math.max(y, 8), Math.max(8, window.innerHeight - box.height - 8));
    host.style.left = `${position.x}px`;
    host.style.top = `${position.y}px`;
  };
  const draggable = (handle: HTMLElement) => {
    let offsetX = 0, offsetY = 0, dragging = false;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || (event.target as Element).closest('button,input,select,textarea,a')) return;
      dragging = true;
      offsetX = event.clientX - position.x;
      offsetY = event.clientY - position.y;
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('aw-dragging');
      event.preventDefault();
    }, { signal });
    handle.addEventListener('pointermove', event => { if (dragging) place(event.clientX - offsetX, event.clientY - offsetY); }, { signal });
    const stop = (event: PointerEvent) => {
      dragging = false;
      handle.classList.remove('aw-dragging');
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener('pointerup', stop, { signal });
    handle.addEventListener('pointercancel', stop, { signal });
  };
  draggable(header);
  draggable(launcher);
  window.addEventListener('resize', () => place(position.x, position.y), { signal });

  function apply() {
    const state = store.state;
    panel.hidden = state.minimized;
    launcher.hidden = !state.minimized;
    place(position.x, position.y);
  }

  store.subscribe(state => {
    counter.textContent = `${state.observed} request${state.observed === 1 ? '' : 's'} observed · ${location.origin}`;
    launcherState.lastChild!.textContent = state.mockEnabled ? 'M0 mock active' : 'No active modules';
    launcherDot.className = state.mockEnabled ? 'aw-dot aw-a' : 'aw-dot';
    for (const control of root.querySelectorAll('.aw-profile')) {
      const label = control.firstElementChild;
      if (label) label.textContent = state.config.profile.name;
    }
  });

  return {
    host,
    mount() {
      go(store.state.screen);
      counter.textContent = `0 requests observed · ${location.origin}`;
      document.documentElement.append(host);
      const box = host.getBoundingClientRect();
      place(window.innerWidth - box.width - 16, 16);
    },
    restore() { restore(); place(position.x, position.y); },
    destroy() {
      listeners.abort();
      for (const dispose of screenWatchers.splice(0)) dispose();
      host.remove();
    },
  };
}
