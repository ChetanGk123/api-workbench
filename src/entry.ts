import { createStore } from './core/store';
import { createShell } from './ui/shell';
import type { UIState } from './ui/screens';
import { createPipeline } from './network/pipeline';
import { fetchAdapter } from './network/fetch-adapter';
import { xhrAdapter } from './network/xhr-adapter';
import { createId, defaultEndpoint, defaultProfile, type Endpoint, type Profile, type WorkbenchConfig } from './core/model';
import { importConfig as parseConfig, loadConfig, saveConfig, exportConfig } from './core/storage';
import { executeOnce } from './tester/once';

const version = '0.1.0-m3';
const key = '__api_workbench_7f49a1_v1__';
type Instance = { version: string; restore: () => void };
const registry = window as unknown as Record<string, Instance | undefined>;
const existing = registry[key];
if (existing) {
  existing.restore();
  if (existing.version !== version) alert('Another API Workbench version is running. Close it or reload before launching this version.');
} else {
  const initialConfig: WorkbenchConfig = { profile: defaultProfile(), endpoints: [], savedProfiles: [] };
  const store = createStore<UIState>({ screen: 'home', minimized: false, observed: 0, activity: '', mockEnabled: false, mockDelay: 0, config: initialConfig, storageReady: false, testerHistory: [] });
  let configDirty = false;
  let directFetch: typeof window.fetch = window.fetch;
  const persist = (config: WorkbenchConfig) => { configDirty = true; store.set({ config }); void saveConfig(config); };
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
    addEndpoint: () => { const endpoint = defaultEndpoint(store.state.config.profile.id); persist({ ...store.state.config, endpoints: [...store.state.config.endpoints, endpoint] }); },
    updateEndpoint: (endpoint: Endpoint) => persist({ ...store.state.config, endpoints: store.state.config.endpoints.map(item => item.id === endpoint.id ? endpoint : item) }),
    deleteEndpoint: (id: string) => persist({ ...store.state.config, endpoints: store.state.config.endpoints.filter(endpoint => endpoint.id !== id) }),
    updateProfile: (profile: Profile) => persist({ ...store.state.config, profile }),
    exportConfig: () => exportConfig(store.state.config),
    runOnce: endpointId => {
      const endpoint = store.state.config.endpoints.find(item => item.id === endpointId);
      if (!endpoint) return;
      void executeOnce(endpoint, store.state.config.profile, directFetch).then(testerResult => store.set({ testerResult, testerHistory: [testerResult, ...store.state.testerHistory].slice(0, 10) }));
    },
    saveProfileAs: name => {
      const config = store.state.config;
      const profile = { ...config.profile, id: createId('profile'), name: name.trim() || 'Untitled', revision: 1, createdAt: Date.now(), updatedAt: Date.now() };
      persist({ ...config, savedProfiles: [...(config.savedProfiles ?? []), { profile, endpoints: config.endpoints.map(endpoint => ({ ...endpoint, profileId: profile.id })) }] });
    },
    selectProfile: id => {
      const snapshot = store.state.config.savedProfiles?.find(item => item.profile.id === id);
      if (snapshot) persist({ ...store.state.config, profile: snapshot.profile, endpoints: snapshot.endpoints });
    },
    importConfig: serialized => {
      try { persist(parseConfig(serialized)); return undefined; }
      catch (error) { return error instanceof Error ? error.message : 'Invalid Workbench JSON'; }
    },
  });

  const capturedFetch = window.fetch, capturedXHR = window.XMLHttpRequest;
  directFetch = capturedFetch;
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
    void loadConfig().then(config => { if (!configDirty) store.set({ config }); store.set({ storageReady: true }); }).catch(() => store.set({ storageReady: false }));
  } catch (error) { close(); throw error; }
}
