import { el, icon, button, checkFields, confirmDialog, headerFields, iconButton, card, cardHeading, caption, group, labeled, labeledAction, formatJsonButton, disclosure, downloadJson, switchBox, toggleBox, type IconName } from "./dom"
import { DEFAULT_LOG_LIMIT, logLimit, mergeHeaders, moduleEnabled, nameFromHost, pageProfileName, type Endpoint, type HeaderValue, type Profile, type Rule, type RuleKind, type TestPlan, type WorkbenchConfig } from "../core/model"
import type { RuleActivity } from "../network/rules"
import type { PausedEntry } from "../breakpoints/registry"
import { chaosScreen, interceptScreen, mockScreen, routeScreen } from "./rule-screens"
import type { OnceResult } from "../tester/once"
import type { RunState } from "../tester/run"
import { onceRow, resultsScreen, runRow, testScreen } from "./test-screens"
import type { Recording } from "../recorder/recorder"
import { candidatesFrom, type Candidate } from "../recorder/promote"
import { DEFAULT_RECORD_LIMIT } from "../recorder/recorder"
import { scanPage, type ContextCandidate } from "../tester/context"
import type { ContextBinding } from "../tester/expressions"
import { importScreen, takeImportSummary } from "./import-screen"

export type ScreenId =
  | "home"
  | "test"
  | "mock"
  | "intercept"
  | "route"
  | "chaos"
  | "results"
  | "endpoints"
  | "record"
  | "import"
  | "settings"

export type ActivityEntry = { at: number; message: string }

export type UIState = {
  screen: ScreenId
  minimized: boolean
  observed: number
  /** Newest first, bounded by ACTIVITY_LIMIT. Every observed request leaves one entry. */
  activity: ActivityEntry[]
  config: WorkbenchConfig
  storageReady: boolean
  testerResult?: OnceResult
  testerHistory: OnceResult[]
  recording: boolean
  recordings: Recording[]
  /** Module activation is session state: a fresh launch never silently intercepts traffic. */
  moduleActive: Record<RuleKind, boolean>
  ruleHits: Record<string, number>
  ruleCursors: Record<string, number>
  matched: RuleActivity[]
  /** Live continuations, not configuration: each entry disappears once it is resolved. */
  paused: PausedEntry[]
  /** The run in progress, if any. */
  run?: RunState
  /** The run the Results screen is showing: the live one, or one picked from history. */
  openRun?: RunState
  /** Completed runs, newest first and bounded by MAX_RUN_SUMMARIES. */
  runs: RunState[]
  /** The newest build this origin has ever run, read from storage at launch. */
  newestVersion?: string
}

export type Ctx = {
  version: string
  state: () => Readonly<UIState>
  go: (screen: ScreenId) => void
  /** Runs now and after every state change; disposed when the screen is replaced. */
  watch: (listener: (state: Readonly<UIState>) => void) => void
  /** Retitles the sub-header, redirects Back and fills the footer action bar for this screen. */
  chrome: (options: { title?: string; onBack?: () => void; actions?: Node[] }) => void
  signal: AbortSignal
  addEndpoint: () => void
  updateEndpoint: (endpoint: Endpoint) => void
  deleteEndpoint: (id: string) => void
  updateProfile: (profile: Profile) => void
  exportConfig: () => string
  runOnce: (endpointId: string) => void
  saveProfileAs: (name: string) => void
  /** Renames the live profile and stores its configuration under that name. */
  saveProfile: (name: string) => void
  selectProfile: (id: string) => void
  deleteProfile: (id: string) => void
  /**
   * Persists a reviewed import in one transaction. Resolves with an error message when the write
   * failed and nothing was saved, so the review can be retried.
   */
  commitImport: (config: WorkbenchConfig, activate: boolean) => Promise<string | undefined>
  reorderEndpoint: (id: string, direction: "up" | "down") => void
  startRecording: () => void
  stopRecording: () => void
  resetRecorder: () => void
  createProfileFromRecordings: (
    name: string,
    endpoints: Endpoint[],
    hosts: Record<string, string>,
    /** Bindings the recorded headers read at send time; they become the new plan's context. */
    bindings?: ContextBinding[],
  ) => void
  saveRule: (rule: Rule) => void
  deleteRule: (id: string) => void
  toggleRule: (id: string, enabled: boolean) => void
  setModuleActive: (kind: RuleKind, value: boolean) => void
  resetSequence: (ruleId: string) => void
  /** Next creation sequence for a new rule; ties on priority resolve by it. */
  nextRuleSeq: () => number
  continueAllPaused: () => void
  /** Compares this build against the newest one recorded for the origin; resolves with the note. */
  checkForUpdate: () => Promise<string>
  /** Deletes this origin's saved configuration and restarts the panel on an empty profile. */
  clearStoredData: () => Promise<void>
  /** The live test plan of the active profile. */
  plan: () => TestPlan
  updatePlan: (plan: TestPlan) => void
  /** Stores a copy of the live plan under `name`, uniquified against the stored names. */
  savePlanAs: (name: string) => void
  /** Makes a stored plan live; the plan being left is stored as it stands. */
  selectPlan: (id: string) => void
  startRun: () => void
  stopRun: () => void
  openRun: (id: string) => void
  exportRun: (format: "json" | "csv") => void
}

type Screen = {
  label: string
  icon: IconName
  tab: boolean
  reference: string
  milestone: string
  summary: string
  points: readonly string[]
}

const SCREEN_DATA = {
  home: {
    label: "Home",
    icon: "home",
    tab: true,
    reference: "home.html",
    milestone: "M1",
    summary: "Module status, profile, counters and quick actions.",
    points: [],
  },
  test: {
    label: "Test",
    icon: "flask",
    tab: true,
    reference: "Test.html · Results.html",
    milestone: "M3, M8",
    summary:
      "API tester: Once and load modes, Flow and Independent strategies, results and export.",
    points: [
      "Setup and load phases with dependency ordering",
      "Iterations, concurrency, delay and ramp-up",
      "Latency statistics, run history, JSON/CSV export",
    ],
  },
  mock: {
    label: "Mock",
    icon: "server",
    tab: true,
    reference: "Mock.html · MockRule.html",
    milestone: "M5",
    summary: "Mock server: endpoint-linked and standalone rules with zero upstream traffic.",
    points: [
      "Method and URL matching with conditions and priority",
      "Response status, body, headers and response sequences",
      "Activation state, hit counts and matched traffic",
    ],
  },
  intercept: {
    label: "Intercept",
    icon: "shuffle",
    tab: true,
    reference: "Intercept.html · InterceptRule.html",
    milestone: "M6, M7",
    summary: "Request and response transformations on this frame’s traffic.",
    points: [
      "Header, body and status edits plus RFC 6902 JSON Patch",
      "Transform outcome log with a rule trace",
      "Request and response breakpoints with a paused-request queue",
    ],
  },
  route: {
    label: "Route",
    icon: "route",
    tab: true,
    reference: "Route.html",
    milestone: "M6",
    summary: "Routes this frame’s fetch/XHR requests; browser restrictions apply.",
    points: [
      "Origin and path matching with path rewrite",
      "Credentials handling, conditions and priority",
      "CORS, cookies and mixed-content rules still apply",
    ],
  },
  chaos: {
    label: "Chaos",
    icon: "flame",
    tab: true,
    reference: "Chaos.html · ChaosRule.html",
    milestone: "M5",
    summary: "Synthetic and real-traffic faults with bounded request replay.",
    points: [
      "Fault presets, probability sampling and delays",
      "Endpoint-derived rules and hit counts",
      "Explicit bounded replay of real requests",
    ],
  },
  results: {
    label: "Results",
    icon: "list",
    tab: false,
    reference: "Results.html",
    milestone: "M8",
    summary: "Run progress, outcome breakdown, latency statistics and export.",
    points: [],
  },
  endpoints: {
    label: "Endpoints",
    icon: "book",
    tab: false,
    reference: "Endpoints.html · EndpointEdit.html",
    milestone: "M3",
    summary: "Endpoint CRUD, headers, environments and checks.",
    points: [
      "Request editor with response sample and checks",
      "Global headers, presets and host mappings",
      "Promotion from recorded traffic (M4)",
    ],
  },
  record: {
    label: "Record",
    icon: "record",
    tab: false,
    reference: "Import.html",
    milestone: "M4",
    summary: "Capture this frame's traffic and turn the selected calls into a profile.",
    points: [
      "Start/stop capture with a reviewable draft",
      "Repeated calls collapse into one endpoint candidate",
      "Edit any candidate, then create a profile from the selection",
    ],
  },
  import: {
    label: "Import",
    icon: "download",
    tab: false,
    reference: "Import.html",
    milestone: "M9",
    summary: "File and paste import for every format in the Import screen.",
    points: [
      "Native JSON, HAR 1.2, Postman 2.1, Swagger 2.0, OpenAPI 3.0",
      "cURL and copied fetch calls",
      "Review preview, conflict handling, no imported code runs",
    ],
  },
  settings: {
    label: "Settings",
    icon: "gear",
    tab: false,
    reference: "Settings.html",
    milestone: "M3, M4, M10",
    summary: "Profiles, storage, module visibility, limits and version information.",
    points: [
      "Profile management and origin-scoped storage",
      "Body and log limits, recorder recovery",
      "Bundled version; replace the bookmark to update",
    ],
  },
} as const satisfies Record<ScreenId, Screen>

export const SCREENS: Record<ScreenId, Screen> = SCREEN_DATA
export const TABS = (Object.keys(SCREEN_DATA) as ScreenId[]).filter((id) => SCREENS[id].tab)

const MODULES = [
  { id: "test", title: "API Tester", milestone: "M3, M8" },
  { id: "mock", title: "Mock Server", milestone: "M5" },
  { id: "intercept", title: "API Interceptor", milestone: "M6, M7" },
  { id: "route", title: "Page Routing", milestone: "M6" },
  { id: "chaos", title: "Chaos Engineering", milestone: "M5" },
] as const

function updateProfile(ctx: Ctx, patch: Partial<Profile>) {
  const profile = ctx.state().config.profile
  ctx.updateProfile({ ...profile, ...patch, revision: profile.revision + 1, updatedAt: Date.now() })
}


/**
 * What each module reports on its Home card, in the wording of `home.html`: the rule ratio and
 * the module's own name for a hit. Shared with the title bar and the tab strip via `moduleState`.
 */
const MODULE_STATS: Record<RuleKind, { rules: string; hits: string }> = {
  mock: { rules: "rules active", hits: "requests matched" },
  intercept: { rules: "rules active", hits: "responses modified" },
  route: { rules: "rules enabled", hits: "routed" },
  chaos: { rules: "rules", hits: "chaos hits" },
}

/** One rule module's live state. Home's card, the title-bar indicators and the tab dots all read
 * it, so the three can never disagree about whether a module is running. */
export function moduleState(state: Readonly<UIState>, kind: RuleKind) {
  const rules = (state.config.rules ?? []).filter(rule => rule.kind === kind)
  const enabled = rules.filter(rule => rule.enabled).length
  const hits = rules.reduce((total, rule) => total + (state.ruleHits[rule.id] ?? 0), 0)
  const running = state.moduleActive[kind]
  // Paused says the rules are configured but nothing is touching traffic; Inactive says there is
  // nothing to run in the first place.
  const label = running ? "Running" : rules.length ? "Paused" : "Inactive"
  return { rules: rules.length, enabled, hits, running, label }
}

export const RULE_MODULES = ["mock", "intercept", "route", "chaos"] as const

function moduleCard(ctx: Ctx, module: (typeof MODULES)[number]): HTMLElement {
  const section = card()
  const tile = el("div", "aw-tile")
  tile.append(icon(SCREENS[module.id].icon))
  const ready = module.id === "test"
  // Reference card: title + state badge, a stat line, and the module's own action below.
  const badge = el("span", "aw-bd")
  const dot = el("span", "aw-dot")
  const badgeLabel = document.createTextNode("Inactive")
  badge.append(dot, badgeLabel)
  // The reference titles the Tester card with its plan line alone: it has no on/off state to show.
  badge.hidden = ready
  const summary = el("div", "aw-xs aw-mu")
  const open = button("aw-btn aw-gh aw-sm", "Open", () => ctx.go(module.id), ctx.signal)
  open.setAttribute("aria-label", `Open ${module.title}`)
  open.append(icon("right"))
  const actions = el("div", "aw-row aw-actions")
  if (ready) {
    const run = button("aw-btn aw-pri aw-sm", "Run", () => ctx.go("test"), ctx.signal)
    run.prepend(icon("play", "aw-i12"))
    // History opens the newest run; Results is the screen that renders one.
    const history = button("aw-btn aw-out aw-sm", "History", () => {
      const latest = ctx.state().runs[0]
      if (latest) ctx.openRun(latest.id)
      ctx.go("results")
    }, ctx.signal)
    history.prepend(icon("history", "aw-i14"))
    actions.append(run, history)
    ctx.watch(state => {
      const plan = ctx.plan()
      const total = state.config.endpoints.length
      const included = state.config.endpoints.filter(item => !plan.excluded.includes(item.id)).length
      const last = state.runs[0]?.endedAt ?? state.runs[0]?.startedAt
      summary.textContent = `${plan.name} · ${included}/${total} in plan · ${last ? `Last run ${new Date(last).toLocaleTimeString()}` : "No runs yet"}`
    })
  } else {
    const kind = module.id as RuleKind
    const words = MODULE_STATS[kind]
    // One button, as on the reference card: the module's own on/off switch once it has rules to
    // run. With none, activating would do nothing, so it stays the reference's way into the rule
    // list instead of offering a dead end.
    const manage = kind === "chaos" ? "Configure" : "Manage rules"
    const toggle = button("aw-btn aw-out aw-sm", "", () => {
      const module = moduleState(ctx.state(), kind)
      if (!module.rules) ctx.go(kind)
      else ctx.setModuleActive(kind, !module.running)
    }, ctx.signal)
    actions.append(toggle)
    ctx.watch(state => {
      const module = moduleState(state, kind)
      badgeLabel.textContent = module.label
      badge.className = module.running ? "aw-bd aw-gr" : module.rules ? "aw-bd aw-am" : "aw-bd"
      dot.className = module.running ? "aw-dot aw-g" : module.rules ? "aw-dot aw-a" : "aw-dot"
      section.classList.toggle("aw-live", module.running)
      summary.textContent = `${module.enabled}/${module.rules} ${words.rules} · ${module.hits} ${words.hits}`
      toggle.className = module.running ? "aw-btn aw-dst aw-sm" : "aw-btn aw-out aw-sm"
      if (!module.rules) toggle.replaceChildren(document.createTextNode(manage))
      else
        toggle.replaceChildren(icon(module.running ? "stop" : "play", "aw-i12"),
          document.createTextNode(module.running ? "Stop" : "Activate"))
    })
  }
  section.append(group("aw-row aw-gap10", tile,
    group("aw-grow aw-col aw-gap2", group("aw-row aw-actions", el("span", "aw-h", module.title), badge), summary), open), actions)
  return section
}

function quickAction(ctx: Ctx, id: ScreenId): HTMLElement {
  const action = button("aw-qa", "", () => ctx.go(id), ctx.signal)
  action.append(icon(SCREENS[id].icon, "aw-i20"), el("span", "", SCREENS[id].label))
  // home.html gives the Endpoints tile a count badge; it tracks the active profile live, so
  // switching profile or saving an endpoint updates it without leaving Home.
  if (id === "endpoints") {
    const count = el("span", "aw-bd aw-s")
    ctx.watch(state => {
      const total = state.config.endpoints.length
      count.textContent = `${total} endpoint${total === 1 ? "" : "s"}`
    })
    action.append(count)
  }
  return action
}

type Draft = Candidate & { selected: boolean }

/**
 * Review drafts live outside the screen so an edit survives leaving and re-entering Record. They
 * are derived from the capture buffer, never the other way round: clearing them cannot touch a
 * saved profile, and resetting the recorder clears them.
 */
const recordDrafts = new Map<string, Draft>()

function recorderControls(ctx: Ctx): HTMLElement {
  const controls = card()
  const status = el("span", "aw-bd aw-s")
  status.setAttribute("role", "status")
  const start = button("aw-btn aw-pri aw-sm", "Start recording", ctx.startRecording, ctx.signal)
  start.prepend(icon("record", "aw-i14"))
  const stop = button("aw-btn aw-out aw-sm", "Stop recording", ctx.stopRecording, ctx.signal)
  const reset = button("aw-btn aw-gh aw-sm", "Reset recorder", () => { recordDrafts.clear(); ctx.resetRecorder(); ctx.go("record") }, ctx.signal)
  ctx.watch(state => {
    status.textContent = state.recording ? `Recording · ${state.recordings.length} captured` : `${state.recordings.length} captured · reviewable draft`
    start.disabled = state.recording
    stop.disabled = !state.recording
    reset.disabled = state.recording || !state.recordings.length
  })
  controls.append(group("aw-row aw-actions", el("span", "aw-lbl", "Recorder"), status),
    el("p", "aw-hint", "Captures this frame's fetch and XHR calls made after recording starts. Sensitive headers are redacted and bodies are bounded."),
    group("aw-row aw-actions", start, stop, reset))
  return controls
}

function recordScreen(ctx: Ctx): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const list = el("div", "aw-card aw-list")
  list.setAttribute("aria-label", "Captured endpoints")
  const notice = el("p", "aw-hint")
  notice.setAttribute("role", "status")
  const profileName = el("input", "aw-in aw-grow")
  let suggested = pageProfileName()
  profileName.value = suggested
  profileName.setAttribute("aria-label", "New profile name")
  let hosts: Record<string, string> = {}

  const editDraft = (draft: Draft) => {
    const editor = endpointEditor(ctx, draft.endpoint, {
      peers: [...recordDrafts.values()].map(item => item.endpoint),
      onSave: endpoint => recordDrafts.set(draft.key, { ...draft, endpoint }),
      onClose: () => ctx.go("record"),
    })
    screen.replaceChildren(editor)
    screen.closest(".aw-body")?.scrollTo(0, 0)
    editor.querySelector<HTMLInputElement>('[aria-label="Name"]')?.focus({ preventScroll: true })
  }

  const draw = () => {
    list.replaceChildren()
    for (const draft of recordDrafts.values()) {
      const select = el("input") as HTMLInputElement
      select.type = "checkbox"
      select.checked = draft.selected
      select.setAttribute("aria-label", `Include ${draft.endpoint.name}`)
      select.addEventListener("change", () => recordDrafts.set(draft.key, { ...recordDrafts.get(draft.key)!, selected: select.checked }), { signal: ctx.signal })
      const name = button("aw-endpoint-name aw-grow aw-tr", draft.endpoint.name, () => editDraft(recordDrafts.get(draft.key) ?? draft), ctx.signal)
      name.title = draft.endpoint.name
      const sample = draft.endpoint.sampleResponse
      const row = el("div", "aw-col aw-gap2 aw-endpoint-row")
      row.append(group("aw-row aw-gap8", select, el("span", `aw-bd aw-m aw-${draft.endpoint.request.method}`, draft.endpoint.request.method), name,
        el("span", "aw-xs aw-mu", draft.count > 1 ? `×${draft.count}` : ""),
        el("span", "aw-xs aw-mu", sample ? String(sample.status) : "no response"),
        iconButton("aw-btn aw-gh aw-ic aw-xs2", "edit", "Edit", () => editDraft(recordDrafts.get(draft.key) ?? draft), ctx.signal)))
      const path = el("span", "aw-grow aw-tr aw-mono aw-xs aw-mu", draft.endpoint.request.path)
      path.title = draft.endpoint.request.path
      row.append(group("aw-row aw-endpoint-meta", path, el("span", "aw-xs aw-mu", draft.endpoint.hostKey)))
      // A credential is redacted at capture and never stored. Where its value was traced to the
      // page, the header comes back as a binding; where it was not, saying so here costs nothing
      // and finding out from a 401 later does.
      if (draft.bindings.length)
        row.append(el("p", "aw-hint aw-endpoint-meta",
          `Sends ${draft.bindings.map(binding => binding.name).join(", ")} read from the page at run time, not a stored copy.`))
      if (draft.dropped.length)
        row.append(el("p", "aw-hint aw-endpoint-meta",
          `${draft.dropped.join(", ")} recorded but not stored, and not found on the page. Add it as a header before replaying.`))
      list.append(row)
    }
    if (!list.children.length) list.append(el("div", "aw-empty", "Nothing captured yet. Start recording, then use the page."))
  }

  let previous: Readonly<UIState>["recordings"] | undefined
  ctx.watch(state => {
    if (previous === state.recordings) return
    previous = state.recordings
    const derived = candidatesFrom(state.recordings, state.config.profile.id)
    hosts = derived.hosts
    // The recorded API host names the profile when the page calls exactly one foreign origin;
    // a name the user has typed is theirs to keep, so only the untouched suggestion moves.
    const foreign = Object.keys(hosts).filter(key => key !== "default")
    const next = (foreign.length === 1 ? nameFromHost(foreign[0] ?? "") : "") || pageProfileName()
    if (profileName.value === suggested) profileName.value = next
    suggested = next
    const live = new Set<string>()
    for (const candidate of derived.candidates) {
      live.add(candidate.key)
      const existing = recordDrafts.get(candidate.key)
      // An edited draft keeps its edits; only the repeat count follows the capture buffer.
      recordDrafts.set(candidate.key, existing ? { ...existing, count: candidate.count } : { ...candidate, selected: true })
    }
    for (const key of [...recordDrafts.keys()]) if (!live.has(key)) recordDrafts.delete(key)
    notice.textContent = derived.skipped ? `${derived.skipped} captured call${derived.skipped === 1 ? "" : "s"} cannot become an endpoint (unsupported method or URL).` : ""
    draw()
  })

  const setAll = (selected: boolean) => {
    for (const [key, draft] of recordDrafts) recordDrafts.set(key, { ...draft, selected })
    draw()
  }
  const create = button("aw-btn aw-pri aw-grow", "Create profile", () => {
    const chosen = [...recordDrafts.values()].filter(draft => draft.selected)
    if (!chosen.length) { notice.textContent = "Select at least one endpoint to create a profile."; return }
    if (!profileName.value.trim()) { notice.textContent = "Enter a name for the new profile."; profileName.focus(); return }
    if (ctx.state().recording) ctx.stopRecording()
    // One binding per page value, however many of the chosen endpoints read it.
    const bindings = [...new Map(chosen.flatMap(draft => draft.bindings).map(binding => [binding.name, binding])).values()]
    ctx.createProfileFromRecordings(profileName.value, chosen.map(draft => draft.endpoint), hosts, bindings)
    // The capture buffer is consumed by the commit, so a second commit cannot duplicate it.
    recordDrafts.clear()
    ctx.resetRecorder()
    ctx.go("endpoints")
  }, ctx.signal)

  const selection = card()
  selection.append(group("aw-row aw-actions", el("span", "aw-lbl aw-grow", "Captured endpoints"),
    button("aw-btn aw-gh aw-sm", "Select all", () => setAll(true), ctx.signal),
    button("aw-btn aw-gh aw-sm", "Clear", () => setAll(false), ctx.signal)),
    el("p", "aw-hint", "Repeated calls to the same method and path are one endpoint. Edit any row before creating the profile."))
  const commit = card()
  commit.append(el("span", "aw-lbl", "Create a profile from the selected endpoints"),
    group("aw-row", profileName), notice)
  screen.append(recorderControls(ctx), selection, list, commit)
  ctx.chrome({ actions: [create, button("aw-btn aw-out aw-grow", "Back", () => ctx.go("home"), ctx.signal)] })
  return screen
}

/** Both kinds of run land here: a plan run from Test's Load view and a direct Once request.
 * Listing only the Once results left Home reporting "No runs yet" after a completed plan run. */
function runHistory(ctx: Ctx): HTMLElement {
  const history = el("div", "aw-card aw-list")
  history.setAttribute("aria-label", "Run history")
  let runs: Readonly<UIState>["runs"] | undefined
  let once: Readonly<UIState>["testerHistory"] | undefined
  ctx.watch(state => {
    if (runs === state.runs && once === state.testerHistory) return
    runs = state.runs
    once = state.testerHistory
    history.replaceChildren()
    for (const run of state.runs) history.append(runRow(ctx, run))
    for (const item of state.testerHistory) history.append(onceRow(state, item))
    if (!history.children.length)
      history.append(el("div", "aw-empty", "No runs yet. Run an endpoint or a plan from Test."))
  })
  return history
}

/** The last thing the interception layer reported, including the failures a rule cannot fix
 * (an opaque cross-origin response, a refused route) that the user would otherwise never see. */
/** Local wall-clock `HH:MM:SS`; a log read beside the page's own network panel must match it. */
const clock = (at: number) => new Date(at).toTimeString().slice(0, 8)

function activityLog(ctx: Ctx): HTMLElement {
  const section = card()
  const caption = el("span", "aw-cap", "Activity")
  // `.aw-code` already scrolls past 160px and carries the platform resize handle, so the log needs
  // no scroller of its own.
  const activity = el("pre", "aw-code aw-wrap", "No requests observed.")
  ctx.watch(state => {
    caption.textContent = state.observed ? `Activity · ${state.observed} observed` : "Activity"
    activity.textContent = state.activity.length
      ? state.activity.map(entry => `${clock(entry.at)}  ${entry.message}`).join("\n")
      : "No requests observed."
  })
  section.append(caption, activity)
  return section
}

function home(ctx: Ctx): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const modules = el("div", "aw-col aw-gap12")
  // A module switched off in Settings is not on Home either; the tab strip hides it in step.
  const profile = ctx.state().config.profile
  for (const module of MODULES)
    if (moduleEnabled(profile, module.id)) modules.append(moduleCard(ctx, module))
  if (!modules.childElementCount)
    modules.append(el("div", "aw-empty", "Every module is switched off in Settings → Modules."))
  const quick = el("div", "aw-g3")
  for (const id of ["endpoints", "record", "import", "settings"] as const)
    if (moduleEnabled(profile, id)) quick.append(quickAction(ctx, id))
  screen.append(modules, caption("Quick actions"), quick, caption("Run history"), runHistory(ctx), activityLog(ctx))
  return screen
}

function field(
  label: string,
  value: string,
  onChange: (value: string) => void,
  signal: AbortSignal,
): HTMLElement {
  const wrapper = el("label", "aw-fld")
  wrapper.append(el("span", "aw-lbl", label))
  const input = el("input", "aw-in aw-mono") as HTMLInputElement
  input.value = value
  input.addEventListener("change", () => onChange(input.value), { signal })
  wrapper.append(input)
  return wrapper
}

type EditorOptions = {
  /** Endpoints the alias must stay unique against; defaults to the active profile's. */
  peers?: Endpoint[]
  /** Receives the edited endpoint instead of the profile store. */
  onSave?: (endpoint: Endpoint) => void
  /** Where Back, Cancel and Escape return to; defaults to the Endpoints screen. */
  onClose?: () => void
}

function endpointEditor(ctx: Ctx, endpoint: Endpoint, options: EditorOptions = {}): HTMLElement {
  const section = el("div", "aw-col aw-gap12")
  const draft = { ...endpoint, request: { ...endpoint.request, headers: endpoint.request.headers.map(header => ({ ...header })) } }
  const name = el("input", "aw-in")
  name.value = endpoint.name
  name.setAttribute("aria-label", "Name")
  const alias = el("input", "aw-in aw-mono")
  alias.value = endpoint.alias
  alias.setAttribute("aria-label", "Alias")
  const path = el("input", "aw-in aw-mono")
  path.value = endpoint.request.path
  path.setAttribute("aria-label", "Path")
  const host = el("input", "aw-in aw-mono")
  host.value = endpoint.hostKey
  host.setAttribute("aria-label", "Host key")
  const method = el("select", "aw-sel")
  method.setAttribute("aria-label", "Method")
  for (const value of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    const option = el("option", "", value)
    option.value = value
    option.selected = value === endpoint.request.method
    method.append(option)
  }
  const body = el("textarea", "aw-ta")
  body.value = endpoint.request.body
  body.setAttribute("aria-label", "Body")
  body.placeholder = "Request body"
  const bodyKind = el("select", "aw-sel")
  bodyKind.setAttribute("aria-label", "Body kind")
  for (const [value, label] of [["none", "None"], ["text", "Text"], ["json", "JSON"], ["urlencoded", "Form URL-encoded"]] as const) {
    const option = el("option", "", label)
    option.value = value
    option.selected = value === endpoint.request.bodyKind
    bodyKind.append(option)
  }
  // The kind decides how the body is rendered before dispatch, so it also names the content type —
  // but only when the endpoint has not set one itself, which is the user's to keep.
  const CONTENT_TYPES: Record<string, string> = { json: "application/json", urlencoded: "application/x-www-form-urlencoded" }
  bodyKind.addEventListener("change", () => {
    const type = CONTENT_TYPES[bodyKind.value]
    if (type && !draft.request.headers.some(header => header.name.trim().toLowerCase() === "content-type")) {
      draft.request.headers = [...draft.request.headers, { name: "Content-Type", value: type }]
      headers.replaceChildren(headerFields(ctx.signal, draft.request.headers, next => { draft.request.headers = next }))
    }
  }, { signal: ctx.signal })
  const notice = el("p", "aw-hint")
  notice.setAttribute("role", "status")
  const cancel = options.onClose ?? (() => ctx.go("endpoints"))
  const save = () => {
    if (!name.value.trim() || !alias.value.trim() || !path.value.trim()) {
      notice.textContent = "Enter a name, alias and request path."
      return
    }
    const peers = options.peers ?? ctx.state().config.endpoints
    if (peers.some(item => item.id !== endpoint.id && item.alias === alias.value.trim())) {
      notice.textContent = "Choose an alias that is unique to this profile."
      alias.focus()
      return
    }
    ;(options.onSave ?? ctx.updateEndpoint)({ ...draft, name: name.value.trim(), alias: alias.value.trim(), hostKey: host.value.trim() || "default",
      request: { ...draft.request, method: method.value as Endpoint["request"]["method"], path: path.value.trim(), body: body.value,
        bodyKind: bodyKind.value as Endpoint["request"]["bodyKind"],
        headers: draft.request.headers.filter(header => header.name.trim()) }, updatedAt: Date.now() })
    cancel()
  }
  const headers = el("div", "aw-col")
  headers.append(headerFields(ctx.signal, draft.request.headers, next => { draft.request.headers = next }))
  const request = card()
  request.append(caption("Request"), group("aw-g2", labeled("Method", method), labeled("Path", path)),
    el("span", "aw-lbl", "Headers"), headers,
    disclosure(`Inherited from global · ${ctx.state().config.profile.globalHeaders.length}`,
      el("pre", "aw-code aw-wrap", ctx.state().config.profile.globalHeaders.map(header => `${header.name}: ${header.value}`).join("\n") || "No global headers.")),
    group("aw-g2", labeled("Body kind", bodyKind), el("span", "")),
    labeledAction("Body", body, formatJsonButton(body, ctx.signal)))
  const sample = el("textarea", "aw-ta")
  sample.value = endpoint.sampleResponse?.body ?? ""
  sample.setAttribute("aria-label", "Response sample")
  sample.placeholder = "No saved response sample. Record a request to capture one, or write one here."
  /** A sample only exists once it has a body: formatting an empty one must not mint `status: 0`. */
  const writeSample = (value: string) => {
    draft.sampleResponse = value ? { status: 0, headers: [], ...draft.sampleResponse, body: value } : undefined
  }
  sample.addEventListener("input", () => writeSample(sample.value), { signal: ctx.signal })
  const formatSample = formatJsonButton({
    read: () => draft.sampleResponse?.body ?? "",
    write: value => { writeSample(value); sample.value = value },
  }, ctx.signal)
  const response = disclosure("Response sample",
    group("aw-row aw-actions", el("span", "aw-lbl aw-grow", "Body"), formatSample), sample)
  const checksLabel = `Checks · ${endpoint.checks.length}`
  const checks = disclosure(checksLabel,
    el("p", "aw-hint", "Asserted after every run of this endpoint, in the tester and in a plan."),
    checkFields(ctx.signal, draft.checks, next => {
      draft.checks = next
      const summary = checks.querySelector("summary")
      if (summary) summary.textContent = `Checks · ${next.length}`
    }))
  section.append(group("aw-row", el("span", "aw-h aw-grow", "Edit endpoint"), el("span", `aw-bd aw-m aw-${endpoint.request.method}`, endpoint.request.method)),
    group("aw-g2", labeled("Name", name), labeled("Alias", alias)), request, response, checks,
    labeled("Host key", host), notice)
  const setChrome = () => ctx.chrome({ title: name.value.trim() || "Edit endpoint", onBack: cancel,
    actions: [button("aw-btn aw-pri aw-grow", "Save endpoint", save, ctx.signal), button("aw-btn aw-out aw-grow", "Cancel", cancel, ctx.signal)] })
  setChrome()
  // The sub-header names the endpoint being edited, so it follows the field rather than the name it
  // was opened with.
  name.addEventListener("input", setChrome, { signal: ctx.signal })
  section.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); cancel() } }, { signal: ctx.signal })
  return section
}

/** Every whitespace-separated term must appear, so "get pets" narrows where "get" alone would not. */
function matchesFilter(endpoint: Endpoint, query: string): boolean {
  const haystack = `${endpoint.request.method} ${endpoint.name} ${endpoint.alias} ${endpoint.request.path}`.toLowerCase()
  return query.split(/\s+/).every(term => haystack.includes(term))
}

function endpoints(ctx: Ctx): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const config = ctx.state().config
  const headers = disclosure(`Global headers · ${config.profile.globalHeaders.length}`,
    el("p", "aw-hint", "Applied to all requests. Changes are saved automatically."),
    headerFields(ctx.signal, config.profile.globalHeaders, globalHeaders => updateProfile(ctx, { globalHeaders })))
  headers.classList.add("aw-card", "aw-cp")
  headers.open = true
  const count = el("span", "aw-bd aw-s", String(config.endpoints.length))
  const title = group("aw-row", el("span", "aw-h", "Endpoints"), count, el("span", "aw-grow"))
  const add = button("aw-btn aw-pri aw-sm", "Add endpoint", () => { ctx.addEndpoint(); ctx.go("endpoints") }, ctx.signal)
  add.prepend(icon("plus", "aw-i14"))
  title.append(add)
  const filter = el("input", "aw-in") as HTMLInputElement
  filter.type = "search"
  filter.placeholder = "Filter by method, name or path"
  filter.setAttribute("aria-label", "Filter endpoints")
  const list = el("div", "aw-card aw-list")
  list.setAttribute("aria-label", "Endpoints")

  // Only the list is redrawn on a filter, a move or a delete. Rebuilding the screen for each of
  // those is what made moving one endpoint 28 full re-renders.
  const drawList = () => {
    const endpoints = ctx.state().config.endpoints
    const query = filter.value.trim().toLowerCase()
    const shown = query ? endpoints.filter(endpoint => matchesFilter(endpoint, query)) : endpoints
    count.textContent = query ? `${shown.length} of ${endpoints.length}` : String(endpoints.length)
    list.replaceChildren()
    for (const endpoint of shown) {
      const index = endpoints.indexOf(endpoint)
      const row = el("div", "aw-col aw-gap2 aw-endpoint-row")
      const editEndpoint = () => {
        const editor = endpointEditor(ctx, ctx.state().config.endpoints.find(item => item.id === endpoint.id) ?? endpoint)
        screen.replaceChildren(editor)
        screen.closest(".aw-body")?.scrollTo(0, 0)
        editor.querySelector<HTMLInputElement>('[aria-label="Name"]')?.focus({ preventScroll: true })
      }
      const name = button("aw-endpoint-name aw-grow aw-tr", endpoint.name, editEndpoint, ctx.signal)
      name.title = endpoint.name
      const run = iconButton("aw-btn aw-gh aw-ic aw-xs2", "play", "Run", () => { ctx.runOnce(endpoint.id); ctx.go("test") }, ctx.signal)
      const move = (direction: "up" | "down") => { ctx.reorderEndpoint(endpoint.id, direction); drawList() }
      const up = iconButton("aw-btn aw-gh aw-ic aw-xs2", "up", "Move up", () => move("up"), ctx.signal)
      const down = iconButton("aw-btn aw-gh aw-ic aw-xs2", "down", "Move down", () => move("down"), ctx.signal)
      // A filtered list hides the neighbour a move would swap with, so order is edited unfiltered.
      up.disabled = !!query || index === 0
      down.disabled = !!query || index === endpoints.length - 1
      if (query) up.title = down.title = "Clear the filter to reorder"
      const remove = iconButton("aw-btn aw-gh aw-ic aw-xs2", "trash", "Delete", () => {
        void confirmDialog(remove, "Delete endpoint", `Delete "${endpoint.name}"? This cannot be undone.`, "Delete", ctx.signal)
          .then(confirmed => { if (confirmed) { ctx.deleteEndpoint(endpoint.id); drawList() } })
      }, ctx.signal)
      const line = group("aw-row aw-gap8", el("span", `aw-bd aw-m aw-${endpoint.request.method}`, endpoint.request.method), name, run, up, down,
        iconButton("aw-btn aw-gh aw-ic aw-xs2", "edit", "Edit", editEndpoint, ctx.signal), remove)
      const path = el("span", "aw-grow aw-tr aw-mono aw-xs aw-mu", endpoint.request.path)
      path.title = endpoint.request.path
      const checks = el("span", "aw-row aw-xs aw-mu", String(endpoint.checks.length))
      checks.prepend(icon("list", "aw-i12"))
      checks.title = `${endpoint.checks.length} checks`
      row.append(line, group("aw-row aw-endpoint-meta", path, checks))
      list.append(row)
    }
    if (!endpoints.length) list.append(el("div", "aw-empty", "No endpoints yet. Add one or import a profile to get started."))
    else if (!shown.length) list.append(el("div", "aw-empty", `Nothing matches "${filter.value.trim()}".`))
  }
  filter.addEventListener("input", drawList, { signal: ctx.signal })
  drawList()
  // The filter is worth its own row only once there is a list to lose things in.
  filter.hidden = config.endpoints.length < 2

  // A committed import lands here and states what it saved, once.
  const imported = takeImportSummary()
  const summary = el("p", "aw-hint", imported)
  summary.setAttribute("role", "status")
  summary.hidden = !imported
  const environments = disclosure("Base URLs", environmentFields(ctx, "endpoints"))
  environments.classList.add("aw-card", "aw-cp")
  environments.open = true
  screen.append(headers, title, filter, summary, list, environments)
  return screen
}

function environmentFields(ctx: Ctx, screen: ScreenId): HTMLElement {
  const profile = ctx.state().config.profile
  const environment = el("select", "aw-sel")
  environment.setAttribute("aria-label", "Active environment")
  for (const name of Object.keys(profile.environments)) {
    const option = el("option", "", name)
    option.value = name
    option.selected = name === profile.activeEnvironment
    environment.append(option)
  }
  environment.addEventListener("change", () => { updateProfile(ctx, { activeEnvironment: environment.value }); ctx.go(screen) }, { signal: ctx.signal })
  const mapping = el("div", "aw-col aw-gap6")
  for (const [key, origin] of Object.entries(profile.environments[profile.activeEnvironment] ?? {})) {
    mapping.append(group("aw-row aw-xs", el("span", "aw-mono", key), el("span", "aw-mu aw-grow aw-wrap", origin || "Auto-detect from page origin")))
  }
  const key = el("input", "aw-in aw-mono")
  key.placeholder = "host_key"
  key.setAttribute("aria-label", "Host key")
  const origin = el("input", "aw-in aw-mono")
  origin.placeholder = "origin URL"
  origin.setAttribute("aria-label", "Host origin")
  const status = el("p", "aw-hint")
  status.setAttribute("role", "status")
  const addHost = button("aw-btn aw-out aw-sm", "Add host", () => {
    if (!key.value.trim()) { status.textContent = "Enter a host key."; key.focus(); return }
    let value = ""
    try {
      if (origin.value.trim()) {
        const url = new URL(origin.value.trim())
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error()
        value = url.origin
      }
    } catch { status.textContent = "Enter an HTTP(S) origin without a path or credentials."; origin.focus(); return }
    const current = ctx.state().config.profile
    updateProfile(ctx, { environments: { ...current.environments, [current.activeEnvironment]: { ...current.environments[current.activeEnvironment], [key.value.trim()]: value } } })
    ctx.go(screen)
  }, ctx.signal)
  const envName = el("input", "aw-in")
  envName.placeholder = "Environment name"
  envName.setAttribute("aria-label", "Environment name")
  const addEnv = button("aw-btn aw-out aw-sm", "Add env", () => {
    const name = envName.value.trim()
    const current = ctx.state().config.profile
    if (!name || Object.hasOwn(current.environments, name)) { status.textContent = "Enter a new environment name."; envName.focus(); return }
    updateProfile(ctx, { environments: { ...current.environments, [name]: { default: "" } }, activeEnvironment: name })
    ctx.go(screen)
  }, ctx.signal)
  return group("aw-col aw-gap10", labeled("Environment", environment), mapping, el("div", "aw-sep"),
    group("aw-g2", key, origin), addHost, group("aw-row", envName, addEnv), status)
}

let fieldSeq = 0
/** The reference's inline setting row: a muted label on the left, its control on the right. */
function inlineField(text: string, input: HTMLElement, ...extra: Node[]): HTMLElement {
  const id = `aw-set-${++fieldSeq}`
  input.id = id
  const label = el("label", "aw-xs aw-mu aw-grow", text)
  label.htmlFor = id
  return group("aw-row", label, input, ...extra)
}

/** A whole-number input sized as the reference sizes its limit fields. */
function limitInput(label: string, value: number, onCommit: (value: number) => void, signal: AbortSignal, fallback = DEFAULT_LOG_LIMIT) {
  const input = el("input", "aw-in aw-mono aw-w84")
  input.type = "number"
  input.min = "1"
  input.max = "1000"
  input.value = String(value)
  input.setAttribute("aria-label", label)
  input.addEventListener("change", () => {
    const next = Math.min(1000, Math.max(1, Math.round(Number(input.value) || fallback)))
    input.value = String(next)
    onCommit(next)
  }, { signal })
  return input
}

function profileCard(ctx: Ctx): HTMLElement {
  const config = ctx.state().config
  const section = card()
  const status = el("p", "aw-hint")
  status.setAttribute("role", "status")
  const saved = el("select", "aw-sel aw-grow")
  saved.setAttribute("aria-label", "Active profile")
  const load = button("aw-btn aw-sec", "Load", () => {
    if (saved.value === ctx.state().config.profile.id) return
    ctx.selectProfile(saved.value)
    ctx.go("settings")
  }, ctx.signal)
  load.setAttribute("aria-label", "Load profile")
  const refreshProfiles = () => {
    const current = ctx.state().config
    saved.replaceChildren()
    for (const profile of [current.profile, ...(current.savedProfiles ?? []).map(item => item.profile).filter(item => item.id !== current.profile.id)]) {
      const option = el("option", "", profile.name)
      option.value = profile.id
      saved.append(option)
    }
    saved.value = current.profile.id
    load.disabled = true
  }
  refreshProfiles()
  // Selecting is not switching: the reference gives the switch its own button, so reading the list
  // never throws away the live profile's unsaved endpoints and rules.
  saved.addEventListener("change", () => { load.disabled = saved.value === ctx.state().config.profile.id }, { signal: ctx.signal })
  // A profile takes its endpoints and rules with it and there is no undo, so this one asks first.
  const remove = button("aw-btn aw-dst", "Delete", () => {
    const current = ctx.state().config
    const last = !(current.savedProfiles ?? []).some(item => item.profile.id !== current.profile.id)
    void confirmDialog(remove, "Delete profile",
      `"${current.profile.name}" and its endpoints and rules are removed.${last ? " It is the last profile, so an empty one takes its place." : ""}`,
      "Delete", ctx.signal).then(confirmed => {
        if (!confirmed) return
        ctx.deleteProfile(ctx.state().config.profile.id)
        ctx.go("settings")
      })
  }, ctx.signal)
  remove.setAttribute("aria-label", "Delete profile")

  const nameInput = el("input", "aw-in aw-grow")
  nameInput.value = config.profile.name
  const nameLabel = el("label", "aw-lbl", "Name")
  nameLabel.htmlFor = (nameInput.id = `aw-set-${++fieldSeq}`)
  const save = button("aw-btn aw-pri", "Save", () => {
    const name = nameInput.value.trim() || ctx.state().config.profile.name
    ctx.saveProfile(name)
    status.textContent = `"${name}" holds this configuration; switching away and back returns to it.`
    refreshProfiles()
  }, ctx.signal)
  save.setAttribute("aria-label", "Save profile")
  save.prepend(icon("save", "aw-i14"))
  // The reference shows one Save. Keeping a copy is the other half of the same field, and the two
  // differ in what happens to the live profile, so the second one is spelled out rather than
  // guessed from whether the name was edited.
  const copy = button("aw-btn aw-out", "Save as copy", () => {
    const live = ctx.state().config.profile
    const name = nameInput.value.trim()
    if (!name || name === live.name) {
      status.textContent = "Give the copy a name of its own."
      nameInput.focus()
      return
    }
    ctx.saveProfileAs(name)
    status.textContent = `Saved "${name}" as a separate profile. Load it above to switch.`
    refreshProfiles()
  }, ctx.signal)
  const saveBlock = el("div", "aw-inset aw-col aw-gap8")
  saveBlock.append(
    el("span", "aw-xs aw-mu", "Save current config as profile"),
    nameLabel,
    group("aw-row aw-gap6", nameInput, save, copy),
  )

  const exportButton = button("aw-btn aw-out aw-w", "Export profile + endpoints", () => {
    status.textContent = `Exported ${downloadJson(ctx.exportConfig(), ctx.state().config.profile.name)}.`
  }, ctx.signal)
  exportButton.prepend(icon("upload", "aw-i14"))

  section.append(
    group("aw-row aw-gap8", icon("save"), cardHeading("Profiles")),
    group("aw-fld", el("span", "aw-lbl", "Active profile"), group("aw-row aw-gap6", saved, load, remove)),
    saveBlock,
    exportButton,
    status,
  )
  return section
}

/** The reference lists the five rule modules; the recorder is the app's sixth switchable surface. */
const MODULE_ROWS = [...MODULES.map((module) => ({ id: module.id as ScreenId, title: module.title })), {
  id: "record" as ScreenId,
  title: "Recorder",
}]

function modulesCard(ctx: Ctx): HTMLElement {
  const section = el("section", "aw-card aw-col aw-modules")
  const list = el("div", "aw-list")
  const settingsOf = () => ctx.state().config.profile.settings
  const write = (patch: Partial<Profile["settings"]>) =>
    updateProfile(ctx, { settings: { ...settingsOf(), ...patch } })
  for (const { id, title } of MODULE_ROWS) {
    const enabled = moduleEnabled(ctx.state().config.profile, id)
    const head = el("div", "aw-row")
    head.append(
      icon(SCREENS[id].icon),
      el("span", "aw-grow aw-medium", title),
      switchBox(title, enabled, (value) => {
        // A module that is off has no tab and no Home card, so it must not keep working either.
        if (!value) {
          const kind = RULE_MODULES.find((rule) => rule === id)
          if (kind) ctx.setModuleActive(kind, false)
          if (id === "record" && ctx.state().recording) ctx.stopRecording()
        }
        write({ enabledModules: { ...settingsOf().enabledModules, [id]: value } })
        ctx.go("settings")
      }, ctx.signal),
    )
    // Only the modules that keep a log of their own carry settings under their name.
    const extras: Node[] = []
    if (id === "mock" || id === "intercept" || id === "chaos") {
      const label = id === "chaos" ? "Max chaos log entries" : "Max traffic log entries"
      const input = limitInput(`${label} (${title})`, logLimit(ctx.state().config.profile, id), (value) => {
        write({ logLimits: { ...settingsOf().logLimits, [id]: value } })
      }, ctx.signal)
      const reset = button("aw-btn aw-gh aw-sm", "Reset", () => {
        input.value = String(DEFAULT_LOG_LIMIT)
        write({ logLimits: { ...settingsOf().logLimits, [id]: DEFAULT_LOG_LIMIT } })
      }, ctx.signal)
      reset.setAttribute("aria-label", `Reset ${label.toLowerCase()} (${title})`)
      reset.prepend(icon("reset", "aw-i12"))
      const row = inlineField(label, input, reset)
      row.classList.add("aw-modopt")
      extras.push(row)
    }
    if (id === "record") {
      const captures = limitInput("Max captures (Recorder)",
        settingsOf().recorderLimit ?? DEFAULT_RECORD_LIMIT,
        (value) => write({ recorderLimit: value }), ctx.signal, DEFAULT_RECORD_LIMIT)
      const resetCaptures = button("aw-btn aw-gh aw-sm", "Reset", () => {
        captures.value = String(DEFAULT_RECORD_LIMIT)
        write({ recorderLimit: DEFAULT_RECORD_LIMIT })
      }, ctx.signal)
      resetCaptures.setAttribute("aria-label", "Reset max captures (Recorder)")
      resetCaptures.prepend(icon("reset", "aw-i12"))
      const row = inlineField("Max captures", captures, resetCaptures)
      row.classList.add("aw-modopt")
      const tester = group("aw-chk aw-xs aw-modopt",
        toggleBox("Include tester traffic", settingsOf().recorderIncludeTester === true, (value) => {
          write({ recorderIncludeTester: value })
          ctx.go("settings")
        }, ctx.signal),
        document.createTextNode("Include tester traffic"))
      extras.push(row, tester)
    }
    if (id === "intercept") {
      const bodies = group("aw-chk aw-xs aw-modopt",
        toggleBox("Store response bodies in traffic log", settingsOf().storeResponseBodies === true, (value) => {
          write({ storeResponseBodies: value })
          ctx.go("settings")
        }, ctx.signal),
        document.createTextNode("Store response bodies in traffic log"))
      extras.push(bodies)
    }
    if (!extras.length) head.classList.add("aw-mod")
    list.append(extras.length ? group("aw-col aw-mod", head, ...extras) : head)
  }
  section.append(group("aw-row aw-gap8", icon("layout"), cardHeading("Modules")), list)
  return section
}

function globalsCard(ctx: Ctx): HTMLElement {
  const roots = () => ctx.state().config.profile.settings.globalRoots ?? []
  const results = el("div", "aw-card aw-list")
  const status = el("p", "aw-hint")
  status.setAttribute("role", "status")
  const show = (candidates: ContextCandidate[]) => {
    results.replaceChildren()
    for (const candidate of candidates.slice(0, 40))
      results.append(group("aw-li aw-xs",
        el("span", "aw-grow aw-tr aw-mono", candidate.key),
        el("span", "aw-mu", candidate.preview)))
    if (!candidates.length)
      results.replaceChildren(el("div", "aw-empty", roots().length ? "Nothing found under these roots." : "No roots named yet."))
  }
  const scan = () => {
    const found = scanPage(["global"], roots())
    show(found)
    status.textContent = roots().length
      ? `${found.length} value${found.length === 1 ? "" : "s"} under ${roots().join(", ")}. Previews are masked; Test → Scan page starts from these roots.`
      : "Name a root object to scan, such as window's own app or config global."
  }
  const input = el("input", "aw-in aw-mono aw-grow")
  input.value = roots().join(", ")
  input.setAttribute("aria-label", "Global roots (comma separated)")
  input.addEventListener("change", () => {
    updateProfile(ctx, {
      settings: {
        ...ctx.state().config.profile.settings,
        globalRoots: input.value.split(",").map(item => item.trim()).filter(Boolean),
      },
    })
    scan()
  }, { signal: ctx.signal })
  const rescan = button("aw-btn aw-out aw-sm", "Scan", scan, ctx.signal)
  rescan.setAttribute("aria-label", "Scan page globals")
  rescan.prepend(icon("search", "aw-i12"))
  const box = disclosure("Page context globals", group("aw-row aw-gap6", input, rescan), status, results)
  box.classList.add("aw-card", "aw-cp")
  box.querySelector("summary")?.append(el("span", "aw-xs aw-mu", "Scanned for auto-detection"))
  scan()
  return box
}

function aboutCard(ctx: Ctx): HTMLElement {
  const section = card()
  const status = el("p", "aw-hint")
  status.setAttribute("role", "status")
  const newest = ctx.state().newestVersion
  const check = button("aw-btn aw-out aw-sm", "Check for update", () => {
    check.disabled = true
    status.textContent = "Checking the build recorded for this origin…"
    void ctx.checkForUpdate().then(message => { status.textContent = message; check.disabled = false })
  }, ctx.signal)
  check.prepend(icon("refresh", "aw-i14"))
  const clear = button("aw-btn aw-dst aw-sm", "Clear stored data", () => {
    void confirmDialog(clear, "Clear stored data",
      "Removes this origin's saved configuration — every profile, endpoint, rule and plan — and restarts the panel on an empty profile. Export first if you want a copy.",
      "Clear", ctx.signal).then(confirmed => {
        if (!confirmed) return
        void ctx.clearStoredData().then(() => ctx.go("settings"))
      })
  }, ctx.signal)
  clear.prepend(icon("trash", "aw-i14"))
  section.append(
    group("aw-row aw-gap8", icon("info"), cardHeading("About API Workbench")),
    group("aw-row aw-xs", el("span", "aw-mu aw-w64", "Version"), el("span", "aw-bd aw-s aw-mono", ctx.version)),
    group("aw-row aw-xs", el("span", "aw-mu aw-w64", "Cache"),
      group("aw-row aw-gap6", document.createTextNode("Not cached"), el("span", "aw-mu", "(inline bookmarklet)"))),
    group("aw-row aw-xs", el("span", "aw-mu aw-w64", "Newest"),
      el("span", "aw-mu", newest ? (newest === ctx.version ? "this build" : `${newest} has run on this origin`) : "not recorded yet")),
    group("aw-row aw-gap6", check, clear),
    status,
  )
  return section
}

function settings(ctx: Ctx): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const config = ctx.state().config
  const limit = el("input", "aw-in aw-mono aw-w100")
  limit.type = "number"
  limit.min = "1"
  limit.max = "1000000"
  limit.value = String(config.profile.settings.bodyLimitKb)
  limit.addEventListener("change", () => {
    const value = Math.min(1000000, Math.max(1, Math.round(Number(limit.value) || 1)))
    limit.value = String(value)
    updateProfile(ctx, { settings: { ...ctx.state().config.profile.settings, bodyLimitKb: value } })
  }, { signal: ctx.signal })
  const core = card()
  core.append(
    group("aw-row aw-gap8", icon("cpu"), cardHeading("Core")),
    inlineField("Body-check size limit (KB)", limit),
  )
  const environments = disclosure("Environments", environmentFields(ctx, "settings"))
  environments.classList.add("aw-card", "aw-cp")
  environments.open = true
  screen.append(
    profileCard(ctx),
    modulesCard(ctx),
    core,
    environments,
    globalsCard(ctx),
    aboutCard(ctx),
    el("p", "aw-hint", "Profiles are saved to this page origin. Switching environments changes host mappings, not endpoint paths."),
  )
  return screen
}

export function renderScreen(ctx: Ctx, id: ScreenId): HTMLElement {
  if (id === "home") return home(ctx)
  if (id === "test") return testScreen(ctx)
  if (id === "results") return resultsScreen(ctx)
  if (id === "endpoints") return endpoints(ctx)
  if (id === "settings") return settings(ctx)
  if (id === "record") return recordScreen(ctx)
  if (id === "import") return importScreen(ctx)
  if (id === "mock") return mockScreen(ctx)
  if (id === "chaos") return chaosScreen(ctx)
  if (id === "intercept") return interceptScreen(ctx)
  if (id === "route") return routeScreen(ctx)
  return home(ctx)
}
