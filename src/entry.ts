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
  defaultTestPlan,
  MAX_RUN_SUMMARIES,
  suggestProfileName,
  type Endpoint,
  type Profile,
  type ProfileSnapshot,
  type Rule,
  type TestPlan,
  type WorkbenchConfig,
} from "./core/model"
import { loadConfig, saveConfig, exportConfig } from "./core/storage"
import { executeOnce } from "./tester/once"
import { startRun, type RunState } from "./tester/run"
import { runToCsv, runToJson } from "./tester/results"
import { createScope } from "./tester/expressions"
import { downloadFile } from "./ui/dom"
import { createRecorder } from "./recorder/recorder"
import { createBreakpoints } from "./breakpoints/registry"

const version = "0.1.0-m9"
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
    runs: [],
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
  // Making a profile live swaps the rule set and drops every cursor, budget and sample stream.
  const activate = (
    profile: Profile,
    endpoints: Endpoint[],
    rules: Rule[],
    savedProfiles: ProfileSnapshot[],
    plan?: TestPlan,
  ) => {
    // Switching profiles stops owned tester work before the new configuration is installed.
    stopRun()
    pipeline.setRules(rules)
    pipeline.engine.resetAll()
    persist({ profile, endpoints, rules, plan: plan ?? defaultTestPlan(profile.id), savedProfiles })
    store.set({ run: undefined, openRun: undefined })
    store.set({ matched: [] })
    syncRuleStats()
  }
  // Every stored name, so a new profile never collides with one already in the list.
  const profileNames = (config: WorkbenchConfig) =>
    [config.profile, ...(config.savedProfiles ?? []).map((item) => item.profile)].map(
      (profile) => profile.name,
    )
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

  // v1 keeps one plan per profile; a missing plan is created on first read, not on load.
  const planOf = (config: WorkbenchConfig): TestPlan => config.plan ?? defaultTestPlan(config.profile.id)
  let runController: AbortController | undefined
  const stopRun = () => {
    runController?.abort()
    runController = undefined
  }
  const beginRun = () => {
    if (runController) return
    const config = store.state.config
    const plan = planOf(config)
    runController = new AbortController()
    // Direct uses the captured transport; Apply active rules goes through the page's wrappers.
    const fetcher: typeof window.fetch = plan.mode === "rules" ? (...args) => window.fetch(...args) : directFetch
    const publish = (run: RunState) => store.set({ run, openRun: run })
    void startRun({
      plan,
      profile: config.profile,
      endpoints: config.endpoints,
      fetcher,
      signal: runController.signal,
      onProgress: publish,
    }).then((run) => {
      runController = undefined
      publish(run)
      store.set({ run: undefined, runs: [run, ...store.state.runs].slice(0, MAX_RUN_SUMMARIES) })
      if (plan.notifyOnComplete)
        report(`Run ${run.state}: ${run.counts.passed} passed of ${run.completed} requests`)
    })
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
      // A manual send resolves plan bindings but keeps its own transient reservation scope.
      const session = createScope({ bindings: planOf(store.state.config).bindings })
      void executeOnce(endpoint, store.state.config.profile, directFetch, {}, session).then((testerResult) =>
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
        name: suggestProfileName(name, profileNames(config)),
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
            plan: { ...planOf(config), profileId: profile.id },
          },
        ],
      })
    },
    selectProfile: (id) => {
      const config = store.state.config
      const snapshot = config.savedProfiles?.find((item) => item.profile.id === id)
      if (!snapshot) return
      activate(
        snapshot.profile,
        snapshot.endpoints,
        snapshot.rules ?? [],
        config.savedProfiles ?? [],
        snapshot.plan,
      )
    },
    deleteProfile: (id) => {
      const config = store.state.config
      const savedProfiles = (config.savedProfiles ?? []).filter((item) => item.profile.id !== id)
      // Deleting a stored profile leaves the live one alone; deleting the live one has to leave
      // something active, so the next stored profile takes over, or an empty one when it was last.
      if (config.profile.id !== id) return persist({ ...config, savedProfiles })
      const next = savedProfiles[0]
      activate(
        next?.profile ?? defaultProfile(),
        next?.endpoints ?? [],
        next?.rules ?? [],
        savedProfiles,
        next?.plan,
      )
    },
    commitImport: async (next, activate) => {
      try {
        // A durable write: a failed commit reports the failure and saves nothing, so the review
        // and the draft stay intact for a retry.
        await saveConfig(next, store.state.storageReady)
      } catch (error) {
        return error instanceof Error ? error.message : "Could not save the imported configuration"
      }
      // Importing a profile as a copy never activates it, so only a replace resets live work.
      if (activate) {
        stopRun()
        pipeline.engine.resetAll()
        store.set({ run: undefined, openRun: undefined, matched: [] })
      }
      pipeline.setRules(next.rules ?? [])
      configDirty = true
      store.set({ config: next })
      syncRuleStats()
      return undefined
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
    plan: () => planOf(store.state.config),
    updatePlan: (plan: TestPlan) => persist({ ...store.state.config, plan }),
    startRun: () => beginRun(),
    stopRun: () => stopRun(),
    openRun: (id: string) => {
      const run = store.state.runs.find((item) => item.id === id)
      if (run) store.set({ openRun: run })
    },
    exportRun: (format) => {
      const run = store.state.openRun
      if (!run) return
      const name = `${run.planName}-${run.id}`
      if (format === "json")
        downloadFile(runToJson(run, store.state.config.profile.revision), name, "json", "application/json")
      else downloadFile(runToCsv(run), name, "csv", "text/csv")
    },
    createProfileFromRecordings: (name, endpoints, hosts) => {
      const config = store.state.config
      const now = Date.now()
      const profile: Profile = {
        ...defaultProfile(),
        id: createId("profile"),
        name: suggestProfileName(name, profileNames(config)),
        createdAt: now,
        updatedAt: now,
        // Recorded hosts become the environment map, so recorded paths resolve without setup.
        environments: { default: { default: location.origin, ...hosts } },
        activeEnvironment: "default",
      }
      const owned = endpoints.map((endpoint) => ({ ...endpoint, profileId: profile.id }))
      // Activating the new profile replaces the live one, so an unsaved current profile is
      // snapshotted first: creating a profile must not discard existing endpoints or rules.
      const savedProfiles = [...(config.savedProfiles ?? [])]
      if (!savedProfiles.some((item) => item.profile.id === config.profile.id))
        savedProfiles.push({
          profile: config.profile,
          endpoints: config.endpoints,
          rules: rulesOf(config),
          plan: planOf(config),
        })
      savedProfiles.push({ profile, endpoints: owned, rules: [] })
      activate(profile, owned, [], savedProfiles)
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
    stopRun()
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
