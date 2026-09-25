import {
  el,
  icon,
  button,
  headerFields,
  prettyJson,
  iconButton,
  card,
  caption,
  group,
  confirmDialog,
  disclosure,
  numberField,
  selectField,
  checkField,
  toggleBox,
  textField,
} from "./dom"
import {
  MAX_CONCURRENCY,
  MAX_ITERATIONS,
  matchesFilter,
  mergeHeaders,
  RAMP_STEP_MS,
  stepPhase,
  type Endpoint,
  type HeaderValue,
  type TestPlan,
} from "../core/model"
import { preflight, type Preflight } from "../tester/plan"
import { OUTCOMES, type RunState } from "../tester/run"
import { endpointStats, failedCount, overallStats, passedCount } from "../tester/results"
import { bindingFrom, bindingPreview, scanPage, SOURCE_LABELS, type ContextCandidate } from "../tester/context"
import { BUILTINS, type ContextSource } from "../tester/expressions"
import type { Ctx, UIState } from "./screens"
import type { OnceResult } from "../tester/once"

const OUTCOME_LABELS: Record<(typeof OUTCOMES)[number], string> = {
  passed: "Passed",
  "failed-check": "Failed checks",
  "network-error": "Network error",
  timeout: "Timeout",
  aborted: "Aborted",
  "skipped-dependency": "Skipped dependency",
  blocked: "Blocked before dispatch",
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

function methodBadge(method: string): HTMLElement {
  return el("span", `aw-bd aw-m aw-${method}`, method)
}

/** Test.html's config row: a fixed-width label beside its control, not stacked above it. */
function fieldRow(label: string, control: HTMLElement, ...rest: Node[]): HTMLElement {
  const text = el("span", "aw-lbl", label)
  text.style.cssText = "width:104px;flex-shrink:0"
  const row = el("label", "aw-row")
  row.append(text, control, ...rest)
  return row
}

/** The reference switch: a button, so a row click never submits or navigates. */
function switchBox(label: string, checked: boolean, onChange: (value: boolean) => void, signal: AbortSignal): HTMLElement {
  const control = el("button", `aw-sw${checked ? " aw-on" : ""}`)
  control.type = "button"
  control.setAttribute("role", "switch")
  control.setAttribute("aria-checked", String(checked))
  control.setAttribute("aria-label", label)
  control.append(el("span", "aw-th"))
  control.addEventListener("click", () => onChange(!checked), { signal })
  return control
}

/** One endpoint row: included/excluded, the method, its alias, and which phase it sits in. */
/**
 * A control commits against the live plan, never against the one the form was drawn from. The form
 * is rebuilt from the store, so a commit can land after the live plan has changed — a switch in the
 * picker, or another field's edit — and writing a whole render-time snapshot back would resurrect
 * the plan that was left and discard the one that replaced it.
 */
function editPlan(ctx: Ctx, change: (live: TestPlan) => Partial<TestPlan>) {
  const live = ctx.plan()
  ctx.updatePlan({ ...live, ...change(live) })
}

function stepRow(ctx: Ctx, plan: TestPlan, endpoint: Endpoint): HTMLElement {
  const phase = stepPhase(plan, endpoint.id)
  const included = phase !== "skip"
  const toggle = toggleBox(`Include ${endpoint.name}`, included, (next) =>
    editPlan(ctx, (live) => ({
      excluded: next ? live.excluded.filter((id) => id !== endpoint.id) : [...live.excluded, endpoint.id],
    })),
  ctx.signal)
  const placement = plan.phases[endpoint.id] ?? "load"
  const move = button("aw-btn aw-gh aw-xs2", placement === "setup" ? "To load" : "To setup", () =>
    editPlan(ctx, (live) => ({ phases: { ...live.phases, [endpoint.id]: placement === "setup" ? "load" : "setup" } })),
  ctx.signal)
  move.title = placement === "setup" ? "Move to the load phase" : "Run once per run, before the load phase"
  const row = group(
    "aw-li",
    toggle,
    methodBadge(endpoint.request.method),
    el("span", "aw-grow aw-tr aw-mono aw-xs", endpoint.alias),
    move,
  )
  if (!included) row.style.opacity = "0.55"
  return row
}

/**
 * The load phase's filter text. The Load view is rebuilt from the store on every plan edit — an
 * Include toggle is a plan edit — so the box's value cannot live in the DOM it is about to lose.
 */
let phaseFilters: Record<string, string> = {}

function phaseList(ctx: Ctx, plan: TestPlan, endpoints: Endpoint[], title: string, empty: string): HTMLElement {
  const list = el("div", "aw-card aw-list")
  list.setAttribute("aria-label", title)
  const query = (phaseFilters[title] ?? "").trim().toLowerCase()
  const shown = query ? endpoints.filter((endpoint) => matchesFilter(endpoint, query)) : endpoints
  for (const endpoint of shown) list.append(stepRow(ctx, plan, endpoint))
  if (!endpoints.length) list.append(el("div", "aw-empty", empty))
  else if (!shown.length) list.append(el("div", "aw-empty", `Nothing matches "${phaseFilters[title]?.trim()}".`))

  const heading = group("aw-row", caption(title), el("span", "aw-grow"))
  // Include all and Exclude all act on what is listed, so the filter is also the way to select.
  const setAll = (include: boolean) =>
    editPlan(ctx, (live) => {
      const ids = new Set(shown.map((endpoint) => endpoint.id))
      return {
        excluded: include
          ? live.excluded.filter((id) => !ids.has(id))
          : [...new Set([...live.excluded, ...shown.map((endpoint) => endpoint.id)])],
      }
    })
  if (endpoints.length > 1) {
    const includeAll = button("aw-btn aw-gh aw-xs2", "Include all", () => setAll(true), ctx.signal)
    const excludeAll = button("aw-btn aw-gh aw-xs2", "Exclude all", () => setAll(false), ctx.signal)
    for (const control of [includeAll, excludeAll]) control.title = query ? "Applies to the steps listed below" : "Applies to every step below"
    heading.append(includeAll, excludeAll)
  }
  const parts: HTMLElement[] = [heading]
  if (endpoints.length > 1) {
    const filter = el("input", "aw-in") as HTMLInputElement
    filter.type = "search"
    filter.value = phaseFilters[title] ?? ""
    filter.placeholder = "Filter by method, name or path"
    filter.setAttribute("aria-label", `Filter ${title.toLowerCase()}`)
    // Typing is not a plan edit, so the list is redrawn here rather than through the store.
    filter.addEventListener("input", () => {
      phaseFilters = { ...phaseFilters, [title]: filter.value }
      const next = phaseList(ctx, ctx.plan(), endpoints, title, empty)
      section.replaceWith(next)
      next.querySelector<HTMLInputElement>("input[type=search]")?.focus()
    }, { signal: ctx.signal })
    parts.push(filter)
  }
  const section = group("aw-col aw-gap6", ...parts, list)
  return section
}

function preflightCard(check: Preflight, plan: TestPlan): HTMLElement {
  const box = card()
  box.append(el("span", "aw-lbl", "Before dispatch"))
  const facts = el("div", "aw-col aw-gap6")
  facts.append(
    el(
      "p",
      "aw-hint",
      `${plural(check.requestCount, "request")} planned · ${check.setup.length} setup · ${plural(check.load.length, "load step")} × ${plan.iterations} ${plan.strategy === "flow" ? "iterations" : "repetitions"}`,
    ),
    el("p", "aw-hint", `Destinations: ${check.origins.join(", ") || "none resolved"}`),
    el("p", "aw-hint", `Tester mode: ${plan.mode === "direct" ? "Direct — active rules are bypassed" : "Apply active rules — the page pipeline runs"}`),
  )
  if (check.mutating.length)
    facts.append(el("p", "aw-hint aw-am", `Can change data: ${check.mutating.join(", ")}`))
  for (const warning of check.warnings) facts.append(el("p", "aw-hint aw-am", warning))
  for (const error of check.errors) facts.append(el("p", "aw-hint aw-rd", error))
  box.append(facts)
  return box
}

/* ── Page-context discovery ────────────────────────────────────────────────── */

const SOURCES: ContextSource[] = ["cookie", "local", "session", "meta", "dom", "global"]

function contextCard(ctx: Ctx): HTMLElement {
  const box = card()
  const chosen = new Set<ContextSource>(["cookie", "meta"])
  // Settings keeps the roots this profile scans; the scan starts from them and edits stay local.
  let roots = (ctx.state().config.profile.settings.globalRoots ?? []).join(", ")
  const results = el("div", "aw-card aw-list")
  results.setAttribute("aria-label", "Scan results")
  const status = el("p", "aw-hint", "Nothing scanned yet. Values are previewed masked and never exported.")
  status.setAttribute("role", "status")

  // Built once and kept across plan edits, so adding a binding never clears the scan results.
  const saved = el("div", "aw-card aw-list")
  saved.setAttribute("aria-label", "Context bindings")
  let shown: unknown
  ctx.watch(() => {
    const plan = ctx.plan()
    if (shown === plan.bindings) return
    shown = plan.bindings
    saved.replaceChildren()
    for (const binding of plan.bindings)
      saved.append(
        group(
          "aw-li aw-xs",
          el("span", "aw-bd", SOURCE_LABELS[binding.source]),
          el("span", "aw-grow aw-tr aw-mono", `{{$context("${binding.name}")}}`),
          el("span", "aw-mu", bindingPreview(binding)),
          iconButton("aw-btn aw-gh aw-ic aw-sm", "trash", `Remove ${binding.name}`, () => {
            const current = ctx.plan()
            ctx.updatePlan({ ...current, bindings: current.bindings.filter((item) => item.name !== binding.name) })
          }, ctx.signal),
        ),
      )
    if (!plan.bindings.length) saved.append(el("div", "aw-empty", "No bindings yet. Scan the page and add what a request needs."))
  })

  const show = (candidates: ContextCandidate[]) => {
    results.replaceChildren()
    for (const candidate of candidates.slice(0, 60)) {
      const add = button("aw-btn aw-gh aw-xs2", "Use", () => {
        const plan = ctx.plan()
        if (plan.bindings.some((item) => item.name === candidate.suggestedName)) return
        editPlan(ctx, (live) => ({ bindings: [...live.bindings, bindingFrom(candidate)] }))
      }, ctx.signal)
      results.append(
        group(
          "aw-li aw-xs",
          el("span", "aw-bd", SOURCE_LABELS[candidate.source]),
          el("span", "aw-grow aw-tr aw-mono", candidate.key),
          el("span", "aw-mu", candidate.preview),
          add,
        ),
      )
    }
    if (!candidates.length) results.append(el("div", "aw-empty", "No candidates in the selected categories."))
  }

  const pickers = el("div", "aw-col aw-gap6")
  for (const source of SOURCES)
    pickers.append(
      checkField(SOURCE_LABELS[source], chosen.has(source), (value) => {
        if (value) chosen.add(source)
        else chosen.delete(source)
      }, ctx.signal).field,
    )
  const rootField = textField("Global roots (comma separated)", roots, (value) => (roots = value), ctx.signal)
  const scan = button("aw-btn aw-out aw-sm", "Scan page", () => {
    const candidates = scanPage([...chosen], roots.split(",").map((item) => item.trim()).filter(Boolean))
    show(candidates)
    status.textContent = `${plural(candidates.length, "candidate")} found. Previews are masked; the value is read again at dispatch.`
  }, ctx.signal)

  box.append(
    group("aw-row aw-actions", el("span", "aw-grow"), scan),
    pickers,
    rootField.field,
    status,
    results,
    caption("Bindings used by {{$context(\"name\")}}"),
    saved,
  )
  return box
}

function builtinsCard(): HTMLElement {
  const box = disclosure(
    "Expression reference",
    el("p", "aw-hint", "{{alias.path}} reads a producer's response. Built-ins are parsed, never executed as JavaScript."),
  )
  const list = el("div", "aw-card aw-list")
  for (const name of BUILTINS) list.append(group("aw-li aw-xs", el("span", "aw-mono aw-grow", `{{${name}}}`)))
  box.append(list)
  return box
}

/* ── Test screen ───────────────────────────────────────────────────────────── */

/** The M3 direct send, kept intact: one endpoint, one request, active rules bypassed. */
/**
 * What this request will actually send, editable in place. The plan's own runs read the same two
 * sets, so this is the request being changed, not a copy of it that a run would ignore.
 */
function headersCard(ctx: Ctx, endpointId?: () => string): HTMLDetailsElement & { redraw: () => void } {
  const box = disclosure("Headers")
  const count = el("span", "aw-bd aw-s")
  box.querySelector("summary")?.append(el("span", "aw-grow"), count)
  const globals = el("div", "aw-col aw-gap6 aw-inset")
  const local = el("div", "aw-col aw-gap6 aw-inset")
  const localLabel = el("span", "aw-lbl")
  const effective = () => {
    const config = ctx.state().config
    const endpoint = endpointId ? config.endpoints.find((item) => item.id === endpointId()) : undefined
    return { config, endpoint }
  }
  const retotal = (local: HeaderValue[]) => {
    count.textContent = String(mergeHeaders(ctx.state().config.profile.globalHeaders, local).length)
  }
  const draw = () => {
    const { config, endpoint } = effective()
    globals.replaceChildren(
      el("span", "aw-lbl", "Global · sent with every request"),
      headerFields(ctx.signal, config.profile.globalHeaders, (globalHeaders) => {
        const profile = ctx.state().config.profile
        ctx.updateProfile({ ...profile, globalHeaders, revision: profile.revision + 1, updatedAt: Date.now() })
        const { endpoint: current } = effective()
        retotal(current?.request.headers ?? [])
      }, "Add global header"),
    )
    local.replaceChildren()
    if (!endpointId) {
      count.textContent = String(config.profile.globalHeaders.filter((header) => !header.removed).length)
      return
    }
    if (!endpoint) {
      count.textContent = "0"
      return
    }
    localLabel.textContent = `${endpoint.name} · replaces a global of the same name`
    local.append(
      localLabel,
      // Re-rendering here would replace the input being typed into, so a save only retotals.
      headerFields(ctx.signal, endpoint.request.headers, (headers: HeaderValue[]) => {
        const current = ctx.state().config.endpoints.find((item) => item.id === endpoint.id)
        if (!current) return
        ctx.updateEndpoint({ ...current, request: { ...current.request, headers }, updatedAt: Date.now() })
        retotal(headers)
      }, "Add endpoint header"),
    )
    retotal(endpoint.request.headers)
  }
  draw()
  box.append(
    globals,
    local,
    el("p", "aw-hint", endpointId
      ? "Edits are saved to the profile and the endpoint, so a run sends exactly this."
      : "Sent with every request in the plan. An endpoint's own headers are edited on Endpoints."),
  )
  return Object.assign(box, { redraw: draw })
}

/** Response body size. Bytes below 1 KiB, one decimal above, so a size is readable at a glance. */
function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`
}

function oncePanel(ctx: Ctx): { panel: HTMLElement; actions: Node[] } {
  const panel = el("div", "aw-col aw-gap12")
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
  const status = el("div", "aw-hint", config.endpoints.length ? "Ready for a direct request." : "Add an endpoint before running the tester.")
  status.setAttribute("role", "status")
  const run = button("aw-btn aw-pri aw-sm", "Run Once", () => {
    if (!selector.value || run.disabled) return
    run.disabled = true
    status.textContent = "Running request…"
    ctx.runOnce(selector.value)
  }, ctx.signal)
  run.prepend(icon("play", "aw-i14"))
  run.disabled = !config.endpoints.length
  const result = card()
  const detail = el("pre", "aw-code aw-wrap", "No result yet.")
  detail.setAttribute("aria-label", "Response body")
  // Failed checks only. A passing run already says so in the status line, and the body box holds
  // the response, not a report about it.
  const failures = el("div", "aw-col aw-gap2")
  const headerList = el("pre", "aw-code aw-wrap", "")
  const responseHeaders = disclosure("Response headers", headerList)
  responseHeaders.hidden = true
  const note = el("p", "aw-hint")
  note.setAttribute("role", "status")
  note.setAttribute("aria-label", "Result action status")
  /** What the buttons below act on: the result now on screen, not whatever runs next. */
  let shown: OnceResult | undefined
  const endpointOf = (item: OnceResult) => ctx.state().config.endpoints.find((endpoint) => endpoint.id === item.endpointId)
  // The body box is what a reader means by "this response", so its indented text is what is copied.
  const copy = button("aw-btn aw-out aw-sm", "Copy body", () => {
    if (!shown?.body) return
    void navigator.clipboard.writeText(detail.textContent ?? "").then(
      () => { note.textContent = "Response body copied." },
      () => { note.textContent = "The browser refused clipboard access. Select the body and copy it." },
    )
  }, ctx.signal)
  const saveSample = button("aw-btn aw-out aw-sm", "Save as response sample", () => {
    const endpoint = shown && endpointOf(shown)
    if (!shown || !endpoint) return
    ctx.updateEndpoint({
      ...endpoint,
      sampleResponse: {
        status: shown.status ?? 0,
        headers: Object.entries(shown.headers ?? {}).map(([name, value]) => ({ name, value })),
        body: shown.body,
      },
      updatedAt: Date.now(),
    })
    note.textContent = `Saved as the response sample for ${endpoint.name}.`
  }, ctx.signal)
  const addCheck = button("aw-btn aw-out aw-sm", "Add status check", () => {
    const endpoint = shown && endpointOf(shown)
    if (!shown?.status || !endpoint) return
    const status = shown.status
    if (endpoint.checks.some((check) => check.kind === "status" && check.value === status)) {
      note.textContent = `${endpoint.name} already checks for status ${status}.`
      return
    }
    ctx.updateEndpoint({ ...endpoint, checks: [...endpoint.checks, { kind: "status", value: status }], updatedAt: Date.now() })
    note.textContent = `${endpoint.name} now checks for status ${status}.`
  }, ctx.signal)
  const resultActions = group("aw-row aw-actions", copy, saveSample, addCheck)
  let previous = ctx.state().testerResult
  /** Set once the headers card exists, which is built after the first refresh. */
  let onSelected = () => {}
  const refresh = (current: NonNullable<ReturnType<Ctx["state"]>["testerResult"]>) => {
    // The result below belongs to one endpoint, so the selector above it names that one — whether
    // the run started here or on an Endpoints row, which lands on this screen mid-flight.
    if ([...selector.options].some((option) => option.value === current.endpointId)) {
      selector.value = current.endpointId
      onSelected()
    }
    shown = current
    note.textContent = ""
    status.textContent =
      `${current.outcome}${current.status ? ` · HTTP ${current.status}` : ""} · ${current.durationMs} ms` +
      `${current.size === undefined ? "" : ` · ${formatBytes(current.size)}${current.truncated ? " (truncated for display)" : ""}`}` +
      `${current.error ? ` · ${current.error}` : ""}`
    const entries = Object.entries(current.headers ?? {})
    responseHeaders.hidden = !entries.length
    headerList.textContent = entries.map(([name, value]) => `${name}: ${value}`).join("\n")
    copy.disabled = !current.body
    saveSample.disabled = !current.body || !endpointOf(current)
    addCheck.disabled = !current.status || !endpointOf(current)
    // A response body is read here, not edited, so a JSON one is shown indented; anything else is
    // shown exactly as it arrived.
    detail.textContent = current.body ? (prettyJson(current.body) ?? current.body) : current.error || "No response body."
    failures.replaceChildren(
      ...current.checks
        .filter((check) => check.state === "failed")
        .map((check) => el("p", "aw-hint aw-rd", check.detail)),
    )
  }
  if (previous) refresh(previous)
  ctx.watch((state) => {
    if (state.testerResult && state.testerResult !== previous) {
      previous = state.testerResult
      refresh(previous)
      run.disabled = !config.endpoints.length
    }
  })
  result.append(caption("Result"), status, detail, failures, responseHeaders, resultActions, note)
  const headers = headersCard(ctx, () => selector.value)
  onSelected = () => headers.redraw()
  selector.addEventListener("change", () => headers.redraw(), { signal: ctx.signal })
  panel.append(
    el("p", "aw-hint", "One request using this page\u2019s session. Direct execution bypasses active rules."),
    group("aw-row", selector, run),
    headers,
    result,
    caption("Run history"),
    onceHistory(ctx),
  )
  return { panel, actions: [] }
}

/** One direct Once result. Home's run history renders the same row. */
export function onceRow(state: Readonly<UIState>, item: OnceResult): HTMLElement {
  const name = state.config.endpoints.find((endpoint) => endpoint.id === item.endpointId)?.name ?? "Endpoint"
  return group(
    "aw-li aw-xs",
    el("span", `aw-bd ${item.outcome === "passed" ? "aw-gr" : "aw-rd"}`, item.outcome),
    el("span", "aw-grow aw-tr", name),
    el("span", "aw-num", `${item.status ?? "\u2014"} · ${item.durationMs} ms`),
  )
}

function onceHistory(ctx: Ctx): HTMLElement {
  const history = el("div", "aw-card aw-list")
  history.setAttribute("aria-label", "Once history")
  let previous: unknown
  ctx.watch((state) => {
    if (previous === state.testerHistory) return
    previous = state.testerHistory
    history.replaceChildren()
    for (const item of state.testerHistory) history.append(onceRow(state, item))
    if (!history.children.length) history.append(el("div", "aw-empty", "No runs yet. Run an endpoint from Test."))
  })
  return history
}


export function testScreen(ctx: Ctx): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const direct = oncePanel(ctx)
  const loadPanel = el("div", "aw-col aw-gap12")
  // Watchers belong to the screen, not to one render pass, so these are built once and moved.
  const history = planRunHistory(ctx)
  const context = contextCard(ctx)
  // Editing a header writes to the profile, which re-renders the plan; rebuilding the editor here
  // would close it and drop focus mid-edit, so it is built once and moved like the two above.
  const planHeaders = headersCard(ctx)
  const once = button("aw-btn aw-sm", "Once", () => showView("once"), ctx.signal)
  const load = button("aw-btn aw-sm", "Load", () => showView("load"), ctx.signal)
  let view: "once" | "load" = "once"
  let actions: Node[] = []

  const renderLoad = () => {
    const state = ctx.state()
    const plan = ctx.plan()
    const endpoints = state.config.endpoints
    const setupEndpoints = endpoints.filter((endpoint) => (plan.phases[endpoint.id] ?? "load") === "setup")
    const loadEndpoints = endpoints.filter((endpoint) => (plan.phases[endpoint.id] ?? "load") === "load")
    const check = preflight(plan, endpoints, state.config.profile)
    const running = !!state.run && state.run.state === "running"

    const config = card()
    config.style.gap = "10px"
    const strategy = selectField(
      "Strategy",
      [
        ["flow", "Flow — ordered sequence per iteration"],
        ["independent", "Independent — one queue per endpoint"],
      ] as const,
      plan.strategy,
      (value) => editPlan(ctx, () => ({ strategy: value })),
      ctx.signal,
    )
    strategy.select.classList.add("aw-grow")
    const iterations = numberField("Iterations", plan.iterations, (value) => editPlan(ctx, () => ({ iterations: value })), ctx.signal, 1, MAX_ITERATIONS)
    const concurrency = numberField("Concurrency", plan.concurrency, (value) => editPlan(ctx, () => ({ concurrency: value })), ctx.signal, 1, MAX_CONCURRENCY)
    const delay = numberField("Batch delay", plan.delayMs, (value) => editPlan(ctx, () => ({ delayMs: value })), ctx.signal, 0, 60000)
    const rampStep = numberField(
      "Ramp-up step",
      plan.rampStepMs ?? RAMP_STEP_MS,
      (value) => editPlan(ctx, () => ({ rampStepMs: value })),
      ctx.signal,
      0,
      60000,
    )
    rampStep.input.disabled = !plan.rampUp
    for (const field of [iterations, concurrency, delay, rampStep]) field.input.style.width = "110px"
    // The switch decides whether workers are staggered at all; the field says by how much, in the
    // same shape as Iterations and Batch delay above it.
    // The switch and the field are two controls, so they carry two names: a second "Ramp-up" would
    // be the Add header mistake again.
    const rampLabel = el("span", "aw-lbl", "Ramp-up")
    rampLabel.style.cssText = "width:72px;flex-shrink:0"
    const rampRow = group(
      "aw-row",
      switchBox("Ramp-up", plan.rampUp, (value) => editPlan(ctx, () => ({ rampUp: value })), ctx.signal),
      rampLabel,
      rampStep.input,
      el("span", "aw-xs aw-mu", "ms per worker"),
    )
    const mode = selectField(
      "Mode",
      [
        ["direct", "Direct — bypass active rules"],
        ["rules", "Apply active rules"],
      ] as const,
      plan.mode,
      (value) => editPlan(ctx, () => ({ mode: value })),
      ctx.signal,
    )
    mode.select.classList.add("aw-grow")
    const onFailure = selectField(
      "On failure",
      [
        ["continue", "Continue unrelated steps"],
        ["stop", "Stop the run"],
      ] as const,
      plan.onFailure,
      (value) => editPlan(ctx, () => ({ onFailure: value })),
      ctx.signal,
    )
    onFailure.select.classList.add("aw-grow")
    const separator = () => {
      const line = el("div", "aw-sep")
      line.style.margin = "2px 0"
      return line
    }
    config.append(
      el("div", "aw-cap", "Load config"),
      fieldRow("Strategy", strategy.select),
      fieldRow("Iterations", iterations.input),
      fieldRow("Concurrency", concurrency.input),
      fieldRow("Batch delay", delay.input, el("span", "aw-xs aw-mu", "ms")),
      separator(),
      rampRow,
      separator(),
      fieldRow("Mode", mode.select),
      fieldRow("On failure", onFailure.select),
      el(
        "p",
        "aw-hint",
        plan.strategy === "flow"
          ? "Concurrency is the number of simultaneous iterations, not parallel requests inside one iteration."
          : "Independent runs have no ordered flow: results aggregate by endpoint and do not describe a completed business flow.",
      ),
    )

    const baseUrls = disclosure("Base URLs")
    const environment = state.config.profile.activeEnvironment
    const summary = baseUrls.firstElementChild as HTMLElement
    summary.classList.add("aw-card")
    summary.style.cssText = "height:36px;padding:0 12px"
    summary.append(icon("right", "aw-i12"), el("span", "aw-mono aw-xs", environment), el("span", "aw-xs aw-mu", "(auto)"))
    const hosts = state.config.profile.environments[environment] ?? {}
    const hostList = el("div", "aw-card aw-list")
    for (const [key, origin] of Object.entries(hosts))
      hostList.append(group("aw-li aw-xs", el("span", "aw-mono aw-grow", key), el("span", "aw-mu", origin || "(this page's origin)")))
    if (!Object.keys(hosts).length) hostList.append(el("div", "aw-empty", "No host mappings. Endpoints resolve against this page's origin."))
    baseUrls.append(hostList)

    const runButton = button("aw-btn aw-pri aw-grow", running ? "Running…" : "Run Load", () => {
      if (running) return
      ctx.startRun()
      ctx.go("results")
    }, ctx.signal)
    runButton.prepend(icon("play", "aw-i14"))
    runButton.disabled = running || check.errors.length > 0
    const stop = button("aw-btn aw-out", "Stop", () => ctx.stopRun(), ctx.signal)
    stop.disabled = !running
    const selectedCount = endpoints.length - plan.excluded.length
    const label = el("span", "aw-xs aw-mu")
    label.style.whiteSpace = "nowrap"
    label.append(
      el("span", "aw-lbl", `${selectedCount} selected`),
      document.createTextNode(" · "),
      el("span", "aw-mono", `${plan.iterations}×${plan.concurrency}`),
    )

    const notify = group(
      "aw-chk aw-xs",
      toggleBox("Notify on complete", plan.notifyOnComplete, (value) => editPlan(ctx, () => ({ notifyOnComplete: value })), ctx.signal),
      el("span", "", "Notify on complete"),
    )
    const historyPanel = disclosure("Load run history", history)
    loadPanel.replaceChildren(
      baseUrls,
      config,
      planHeaders,
      phaseList(ctx, plan, setupEndpoints, "Setup phase", "No setup steps. Move an endpoint here to run it once per run."),
      phaseList(ctx, plan, loadEndpoints, "Load phase", "No load steps. Add endpoints in Endpoints first."),
      notify,
      preflightCard(check, plan),
      disclosure("Page context", context),
      builtinsCard(),
      historyPanel,
    )
    actions = [label, stop, runButton]
    if (view === "load") ctx.chrome({ actions })
  }

  // One screen, two views: Once keeps the direct single send, Load carries the plan.
  function showView(next: "once" | "load") {
    view = next
    once.classList.toggle("aw-on", view === "once")
    load.classList.toggle("aw-on", view === "load")
    direct.panel.hidden = view !== "once"
    loadPanel.hidden = view === "once"
    ctx.chrome(view === "once" ? { actions: undefined } : { actions })
  }

  // Built once: a re-render on every plan edit would take the focus out of the name while typing.
  const planName = el("input", "aw-in aw-grow")
  planName.value = ctx.plan().name
  planName.setAttribute("aria-label", "Plan name")
  planName.hidden = true
  planName.addEventListener("change", () => {
    const current = ctx.plan()
    const next = planName.value.trim()
    if (!next) planName.value = current.name
    else if (next !== current.name) ctx.updatePlan({ ...current, name: next })
    planName.hidden = true
  }, { signal: ctx.signal })

  // Test.html's plan row: pick a stored plan, rename the live one, store a copy of it. Stored
  // plans reference this profile's endpoints, so only its own are offered.
  const planPicker = el("select", "aw-sel aw-grow")
  planPicker.setAttribute("aria-label", "Test plan")
  const storedPlans = () => {
    const config = ctx.state().config
    return (config.savedPlans ?? []).filter((plan) => plan.profileId === config.profile.id)
  }
  const refreshPlans = () => {
    const live = ctx.plan()
    // Only a stored plan can be deleted; the live one that was never saved has nothing to remove.
    deletePlan.disabled = !storedPlans().some((plan) => plan.id === live.id)
    planPicker.replaceChildren()
    for (const plan of [live, ...storedPlans().filter((plan) => plan.id !== live.id)]) {
      const option = el("option", "", plan.name)
      option.value = plan.id
      planPicker.append(option)
    }
    planPicker.value = live.id
    planName.value = live.name
  }
  planPicker.addEventListener("change", () => ctx.selectPlan(planPicker.value), { signal: ctx.signal })
  const rename = iconButton("aw-btn aw-out aw-ic", "edit", "Rename plan", () => {
    planName.hidden = false
    planName.focus()
    planName.select()
  }, ctx.signal)
  // savePlanAs always mints a new id and de-duplicates the name, so this copies; it never overwrites.
  const savePlan = iconButton("aw-btn aw-out aw-ic", "save", "Save as new plan", () => ctx.savePlanAs(ctx.plan().name), ctx.signal)
  const deletePlan = iconButton("aw-btn aw-out aw-ic", "trash", "Delete plan", () => {
    const live = ctx.plan()
    void confirmDialog(deletePlan, "Delete plan", `Delete "${live.name}"? This cannot be undone.`, "Delete", ctx.signal)
      .then((confirmed) => { if (confirmed) ctx.deletePlan(live.id) })
  }, ctx.signal)
  // After the buttons above: the first refresh reads them to decide what can be deleted.
  refreshPlans()

  // An edit anywhere in the plan changes the preflight, the footer and which steps are listed.
  let lastPlan: unknown
  let lastRun: unknown
  let lastEndpoints: unknown
  let lastSavedPlans: unknown
  ctx.watch((state) => {
    if (state.config.plan !== lastPlan || state.config.savedPlans !== lastSavedPlans) {
      lastSavedPlans = state.config.savedPlans
      refreshPlans()
    }
    if (state.config.plan === lastPlan && state.run === lastRun && state.config.endpoints === lastEndpoints) return
    lastPlan = state.config.plan
    lastRun = state.run
    lastEndpoints = state.config.endpoints
    renderLoad()
  })

  const segment = group("aw-seg", once, load)
  segment.style.alignSelf = "flex-start"
  segment.setAttribute("role", "group")
  segment.setAttribute("aria-label", "Run mode")
  screen.append(
    group("aw-row", planPicker, rename, savePlan, deletePlan),
    planName,
    segment,
    direct.panel,
    loadPanel,
  )
  showView(ctx.state().run ? "load" : "once")
  return screen
}

/**
 * One finished plan run. Open shows it on Results, the only screen that renders a run: setting
 * `openRun` without navigating left the reader on the screen they clicked from. Home reuses this.
 */
export function runRow(ctx: Ctx, run: RunState): HTMLElement {
  const open = button("aw-btn aw-gh aw-xs2", "Open", () => { ctx.openRun(run.id); ctx.go("results") }, ctx.signal)
  return group(
    "aw-li aw-xs",
    el("span", `aw-bd ${run.state === "completed" ? "aw-gr" : "aw-am"}`, run.state),
    el("span", "aw-grow aw-tr", `${run.planName} · ${run.strategy}`),
    el("span", "aw-num", `${passedCount(run)}/${run.completed}`),
    open,
  )
}

function planRunHistory(ctx: Ctx): HTMLElement {
  const history = el("div", "aw-card aw-list")
  history.setAttribute("aria-label", "Load run history")
  let previous: RunState[] | undefined
  ctx.watch((state) => {
    if (previous === state.runs) return
    previous = state.runs
    history.replaceChildren()
    for (const run of state.runs) history.append(runRow(ctx, run))
    if (!history.children.length) history.append(el("div", "aw-empty", "No load runs yet."))
  })
  return history
}

/* ── Results screen ────────────────────────────────────────────────────────── */

const PASS_GREEN = "#4ade80"
const FAIL_RED = "#f87171"
const SLOW_AMBER = "#fbbf24"

/** Results.html's stat tile: a muted label over one big number, coloured by what it reports. */
function tile(label: string, value: string, unit = "", color = ""): HTMLElement {
  const box = el("div", "aw-card aw-cp aw-col")
  box.style.gap = "4px"
  const big = el("span", "aw-big", value)
  if (color) big.style.color = color
  if (unit) {
    const suffix = el("span", "", unit)
    suffix.style.cssText = "font-size:14px;color:var(--aw-zinc-400);font-weight:500"
    big.append(suffix)
  }
  box.append(el("span", "aw-xs aw-mu", label), big)
  return box
}

const show = (value: number | undefined) => (value === undefined ? "—" : String(value))

/** Header cells, in order, with the reference's fixed widths. */
const COLUMNS: readonly (readonly [string, string])[] = [
  ["Endpoint", "text-align:left;padding-left:12px"],
  ["Pass", "width:38px"],
  ["Fail", "width:36px"],
  ["Avg", "width:50px"],
  ["Min", "width:50px"],
  ["Max", "width:50px"],
  ["P95", "width:62px;padding-right:12px"],
] as const

/** One numeric cell: muted when the run has no sample for it. */
function numberCell(value: string, style = ""): HTMLElement {
  const cell = el("td", `aw-num${value === "—" ? " aw-mu" : ""}`)
  cell.textContent = value
  if (style) cell.style.cssText = style
  return cell
}

/**
 * Load's answer to Once's Save as response sample. A run keeps one response per endpoint — the last
 * real one — so a sample can be taken from a run without re-sending anything. A long list makes two
 * things matter: saving the lot in one go, and each row saying where it stands without scrolling to
 * a status line at the bottom.
 */
function responseSamplesCard(ctx: Ctx, run: RunState): HTMLElement | undefined {
  const kept = run.endpoints.filter((endpoint) => endpoint.response)
  if (!kept.length) return undefined
  const box = card()
  const note = el("p", "aw-hint")
  note.setAttribute("role", "status")
  note.setAttribute("aria-label", "Response sample status")

  /** Writes this run's response onto the endpoint; returns its name, or undefined if it is gone. */
  const save = (stats: (typeof kept)[number]): string | undefined => {
    const current = ctx.state().config.endpoints.find((item) => item.id === stats.endpointId)
    const response = stats.response
    if (!current || !response) return undefined
    ctx.updateEndpoint({
      ...current,
      sampleResponse: {
        status: response.status,
        headers: Object.entries(response.headers).map(([name, value]) => ({ name, value })),
        body: response.body,
      },
      updatedAt: Date.now(),
    })
    return current.name
  }

  /** Whether the endpoint already holds exactly this run's response. */
  const isSaved = (stats: (typeof kept)[number]): boolean => {
    const current = ctx.state().config.endpoints.find((item) => item.id === stats.endpointId)
    return current?.sampleResponse?.body === stats.response?.body && current?.sampleResponse?.status === stats.response?.status
  }

  const repaints: Array<() => void> = []
  const saveAll = button("aw-btn aw-out aw-sm", "Save all", () => {
    const pending = kept.filter((stats) => !isSaved(stats))
    const saved = pending.map(save).filter((name): name is string => !!name)
    // Repaints the rows and this button's own count; it is defined below and only runs on a click.
    repaintAll()
    note.textContent = saved.length
      ? `Saved ${saved.length} response sample${saved.length === 1 ? "" : "s"}.`
      : "Every endpoint already holds this run's response."
  }, ctx.signal)

  const repaintAll = () => {
    for (const repaint of repaints) repaint()
    const pending = kept.filter((stats) => !isSaved(stats)).length
    saveAll.textContent = pending ? `Save all (${pending})` : "All saved"
    saveAll.disabled = !pending
  }

  box.append(
    group("aw-row aw-actions", el("span", "aw-lbl aw-grow", "Response samples"), saveAll),
    el("p", "aw-hint", "The last response each endpoint returned in this run, up to 16 KiB. Saving one stores it on the endpoint, where the editor and a mock can use it."),
    note,
  )

  for (const stats of kept) {
    const response = stats.response!
    const state = el("span", "aw-bd aw-xs aw-gr", "Saved")
    const action = button("aw-btn aw-out aw-xs2", "Save as sample", () => {
      const name = save(stats)
      note.textContent = name ? `Saved the response sample for ${name}.` : `${stats.name} is no longer in this profile.`
      repaintAll()
    }, ctx.signal)
    const repaint = () => {
      const current = ctx.state().config.endpoints.find((item) => item.id === stats.endpointId)
      const saved = isSaved(stats)
      // Three states, because "has a sample" and "has this run's sample" are different answers.
      state.hidden = !saved
      action.hidden = saved
      action.textContent = current?.sampleResponse ? "Replace sample" : "Save as sample"
      action.disabled = !current
      if (!current) action.textContent = "Endpoint removed"
    }
    repaints.push(repaint)
    repaint()

    // Saving a response you cannot read is a guess. The body is already retained, so the row shows
    // it on request rather than only offering to store it.
    const detail = el("div", "aw-col aw-gap6")
    detail.hidden = true
    detail.setAttribute("aria-label", `Response ${stats.alias} returned`)
    // Three unlabelled boxes are a wall of text: each block says what it is, and the request side is
    // here too, so a response can be read against what was actually sent to produce it.
    const headerBlock = (label: string, headers: Record<string, string>) => {
      const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join("\n")
      const box = el("pre", "aw-code aw-wrap aw-xs aw-mu", lines || "None.")
      box.setAttribute("aria-label", `${label} for ${stats.alias}`)
      return [el("span", "aw-lbl", label), box]
    }
    detail.append(
      ...headerBlock("Request headers sent", response.requestHeaders),
      ...headerBlock("Response headers", response.headers),
      el("span", "aw-lbl", "Response body"),
    )
    detail.append(el("pre", "aw-code aw-wrap", response.body ? (prettyJson(response.body) ?? response.body) : "No response body."))
    if (response.truncated) detail.append(el("p", "aw-hint aw-am", "Body truncated to 16 KiB; saving stores what is shown."))
    const reveal = iconButton("aw-btn aw-gh aw-ic aw-xs2", "expand", `Show the response ${stats.alias} returned`, () => {
      detail.hidden = !detail.hidden
      reveal.title = detail.hidden ? `Show the response ${stats.alias} returned` : `Hide the response ${stats.alias} returned`
      reveal.setAttribute("aria-expanded", String(!detail.hidden))
    }, ctx.signal)
    reveal.setAttribute("aria-expanded", "false")

    box.append(group("aw-row aw-gap8",
      methodBadge(stats.method),
      el("span", "aw-grow aw-tr aw-xs aw-mono", stats.alias),
      el("span", "aw-xs aw-mu", `${response.status}${response.truncated ? " · truncated" : ""}`),
      state,
      reveal,
      action), detail)
  }
  repaintAll()
  return box
}

function breakdownTable(run: RunState): HTMLElement {
  const table = el("table")
  table.style.cssText = "width:100%;border-collapse:collapse;table-layout:fixed"
  const header = el("tr")
  header.style.cssText = "height:32px;border-bottom:1px solid var(--aw-zinc-800);background:var(--aw-zinc-950)"
  for (const [label, width] of COLUMNS) {
    const cell = el("th", label === "Endpoint" ? "" : "aw-num", label)
    cell.style.cssText = `${width};font-size:11px;font-weight:500;color:var(--aw-zinc-400)`
    header.append(cell)
  }
  const head = el("thead")
  head.append(header)
  const rows = el("tbody")
  for (const endpoint of run.endpoints) {
    const stats = endpointStats(endpoint)
    const notPassed = OUTCOMES.filter((outcome) => outcome !== "passed").reduce((sum, outcome) => sum + endpoint.counts[outcome], 0)
    const name = group("aw-row", methodBadge(endpoint.method))
    name.style.gap = "6px"
    if (endpoint.phase === "setup") {
      const marker = el("span", "aw-mu")
      marker.title = "Setup phase"
      marker.append(icon("wrench", "aw-i12"))
      name.append(marker)
    }
    const alias = el("span", "aw-tr aw-xs aw-mono", endpoint.alias)
    alias.title = endpoint.alias
    name.append(alias)
    const first = el("td")
    first.style.paddingLeft = "12px"
    first.append(name)
    const row = el("tr")
    row.style.cssText = "height:34px;border-bottom:1px solid var(--aw-zinc-800)"
    row.append(
      first,
      numberCell(String(endpoint.counts.passed), `color:${PASS_GREEN}`),
      numberCell(String(notPassed), `color:${FAIL_RED}`),
      numberCell(show(stats.avgMs)),
      numberCell(show(stats.minMs)),
      numberCell(show(stats.maxMs)),
      numberCell(stats.p95Ms === undefined ? "—" : `${stats.p95Ms}ms`, `padding-right:12px${stats.p95Ms === undefined ? "" : `;color:${SLOW_AMBER}`}`),
    )
    rows.append(row)
  }
  table.append(head, rows)
  const box = el("div", "aw-card")
  box.style.overflow = "hidden"
  box.setAttribute("aria-label", "Per-endpoint breakdown")
  box.append(table)
  return box
}

export function resultsScreen(ctx: Ctx): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const body = el("div", "aw-col aw-gap12")
  screen.append(body)
  let seen: RunState | undefined
  let rendered = false

  const render = (run: RunState | undefined) => {
    body.replaceChildren()
    if (!run) {
      body.append(el("div", "aw-empty", "No run yet. Start one from Test."))
      return
    }
    const overall = overallStats(run)
    const title = el("span", "aw-h aw-row", `Results: ${run.planName}`)
    title.style.gap = "6px"
    title.prepend(icon("bolt", "aw-i14"))
    const shape = el("span", "aw-bd", `${run.strategy === "flow" ? "Flow" : "Independent"} · ${run.iterations}×${run.concurrency}`)
    shape.prepend(icon("link", "aw-i12"))
    const percent = run.progressTotal ? Math.round((run.progress / run.progressTotal) * 100) : 0
    const progress = el("div", "aw-prog")
    progress.setAttribute("role", "progressbar")
    progress.setAttribute("aria-label", run.strategy === "flow" ? "Iterations complete" : "Jobs complete")
    progress.setAttribute("aria-valuenow", String(percent))
    progress.setAttribute("aria-valuemin", "0")
    progress.setAttribute("aria-valuemax", "100")
    const bar = el("span")
    bar.style.width = `${percent}%`
    progress.append(bar)
    const done = el("span", "aw-mono", `${run.progress} / ${run.progressTotal}`)
    done.style.color = "var(--aw-zinc-50)"
    const counted = el("div", "aw-xs aw-mu")
    counted.style.textAlign = "center"
    counted.append(
      done,
      document.createTextNode(` ${run.strategy === "flow" ? "iterations" : "jobs"} · ${run.completed} of ${run.planned} requests`),
    )
    const header = el("div", "aw-col")
    header.style.gap = "8px"
    header.append(group("aw-row", title, el("span", "aw-grow"), el("span", "aw-bd aw-s", run.state), shape), progress, counted)
    const tiles = el("div", "aw-g2")
    tiles.style.gap = "10px"
    tiles.append(
      tile("Passed", String(passedCount(run)), "", PASS_GREEN),
      tile("Failed", String(failedCount(run)), "", FAIL_RED),
      tile("Avg latency", show(overall.avgMs), "ms"),
      tile("P95 latency", show(overall.p95Ms), "ms", overall.p95Ms === undefined ? "" : SLOW_AMBER),
    )
    body.append(header, tiles, caption("Per-endpoint breakdown"), breakdownTable(run))

    const breakdown = card()
    breakdown.append(el("span", "aw-lbl", "Outcome breakdown"))
    for (const outcome of OUTCOMES)
      if (run.counts[outcome])
        breakdown.append(group("aw-row aw-xs", el("span", "aw-grow", OUTCOME_LABELS[outcome]), el("span", "aw-num", String(run.counts[outcome]))))
    breakdown.append(
      el(
        "p",
        "aw-hint",
        `${plural(overall.count, "latency sample")}${overall.truncated ? " (P95 covers the samples kept)" : ""}. Browser-local timings from one tab: not a server capacity measurement.`,
      ),
    )
    for (const message of run.errors) breakdown.append(el("p", "aw-hint aw-rd", message))
    for (const message of run.warnings) breakdown.append(el("p", "aw-hint aw-am", message))
    body.append(breakdown)
    const samples = responseSamplesCard(ctx, run)
    if (samples) body.append(samples)
  }

  ctx.watch((state) => {
    const run = state.openRun
    if (rendered && run === seen) return
    seen = run
    rendered = true
    render(run)
  })

  ctx.chrome({
    title: "Results",
    onBack: () => ctx.go("test"),
    actions: [
      button("aw-btn aw-out aw-sm", "JSON", () => ctx.exportRun("json"), ctx.signal),
      button("aw-btn aw-out aw-sm", "CSV", () => ctx.exportRun("csv"), ctx.signal),
      button("aw-btn aw-out", "Stop", () => ctx.stopRun(), ctx.signal),
      button("aw-btn aw-pri aw-grow", "Run again", () => ctx.startRun(), ctx.signal),
    ],
  })
  return screen
}
