import { createStore } from './core/store';
import { createShell } from './ui/shell';
import type { UIState } from './ui/screens';
import { createPipeline } from './network/pipeline';
import { fetchAdapter } from './network/fetch-adapter';
import { xhrAdapter } from './network/xhr-adapter';

const version = '0.1.0-m1';
const key = '__api_workbench_7f49a1_v1__';
type Instance = { version: string; restore: () => void };
const registry = window as unknown as Record<string, Instance | undefined>;
const existing = registry[key];
if (existing) {
  existing.restore();
  if (existing.version !== version) alert('Another API Workbench version is running. Close it or reload before launching this version.');
} else {
  const store = createStore<UIState>({ screen: 'home', minimized: false, observed: 0, activity: '', mockEnabled: false, mockDelay: 0 });
  const pipeline = createPipeline(message => store.set({ observed: store.state.observed + 1, activity: message }));

  const shell = createShell({
    version, store,
    // Transport settings are written synchronously; only the display update is batched.
    setMock: enabled => { pipeline.settings.enabled = enabled; store.set({ mockEnabled: enabled }); },
    setDelay: ms => {
      pipeline.settings.delay = Math.min(10000, Math.max(0, Math.round(Number(ms) || 0)));
      store.set({ mockDelay: pipeline.settings.delay });
    },
    onClose: () => close(),
  });

  const capturedFetch = window.fetch, capturedXHR = window.XMLHttpRequest;
  const fetchDescriptor = Object.getOwnPropertyDescriptor(window, 'fetch');
  const xhrDescriptor = Object.getOwnPropertyDescriptor(window, 'XMLHttpRequest');
  const wrappedFetch = fetchAdapter(capturedFetch, pipeline);
  const wrappedXHR = xhrAdapter(capturedXHR, pipeline);
  const instance: Instance = { version, restore: () => shell.restore() };
  const close = () => {
    pipeline.close();
    shell.destroy();
    store.dispose();
    // Restore only references that still hold this instance's wrappers.
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

  try {
    window.fetch = wrappedFetch; window.XMLHttpRequest = wrappedXHR;
    shell.mount();
    registry[key] = instance;
  } catch (error) { close(); throw error; }
}
