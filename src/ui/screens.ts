import { el, icon, button, confirmDialog, iconButton, card, caption, group, labeled, labeledAction, formatJsonButton, disclosure, downloadJson, type IconName } from "./dom"
import { nameFromHost, pageProfileName, type Endpoint, type HeaderValue, type Profile, type Rule, type RuleKind, type TestPlan, type WorkbenchConfig } from "../core/model"
import type { RuleActivity } from "../network/rules"
import type { PausedEntry } from "../breakpoints/registry"
import { chaosScreen, interceptScreen, mockScreen, routeScreen } from "./rule-screens"
import type { OnceResult } from "../tester/once"
import type { RunState } from "../tester/run"
import { resultsScreen, testScreen } from "./test-screens"
import type { Recording } from "../recorder/recorder"
import { candidatesFrom, type Candidate } from "../recorder/promote"
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

export type UIState = {
  screen: ScreenId
  minimized: boolean
  observed: number
  activity: string
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
  ) => void
  saveRule: (rule: Rule) => void
  deleteRule: (id: string) => void
  toggleRule: (id: string, enabled: boolean) => void
  setModuleActive: (kind: RuleKind, value: boolean) => void
  resetSequence: (ruleId: string) => void
  /** Next creation sequence for a new rule; ties on priority resolve by it. */
  nextRuleSeq: () => number
  continueAllPaused: () => void
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

function unavailable(label: string, reason: string): HTMLButtonElement {
  const control = el("button", "aw-btn aw-out aw-sm", label)
  control.type = "button"
  control.disabled = true
  control.title = reason
  return control
}

function updateProfile(ctx: Ctx, patch: Partial<Profile>) {
  const profile = ctx.state().config.profile
  ctx.updateProfile({ ...profile, ...patch, revision: profile.revision + 1, updatedAt: Date.now() })
}

function headerFields(ctx: Ctx, values: HeaderValue[], save: (headers: HeaderValue[]) => void): HTMLElement {
  const section = el("div", "aw-col aw-gap10")
  const rows = el("div", "aw-col aw-gap6")
  let headers = values.map(header => ({ ...header }))
  const render = () => {
    rows.replaceChildren()
    for (const header of headers) {
      const name = el("input", "aw-in aw-mono")
      name.value = header.name
      name.placeholder = "Header name"
      name.setAttribute("aria-label", "Header name")
      const value = el("input", "aw-in aw-mono")
      value.value = header.value
      value.placeholder = "Header value"
      value.setAttribute("aria-label", "Header value")
      const commit = () => { header.name = name.value; header.value = value.value; save(headers.map(item => ({ ...item }))) }
      name.addEventListener("change", commit, { signal: ctx.signal })
      value.addEventListener("change", commit, { signal: ctx.signal })
      rows.append(group("aw-header-row", name, value, iconButton("aw-btn aw-gh aw-ic", "close", "Remove header", () => {
        headers = headers.filter(item => item !== header)
        save(headers.map(item => ({ ...item })))
        render()
      }, ctx.signal)))
    }
  }
  const add = button("aw-btn aw-out aw-sm aw-self", "Add header", () => {
    headers.push({ name: "", value: "" })
    render()
    rows.lastElementChild?.querySelector("input")?.focus()
  }, ctx.signal)
  add.prepend(icon("plus", "aw-i14"))
  render()
  section.append(rows, add)
  return section
}

function moduleCard(ctx: Ctx, module: (typeof MODULES)[number]): HTMLElement {
  const section = card()
  const tile = el("div", "aw-tile")
  tile.append(icon(SCREENS[module.id].icon))
  const ready = module.id === "test"
  // Reference card: title + state badge, a stat line, and the module's own actions below.
  const badge = el("span", "aw-bd")
  const dot = el("span", "aw-dot")
  const badgeLabel = document.createTextNode(ready ? "Ready" : "Inactive")
  badge.append(dot, badgeLabel)
  const summary = el("div", "aw-xs aw-mu")
  const open = button("aw-btn aw-gh aw-sm", "Open", () => ctx.go(module.id), ctx.signal)
  open.setAttribute("aria-label", `Open ${module.title}`)
  open.append(icon("right"))
  const actions = el("div", "aw-row aw-actions")
  if (ready) {
    actions.append(button("aw-btn aw-pri aw-sm", "Run", () => ctx.go("test"), ctx.signal),
      button("aw-btn aw-out aw-sm", "History", () => ctx.go("test"), ctx.signal))
    ctx.watch(state => {
      const runs = state.testerHistory.length
      summary.textContent = `${state.config.endpoints.length} endpoint${state.config.endpoints.length === 1 ? "" : "s"} · ${runs ? `${runs} run${runs === 1 ? "" : "s"}` : "no runs yet"}`
    })
  } else {
    const kind = module.id as RuleKind
    actions.append(button("aw-btn aw-out aw-sm", kind === "chaos" ? "Configure" : "Manage rules", () => ctx.go(module.id), ctx.signal))
    ctx.watch(state => {
      const rules = (state.config.rules ?? []).filter(rule => rule.kind === kind)
      const enabled = rules.filter(rule => rule.enabled).length
      const on = state.moduleActive[kind]
      badgeLabel.textContent = on ? "Active" : "Inactive"
      dot.className = on ? "aw-dot aw-a" : "aw-dot"
      const hits = rules.reduce((total, rule) => total + (state.ruleHits[rule.id] ?? 0), 0)
      summary.textContent = `${rules.length} rule${rules.length === 1 ? "" : "s"} · ${enabled} enabled · ${hits} hit${hits === 1 ? "" : "s"}`
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
    ctx.createProfileFromRecordings(profileName.value, chosen.map(draft => draft.endpoint), hosts)
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

function runHistory(ctx: Ctx): HTMLElement {
  const history = el("div", "aw-card aw-list")
  history.setAttribute("aria-label", "Run history")
  let previous: Readonly<UIState>["testerHistory"] | undefined
  ctx.watch(state => {
    if (previous === state.testerHistory) return
    previous = state.testerHistory
    history.replaceChildren()
    for (const item of state.testerHistory) {
      const name = state.config.endpoints.find(endpoint => endpoint.id === item.endpointId)?.name ?? "Endpoint"
      history.append(group("aw-li aw-xs", el("span", `aw-bd ${item.outcome === "passed" ? "aw-gr" : "aw-rd"}`, item.outcome),
        el("span", "aw-grow aw-tr", name), el("span", "aw-num", `${item.status ?? "—"} · ${item.durationMs} ms`)))
    }
    if (!history.children.length) history.append(el("div", "aw-empty", "No runs yet. Run an endpoint from Test."))
  })
  return history
}

/** The last thing the interception layer reported, including the failures a rule cannot fix
 * (an opaque cross-origin response, a refused route) that the user would otherwise never see. */
function activityLog(ctx: Ctx): HTMLElement {
  const section = card()
  const activity = el("pre", "aw-code aw-wrap", "No requests observed.")
  ctx.watch(state => {
    activity.textContent = state.observed
      ? `${state.observed} observed\n${state.activity}`
      : "No requests observed."
  })
  section.append(el("span", "aw-cap", "Activity"), activity)
  return section
}

function home(ctx: Ctx): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const modules = el("div", "aw-col aw-gap12")
  for (const module of MODULES) modules.append(moduleCard(ctx, module))
  const quick = el("div", "aw-g3")
  for (const id of ["endpoints", "record", "import", "settings"] as const) quick.append(quickAction(ctx, id))
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
        bodyKind: body.value ? (endpoint.request.bodyKind === "none" ? "text" : endpoint.request.bodyKind) : "none",
        headers: draft.request.headers.filter(header => header.name.trim()) }, updatedAt: Date.now() })
    cancel()
  }
  const request = card()
  request.append(caption("Request"), group("aw-g2", labeled("Method", method), labeled("Path", path)),
    el("span", "aw-lbl", "Headers"), headerFields(ctx, draft.request.headers, headers => { draft.request.headers = headers }),
    disclosure(`Inherited from global · ${ctx.state().config.profile.globalHeaders.length}`,
      el("pre", "aw-code aw-wrap", ctx.state().config.profile.globalHeaders.map(header => `${header.name}: ${header.value}`).join("\n") || "No global headers.")),
    labeledAction("Body", body, formatJsonButton(body, ctx.signal)))
  const sample = el("pre", "aw-code aw-wrap", endpoint.sampleResponse?.body ?? "No saved response sample. Record a request to capture one.")
  // Formatting the sample edits the draft, so Save keeps the indented copy.
  const formatSample = formatJsonButton({
    read: () => draft.sampleResponse?.body ?? "",
    write: value => {
      draft.sampleResponse = { status: 0, headers: [], ...draft.sampleResponse, body: value }
      sample.textContent = value
    },
  }, ctx.signal)
  const response = disclosure("Response sample",
    group("aw-row aw-actions", el("span", "aw-lbl aw-grow", "Body"), formatSample), sample)
  const checks = disclosure(`Checks · ${endpoint.checks.length}`, el("pre", "aw-code aw-wrap", JSON.stringify(endpoint.checks, null, 2)))
  section.append(group("aw-row", el("span", "aw-h aw-grow", "Edit endpoint"), el("span", `aw-bd aw-m aw-${endpoint.request.method}`, endpoint.request.method)),
    group("aw-g2", labeled("Name", name), labeled("Alias", alias)), request, response, checks,
    labeled("Host key", host), notice)
  ctx.chrome({ title: endpoint.name, onBack: cancel,
    actions: [button("aw-btn aw-pri aw-grow", "Save endpoint", save, ctx.signal), button("aw-btn aw-out aw-grow", "Cancel", cancel, ctx.signal)] })
  section.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); cancel() } }, { signal: ctx.signal })
  return section
}

function endpoints(ctx: Ctx): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const config = ctx.state().config
  const headers = disclosure(`Global headers · ${config.profile.globalHeaders.length}`,
    el("p", "aw-hint", "Applied to all requests. Changes are saved automatically."),
    headerFields(ctx, config.profile.globalHeaders, globalHeaders => updateProfile(ctx, { globalHeaders })),
    group("aw-row aw-actions", unavailable("Presets…", "Header presets are coming later"), unavailable("Promote common", "Common-header review is coming later")))
  headers.classList.add("aw-card", "aw-cp")
  headers.open = true
  const title = group("aw-row", el("span", "aw-h", "Endpoints"), el("span", "aw-bd aw-s", String(config.endpoints.length)), el("span", "aw-grow"))
  const add = button("aw-btn aw-pri aw-sm", "Add endpoint", () => { ctx.addEndpoint(); ctx.go("endpoints") }, ctx.signal)
  add.prepend(icon("plus", "aw-i14"))
  title.append(add)
  const list = el("div", "aw-card aw-list")
  for (const [index, endpoint] of config.endpoints.entries()) {
    const row = el("div", "aw-col aw-gap2 aw-endpoint-row")
    const editEndpoint = () => {
      const editor = endpointEditor(ctx, ctx.state().config.endpoints.find(item => item.id === endpoint.id) ?? endpoint)
      screen.replaceChildren(editor)
      screen.closest(".aw-body")?.scrollTo(0, 0)
      editor.querySelector<HTMLInputElement>('[aria-label="Name"]')?.focus({ preventScroll: true })
    }
    const name = button("aw-endpoint-name aw-grow aw-tr", endpoint.name, editEndpoint, ctx.signal)
    name.title = endpoint.name
    const move = (direction: "up" | "down") => { ctx.reorderEndpoint(endpoint.id, direction); ctx.go("endpoints") }
    const up = iconButton("aw-btn aw-gh aw-ic aw-xs2", "up", "Move up", () => move("up"), ctx.signal)
    up.disabled = index === 0
    const down = iconButton("aw-btn aw-gh aw-ic aw-xs2", "down", "Move down", () => move("down"), ctx.signal)
    down.disabled = index === config.endpoints.length - 1
    const line = group("aw-row aw-gap8", el("span", `aw-bd aw-m aw-${endpoint.request.method}`, endpoint.request.method), name, up, down,
      iconButton("aw-btn aw-gh aw-ic aw-xs2", "edit", "Edit", editEndpoint, ctx.signal),
      iconButton("aw-btn aw-gh aw-ic aw-xs2", "trash", "Delete", () => { ctx.deleteEndpoint(endpoint.id); ctx.go("endpoints") }, ctx.signal))
    const path = el("span", "aw-grow aw-tr aw-mono aw-xs aw-mu", endpoint.request.path)
    path.title = endpoint.request.path
    const checks = el("span", "aw-row aw-xs aw-mu", String(endpoint.checks.length))
    checks.prepend(icon("list", "aw-i12"))
    checks.title = `${endpoint.checks.length} checks`
    row.append(line, group("aw-row aw-endpoint-meta", path, checks))
    list.append(row)
  }
  if (!config.endpoints.length) list.append(el("div", "aw-empty", "No endpoints yet. Add one or import a profile to get started."))
  // A committed import lands here and states what it saved, once.
  const imported = takeImportSummary()
  const summary = el("p", "aw-hint", imported)
  summary.setAttribute("role", "status")
  summary.hidden = !imported
  const environments = disclosure("Base URLs", environmentFields(ctx, "endpoints"))
  environments.classList.add("aw-card", "aw-cp")
  environments.open = true
  screen.append(headers, title, summary, list, environments)
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

function settings(ctx: Ctx): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const config = ctx.state().config
  const status = el("p", "aw-hint")
  status.setAttribute("role", "status")
  const profileName = el("input", "aw-in aw-grow")
  profileName.value = config.profile.name
  profileName.setAttribute("aria-label", "Name")
  const save = button("aw-btn aw-pri aw-sm", "Save profile", () => {
    updateProfile(ctx, { name: profileName.value.trim() || config.profile.name })
    status.textContent = "Profile saved."
    refreshProfiles()
  }, ctx.signal)
  const saved = el("select", "aw-sel aw-grow")
  // labeledAction() puts the delete control outside a <label>, so the select carries its own
  // accessible name; it repeats the visible text rather than contradicting it.
  const refreshProfiles = () => {
    const current = ctx.state().config
    saved.replaceChildren()
    for (const profile of [current.profile, ...(current.savedProfiles ?? []).map(item => item.profile).filter(item => item.id !== current.profile.id)]) {
      const option = el("option", "", profile.name)
      option.value = profile.id
      saved.append(option)
    }
    saved.value = current.profile.id
  }
  saved.setAttribute("aria-label", "Active profile")
  refreshProfiles()
  // A red, labelled button, like the rule editors' Delete: an icon-only ghost control read as
  // decoration next to the selector.
  const remove = button("aw-btn aw-dst aw-sm", "Delete profile", () => {
    const current = ctx.state().config
    const last = !(current.savedProfiles ?? []).some(item => item.profile.id !== current.profile.id)
    // A profile takes its endpoints and rules with it and there is no undo, so this one asks first.
    void confirmDialog(remove, "Delete profile",
      `"${current.profile.name}" and its endpoints and rules are removed.${last ? " It is the last profile, so an empty one takes its place." : ""}`,
      "Delete", ctx.signal).then(confirmed => {
        if (!confirmed) return
        ctx.deleteProfile(ctx.state().config.profile.id)
        ctx.go("settings")
      })
  }, ctx.signal)
  remove.prepend(icon("trash", "aw-i14"))
  saved.addEventListener("change", () => { ctx.selectProfile(saved.value); ctx.go("settings") }, { signal: ctx.signal })
  const saveAsName = el("input", "aw-in aw-grow")
  saveAsName.placeholder = "New profile name"
  saveAsName.setAttribute("aria-label", "New profile name")
  const saveAs = button("aw-btn aw-out aw-sm", "Save as profile", () => {
    if (!saveAsName.value.trim()) { status.textContent = "Enter a new profile name."; saveAsName.focus(); return }
    ctx.saveProfileAs(saveAsName.value)
    saveAsName.value = ""
    refreshProfiles()
    status.textContent = "Profile copy saved. Select it above to switch."
  }, ctx.signal)
  const profile = card()
  // Three adjacent text fields need visible labels, not just accessible names.
  const saveAsBlock = el("div", "aw-inset aw-col aw-gap10")
  saveAsBlock.append(el("span", "aw-lbl", "Save current config as a new profile"), group("aw-row", saveAsName, saveAs))
  profile.append(group("aw-row", icon("book"), el("span", "aw-lbl", "Profiles")),
    labeledAction("Active profile", saved, remove),
    group("aw-col aw-gap6", el("span", "aw-lbl", "Profile name"), group("aw-row", profileName, save)),
    saveAsBlock, status,
    el("div", "aw-xs aw-mu", `Origin-scoped storage · ${ctx.state().storageReady ? "IndexedDB available" : "session fallback"}`),
    button("aw-btn aw-out aw-sm", "Export profile + endpoints", () => {
      status.textContent = `Exported ${downloadJson(ctx.exportConfig(), ctx.state().config.profile.name)}.`
    }, ctx.signal))
  const environments = disclosure("Environments", environmentFields(ctx, "settings"))
  environments.classList.add("aw-card", "aw-cp")
  environments.open = true
  const limit = el("input", "aw-in aw-mono")
  limit.type = "number"
  limit.min = "1"
  limit.value = String(config.profile.settings.bodyLimitKb)
  limit.setAttribute("aria-label", "Body-check size limit (KB)")
  limit.addEventListener("change", () => {
    const value = Math.max(1, Math.round(Number(limit.value) || 1))
    limit.value = String(value)
    updateProfile(ctx, { settings: { ...ctx.state().config.profile.settings, bodyLimitKb: value } })
  }, { signal: ctx.signal })
  const core = card()
  core.append(group("aw-row", icon("gear"), el("span", "aw-lbl", "Core")), labeled("Body-check size limit (KB)", limit))
  screen.append(profile, environments, core,
    el("p", "aw-hint", "Profiles are saved to this page origin. Switching environments changes host mappings, not endpoint paths."))
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
