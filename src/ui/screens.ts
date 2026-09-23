import { el, icon, button, iconButton, type IconName } from "./dom"
import { type Endpoint, type HeaderValue, type Profile, type WorkbenchConfig } from "../core/model"
import type { OnceResult } from "../tester/once"
import type { Recording } from "../recorder/recorder"

export type ScreenId =
  | "home"
  | "test"
  | "mock"
  | "intercept"
  | "route"
  | "chaos"
  | "endpoints"
  | "import"
  | "settings"

export type UIState = {
  screen: ScreenId
  minimized: boolean
  observed: number
  activity: string
  mockEnabled: boolean
  mockDelay: number
  config: WorkbenchConfig
  storageReady: boolean
  testerResult?: OnceResult
  testerHistory: OnceResult[]
  recording: boolean
  recordings: Recording[]
}

export type Ctx = {
  version: string
  state: () => Readonly<UIState>
  go: (screen: ScreenId) => void
  /** Runs now and after every state change; disposed when the screen is replaced. */
  watch: (listener: (state: Readonly<UIState>) => void) => void
  /** Retitles the sub-header, redirects Back and fills the footer action bar for this screen. */
  chrome: (options: { title?: string; onBack?: () => void; actions?: Node[] }) => void
  setMock: (enabled: boolean) => void
  setDelay: (ms: number) => void
  signal: AbortSignal
  addEndpoint: () => void
  updateEndpoint: (endpoint: Endpoint) => void
  deleteEndpoint: (id: string) => void
  updateProfile: (profile: Profile) => void
  exportConfig: () => string
  runOnce: (endpointId: string) => void
  saveProfileAs: (name: string) => void
  selectProfile: (id: string) => void
  importConfig: (serialized: string) => string | undefined
  reorderEndpoint: (id: string, direction: "up" | "down") => void
  startRecording: () => void
  stopRecording: () => void
  resetRecorder: () => void
  promoteRecording: (recording: Recording) => void
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
      "Header, body and status edits plus JSON Patch",
      "Transform outcome log with a rule trace",
      "Request and response breakpoints (M7)",
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
  { id: "test", title: "API Tester", milestone: "M3" },
  { id: "mock", title: "Mock Server", milestone: "M5" },
  { id: "intercept", title: "API Interceptor", milestone: "M6" },
  { id: "route", title: "Page Routing", milestone: "M6" },
  { id: "chaos", title: "Chaos Engineering", milestone: "M5" },
] as const

function card(): HTMLElement {
  const section = el("section", "aw-card aw-cp aw-col aw-gap12")
  return section
}

function caption(text: string): HTMLElement {
  return el("div", "aw-cap aw-capl", text)
}
function group(className: string, ...children: Node[]): HTMLElement {
  const element = el("div", className)
  element.append(...children)
  return element
}

function labeled(label: string, input: HTMLElement): HTMLElement {
  const wrapper = el("label", "aw-fld")
  wrapper.append(el("span", "aw-lbl", label), input)
  return wrapper
}

function disclosure(title: string, ...children: Node[]): HTMLDetailsElement {
  const details = el("details", "aw-col aw-gap10")
  const summary = el("summary", "aw-coll", title)
  summary.prepend(icon("right", "aw-i14"))
  details.append(summary, group("aw-col aw-gap10", ...children))
  return details
}

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

/** The M0 feasibility control: one exact GET matcher, kept until the M5 mock engine replaces it. */
function feasibility(ctx: Ctx): HTMLElement {
  const section = card()
  const head = el("div", "aw-row")
  const badge = el("span", "aw-bd")
  const dot = el("span", "aw-dot")
  badge.append(dot, document.createTextNode("Inactive"))
  head.append(el("span", "aw-cap aw-grow", "Feasibility experiment · M0"), badge)
  const target = el("code", "aw-mono aw-xs", "GET /api/mock-target")

  const toggle = el("label", "aw-chk")
  const checkbox = el("input")
  checkbox.type = "checkbox"
  checkbox.checked = ctx.state().mockEnabled
  checkbox.addEventListener("change", () => ctx.setMock(checkbox.checked), { signal: ctx.signal })
  toggle.append(checkbox, document.createTextNode("Enable mock · sends no network request"))

  const field = el("label", "aw-fld")
  field.append(el("span", "aw-lbl", "Mock delay (0–10,000 ms)"))
  const delay = el("input", "aw-in")
  delay.type = "number"
  delay.min = "0"
  delay.max = "10000"
  delay.step = "1"
  delay.value = String(ctx.state().mockDelay)
  delay.addEventListener(
    "change",
    () => {
      ctx.setDelay(Number(delay.value))
      delay.value = String(ctx.state().mockDelay)
    },
    { signal: ctx.signal },
  )
  field.append(delay)

  const status = el("p", "aw-hint")
  status.setAttribute("role", "status")
  const activity = el("pre", "aw-code aw-wrap", "No requests observed.")

  ctx.watch((state) => {
    badge.lastChild!.textContent = state.mockEnabled ? "Mock active" : "Inactive"
    dot.className = state.mockEnabled ? "aw-dot aw-g" : "aw-dot"
    status.textContent = state.mockEnabled
      ? "Mock active · GET /api/mock-target"
      : "Mock inactive · current-frame fetch / XHR"
    activity.textContent = state.observed
      ? `${state.observed} observed\n${state.activity}`
      : "No requests observed."
    if (checkbox.checked !== state.mockEnabled) checkbox.checked = state.mockEnabled
  })
  section.append(head, target, toggle, field, status, activity)
  return section
}

function moduleCard(ctx: Ctx, module: (typeof MODULES)[number]): HTMLElement {
  const section = card()
  const tile = el("div", "aw-tile")
  tile.append(icon(SCREENS[module.id].icon))
  const ready = module.id === "test"
  // Reference card: title + state badge, a stat line, and the module's own actions below.
  const badge = el("span", "aw-bd")
  badge.append(el("span", "aw-dot"), document.createTextNode(ready ? "Ready" : "Inactive"))
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
    actions.append(button("aw-btn aw-out aw-sm", module.id === "chaos" ? "Configure" : "Manage rules", () => ctx.go(module.id), ctx.signal))
    summary.textContent = "0 rules · rule editor preview, execution coming later"
  }
  section.append(group("aw-row aw-gap10", tile,
    group("aw-grow aw-col aw-gap2", group("aw-row aw-actions", el("span", "aw-h", module.title), badge), summary), open), actions)
  return section
}

function quickAction(ctx: Ctx, id: ScreenId): HTMLElement {
  const action = button("aw-qa", "", () => ctx.go(id), ctx.signal)
  action.append(icon(SCREENS[id].icon, "aw-i20"), el("span", "", SCREENS[id].label))
  return action
}

function recorderPanel(ctx: Ctx): HTMLElement {
  const recorder = card()
  const status = el("span", "aw-bd aw-s")
  status.setAttribute("role", "status")
  const rows = el("div", "aw-col aw-gap6")
  const start = button("aw-btn aw-pri aw-sm", "Start recording", ctx.startRecording, ctx.signal)
  const stop = button("aw-btn aw-out aw-sm", "Stop recording", ctx.stopRecording, ctx.signal)
  const reset = button("aw-btn aw-gh aw-sm", "Reset recorder", ctx.resetRecorder, ctx.signal)
  let previous: Readonly<UIState>["recordings"] | undefined
  ctx.watch(state => {
    status.textContent = state.recording ? `Recording · ${state.recordings.length} captured` : `${state.recordings.length} captured · reviewable draft`
    start.disabled = state.recording
    stop.disabled = !state.recording
    reset.disabled = state.recording || !state.recordings.length
    if (previous === state.recordings) return
    previous = state.recordings
    rows.replaceChildren()
    for (const item of state.recordings.slice(-10).reverse()) {
      const path = el("span", "aw-grow aw-tr aw-mono aw-xs", new URL(item.url).pathname)
      path.title = item.url
      rows.append(group("aw-row", el("span", `aw-bd aw-m aw-${item.method}`, item.method), path,
        el("span", "aw-xs aw-mu", item.response ? String(item.response.status) : item.error ?? "pending"),
        button("aw-btn aw-out aw-sm", "Promote", () => { ctx.promoteRecording(item); ctx.go("endpoints") }, ctx.signal)))
    }
    if (!rows.children.length) rows.append(el("div", "aw-empty", "Start recording, then use the page to capture requests."))
  })
  recorder.append(group("aw-row aw-actions", el("span", "aw-lbl", "Recorder"), status),
    el("p", "aw-hint", "Captures future fetch/XHR traffic in this frame. Sensitive headers are redacted."),
    group("aw-row aw-actions", start, stop, reset), rows)
  return recorder
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

function home(ctx: Ctx): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const modules = el("div", "aw-col aw-gap12")
  for (const module of MODULES) modules.append(moduleCard(ctx, module))
  const quick = el("div", "aw-g3")
  for (const id of ["endpoints", "import", "settings"] as const) quick.append(quickAction(ctx, id))
  const experiment = disclosure("Fixture mock · developer controls", feasibility(ctx))
  experiment.open = true
  screen.append(modules, caption("Quick actions"), quick, recorderPanel(ctx), caption("Run history"), runHistory(ctx), experiment)
  return screen
}

function tester(ctx: Ctx): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const config = ctx.state().config
  const selector = el("select", "aw-sel aw-grow")
  selector.setAttribute("aria-label", "Endpoint to run")
  for (const endpoint of config.endpoints) {
    const option = el("option", "", `${endpoint.request.method} · ${endpoint.name}`)
    option.value = endpoint.id
    selector.append(option)
  }
  if (!config.endpoints.length) selector.append(el("option", "", "No endpoints yet"))
  selector.disabled = !config.endpoints.length
  const run = button("aw-btn aw-pri aw-sm", "Run Once", () => {
    if (!selector.value || run.disabled) return
    run.disabled = true
    status.textContent = "Running request…"
    ctx.runOnce(selector.value)
  }, ctx.signal)
  run.prepend(icon("play", "aw-i14"))
  run.disabled = !config.endpoints.length
  const result = card()
  const status = el("div", "aw-hint", config.endpoints.length ? "Ready for a direct request." : "Add an endpoint before running the tester.")
  status.setAttribute("role", "status")
  const detail = el("pre", "aw-code aw-wrap", "No result yet.")
  let previous = ctx.state().testerResult
  const refresh = (current: OnceResult) => {
    status.textContent = `${current.outcome}${current.status ? ` · HTTP ${current.status}` : ""} · ${current.durationMs} ms${current.error ? ` · ${current.error}` : ""}`
    detail.textContent = `${current.body || current.error || "No response body."}\n\nChecks\n${current.checks.map(check => `${check.state} · ${check.detail}`).join("\n")}`
  }
  if (previous) refresh(previous)
  ctx.watch(state => {
    if (state.testerResult && state.testerResult !== previous) {
      previous = state.testerResult
      refresh(previous)
      run.disabled = !config.endpoints.length
    }
  })
  result.append(caption("Result"), status, detail)
  const once = el("span", "aw-btn aw-on", "Once")
  screen.append(group("aw-row", el("div", "aw-h aw-grow", "API Tester"), button("aw-btn aw-out aw-sm", "Endpoints", () => ctx.go("endpoints"), ctx.signal)),
    group("aw-row aw-actions", group("aw-seg", once, unavailable("Load", "Load testing is not available yet")), el("span", "aw-bd", "Direct")),
    el("p", "aw-hint", "One request using this page’s session. Direct execution bypasses active rules."),
    group("aw-row", selector, run), result, caption("Run history"), runHistory(ctx),
    el("p", "aw-hint", "Load, Flow and Independent execution are coming later."))
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

function endpointEditor(ctx: Ctx, endpoint: Endpoint): HTMLElement {
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
  const cancel = () => ctx.go("endpoints")
  const save = () => {
    if (!name.value.trim() || !alias.value.trim() || !path.value.trim()) {
      notice.textContent = "Enter a name, alias and request path."
      return
    }
    if (ctx.state().config.endpoints.some(item => item.id !== endpoint.id && item.alias === alias.value.trim())) {
      notice.textContent = "Choose an alias that is unique to this profile."
      alias.focus()
      return
    }
    ctx.updateEndpoint({ ...draft, name: name.value.trim(), alias: alias.value.trim(), hostKey: host.value.trim() || "default",
      request: { ...draft.request, method: method.value as Endpoint["request"]["method"], path: path.value.trim(), body: body.value,
        bodyKind: body.value ? (endpoint.request.bodyKind === "none" ? "text" : endpoint.request.bodyKind) : "none",
        headers: draft.request.headers.filter(header => header.name.trim()) }, updatedAt: Date.now() })
    cancel()
  }
  const request = card()
  request.append(caption("Request"), group("aw-g2", labeled("Method", method), labeled("Path", path)),
    el("span", "aw-lbl", "Headers"), headerFields(ctx, draft.request.headers, headers => { draft.request.headers = headers }),
    disclosure(`Inherited from global · ${ctx.state().config.profile.globalHeaders.length}`,
      el("pre", "aw-code aw-wrap", ctx.state().config.profile.globalHeaders.map(header => `${header.name}: ${header.value}`).join("\n") || "No global headers.")), labeled("Body", body))
  const response = disclosure("Response sample", el("pre", "aw-code aw-wrap", endpoint.sampleResponse?.body ?? "No saved response sample. Record a request to capture one."))
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
  const environments = disclosure("Base URLs", environmentFields(ctx, "endpoints"))
  environments.classList.add("aw-card", "aw-cp")
  environments.open = true
  screen.append(headers, title, list, environments)
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
    updateProfile(ctx, { name: profileName.value.trim() || "Default" })
    status.textContent = "Profile saved."
    refreshProfiles()
  }, ctx.signal)
  const saved = el("select", "aw-sel aw-grow")
  // labeled() wraps it in a <label>, so the visible text is the accessible name; an aria-label
  // reading "Saved profile" would contradict the "Active profile" the user sees.
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
  refreshProfiles()
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
  const exported = el("textarea", "aw-ta aw-mono")
  exported.readOnly = true
  exported.setAttribute("aria-label", "Exported profile JSON")
  exported.value = ctx.exportConfig()
  ctx.watch(() => { exported.value = ctx.exportConfig() })
  const profile = card()
  // Three adjacent text fields need visible labels, not just accessible names.
  const saveAsBlock = el("div", "aw-inset aw-col aw-gap10")
  saveAsBlock.append(el("span", "aw-lbl", "Save current config as a new profile"), group("aw-row", saveAsName, saveAs))
  profile.append(group("aw-row", icon("book"), el("span", "aw-lbl", "Profiles")),
    labeled("Active profile", saved),
    group("aw-col aw-gap6", el("span", "aw-lbl", "Profile name"), group("aw-row", profileName, save)),
    saveAsBlock, status,
    el("div", "aw-xs aw-mu", `Origin-scoped storage · ${ctx.state().storageReady ? "IndexedDB available" : "session fallback"}`),
    button("aw-btn aw-out aw-sm", "Export profile + endpoints", () => {
      exported.value = ctx.exportConfig()
      exported.focus()
      exported.select()
      status.textContent = "Export ready. Copy the selected JSON to save it."
    }, ctx.signal), exported)
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

function importScreen(ctx: Ctx): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const source = el("textarea", "aw-ta aw-mono")
  source.setAttribute("aria-label", "Import JSON")
  source.placeholder = "Paste a native API Workbench JSON export"
  source.style.height = "150px"
  // A bare file input keeps its user-agent look inside the shadow root; the label carries the
  // button styling and the input stays the real, accessible control.
  const file = el("input")
  file.type = "file"
  file.accept = ".json,application/json"
  file.setAttribute("aria-label", "Import JSON file")
  const chooseFile = el("label", "aw-btn aw-out")
  chooseFile.append(icon("download", "aw-i14"), document.createTextNode("Choose file"), file)
  const status = el("p", "aw-hint", "Native JSON is available. Other formats are listed below with their current status.")
  status.setAttribute("role", "status")
  file.addEventListener("change", () => {
    const selected = file.files?.[0]
    if (!selected) return
    const reader = new FileReader()
    reader.addEventListener("load", () => { source.value = String(reader.result ?? ""); status.textContent = `Loaded ${selected.name}. Review the JSON before importing.` }, { signal: ctx.signal })
    reader.addEventListener("error", () => { status.textContent = "Could not read the file. Choose it again or paste the JSON." }, { signal: ctx.signal })
    ctx.signal.addEventListener("abort", () => reader.abort(), { once: true })
    reader.readAsText(selected)
  }, { signal: ctx.signal })
  const commit = button("aw-btn aw-pri", "Import JSON", () => {
    const error = ctx.importConfig(source.value)
    status.textContent = error ?? "Imported configuration."
    if (!error) ctx.go("settings")
  }, ctx.signal)
  const input = card()
  input.append(labeled("Paste or load native JSON", source), group("aw-row aw-actions", commit, chooseFile), status)
  const formats = card()
  formats.append(el("div", "aw-lbl", "Supported formats"))
  // Colours follow the reference legend; only the green formats are wired up in this build.
  for (const [format, note, tone] of [
    ["Native", "Profile + endpoints JSON", "aw-gr"], ["Swagger / OpenAPI", "2.0 / 3.0 · coming later", "aw-bl"],
    ["HAR", "1.2 · coming later", "aw-am"], ["Postman", "2.1 · coming later", "aw-vi"],
    ["Recorder", "Current-frame fetch / XHR", "aw-gr"], ["cURL", "DevTools copy · coming later", ""],
    ["fetch()", "DevTools copy · coming later", ""],
  ] as const) formats.append(group("aw-row aw-xs aw-format", el("span", `aw-bd ${tone}`, format), el("span", "aw-mu aw-grow", note)))
  screen.append(recorderPanel(ctx), input, formats)
  return screen
}

function moduleHeader(ctx: Ctx, id: ScreenId, label = MODULES.find(module => module.id === id)?.title ?? SCREENS[id].label): HTMLElement {
  const head = el("div", "aw-row aw-gap10")
  const tile = el("div", "aw-tile")
  tile.append(icon(SCREENS[id].icon))
  const state = el("span", "aw-bd")
  state.append(el("span", "aw-dot"), document.createTextNode("Inactive"))
  head.append(tile, el("span", "aw-h", label), state)
  const activate = previewDisabled("Activate")
  activate.prepend(icon("play", "aw-i12"))
  return group("aw-col aw-gap12", head, activate, el("p", "aw-hint", "UI preview · Explore rule settings. Saving and activation are not available yet."))
}

function previewDisabled(text: string, extra = "aw-sm aw-self"): HTMLButtonElement {
  const control = el("button", `aw-btn aw-pri ${extra}`, text)
  control.type = "button"
  control.disabled = true
  control.title = "UI preview — rule saving and execution are not connected yet"
  return control
}

function ruleLabel(text: string, control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): HTMLElement {
  const label = el("label", "aw-fld")
  control.setAttribute("aria-label", text)
  label.append(el("span", "aw-lbl", text), control)
  return label
}

function ruleInput(text: string, value = "", type = "text", placeholder = ""): HTMLElement {
  const input = el("input", "aw-in aw-mono")
  input.type = type
  input.value = value
  input.placeholder = placeholder
  if (type === "number") input.min = "0"
  return ruleLabel(text, input)
}

function ruleSelect(text: string, choices: readonly string[], selected = choices[0]): HTMLElement {
  const select = el("select", "aw-sel")
  for (const value of choices) {
    const option = el("option", "", value)
    option.value = value
    option.selected = value === selected
    select.append(option)
  }
  return ruleLabel(text, select)
}

function ruleArea(text: string, value = "", placeholder = ""): HTMLElement {
  const area = el("textarea", "aw-ta aw-mono")
  area.value = value
  area.placeholder = placeholder
  return ruleLabel(text, area)
}

function ruleCheck(text: string, checked = false): HTMLElement {
  const label = el("label", "aw-chk aw-xs")
  const input = el("input")
  input.type = "checkbox"
  input.checked = checked
  label.append(input, document.createTextNode(text))
  return label
}

function ruleDisclosure(text: string, ...children: HTMLElement[]): HTMLElement {
  const details = el("details", "aw-card aw-cp")
  const summary = el("summary", "aw-coll", text)
  summary.prepend(icon("right", "aw-i14"))
  details.append(summary, group("aw-col aw-gap10", ...children))
  return details
}

function ruleSection(ctx: Ctx, title: string, empty: string, action?: string, open?: () => void): HTMLElement {
  const section = el("div", "aw-col aw-gap8")
  section.append(group("aw-row", el("span", "aw-lbl", title), el("span", "aw-bd aw-s", "0")))
  section.append(el("div", "aw-empty", empty))
  if (action && open) {
    const add = button("aw-btn aw-dash aw-w", action, open, ctx.signal)
    add.prepend(icon("plus", "aw-i14"))
    section.append(add)
  }
  return section
}

function moduleScreen(ctx: Ctx, id: ScreenId): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const back = () => ctx.go(id)
  const edit = (fromEndpoint = false, preset = "") => {
    const heading = el("div", "aw-h", `New ${id === "intercept" ? "intercept" : id} rule`)
    heading.tabIndex = -1
    screen.replaceChildren(heading, el("p", "aw-hint", "UI preview · Changes stay in this editor and are discarded when you leave. Saving and activation are not available yet."))
    ctx.chrome({ actions: [previewDisabled("Save rule", "aw-grow"), button("aw-btn aw-out aw-grow", "Cancel", back, ctx.signal)] })
    const match = card()
    const endpoints = ctx.state().config.endpoints
    const source = el("select", "aw-sel")
    source.append(el("option", "", "Ad-hoc (custom URL)"))
    source.options[0]!.value = ""
    for (const endpoint of endpoints) {
      const option = el("option", "", endpoint.name)
      option.value = endpoint.id
      source.append(option)
    }
    if (fromEndpoint && endpoints[0]) source.value = endpoints[0].id
    const label = ruleInput("Label", preset)
    const method = ruleSelect("Method", ["*", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"], "GET")
    const url = ruleInput("URL", "/api/**")
    const sourceNote = el("p", "aw-hint")
    const syncSource = () => {
      const endpoint = endpoints.find(item => item.id === source.value)
      if (endpoint) {
        label.querySelector("input")!.value = `${id === "mock" ? "Mock" : id === "intercept" ? "Intercept" : "Fault"} ${endpoint.name}`
        method.querySelector("select")!.value = endpoint.request.method
        url.querySelector("input")!.value = endpoint.request.path
      }
      sourceNote.textContent = endpoint ? "Method and URL copied from the selected endpoint for this preview." : fromEndpoint && !endpoints.length ? "No endpoints yet. Add one in Endpoints, or explore an ad-hoc rule." : "Match a method and URL in this frame."
    }
    source.addEventListener("change", syncSource, { signal: ctx.signal })
    syncSource()
    match.append(label, ruleLabel("Endpoint", source), sourceNote, group("aw-g2", method, url))
    screen.append(match)
    if (id === "mock") {
      const response = card()
      const status = ruleInput("Status", "200", "number")
      const body = ruleArea("Response body", "{}", "Response body JSON")
      const useSample = button("aw-btn aw-out aw-sm aw-self", "Use recorded response", () => {
        const sample = endpoints.find(item => item.id === source.value)?.sampleResponse
        if (sample) {
          status.querySelector("input")!.value = String(sample.status)
          body.querySelector("textarea")!.value = sample.body
        }
      }, ctx.signal)
      const updateSample = () => {
        useSample.disabled = !endpoints.find(item => item.id === source.value)?.sampleResponse
        useSample.title = useSample.disabled ? "Choose an endpoint with a recorded response" : "Copy the recorded body and status into this preview"
      }
      source.addEventListener("change", updateSample, { signal: ctx.signal })
      updateSample()
      response.append(caption("Response"), group("aw-g3", status, ruleInput("Delay (ms)", "0", "number"), ruleInput("Priority", "0", "number")), body, useSample, ruleArea("Response headers", "", "Name: Value — one per line"))
      screen.append(response)
    } else if (id === "intercept") {
      screen.append(group("aw-row", ruleCheck("Break on request"), ruleCheck("Break on response")))
      for (const stage of ["Response", "Request"]) {
        const transform = card()
        transform.append(caption(`${stage} transform`))
        if (stage === "Response") transform.append(ruleInput("Status override", "", "number"), el("p", "aw-hint", "Blank keeps the original status."))
        transform.append(ruleArea(`${stage} set headers`, "", "Name: Value — one per line"), ruleArea(`${stage} remove headers`, "", "One header name per line"))
        const operations = el("div", "aw-col aw-gap8")
        const raw = ruleArea(`${stage} patch JSON preview`, "[]")
        raw.querySelector("textarea")!.readOnly = true
        const addOperation = button("aw-btn aw-out aw-sm aw-self", "Add operation", () => {
          const row = group("aw-col aw-gap8")
          const operation = ruleSelect(`${stage} operation`, ["replace", "remove", "add", "nullify"])
          const path = ruleInput(`${stage} JSON Pointer`, "/field")
          const value = ruleInput(`${stage} JSON value`, "null")
          const update = () => {
            const patches = Array.from(operations.children).map(item => {
              const op = item.querySelector("select")!.value
              const inputs = item.querySelectorAll("input")
              const patch: Record<string, unknown> = { op: op === "nullify" ? "replace" : op, path: inputs[0]!.value }
              inputs[1]!.disabled = op === "remove" || op === "nullify"
              if (op === "nullify") patch.value = null
              else if (op !== "remove") {
                try { patch.value = JSON.parse(inputs[1]!.value) } catch { patch.value = inputs[1]!.value }
              }
              return patch
            })
            raw.querySelector("textarea")!.value = JSON.stringify(patches, null, 2)
          }
          const remove = iconButton("aw-btn aw-gh aw-ic aw-sm", "trash", `Remove ${stage.toLowerCase()} operation`, () => { row.remove(); update() }, ctx.signal)
          row.append(group("aw-row", operation, remove), path, value)
          row.addEventListener("input", update, { signal: ctx.signal })
          operations.append(row)
          update()
        }, ctx.signal)
        transform.append(ruleDisclosure(`${stage} JSON Patch`, operations, addOperation, raw), group("aw-g2", ruleInput(`${stage} body find`), ruleInput(`${stage} body replace`)))
        screen.append(transform)
      }
    } else {
      const fault = card()
      const isLatency = /slow|latency/i.test(preset)
      const mode = ruleSelect("Mode", ["Synthetic", "Real traffic"])
      const modeNote = el("p", "aw-hint", "No network call — generate a fault response.")
      mode.querySelector("select")!.addEventListener("change", event => {
        modeNote.textContent = (event.target as HTMLSelectElement).value === "Synthetic" ? "No network call — generate a fault response." : "A real request reaches the server before response faults are applied."
      }, { signal: ctx.signal })
      const faultType = ruleSelect("Fault type", ["Error status", "Latency", "Random latency", "Network error"], preset === "Random latency" ? "Random latency" : isLatency ? "Latency" : "Error status")
      const status = ruleInput("Fault status", /503/.test(preset) ? "503" : /502/.test(preset) ? "502" : "500", "number")
      const delay = ruleInput("Fault delay (ms)", /Very slow/.test(preset) ? "5000" : "1000", "number")
      const range = group("aw-g2", ruleInput("Minimum delay (ms)", "250", "number"), ruleInput("Maximum delay (ms)", "2000", "number"))
      const body = ruleArea("Fault body", "", '{"error":"…"}')
      const updateFault = () => {
        const kind = faultType.querySelector("select")!.value
        status.hidden = kind !== "Error status"
        body.hidden = kind !== "Error status"
        delay.hidden = kind !== "Latency"
        range.hidden = kind !== "Random latency"
      }
      faultType.querySelector("select")!.addEventListener("change", updateFault, { signal: ctx.signal })
      updateFault()
      fault.append(mode, modeNote, faultType, status, delay, range, body)
      screen.append(fault)
    }
    screen.append(ruleDisclosure("Conditional match · Optional", ruleInput("Query params", ""), ruleInput("Match headers", ""), ruleInput("Body contains", ""), ruleInput("Match priority", "0", "number")))
    if (id === "mock") screen.append(ruleSelect("Fault mode", ["None (static response)", "Network error", "Timeout"]))
    const body = screen.closest<HTMLElement>(".aw-body")
    if (body) body.scrollTop = 0
    heading.focus({ preventScroll: true })
  }
  screen.append(moduleHeader(ctx, id))
  if (id === "chaos") {
    const presets = card()
    const choices = el("div", "aw-g2")
    for (const preset of ["Slow API", "Very slow API", "Random latency", "Server error 500", "Service unavailable 503", "Bad gateway 502"])
      choices.append(button("aw-btn aw-out aw-sm", preset, () => edit(false, preset), ctx.signal))
    presets.append(el("div", "aw-lbl", "Presets"), el("p", "aw-hint", "Choose a preset to preview its rule."), choices)
    screen.append(presets, ruleSection(ctx, "Rules", "No chaos rules configured", "Add rule", () => edit()), button("aw-btn aw-out aw-sm aw-self", "From endpoint", () => edit(true), ctx.signal))
  } else if (id === "route") {
    const form = card()
    form.append(
      el("p", "aw-hint", "Routes this frame’s fetch/XHR requests; browser restrictions apply."),
      el("div", "aw-lbl", "New page rule"),
      group("aw-g2", ruleInput("Label", "", "text", "e.g. Local API"), ruleSelect("Method", ["*", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
        ruleInput("URL pathname glob", "/api/**"), ruleInput("Match origin", "", "text", "Blank = current document"),
        ruleInput("Destination origin", location.origin), ruleInput("Path rewrite", "", "text", "/local/**"),
        ruleSelect("Destination credentials", ["same-origin", "include", "omit"]), ruleInput("Priority", "0", "number")),
      group("aw-g2", ruleArea("Query params", "{}"), ruleArea("Headers", "{}")),
      ruleInput("Body contains", "", "text", "Literal substring (optional)"), ruleCheck("Preserve original path — rewrite takes precedence", true), ruleCheck("Rule enabled — does not activate routing", true),
    )
      form.append(el("p", "aw-hint", "All conditions must match. Query params and headers are JSON maps of exact string values."))
    ctx.chrome({ actions: [previewDisabled("Save rule", "aw-grow"), button("aw-btn aw-out aw-grow", "Cancel", () => ctx.go("home"), ctx.signal)] })
    screen.append(form)
  } else {
    screen.append(
      ruleSection(ctx, "Endpoint rules", "No endpoint rules configured", id === "mock" ? "Add rule from endpoint" : "From endpoint", () => edit(true)),
      ruleSection(ctx, "Ad-hoc rules", id === "mock" ? "No ad-hoc rules" : "No freestanding intercept rules", id === "mock" ? "Add ad-hoc rule" : "Add rule", () => edit()),
      ruleSection(ctx, id === "mock" ? "Matched traffic" : "Traffic log", id === "mock" ? "No matched traffic yet" : "No intercepted traffic yet"),
    )
  }
  return screen
}

function planned(ctx: Ctx, id: ScreenId): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const section = card()
  const head = el("div", "aw-row aw-gap10")
  const tile = el("div", "aw-tile")
  tile.append(icon(SCREENS[id].icon))
  const badge = el("span", "aw-bd aw-am", `Not built · ${SCREENS[id].milestone}`)
  const text = el("div", "aw-grow aw-col aw-gap2")
  text.append(el("div", "aw-h", SCREENS[id].label), el("div", "aw-xs aw-mu", SCREENS[id].summary))
  head.append(tile, text, badge)
  const list = el("ul", "aw-plan")
  for (const point of SCREENS[id].points) list.append(el("li", "aw-xs aw-mu", point))
  section.append(head, list)
  const note = el(
    "p",
    "aw-hint",
    `M1 delivers the panel shell only. This screen has no behavior yet; reference design: ${SCREENS[id].reference}.`,
  )
  screen.append(
    section,
    note,
  )
  return screen
}

export function renderScreen(ctx: Ctx, id: ScreenId): HTMLElement {
  if (id === "home") return home(ctx)
  if (id === "test") return tester(ctx)
  if (id === "endpoints") return endpoints(ctx)
  if (id === "settings") return settings(ctx)
  if (id === "import") return importScreen(ctx)
  if (id === "mock" || id === "intercept" || id === "route" || id === "chaos")
    return moduleScreen(ctx, id)
  return planned(ctx, id)
}
