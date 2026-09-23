import {
  el,
  icon,
  button,
  iconButton,
  card,
  caption,
  group,
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
  RAMP_STEP_MS,
  stepPhase,
  type Endpoint,
  type TestPlan,
} from "../core/model"
import { preflight, type Preflight } from "../tester/plan"
import { OUTCOMES, type RunState } from "../tester/run"
import { endpointStats, failedCount, overallStats, passedCount } from "../tester/results"
import { bindingFrom, bindingPreview, scanPage, SOURCE_LABELS, type ContextCandidate } from "../tester/context"
import { BUILTINS, type ContextSource } from "../tester/expressions"
import type { Ctx } from "./screens"

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

/** One endpoint row: included/excluded, the method, its alias, and which phase it sits in. */
function stepRow(ctx: Ctx, plan: TestPlan, endpoint: Endpoint): HTMLElement {
  const phase = stepPhase(plan, endpoint.id)
  const included = phase !== "skip"
  const toggle = toggleBox(`Include ${endpoint.name}`, included, (next) =>
    ctx.updatePlan({
      ...plan,
      excluded: next ? plan.excluded.filter((id) => id !== endpoint.id) : [...plan.excluded, endpoint.id],
    }),
  ctx.signal)
  const placement = plan.phases[endpoint.id] ?? "load"
  const move = button("aw-btn aw-gh aw-xs2", placement === "setup" ? "To load" : "To setup", () =>
    ctx.updatePlan({ ...plan, phases: { ...plan.phases, [endpoint.id]: placement === "setup" ? "load" : "setup" } }),
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

function phaseList(ctx: Ctx, plan: TestPlan, endpoints: Endpoint[], title: string, empty: string): HTMLElement {
  const list = el("div", "aw-card aw-list")
  list.setAttribute("aria-label", title)
  for (const endpoint of endpoints) list.append(stepRow(ctx, plan, endpoint))
  if (!endpoints.length) list.append(el("div", "aw-empty", empty))
  return group("aw-col aw-gap6", caption(title), list)
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
  let roots = ""
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
        ctx.updatePlan({ ...plan, bindings: [...plan.bindings, bindingFrom(candidate)] })
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
  const rootField = textField("Global roots (comma separated)", "", (value) => (roots = value), ctx.signal)
  const scan = button("aw-btn aw-out aw-sm", "Scan page", () => {
    const candidates = scanPage([...chosen], roots.split(",").map((item) => item.trim()).filter(Boolean))
    show(candidates)
    status.textContent = `${plural(candidates.length, "candidate")} found. Previews are masked; the value is read again at dispatch.`
  }, ctx.signal)

  box.append(
    group("aw-row aw-actions", el("span", "aw-lbl aw-grow", "Page context"), scan),
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
  let previous = ctx.state().testerResult
  const refresh = (current: NonNullable<ReturnType<Ctx["state"]>["testerResult"]>) => {
    status.textContent = `${current.outcome}${current.status ? ` · HTTP ${current.status}` : ""} · ${current.durationMs} ms${current.error ? ` · ${current.error}` : ""}`
    detail.textContent = `${current.body || current.error || "No response body."}\n\nChecks\n${current.checks.map((check) => `${check.state} · ${check.detail}`).join("\n")}`
  }
  if (previous) refresh(previous)
  ctx.watch((state) => {
    if (state.testerResult && state.testerResult !== previous) {
      previous = state.testerResult
      refresh(previous)
      run.disabled = !config.endpoints.length
    }
  })
  result.append(caption("Result"), status, detail)
  panel.append(
    el("p", "aw-hint", "One request using this page\u2019s session. Direct execution bypasses active rules."),
    group("aw-row", selector, run),
    result,
    caption("Run history"),
    onceHistory(ctx),
  )
  return { panel, actions: [] }
}

function onceHistory(ctx: Ctx): HTMLElement {
  const history = el("div", "aw-card aw-list")
  history.setAttribute("aria-label", "Once history")
  let previous: unknown
  ctx.watch((state) => {
    if (previous === state.testerHistory) return
    previous = state.testerHistory
    history.replaceChildren()
    for (const item of state.testerHistory) {
      const name = state.config.endpoints.find((endpoint) => endpoint.id === item.endpointId)?.name ?? "Endpoint"
      history.append(
        group(
          "aw-li aw-xs",
          el("span", `aw-bd ${item.outcome === "passed" ? "aw-gr" : "aw-rd"}`, item.outcome),
          el("span", "aw-grow aw-tr", name),
          el("span", "aw-num", `${item.status ?? "\u2014"} · ${item.durationMs} ms`),
        ),
      )
    }
    if (!history.children.length) history.append(el("div", "aw-empty", "No runs yet. Run an endpoint from Test."))
  })
  return history
}


export function testScreen(ctx: Ctx): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const direct = oncePanel(ctx)
  const loadPanel = el("div", "aw-col aw-gap12")
  // Watchers belong to the screen, not to one render pass, so these two are built once and moved.
  const history = planRunHistory(ctx)
  const context = contextCard(ctx)
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
    config.append(
      caption("Load config"),
      selectField(
        "Strategy",
        [
          ["flow", "Flow — ordered sequence per iteration"],
          ["independent", "Independent — one queue per endpoint"],
        ] as const,
        plan.strategy,
        (value) => ctx.updatePlan({ ...plan, strategy: value }),
        ctx.signal,
      ).field,
      numberField("Iterations", plan.iterations, (value) => ctx.updatePlan({ ...plan, iterations: value }), ctx.signal, 1, MAX_ITERATIONS).field,
      numberField("Concurrency", plan.concurrency, (value) => ctx.updatePlan({ ...plan, concurrency: value }), ctx.signal, 1, MAX_CONCURRENCY).field,
      numberField("Delay after each iteration (ms)", plan.delayMs, (value) => ctx.updatePlan({ ...plan, delayMs: value }), ctx.signal, 0, 60000).field,
      checkField(`Ramp-up — admit a worker every ${RAMP_STEP_MS} ms`, plan.rampUp, (value) => ctx.updatePlan({ ...plan, rampUp: value }), ctx.signal).field,
      selectField(
        "On failure",
        [
          ["continue", "Continue unrelated steps"],
          ["stop", "Stop the run"],
        ] as const,
        plan.onFailure,
        (value) => ctx.updatePlan({ ...plan, onFailure: value }),
        ctx.signal,
      ).field,
      el(
        "p",
        "aw-hint",
        plan.strategy === "flow"
          ? "Concurrency is the number of simultaneous iterations, not parallel requests inside one iteration."
          : "Independent runs have no ordered flow: results aggregate by endpoint and do not describe a completed business flow.",
      ),
    )

    const baseUrls = disclosure("Base URLs")
    const hosts = state.config.profile.environments[state.config.profile.activeEnvironment] ?? {}
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
    const label = el("span", "aw-xs aw-mu", `${plural(selectedCount, "endpoint")} selected · ${plan.iterations}×${plan.concurrency}`)

    loadPanel.replaceChildren(
      baseUrls,
      config,
      phaseList(ctx, plan, setupEndpoints, "Setup phase", "No setup steps. Move an endpoint here to run it once per run."),
      phaseList(ctx, plan, loadEndpoints, "Load phase", "No load steps. Add endpoints in Endpoints first."),
      context,
      builtinsCard(),
      preflightCard(check, plan),
      checkField("Notify on complete", plan.notifyOnComplete, (value) => ctx.updatePlan({ ...plan, notifyOnComplete: value }), ctx.signal).field,
      caption("Load run history"),
      history,
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

  const mode = selectField(
    "Tester mode",
    [
      ["direct", "Direct — bypass active rules"],
      ["rules", "Apply active rules"],
    ] as const,
    ctx.plan().mode,
    (value) => ctx.updatePlan({ ...ctx.plan(), mode: value }),
    ctx.signal,
  )

  // An edit anywhere in the plan changes the preflight, the footer and which steps are listed.
  let lastPlan: unknown
  let lastRun: unknown
  let lastEndpoints: unknown
  ctx.watch((state) => {
    if (state.config.plan === lastPlan && state.run === lastRun && state.config.endpoints === lastEndpoints) return
    lastPlan = state.config.plan
    lastRun = state.run
    lastEndpoints = state.config.endpoints
    renderLoad()
  })

  screen.append(
    group("aw-row", el("div", "aw-h aw-grow", "API Tester"), button("aw-btn aw-out aw-sm", "Endpoints", () => ctx.go("endpoints"), ctx.signal)),
    group("aw-row aw-actions", group("aw-seg", once, load), el("span", "aw-grow"), mode.field),
    direct.panel,
    loadPanel,
  )
  showView(ctx.state().run ? "load" : "once")
  return screen
}

function planRunHistory(ctx: Ctx): HTMLElement {
  const history = el("div", "aw-card aw-list")
  history.setAttribute("aria-label", "Load run history")
  let previous: RunState[] | undefined
  ctx.watch((state) => {
    if (previous === state.runs) return
    previous = state.runs
    history.replaceChildren()
    for (const run of state.runs) {
      const open = button("aw-btn aw-gh aw-xs2", "Open", () => ctx.openRun(run.id), ctx.signal)
      history.append(
        group(
          "aw-li aw-xs",
          el("span", `aw-bd ${run.state === "completed" ? "aw-gr" : "aw-am"}`, run.state),
          el("span", "aw-grow aw-tr", `${run.planName} · ${run.strategy}`),
          el("span", "aw-num", `${passedCount(run)}/${run.completed}`),
          open,
        ),
      )
    }
    if (!history.children.length) history.append(el("div", "aw-empty", "No load runs yet."))
  })
  return history
}

/* ── Results screen ────────────────────────────────────────────────────────── */

function tile(label: string, value: string, unit = ""): HTMLElement {
  const box = el("div", "aw-card aw-cp aw-col")
  const big = el("span", "aw-big", value)
  if (unit) big.append(el("span", "aw-mu aw-xs", unit))
  box.append(el("span", "aw-xs aw-mu", label), big)
  return box
}

const show = (value: number | undefined) => (value === undefined ? "—" : String(value))

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
    const progress = el("div", "aw-prog")
    const bar = el("span")
    bar.style.width = `${run.progressTotal ? Math.round((run.progress / run.progressTotal) * 100) : 0}%`
    progress.append(bar)
    body.append(
      group(
        "aw-row",
        el("span", "aw-h aw-grow", `Results: ${run.planName}`),
        el("span", "aw-bd aw-s", run.state),
        el("span", "aw-bd", `${run.strategy} · ${run.iterations}×${run.concurrency}`),
      ),
      progress,
      el(
        "div",
        "aw-xs aw-mu",
        `${run.progress} / ${run.progressTotal} ${run.strategy === "flow" ? "iterations" : "jobs"} · ${run.completed} of ${run.planned} planned requests`,
      ),
    )
    const tiles = el("div", "aw-g2")
    tiles.append(
      tile("Passed", String(passedCount(run))),
      tile("Not passed", String(failedCount(run))),
      tile("Avg latency", show(overall.avgMs), "ms"),
      tile("P95 latency", show(overall.p95Ms), "ms"),
    )
    body.append(tiles)

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

    body.append(caption("Per-endpoint breakdown"))
    const table = el("div", "aw-card aw-list")
    table.setAttribute("aria-label", "Per-endpoint breakdown")
    table.append(
      group(
        "aw-li aw-xs aw-mu",
        el("span", "aw-grow", "Endpoint"),
        el("span", "aw-num", "Pass"),
        el("span", "aw-num", "Fail"),
        el("span", "aw-num", "Avg"),
        el("span", "aw-num", "Min"),
        el("span", "aw-num", "Max"),
        el("span", "aw-num", "P95"),
      ),
    )
    for (const endpoint of run.endpoints) {
      const stats = endpointStats(endpoint)
      const notPassed = OUTCOMES.filter((outcome) => outcome !== "passed").reduce((sum, outcome) => sum + endpoint.counts[outcome], 0)
      table.append(
        group(
          "aw-li aw-xs",
          group("aw-row aw-gap6 aw-grow", methodBadge(endpoint.method), el("span", "aw-tr aw-mono", endpoint.alias)),
          el("span", "aw-num", String(endpoint.counts.passed)),
          el("span", "aw-num", String(notPassed)),
          el("span", "aw-num", show(stats.avgMs)),
          el("span", "aw-num", show(stats.minMs)),
          el("span", "aw-num", show(stats.maxMs)),
          el("span", "aw-num", show(stats.p95Ms)),
        ),
      )
    }
    body.append(table)
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
