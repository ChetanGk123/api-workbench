import { createStore } from "./core/store"
import { createShell } from "./ui/shell"
import type { UIState } from "./ui/screens"
import { createPipeline, type RuleActivity } from "./network/pipeline"
import { TESTER_MARK } from "./network/rules"
import { fetchAdapter } from "./network/fetch-adapter"
import { xhrAdapter } from "./network/xhr-adapter"
import {
  createId,
  defaultEndpoint,
  defaultProfile,
  defaultTestPlan,
  logLimit,
  MAX_RUN_SUMMARIES,
  suggestProfileName,
  type Endpoint,
  type Profile,
  type ProfileSnapshot,
  type Rule,
  type TestPlan,
  type WorkbenchConfig,
} from "./core/model"
import { clearStoredConfig, loadConfig, readLaunchVersion, recordLaunchVersion, saveConfig, exportConfig } from "./core/storage"
import { executeOnce } from "./tester/once"
import { startRun, type RunState } from "./tester/run"
import { failedCount, runToCsv, runToJson } from "./tester/results"
import { createScope } from "./tester/expressions"
import { downloadFile } from "./ui/dom"
import { createRecorder, DEFAULT_RECORD_LIMIT } from "./recorder/recorder"
import { createBreakpoints } from "./breakpoints/registry"

const version = __AW_VERSION__
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
  const initialProfile = defaultProfile()
  const initialConfig: WorkbenchConfig = {
    profile: initialProfile,
    endpoints: [],
    savedProfiles: [],
    plan: defaultTestPlan(initialProfile.id),
  }
  const store = createStore<UIState>({
    screen: "home",
    minimized: false,
    observed: 0,
    activity: "",
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
  /**
   * A live configuration always carries its plan. `planOf` falls back to a fresh `defaultTestPlan`,
   * which mints a new id on every call, so a config without one has no stable plan identity: the
   * picker, `selectPlan` and `savePlanAs` each read a different plan, and an edit made against one
   * of them is lost when the next read invents another.
   */
  const withPlan = (config: WorkbenchConfig): WorkbenchConfig =>
    config.plan ? config : { ...config, plan: defaultTestPlan(config.profile.id) }

  const persist = (config: WorkbenchConfig) => {
    configDirty = true
    const next = withPlan(config)
    store.set({ config: next })
    void saveConfig(next)
    syncBodyCapture()
    syncRecorder()
  }
  const report = (message: string) =>
    store.set({ observed: store.state.observed + 1, activity: message })
  const breakpoints = createBreakpoints({ report })
  const pipeline = createPipeline(report, breakpoints)
  // A pause makes the page wait on the user, so restore a minimized panel's launcher visibly and
  // keep the queue in state for the Intercept screen.
  breakpoints.onChange((paused) => store.set({ paused }))
  const recorder = createRecorder(pipeline, (recordings) => store.set({ recordings: [...recordings] }))
  store.set({ recordings: recorder.records })
  /** The recorder's cap is the profile's, so a loaded or edited profile retunes it. */
  const syncRecorder = () =>
    recorder.setLimit(store.state.config.profile.settings?.recorderLimit ?? DEFAULT_RECORD_LIMIT)

  /** Dotted numeric compare, so 1.10.0 sorts above 1.9.0; unparsable parts compare as 0. */
  const compareVersions = (left: string, right: string) => {
    const parts = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0)
    const [a, b] = [parts(left), parts(right)]
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      const difference = (a[index] ?? 0) - (b[index] ?? 0)
      if (difference) return difference
    }
    return 0
  }

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
    // Stored plans stay with their own profile, so switching away and back is not a loss.
    persist({
      profile,
      endpoints,
      rules,
      plan: plan ?? defaultTestPlan(profile.id),
      savedPlans: store.state.config.savedPlans,
      savedProfiles,
    })
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
  const kindOf = (ruleId: string) => rulesOf(store.state.config).find((rule) => rule.id === ruleId)?.kind
  /**
   * Each module keeps the number of entries its own setting asks for, counted from the newest, so
   * a noisy mock cannot push the intercept log out of a single shared cap.
   */
  const trimLog = (entries: RuleActivity[]): RuleActivity[] => {
    const profile = store.state.config.profile
    const kept = new Map<string, number>()
    const keep: RuleActivity[] = []
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index]!
      const kind = kindOf(entry.ruleId)
      const limit = kind ? logLimit(profile, kind) : logLimit(profile, "route")
      const seen = kept.get(kind ?? "") ?? 0
      if (seen >= limit) continue
      kept.set(kind ?? "", seen + 1)
      keep.push(entry)
    }
    return keep.reverse()
  }
  pipeline.onActivity((activity) => {
    store.set({ matched: trimLog([...store.state.matched, activity]) })
    syncRuleStats()
  })
  /**
   * Response bodies in the traffic log. Observing traffic is what makes the adapters clone and read
   * every response, so this is wired only while the profile asks for it. The body arrives after the
   * activity was announced, so it is attached to the newest entry of that rule and URL.
   */
  let stopBodyCapture: (() => void) | undefined
  const syncBodyCapture = () => {
    const wanted = store.state.config.profile.settings.storeResponseBodies === true
    if (wanted === !!stopBodyCapture) return
    if (!wanted) {
      stopBodyCapture?.()
      stopBodyCapture = undefined
      return
    }
    stopBodyCapture = pipeline.observe((event) => {
      const body = event.response?.body
      if (body == null) return
      const limit = Math.max(1, store.state.config.profile.settings.bodyLimitKb) * 1024
      const ids = new Set(event.ruleIds)
      const entries = [...store.state.matched]
      for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index]!
        if (entry.body !== undefined || !ids.has(entry.ruleId)) continue
        if (entry.url !== event.request.url || kindOf(entry.ruleId) !== "intercept") continue
        entries[index] = { ...entry, body: body.length > limit ? `${body.slice(0, limit)}…` : body }
        store.set({ matched: entries })
        return
      }
    })
  }
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
    // A run in rules mode dispatches through the page's wrapped fetch, so it is marked: the
    // recorder leaves the workbench's own traffic out of a page recording unless asked not to.
    const fetcher: typeof window.fetch =
      plan.mode === "rules"
        ? (input, init) => window.fetch(input, { ...init, [TESTER_MARK]: true } as RequestInit)
        : directFetch
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
      if (plan.notifyOnComplete) {
        const summary = `Run ${run.state}: ${run.counts.passed} passed of ${run.completed} requests`
        report(summary)
        // The activity line is the record; the dialog is the notification the plan asked for.
        const failed = failedCount(run)
        void shell.announceRun(
          `Run ${run.state}`,
          `${run.planName}: ${run.counts.passed} of ${run.completed} request${run.completed === 1 ? "" : "s"} passed` +
            (failed ? `, ${failed} did not.` : ".") +
            (run.errors.length ? ` ${run.errors.length} error${run.errors.length === 1 ? "" : "s"} reported.` : ""),
        )
      }
    })
  }

  const shell = createShell({
    version,
    store,
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
    /**
     * Stores the live profile as it stands, under `name`. Switching profiles installs a stored
     * snapshot over the live one, so a profile that was never stored is a profile that cannot be
     * returned to; this is how it gets there, and how it is renamed.
     */
    saveProfile: (name) => {
      const config = store.state.config
      const profile = {
        ...config.profile,
        name: name.trim() || config.profile.name,
        revision: config.profile.revision + 1,
        updatedAt: Date.now(),
      }
      const snapshot = { profile, endpoints: config.endpoints, rules: rulesOf(config), plan: planOf(config) }
      const saved = config.savedProfiles ?? []
      persist({
        ...config,
        profile,
        savedProfiles: saved.some((item) => item.profile.id === profile.id)
          ? saved.map((item) => (item.profile.id === profile.id ? snapshot : item))
          : [...saved, snapshot],
      })
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
    commitImport: async (raw, activate) => {
      // An imported profile need not carry a plan; the live configuration must.
      const next = withPlan(raw)
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
      const capture = store.state.config.profile.settings?.recorderIncludeTester === true
      if (recorder.start({ includeTester: capture })) store.set({ recording: true })
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
    /**
     * An inline bookmarklet fetches nothing, so there is no remote manifest to ask. What this
     * origin does know is the newest build that has ever run here, recorded at launch: a bookmark
     * older than that note is a stale copy the user saved before re-installing.
     */
    checkForUpdate: async () => {
      const seen = await readLaunchVersion()
      if (!seen) {
        void recordLaunchVersion(version)
        store.set({ newestVersion: version })
        return `No earlier build is recorded for this origin. ${version} is noted as the newest.`
      }
      if (seen === version) return `Up to date: no build newer than ${version} has run on this origin.`
      if (compareVersions(seen, version) < 0) {
        void recordLaunchVersion(version)
        store.set({ newestVersion: version })
        return `${version} is newer than the ${seen} recorded here; this origin now expects ${version}.`
      }
      return `A newer build (${seen}) has run on this origin. Re-install the bookmarklet from the landing page to replace this ${version} bookmark.`
    },
    clearStoredData: async () => {
      await clearStoredConfig()
      // What is on screen has to match what is stored, so the panel restarts on an empty profile.
      activate(defaultProfile(), [], [], [])
      store.set({ testerHistory: [], runs: [], openRun: undefined, newestVersion: undefined })
    },
    plan: () => planOf(store.state.config),
    updatePlan: (plan: TestPlan) => persist({ ...store.state.config, plan }),
    savePlanAs: (name) => {
      const config = store.state.config
      const live = planOf(config)
      const saved = config.savedPlans ?? []
      const plan = {
        ...live,
        id: createId("plan"),
        name: suggestProfileName(name || live.name, [live.name, ...saved.map((item) => item.name)]),
      }
      persist({ ...config, savedPlans: [...saved, plan] })
    },
    selectPlan: (id) => {
      const config = store.state.config
      const live = planOf(config)
      const saved = config.savedPlans ?? []
      const next = saved.find((item) => item.id === id)
      if (!next || next.id === live.id) return
      // The plan being left is stored as it stands — updated, or added when it was never saved —
      // so switching plans never silently discards its edits.
      persist({
        ...config,
        plan: { ...next, profileId: config.profile.id },
        savedPlans: saved.some((item) => item.id === live.id)
          ? saved.map((item) => (item.id === live.id ? live : item))
          : [...saved, live],
      })
    },
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
    createProfileFromRecordings: (name, endpoints, hosts, bindings = []) => {
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
      // The recorded headers reference these by name, so the plan carries them from the first run.
      activate(profile, owned, [], savedProfiles, { ...defaultTestPlan(profile.id), bindings })
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
          store.set({ config: withPlan(config) })
          pipeline.setRules(config.rules ?? [])
          syncRuleStats()
        }
        store.set({ storageReady: true })
        syncBodyCapture()
        syncRecorder()
      })
      .catch(() => store.set({ storageReady: false }))
    // The newest build this origin has seen, so Settings can say whether this bookmark is stale.
    void readLaunchVersion().then((seen) => {
      const newest = seen && compareVersions(seen, version) > 0 ? seen : version
      store.set({ newestVersion: newest })
      if (newest === version && seen !== version) void recordLaunchVersion(version)
    })
  } catch (error) {
    close()
    throw error
  }
}
