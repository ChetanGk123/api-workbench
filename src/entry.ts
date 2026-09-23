import { createStore } from "./core/store"
import { createShell } from "./ui/shell"
import type { UIState } from "./ui/screens"
import { createPipeline } from "./network/pipeline"
import { fetchAdapter } from "./network/fetch-adapter"
import { xhrAdapter } from "./network/xhr-adapter"
import {
  createId,
  defaultEndpoint,
  defaultProfile,
  type Endpoint,
  type Profile,
  type Rule,
  type WorkbenchConfig,
} from "./core/model"
import { importConfig as parseConfig, loadConfig, saveConfig, exportConfig } from "./core/storage"
import { executeOnce } from "./tester/once"
import { createRecorder, type Recording } from "./recorder/recorder"
import { createBreakpoints } from "./breakpoints/registry"

const version = "0.1.0-m7"
const key = "__api_workbench_7f49a1_v1__"
type Instance = { version: string; restore: () => void }
const registry = window as unknown as Record<string, Instance | undefined>
const existing = registry[key]
if (existing) {
  existing.restore()
  if (existing.version !== version)
    alert(
      "Another API Workbench version is running. Close it or reload before launching this version.",
    )
} else {
  const initialConfig: WorkbenchConfig = {
    profile: defaultProfile(),
    endpoints: [],
    savedProfiles: [],
  }
  const store = createStore<UIState>({
    screen: "home",
    minimized: false,
    observed: 0,
    activity: "",
    mockEnabled: false,
    mockDelay: 0,
    config: initialConfig,
    storageReady: false,
    testerHistory: [],
    recording: false,
    recordings: [],
    moduleActive: { mock: false, chaos: false, intercept: false, route: false },
    ruleHits: {},
    ruleCursors: {},
    matched: [],
    paused: [],
  })
  let configDirty = false
  let directFetch: typeof window.fetch = window.fetch
  const persist = (config: WorkbenchConfig) => {
    configDirty = true
    store.set({ config })
    void saveConfig(config)
  }
  const report = (message: string) =>
    store.set({ observed: store.state.observed + 1, activity: message })
  const breakpoints = createBreakpoints({ report })
  const pipeline = createPipeline(report, breakpoints)
  // A pause makes the page wait on the user, so restore a minimized panel's launcher visibly and
  // keep the queue in state for the Intercept screen.
  breakpoints.onChange((paused) => store.set({ paused }))
  const recorder = createRecorder(pipeline, (recordings) =>
    store.set({ recordings: [...recordings] }),
  )
  store.set({ recordings: recorder.records })

  const rulesOf = (config: WorkbenchConfig) => config.rules ?? []
  // Hit counts and sequence cursors live in the engine; the store only mirrors them for display.
  const syncRuleStats = () => {
    const hits: Record<string, number> = {}
    const cursors: Record<string, number> = {}
    for (const rule of rulesOf(store.state.config)) {
      hits[rule.id] = pipeline.engine.hits(rule.id)
      if (rule.kind === "mock") cursors[rule.id] = pipeline.engine.cursor(rule)
    }
    store.set({ ruleHits: hits, ruleCursors: cursors })
  }
  pipeline.onActivity((activity) => {
    store.set({ matched: [...store.state.matched, activity].slice(-50) })
    syncRuleStats()
  })
  const persistRules = (rules: Rule[]) => {
    pipeline.setRules(rules)
    persist({ ...store.state.config, rules })
    syncRuleStats()
  }

  const shell = createShell({
    version,
    store,
    // Transport settings are written synchronously; only the display update is batched.
    setMock: (enabled) => {
      pipeline.settings.enabled = enabled
      store.set({ mockEnabled: enabled })
    },
    setDelay: (ms) => {
      pipeline.settings.delay = Math.min(10000, Math.max(0, Math.round(Number(ms) || 0)))
      store.set({ mockDelay: pipeline.settings.delay })
    },
    onClose: () => close(),
    addEndpoint: () => {
      const endpoint = defaultEndpoint(store.state.config.profile.id)
      persist({ ...store.state.config, endpoints: [...store.state.config.endpoints, endpoint] })
    },
    updateEndpoint: (endpoint: Endpoint) =>
      persist({
        ...store.state.config,
        endpoints: store.state.config.endpoints.map((item) =>
          item.id === endpoint.id ? endpoint : item,
        ),
      }),
    deleteEndpoint: (id: string) =>
      persist({
        ...store.state.config,
        endpoints: store.state.config.endpoints.filter((endpoint) => endpoint.id !== id),
      }),
    updateProfile: (profile: Profile) => persist({ ...store.state.config, profile }),
    exportConfig: () => exportConfig(store.state.config),
    runOnce: (endpointId) => {
      const endpoint = store.state.config.endpoints.find((item) => item.id === endpointId)
      if (!endpoint) return
      void executeOnce(endpoint, store.state.config.profile, directFetch).then((testerResult) =>
        store.set({
          testerResult,
          testerHistory: [testerResult, ...store.state.testerHistory].slice(0, 10),
        }),
      )
    },
    saveProfileAs: (name) => {
      const config = store.state.config
      const profile = {
        ...config.profile,
        id: createId("profile"),
        name: name.trim() || "Untitled",
        revision: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      persist({
        ...config,
        savedProfiles: [
          ...(config.savedProfiles ?? []),
          {
            profile,
            endpoints: config.endpoints.map((endpoint) => ({ ...endpoint, profileId: profile.id })),
            rules: rulesOf(config).map((rule) => ({ ...rule, profileId: profile.id })),
          },
        ],
      })
    },
    selectProfile: (id) => {
      const snapshot = store.state.config.savedProfiles?.find((item) => item.profile.id === id)
      if (!snapshot) return
      // Switching profile swaps the rule set and drops every cursor, budget and sample stream.
      const rules = snapshot.rules ?? []
      pipeline.setRules(rules)
      pipeline.engine.resetAll()
      persist({
        ...store.state.config,
        profile: snapshot.profile,
        endpoints: snapshot.endpoints,
        rules,
      })
      store.set({ matched: [] })
      syncRuleStats()
    },
    importConfig: (serialized) => {
      try {
        const imported = parseConfig(serialized)
        pipeline.setRules(imported.rules ?? [])
        pipeline.engine.resetAll()
        persist(imported)
        syncRuleStats()
        return undefined
      } catch (error) {
        return error instanceof Error ? error.message : "Invalid Workbench JSON"
      }
    },
    reorderEndpoint: (id, direction) => {
      const endpoints = [...store.state.config.endpoints]
      const index = endpoints.findIndex((endpoint) => endpoint.id === id)
      const target = direction === "up" ? index - 1 : index + 1
      if (index < 0 || target < 0 || target >= endpoints.length) return
      const current = endpoints[index]!
      endpoints[index] = endpoints[target]!
      endpoints[target] = current
      persist({ ...store.state.config, endpoints })
      store.set({ screen: "endpoints" })
    },
    startRecording: () => {
      if (recorder.start()) store.set({ recording: true })
    },
    stopRecording: () => {
      recorder.stop()
      store.set({ recording: false, recordings: recorder.records })
    },
    resetRecorder: () => {
      recorder.reset()
      store.set({ recordings: [] })
    },
    saveRule: (rule: Rule) => {
      const rules = rulesOf(store.state.config)
      persistRules(
        rules.some((item) => item.id === rule.id)
          ? rules.map((item) => (item.id === rule.id ? rule : item))
          : [...rules, rule],
      )
    },
    deleteRule: (id: string) =>
      persistRules(rulesOf(store.state.config).filter((rule) => rule.id !== id)),
    toggleRule: (id: string, enabled: boolean) =>
      persistRules(rulesOf(store.state.config).map((rule) => (rule.id === id ? { ...rule, enabled } : rule))),
    setModuleActive: (kind, value) => {
      pipeline.setActive(kind, value)
      store.set({ moduleActive: { ...store.state.moduleActive, [kind]: value } })
      syncRuleStats()
    },
    resetSequence: (ruleId: string) => {
      pipeline.engine.resetCursor(ruleId)
      syncRuleStats()
    },
    nextRuleSeq: () =>
      rulesOf(store.state.config).reduce((highest, rule) => Math.max(highest, rule.seq), 0) + 1,
    continueAllPaused: () => breakpoints.continueAll(),
    promoteRecording: (recording: Recording) => {
      const url = new URL(recording.url)
      const endpoint: Endpoint = {
        ...defaultEndpoint(store.state.config.profile.id),
        name: `${recording.method} ${url.pathname}`,
        alias: `recorded_${url.pathname.split("/").filter(Boolean).join("_") || "root"}`,
        request: {
          ...defaultEndpoint(store.state.config.profile.id).request,
          method: (recording.method === "CONNECT"
            ? "GET"
            : recording.method) as Endpoint["request"]["method"],
          path: `${url.pathname}${url.search}`,
          headers: Object.entries(recording.headers)
            .filter(([, value]) => value !== "[REDACTED]")
            .map(([name, value]) => ({ name, value })),
          bodyKind: recording.body ? "text" : "none",
          body: recording.body ?? "",
        },
        sampleResponse: recording.response?.body
          ? {
              status: recording.response.status,
              headers: Object.entries(recording.response.headers).map(([name, value]) => ({
                name,
                value,
              })),
              body: recording.response.body,
            }
          : undefined,
      }
      persist({ ...store.state.config, endpoints: [...store.state.config.endpoints, endpoint] })
    },
  })

  const capturedFetch = window.fetch,
    capturedXHR = window.XMLHttpRequest
  directFetch = capturedFetch
  const fetchDescriptor = Object.getOwnPropertyDescriptor(window, "fetch")
  const xhrDescriptor = Object.getOwnPropertyDescriptor(window, "XMLHttpRequest")
  const wrappedFetch = fetchAdapter(capturedFetch, pipeline)
  const wrappedXHR = xhrAdapter(capturedXHR, pipeline)
  const instance: Instance = { version, restore: () => shell.restore() }
  const close = () => {
    pipeline.close()
    shell.destroy()
    store.dispose()
    // Restore only references that still hold this instance's wrappers.
    if (window.fetch === wrappedFetch) {
      if (fetchDescriptor) Object.defineProperty(window, "fetch", fetchDescriptor)
      else delete (window as Partial<Window>).fetch
    }
    if (window.XMLHttpRequest === wrappedXHR) {
      if (xhrDescriptor) Object.defineProperty(window, "XMLHttpRequest", xhrDescriptor)
      else Reflect.deleteProperty(window, "XMLHttpRequest")
    }
    if (registry[key] === instance) delete registry[key]
  }

  try {
    window.fetch = wrappedFetch
    window.XMLHttpRequest = wrappedXHR
    shell.mount()
    registry[key] = instance
    void loadConfig()
      .then((config) => {
        if (!configDirty) {
          store.set({ config })
          pipeline.setRules(config.rules ?? [])
          syncRuleStats()
        }
        store.set({ storageReady: true })
      })
      .catch(() => store.set({ storageReady: false }))
  } catch (error) {
    close()
    throw error
  }
}
