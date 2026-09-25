import { el, icon, button, iconButton, card, caption, cardHeading, group, labeled, labeledAction, formatJsonButton, prettyJson, disclosure, textField, numberField, selectField, checkField, toggleBox } from "./dom"
import {
  CHAOS_PRESETS,
  defaultInterceptRule,
  logLimit,
  defaultRouteRule,
  forbiddenRequestHeader,
  MAX_REPLAY_COPIES,
  defaultChaosRule,
  defaultMockRule,
  MAX_PAUSED_REQUESTS,
  PAUSE_DEADLINE_MS,
  defaultMockSlot,
  labelFromEndpoint,
  matcherFromEndpoint,
  type ChaosFault,
  type ChaosRule,
  type Endpoint,
  type InterceptRule,
  type MockRule,
  type PatchOp,
  type RouteRule,
  type Transform,
  type MockSlot,
  type Rule,
  type RuleKind,
  type RuleMatcher,
} from "../core/model"
import { getPathname, routeTarget, validateRewrite } from "../network/rules"
import type { PauseEdit, PausedEntry } from "../breakpoints/registry"
import { parseHeaderLines, parseHeaderNames } from "../network/transform"
import { parsePointer, pointers } from "../network/patch"
import type { Ctx } from "./screens"

const METHODS = ["*", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const

const FAULT_LABELS: Record<ChaosFault["kind"], string> = {
  status: "Error status",
  latency: "Latency",
  "random-latency": "Random latency",
  "network-error": "Network failure",
  timeout: "Timeout",
  "malformed-json": "Malformed JSON",
  replay: "Request replay",
}

function radioCard(
  title: string,
  description: string,
  colour: string,
  selected: boolean,
  onSelect: () => void,
  signal: AbortSignal,
): HTMLButtonElement {
  const control = el("button", `aw-rc${selected ? " aw-on" : ""}`)
  control.type = "button"
  control.setAttribute("role", "radio")
  control.setAttribute("aria-checked", String(selected))
  const marker = el("span", `aw-rd${selected ? " aw-on" : ""}`)
  marker.append(el("span"))
  const dot = el("span", "aw-dot")
  dot.style.background = colour
  const heading = group("aw-row aw-gap6", dot, document.createTextNode(title))
  heading.style.fontWeight = "500"
  control.append(marker, group("aw-col aw-gap2", heading, el("span", "aw-xs aw-mu", description)))
  control.addEventListener("click", onSelect, { signal })
  return control
}

/* ── Shared rule chrome ────────────────────────────────────────────────────── */

const MODULE_ICON = { mock: "server", chaos: "flame", intercept: "shuffle", route: "route" } as const

/** What each module does, as opposed to the hint below it, which says what it is doing right now. */
const MODULE_DESCRIPTION = {
  mock: "Answers matching requests from the panel instead of the server, with a status, headers and body you set.",
  intercept: "Edits matching requests and responses in flight, and can pause one at a breakpoint to inspect it.",
  route: "Sends matching requests to a different origin or path, without touching the page\u2019s own code.",
  chaos: "Adds latency, failures and error statuses to matching traffic, to see how the page copes.",
} as const

function moduleHeader(ctx: Ctx, kind: RuleKind, title: string, onToggle: () => void): HTMLElement {
  const head = el("div", "aw-row aw-gap10")
  const tile = el("div", "aw-tile")
  tile.append(icon(MODULE_ICON[kind]))
  const badge = el("span", "aw-bd")
  const dot = el("span", "aw-dot")
  const label = document.createTextNode("Inactive")
  badge.append(dot, label)
  head.append(tile, el("span", "aw-h", title), badge)
  const activate = button("aw-btn aw-pri aw-sm aw-self", "Activate", onToggle, ctx.signal)
  activate.prepend(icon("play", "aw-i12"))
  const hint = el("p", "aw-hint")
  hint.setAttribute("role", "status")
  ctx.watch((state) => {
    const on = state.moduleActive[kind]
    label.textContent = on ? "Active" : "Inactive"
    dot.className = on ? "aw-dot aw-a" : "aw-dot"
    activate.textContent = on ? "Deactivate" : "Activate"
    activate.prepend(icon("play", "aw-i12"))
    activate.className = `aw-btn ${on ? "aw-out" : "aw-pri"} aw-sm aw-self`
    const enabled = state.config.rules?.filter((rule) => rule.kind === kind && rule.enabled).length ?? 0
    hint.textContent = on
      ? `${enabled} enabled rule${enabled === 1 ? "" : "s"} apply to this frame's fetch and XHR traffic.`
      : `Module inactive. ${enabled} enabled rule${enabled === 1 ? "" : "s"} will apply once activated.`
  })
  // Name, then what it is for, then the control, then what it is doing: the same order on every
  // module screen, and the same one the Test screen opens with.
  return group("aw-col aw-gap12", group("aw-col aw-gap6", head, el("p", "aw-hint", MODULE_DESCRIPTION[kind])), activate, hint)
}

function matcherFields(matcher: RuleMatcher, ctx: Ctx, onDetach: () => void): HTMLElement[] {
  const method = selectField(
    "Method",
    METHODS.map((value) => [value, value] as const),
    matcher.method as (typeof METHODS)[number],
    (value) => {
      matcher.method = value
      onDetach()
    },
    ctx.signal,
  )
  const url = textField("URL", matcher.url, (value) => {
    matcher.url = value
    onDetach()
  }, ctx.signal)
  url.input.placeholder = "/api/**"
  const row = group("aw-row aw-gap8", method.field, url.field)
  method.field.style.width = "104px"
  method.field.style.flexShrink = "0"
  url.field.classList.add("aw-grow")
  return [row]
}

function conditionFields(matcher: RuleMatcher, ctx: Ctx): HTMLElement {
  const query = textField("Query params", matcher.query, (value) => (matcher.query = value), ctx.signal)
  query.input.placeholder = "k=v&k2=v2"
  const headers = textField("Headers", matcher.headers, (value) => (matcher.headers = value), ctx.signal)
  headers.input.setAttribute("aria-label", "Match headers")
  headers.input.placeholder = "k=v&k2=v2"
  const body = textField("Body contains", matcher.bodyContains, (value) => (matcher.bodyContains = value), ctx.signal)
  body.input.placeholder = "substring"
  const section = card()
  section.append(
    cardHeading("Conditional match", el("span", "aw-bd", "Optional")),
    query.field,
    headers.field,
    body.field,
    el(
      "p",
      "aw-hint",
      "All conditions must match. A request whose body is unavailable reports “condition not evaluated” rather than matching.",
    ),
  )
  return section
}

/**
 * A label the user never wrote follows the link. A chaos rule created from a preset carries
 * "<preset> · <endpoint>", so only that suffix moves; anything typed by hand is left alone.
 */
function relabel(label: string, previous: Endpoint | undefined, endpoint: Endpoint): string {
  const derived = labelFromEndpoint(endpoint)
  if (!label.trim() || /^New .+ rule$/.test(label)) return derived
  if (!previous) return label
  const was = labelFromEndpoint(previous)
  if (label === was) return derived
  return label.endsWith(` · ${was}`) ? `${label.slice(0, -was.length)}${derived}` : label
}

function endpointPicker(
  draft: Rule,
  endpoints: Endpoint[],
  ctx: Ctx,
  onPick: () => void,
): HTMLElement {
  const choices: Array<readonly [string, string]> = [["", "Ad-hoc (custom URL)"]]
  for (const endpoint of endpoints) choices.push([endpoint.id, `${endpoint.request.method} · ${endpoint.name}`])
  const note = el("p", "aw-hint")
  const picker = selectField(
    "Endpoint",
    choices,
    draft.endpointId ?? "",
    (value) => {
      const previous = endpoints.find((item) => item.id === draft.endpointId)
      const endpoint = endpoints.find((item) => item.id === value)
      draft.endpointId = endpoint?.id
      if (endpoint) {
        draft.matcher = { ...draft.matcher, ...matcherFromEndpoint(endpoint) }
        draft.label = relabel(draft.label, previous, endpoint)
      }
      onPick()
      note.textContent = endpoint
        ? `Method and URL synced from ${endpoint.name}. Editing either detaches the rule on save.`
        : "Ad-hoc rule: match a method and URL in this frame."
    },
    ctx.signal,
  )
  note.textContent = draft.endpointId
    ? `Method and URL synced from the linked endpoint. Editing either detaches the rule on save.`
    : "Ad-hoc rule: match a method and URL in this frame."
  return group("aw-col aw-gap6", picker.field, note)
}

function ruleRow(ctx: Ctx, rule: Rule, summary: string | Node, onOpen: () => void): HTMLElement {
  const screen = rule.kind
  const row = el("div", "aw-row aw-gap10 aw-rule-row")
  row.append(
    toggleBox(
      `Enable ${rule.label}`,
      rule.enabled,
      (value) => {
        ctx.toggleRule(rule.id, value)
        ctx.go(screen)
      },
      ctx.signal,
    ),
  )
  const open = button("aw-grow aw-col aw-gap2 aw-endpoint-name aw-tr", "", onOpen, ctx.signal)
  open.append(el("span", "", rule.label))
  // The badge sits on the meta line itself, so this line is flush with the label, not indented.
  const meta = el("span", "aw-row aw-gap6 aw-endpoint-meta aw-rule-meta aw-mono aw-xs")
  const url = el("span", "aw-tr", rule.matcher.url)
  url.title = rule.matcher.url
  meta.append(
    el("span", `aw-bd aw-m aw-${rule.matcher.method === "*" ? "GET" : rule.matcher.method}`, rule.matcher.method),
    url,
    typeof summary === "string" ? el("span", "aw-bd aw-s", summary) : summary,
  )
  open.append(meta)
  const hits = el("span", "aw-xs aw-mu")
  ctx.watch((state) => {
    const count = state.ruleHits[rule.id] ?? 0
    hits.textContent = count ? `${count} hit${count === 1 ? "" : "s"}` : ""
  })
  row.append(
    open,
    hits,
    iconButton(
      "aw-btn aw-gh aw-ic aw-sm",
      "close",
      `Delete ${rule.label}`,
      () => {
        ctx.deleteRule(rule.id)
        ctx.go(screen)
      },
      ctx.signal,
    ),
  )
  return row
}

function ruleList(
  ctx: Ctx,
  rules: Rule[],
  empty: string,
  summary: (rule: Rule) => string | Node,
  onOpen: (rule: Rule) => void,
): HTMLElement {
  const list = el("div", "aw-card aw-list")
  if (!rules.length) return el("div", "aw-empty", empty)
  for (const rule of rules) list.append(ruleRow(ctx, rule, summary(rule), () => onOpen(rule)))
  return list
}

function section(title: string, count: number, ...children: Node[]): HTMLElement {
  const wrapper = el("div", "aw-col aw-gap8")
  wrapper.append(group("aw-row", el("span", "aw-lbl", title), el("span", "aw-bd aw-s", String(count))))
  wrapper.append(...children)
  return wrapper
}

function dashButton(ctx: Ctx, label: string, onClick: () => void): HTMLButtonElement {
  const control = button("aw-btn aw-dash aw-w", label, onClick, ctx.signal)
  control.prepend(icon("plus", "aw-i14"))
  return control
}

const TRAFFIC_TITLE: Record<RuleKind, [string, string]> = {
  mock: ["Matched traffic", "No matched traffic yet"],
  chaos: ["Fault log", "No faults applied yet"],
  intercept: ["Traffic log", "No intercepted traffic yet"],
  route: ["Routed traffic", "No routed traffic yet"],
}

function matchedTraffic(ctx: Ctx, kind: RuleKind): HTMLElement {
  const rows = el("div", "aw-card aw-list")
  const wrapper = el("div", "aw-col aw-gap8")
  const count = el("span", "aw-bd aw-s", "0")
  wrapper.append(
    group("aw-row", el("span", "aw-lbl", TRAFFIC_TITLE[kind][0]), count),
    rows,
  )
  ctx.watch((state) => {
    const ids = new Set((state.config.rules ?? []).filter((rule) => rule.kind === kind).map((rule) => rule.id))
    // Settings caps this module's log; the screen shows what the cap keeps, newest first.
    const entries = state.matched
      .filter((item) => ids.has(item.ruleId))
      .slice(-logLimit(state.config.profile, kind))
      .reverse()
    count.textContent = String(entries.length)
    rows.replaceChildren()
    for (const entry of entries) {
      const path = el("span", "aw-grow aw-tr aw-mono aw-xs", entry.url ? new URL(entry.url).pathname : "—")
      path.title = entry.url
      const line = group(
        "aw-li aw-row aw-gap8",
        el("span", `aw-bd aw-m aw-${entry.method || "GET"}`, entry.method || "·"),
        path,
        el("span", "aw-xs aw-mu", entry.outcome),
      )
      if (entry.body == null) {
        rows.append(line)
        continue
      }
      // Bodies are kept only while Settings asks for them, so a row carries one or says nothing.
      const body = disclosure("Response body", el("pre", "aw-code aw-wrap", prettyJson(entry.body) ?? entry.body))
      body.classList.add("aw-bodylog")
      rows.append(group("aw-col", line, body))
    }
    if (!entries.length) rows.replaceChildren(el("div", "aw-empty", TRAFFIC_TITLE[kind][1]))
  })
  return wrapper
}

function editorHeading(ctx: Ctx, text: string, onBack: () => void) {
  // Mock and Chaos are tab screens, so the panel's Back sub-header stays hidden. The editor
  // carries its own Back control, exactly as MockRule.html and ChaosRule.html do.
  const back = button("aw-btn aw-gh aw-sm", "Back", onBack, ctx.signal)
  back.prepend(icon("back", "aw-i14"))
  const title = el("div", "aw-h", text)
  title.tabIndex = -1
  return { row: group("aw-row aw-gap8", back, title), title }
}

/* ── Mock ──────────────────────────────────────────────────────────────────── */

function slotFields(ctx: Ctx, slot: MockSlot, index: number, onRemove?: () => void, numbered = true): HTMLElement {
  const wrapper = card()
  const status = numberField(`Status ${index + 1}`, slot.status, (value) => (slot.status = value), ctx.signal, 100, 599)
  const delay = numberField(`Delay (ms) ${index + 1}`, slot.delayMs, (value) => (slot.delayMs = value), ctx.signal, 0, 60000)
  const fault = selectField(
    `Fault mode ${index + 1}`,
    [
      ["none", "None (static response)"],
      ["network-error", "Network error"],
      ["timeout", "Timeout"],
    ] as const,
    slot.fault,
    (value) => (slot.fault = value),
    ctx.signal,
  )
  const body = el("textarea", "aw-ta aw-mono")
  body.value = slot.body
  body.placeholder = "Response body JSON"
  body.setAttribute("aria-label", `Body ${index + 1}`)
  const validity = el("p", "aw-hint")
  validity.setAttribute("role", "status")
  const check = () => {
    slot.body = body.value
    if (!body.value.trim()) return (validity.textContent = "Empty body.")
    try {
      JSON.parse(body.value)
      validity.textContent = "Valid JSON."
    } catch {
      validity.textContent = "Not valid JSON — sent as raw text."
    }
  }
  body.addEventListener("input", check, { signal: ctx.signal })
  check()
  const headers = el("textarea", "aw-ta aw-mono")
  headers.value = slot.headers
  headers.placeholder = "Name: Value — one per line"
  headers.setAttribute("aria-label", `Response headers ${index + 1}`)
  headers.addEventListener("input", () => (slot.headers = headers.value), { signal: ctx.signal })
  const head = group("aw-row", caption(numbered ? `Response ${index + 1}` : "Response"))
  if (onRemove)
    head.append(iconButton("aw-btn aw-gh aw-ic aw-xs2", "trash", `Remove response ${index + 1}`, onRemove, ctx.signal))
  wrapper.append(
    head,
    group("aw-g3", status.field, delay.field, fault.field),
    labeledAction(`Body ${index + 1}`, body, formatJsonButton(body, ctx.signal)),
    validity,
    labeled(`Response headers ${index + 1}`, headers),
    el(
      "p",
      "aw-hint",
      "A synthetic Set-Cookie header is visible to the caller but cannot update the browser cookie jar.",
    ),
  )
  return wrapper
}

function mockEditor(ctx: Ctx, screen: HTMLElement, original: MockRule, isNew: boolean) {
  const draft: MockRule = structuredClone(original)
  const detached = { value: false }
  const endpoints = ctx.state().config.endpoints
  const back = () => ctx.go("mock")
  const notice = el("p", "aw-hint")
  notice.setAttribute("role", "status")

  const rebuild = () => {
    const heading = editorHeading(ctx, isNew ? "New mock rule" : "Edit mock rule", back)
    const label = textField("Label", draft.label, (value) => (draft.label = value), ctx.signal, false)
    const picker = endpointPicker(draft, endpoints, ctx, () => {
      detached.value = false
      rebuild()
    })
    const matcher = matcherFields(draft.matcher, ctx, () => {
      if (draft.endpointId) {
        detached.value = true
        notice.textContent = "Method or URL edited — this rule detaches from its endpoint on save."
      }
    })
    const mode = selectField(
      "Response mode",
      [
        ["static", "Static response"],
        ["sequence", "Response sequence"],
      ] as const,
      draft.mode,
      (value) => {
        draft.mode = value
        if (value === "sequence" && draft.slots.length < 2) draft.slots.push(defaultMockSlot())
        rebuild()
      },
      ctx.signal,
    )
    const priority = numberField("Priority", draft.priority, (value) => (draft.priority = value), ctx.signal, -999, 999)
    const enabled = checkField("Rule enabled", draft.enabled, (value) => (draft.enabled = value), ctx.signal)

    const responses = el("div", "aw-col aw-gap12")
    const renderSlots = () => {
      responses.replaceChildren()
      if (draft.mode === "static") {
        responses.append(slotFields(ctx, draft.slots[0]!, 0, undefined, false))
        return
      }
      draft.slots.forEach((slot, index) =>
        responses.append(
          slotFields(ctx, slot, index, draft.slots.length > 1 ? () => {
            draft.slots.splice(index, 1)
            renderSlots()
          } : undefined),
        ),
      )
      const add = dashButton(ctx, "Add response to sequence", () => {
        draft.slots.push(defaultMockSlot())
        renderSlots()
      })
      const exhaustion = selectField(
        "When the sequence is exhausted",
        [
          ["repeat-last", "Repeat the last response"],
          ["loop", "Loop from the start"],
          ["network-error", "Fail with a simulated network error"],
        ] as const,
        draft.exhaustion,
        (value) => (draft.exhaustion = value),
        ctx.signal,
      )
      const position = el("p", "aw-hint")
      position.setAttribute("role", "status")
      const reset = button("aw-btn aw-out aw-sm aw-self", "Reset position", () => ctx.resetSequence(draft.id), ctx.signal)
      ctx.watch((state) => {
        const cursor = state.ruleCursors[draft.id] ?? 0
        position.textContent = `Next response: ${Math.min(cursor, draft.slots.length - 1) + 1} of ${draft.slots.length}${cursor >= draft.slots.length ? " · exhausted" : ""}. Slots are reserved in request-arrival order; an aborted request still consumes its slot.`
      })
      responses.append(add, exhaustion.field, position, reset)
    }
    renderSlots()

    const sample = button(
      "aw-btn aw-out aw-w",
      "Use recorded response",
      () => {
        const recorded = endpoints.find((item) => item.id === draft.endpointId)?.sampleResponse
        if (!recorded) return
        const slot = draft.slots[0]!
        slot.status = recorded.status
        slot.body = prettyJson(recorded.body) ?? recorded.body
        slot.headers = recorded.headers.map((header) => `${header.name}: ${header.value}`).join("\n")
        rebuild()
      },
      ctx.signal,
    )
    const recorded = endpoints.find((item) => item.id === draft.endpointId)?.sampleResponse
    sample.disabled = !recorded
    sample.title = recorded ? "Copy the endpoint's recorded status, body and headers" : "Link an endpoint with a recorded response first"

    const save = button(
      "aw-btn aw-pri aw-grow",
      "Save",
      () => {
        if (!draft.matcher.url.trim()) {
          notice.textContent = "Enter a URL to match."
          return
        }
        if (detached.value) draft.endpointId = undefined
        ctx.saveRule({ ...draft, label: draft.label.trim() || "Mock rule", revision: original.revision + 1 })
        back()
      },
      ctx.signal,
    )
    save.prepend(icon("edit", "aw-i14"))
    const remove = button(
      "aw-btn aw-dst aw-grow",
      "Delete",
      () => {
        ctx.deleteRule(draft.id)
        back()
      },
      ctx.signal,
    )
    remove.prepend(icon("trash", "aw-i14"))
    ctx.chrome({ title: draft.label || "Mock rule", onBack: back, actions: isNew ? [save, button("aw-btn aw-out aw-grow", "Cancel", back, ctx.signal)] : [save, remove] })

    screen.replaceChildren(
      heading.row,
      label.field,
      picker,
      ...matcher,
      mode.field,
      responses,
      sample,
      conditionFields(draft.matcher, ctx),
      group("aw-row aw-gap8", priority.field, enabled.field),
      notice,
    )
    screen.closest(".aw-body")?.scrollTo(0, 0)
    heading.title.focus({ preventScroll: true })
  }
  rebuild()
}

export function mockScreen(ctx: Ctx): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const rules = (ctx.state().config.rules ?? []).filter((rule): rule is MockRule => rule.kind === "mock")
  const open = (rule: MockRule, isNew = false) => mockEditor(ctx, screen, rule, isNew)
  const create = (endpoint?: Endpoint) => {
    const rule = defaultMockRule(ctx.state().config.profile.id, ctx.nextRuleSeq())
    if (endpoint) {
      rule.endpointId = endpoint.id
      rule.label = labelFromEndpoint(endpoint)
      rule.matcher = matcherFromEndpoint(endpoint)
    }
    open(rule, true)
  }
  const summary = (rule: Rule) => {
    const mock = rule as MockRule
    if (mock.mode === "sequence") return `${mock.slots.length} step sequence`
    const status = mock.slots[0]?.status ?? 200
    // A fragment, so the arrow and badge are meta-line children themselves and keep the row's gap
    // and shrink behaviour; a wrapper would shrink and clip the badge on a long URL.
    const parts = document.createDocumentFragment()
    parts.append(
      el("span", "aw-mu", "\u2192"),
      el("span", `aw-bd ${status < 400 ? "aw-gr" : "aw-rd"}`, String(status)),
    )
    return parts
  }
  const linked = rules.filter((rule) => rule.endpointId)
  const adhoc = rules.filter((rule) => !rule.endpointId)
  const endpoints = ctx.state().config.endpoints
  const fromEndpoint = dashButton(ctx, "Add rule from endpoint", () => create(endpoints[0]))
  fromEndpoint.disabled = !endpoints.length
  fromEndpoint.title = endpoints.length ? "Create a rule linked to an endpoint" : "Add an endpoint first"
  screen.append(
    moduleHeader(ctx, "mock", "Mock Server", () => ctx.setModuleActive("mock", !ctx.state().moduleActive.mock)),
    section("Endpoint rules", linked.length, ruleList(ctx, linked, "No endpoint rules", summary, (rule) => open(rule as MockRule)), fromEndpoint),
    section("Ad-hoc rules", adhoc.length, ruleList(ctx, adhoc, "No ad-hoc rules", summary, (rule) => open(rule as MockRule)), dashButton(ctx, "Add ad-hoc rule", () => create())),
    matchedTraffic(ctx, "mock"),
    el("p", "aw-hint", "A selected mock makes no upstream request. Exhaustion never falls back to real traffic."),
  )
  return screen
}

/* ── Chaos ─────────────────────────────────────────────────────────────────── */

function faultFields(ctx: Ctx, draft: ChaosRule, rebuild: () => void): HTMLElement {
  const wrapper = card()
  const kind = selectField(
    "Fault type",
    (Object.keys(FAULT_LABELS) as ChaosFault["kind"][]).map((value) => [value, FAULT_LABELS[value]] as const),
    draft.fault.kind,
    (value) => {
      draft.fault =
        value === "status"
          ? { kind: "status", status: 500, body: "" }
          : value === "latency"
            ? { kind: "latency", delayMs: 1000 }
            : value === "random-latency"
              ? { kind: "random-latency", minMs: 250, maxMs: 2000 }
              : value === "timeout"
                ? { kind: "timeout", timeoutMs: 3000 }
                : value === "replay"
                  ? { kind: "replay", copies: 1, gapMs: 0 }
                  : value === "malformed-json"
                    ? { kind: "malformed-json" }
                    : { kind: "network-error" }
      rebuild()
    },
    ctx.signal,
  )
  wrapper.append(caption("Fault type"), kind.field)
  const fault = draft.fault
  if (fault.kind === "status") {
    const status = numberField("Fault status", fault.status, (value) => (fault.status = value), ctx.signal, 100, 599)
    const body = textField("Fault body", fault.body, (value) => (fault.body = value), ctx.signal)
    body.input.placeholder = '{"error":"…"}'
    wrapper.append(status.field, body.field)
  } else if (fault.kind === "latency") {
    const delay = numberField("Delay (ms)", fault.delayMs, (value) => (fault.delayMs = value), ctx.signal, 0, 60000)
    wrapper.append(delay.field)
  } else if (fault.kind === "random-latency") {
    const min = numberField("Minimum delay (ms)", fault.minMs, (value) => (fault.minMs = value), ctx.signal, 0, 60000)
    const max = numberField("Maximum delay (ms)", fault.maxMs, (value) => (fault.maxMs = value), ctx.signal, 0, 60000)
    wrapper.append(group("aw-g2", min.field, max.field))
  } else if (fault.kind === "timeout") {
    const timeout = numberField("Timeout (ms)", fault.timeoutMs, (value) => (fault.timeoutMs = value), ctx.signal, 0, 120000)
    wrapper.append(
      timeout.field,
      el("p", "aw-hint", "Caller cancellation wins. In real-traffic mode the upstream request cannot be rolled back."),
    )
  } else if (fault.kind === "replay") {
    const copies = numberField(
      "Additional copies",
      fault.copies,
      (value) => {
        fault.copies = value
        rebuild()
      },
      ctx.signal,
      0,
      MAX_REPLAY_COPIES,
    )
    const gap = numberField("Delay between copies (ms)", fault.gapMs, (value) => (fault.gapMs = value), ctx.signal, 0, 60000)
    const total = el("p", "aw-hint")
    total.setAttribute("role", "status")
    total.textContent = `${draft.matcher.method} · ${1 + fault.copies} total dispatches per matching request (1 primary + ${fault.copies}). The caller receives only the primary result; replay is never an automatic retry.`
    wrapper.append(group("aw-g2", copies.field, gap.field), total)
  } else if (fault.kind === "malformed-json") {
    wrapper.append(el("p", "aw-hint", "Returns deliberately invalid JSON text. In real-traffic mode an unsupported response body is skipped, not faked."))
  } else {
    wrapper.append(el("p", "aw-hint", "Produces a transport-appropriate failure. In real-traffic mode the upstream request has already been sent."))
  }
  return wrapper
}

function chaosEditor(ctx: Ctx, screen: HTMLElement, original: ChaosRule, isNew: boolean) {
  const draft: ChaosRule = structuredClone(original)
  const detached = { value: false }
  const endpoints = ctx.state().config.endpoints
  const back = () => ctx.go("chaos")
  const notice = el("p", "aw-hint")
  notice.setAttribute("role", "status")

  const rebuild = () => {
    const heading = editorHeading(ctx, isNew ? "New chaos rule" : "Edit chaos rule", back)
    const label = textField("Label", draft.label, (value) => (draft.label = value), ctx.signal, false)
    const picker = endpointPicker(draft, endpoints, ctx, () => {
      detached.value = false
      rebuild()
    })
    const matcher = matcherFields(draft.matcher, ctx, () => {
      if (draft.endpointId) {
        detached.value = true
        notice.textContent = "Method or URL edited — this rule detaches from its endpoint on save."
      }
    })
    const mode = card()
    mode.append(
      caption("Mode"),
      group(
        "aw-col aw-gap8",
        radioCard(
          "Synthetic",
          "No network call — the fault response is generated",
          "#f97316",
          draft.mode === "synthetic",
          () => {
            draft.mode = "synthetic"
            rebuild()
          },
          ctx.signal,
        ),
        radioCard(
          "Real traffic",
          "One real dispatch, then the fault is applied to its result",
          "#3b82f6",
          draft.mode === "real",
          () => {
            draft.mode = "real"
            rebuild()
          },
          ctx.signal,
        ),
      ),
    )
    mode.querySelector(".aw-col")?.setAttribute("role", "radiogroup")
    mode.querySelector(".aw-col")?.setAttribute("aria-label", "Mode")

    const sampling = card()
    const probability = numberField("Probability (%)", draft.probability, (value) => (draft.probability = value), ctx.signal, 0, 100)
    const seed = textField("Seed", draft.seed, (value) => (draft.seed = value), ctx.signal)
    seed.input.placeholder = "blank = unseeded"
    const budget = numberField("Hit budget", draft.budget, (value) => (draft.budget = value), ctx.signal, 0, 10000)
    sampling.append(
      caption("Sampling"),
      group("aw-g3", probability.field, seed.field, budget.field),
      el(
        "p",
        "aw-hint",
        "Sampled once per matching request; a failed sample means no chaos on that request. A seed repeats the same ordered stream, not arbitrary concurrent traffic. Hit budget 0 means no budget.",
      ),
    )
    const dispatch = card()
    const pre = numberField("Dispatch delay (ms)", draft.preDelayMs, (value) => (draft.preDelayMs = value), ctx.signal, 0, 60000)
    dispatch.append(
      caption("Dispatch"),
      pre.field,
      el(
        "p",
        "aw-hint",
        "Dispatch delay waits before the real request is sent. A latency fault is a delivery delay applied after the response arrives. Neither is bandwidth throttling.",
      ),
    )

    const priority = numberField("Priority", draft.priority, (value) => (draft.priority = value), ctx.signal, -999, 999)
    const enabled = checkField("Rule enabled", draft.enabled, (value) => (draft.enabled = value), ctx.signal)

    const save = button(
      "aw-btn aw-pri aw-grow",
      "Save",
      () => {
        if (!draft.matcher.url.trim()) {
          notice.textContent = "Enter a URL to match."
          return
        }
        if (draft.mode === "synthetic" && draft.fault.kind === "replay") {
          notice.textContent = "Replay dispatches real requests. Choose Real traffic mode, or another fault."
          return
        }
        if (detached.value) draft.endpointId = undefined
        ctx.saveRule({ ...draft, label: draft.label.trim() || "Chaos rule", revision: original.revision + 1 })
        back()
      },
      ctx.signal,
    )
    save.prepend(icon("edit", "aw-i14"))
    const remove = button(
      "aw-btn aw-dst aw-grow",
      "Delete",
      () => {
        ctx.deleteRule(draft.id)
        back()
      },
      ctx.signal,
    )
    remove.prepend(icon("trash", "aw-i14"))
    ctx.chrome({ title: draft.label || "Chaos rule", onBack: back, actions: isNew ? [save, button("aw-btn aw-out aw-grow", "Cancel", back, ctx.signal)] : [save, remove] })

    const children: Node[] = [heading.row, label.field, picker, ...matcher, mode, faultFields(ctx, draft, rebuild), sampling]
    if (draft.mode === "real") children.push(dispatch)
    children.push(conditionFields(draft.matcher, ctx), group("aw-row aw-gap8", priority.field, enabled.field), notice)
    screen.replaceChildren(...children)
    screen.closest(".aw-body")?.scrollTo(0, 0)
    heading.title.focus({ preventScroll: true })
  }
  rebuild()
}

export function chaosScreen(ctx: Ctx): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const rules = (ctx.state().config.rules ?? []).filter((rule): rule is ChaosRule => rule.kind === "chaos")
  const open = (rule: ChaosRule, isNew = false) => chaosEditor(ctx, screen, rule, isNew)
  const create = (preset?: string, endpoint?: Endpoint) => {
    let rule = defaultChaosRule(ctx.state().config.profile.id, ctx.nextRuleSeq())
    if (preset) rule = CHAOS_PRESETS[preset]!(rule)
    if (endpoint) {
      rule.endpointId = endpoint.id
      rule.label = `${rule.label} · ${labelFromEndpoint(endpoint)}`
      rule.matcher = { ...rule.matcher, ...matcherFromEndpoint(endpoint) }
    }
    open(rule, true)
  }
  const presets = card()
  const choices = el("div", "aw-row aw-gap6")
  choices.style.flexWrap = "wrap"
  for (const name of ["Slow API", "Very slow API", "Random latency", "Server error 500", "Service unavailable 503", "Bad gateway 502"])
    choices.append(button("aw-btn aw-out aw-sm", name, () => create(name), ctx.signal))
  const more = el("div", "aw-row aw-gap6")
  more.style.flexWrap = "wrap"
  for (const name of ["Timeout", "Network failure", "Malformed JSON", "Request replay"])
    more.append(button("aw-btn aw-out aw-sm", name, () => create(name), ctx.signal))
  presets.append(
    group("aw-row", el("span", "aw-h aw-cap aw-grow", "Presets"), el("span", "aw-xs aw-mu", "One click opens a rule")),
    choices,
    disclosure("More…", more),
  )
  const endpoints = ctx.state().config.endpoints
  const fromEndpoint = dashButton(ctx, "From endpoint", () => create(undefined, endpoints[0]))
  fromEndpoint.disabled = !endpoints.length
  fromEndpoint.title = endpoints.length ? "Create a rule linked to an endpoint" : "Add an endpoint first"
  const summary = (rule: Rule) => {
    const chaos = rule as ChaosRule
    return `${chaos.mode === "real" ? "real" : "synthetic"} · ${FAULT_LABELS[chaos.fault.kind]} · ${chaos.probability}%`
  }
  screen.append(
    moduleHeader(ctx, "chaos", "Chaos Engineering", () => ctx.setModuleActive("chaos", !ctx.state().moduleActive.chaos)),
    presets,
    section(
      "Rules",
      rules.length,
      ruleList(ctx, rules, "No chaos rules configured", summary, (rule) => open(rule as ChaosRule)),
      group("aw-g2", dashButton(ctx, "Add rule", () => create()), fromEndpoint),
    ),
    matchedTraffic(ctx, "chaos"),
  )
  return screen
}

/* ── Intercept ─────────────────────────────────────────────────────────────── */

const PATCH_OPS = [
  ["replace", "Replace"],
  ["remove", "Remove"],
  ["add", "Add"],
  ["nullify", "Nullify"],
  ["move", "Move"],
  ["copy", "Copy"],
  ["test", "Test"],
] as const

type PatchChoice = (typeof PATCH_OPS)[number][0]

/** "Nullify" is a convenience that emits `replace` with `null`; it is not a standard operation. */
function choiceOf(operation: PatchOp): PatchChoice {
  return operation.op === "replace" && operation.value === null ? "nullify" : operation.op
}

function encodeValue(operation: PatchOp): string {
  return operation.value === undefined ? "" : JSON.stringify(operation.value)
}

function decodeValue(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // A bare word is the common case; keep it as the string the author typed.
    return text
  }
}

function patchProblem(operation: PatchOp): string | undefined {
  if (!PATCH_OPS.some(([key]) => key === operation.op)) return `unsupported operation "${operation.op}"`
  const path = parsePointer(operation.path)
  if (typeof path === "object" && "error" in path) return path.error
  if (operation.op === "move" || operation.op === "copy") {
    if (!operation.from) return `${operation.op} needs a "from" pointer`
    const from = parsePointer(operation.from)
    if (typeof from === "object" && "error" in from) return from.error
  }
  return undefined
}

/**
 * The friendly rows and the raw JSON are two views of the same array: a row edit rewrites the raw
 * text, and a raw edit that parses rebuilds the rows. Nothing here executes an imported snippet.
 */
function patchEditor(ctx: Ctx, transform: Transform, stage: "Request" | "Response", sample?: string, endpointName?: string): HTMLElement {
  const response = stage === "Response"
  const rows = el("div", "aw-col aw-gap8")
  const raw = el("textarea", "aw-ta aw-mono")
  raw.setAttribute("aria-label", `${stage} JSON Patch raw JSON`)
  const status = el("p", "aw-hint")
  status.setAttribute("role", "status")
  const paths = el("datalist")
  paths.id = `aw-paths-${stage.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`
  // What Load has to offer, stated before it is pressed, as the reference screen states it.
  const available = (() => {
    try {
      return sample ? pointers(JSON.parse(sample)).length : 0
    } catch {
      return 0
    }
  })()
  const pathHint = el("span", "aw-row aw-hint aw-gap6")
  if (available && endpointName) {
    pathHint.append(icon("book", "aw-i12"), document.createTextNode(`Paths from ${endpointName} · ${available} paths`))
  }

  const report = () => {
    const problems = transform.patch.map(patchProblem).filter(Boolean)
    status.textContent = problems.length
      ? `${problems.length} problem: ${problems.join("; ")}`
      : `${transform.patch.length} operation${transform.patch.length === 1 ? "" : "s"}. Applied in order on an isolated value and committed only if all succeed.`
  }
  const syncRaw = () => {
    raw.value = JSON.stringify(transform.patch, null, 2)
    report()
  }

  const render = () => {
    rows.replaceChildren()
    transform.patch.forEach((operation, index) => {
      const row = card()
      const choice = selectField(
        `${stage} operation ${index + 1}`,
        PATCH_OPS,
        choiceOf(operation),
        (value) => {
          if (value === "nullify") transform.patch[index] = { op: "replace", path: operation.path, value: null }
          else if (value === "remove") transform.patch[index] = { op: "remove", path: operation.path }
          else if (value === "move" || value === "copy")
            transform.patch[index] = { op: value, path: operation.path, from: operation.from ?? "" }
          else transform.patch[index] = { op: value, path: operation.path, value: operation.value ?? null }
          render()
          syncRaw()
        },
        ctx.signal,
      )
      const path = textField(`${stage} JSON Pointer ${index + 1}`, operation.path, (value) => {
        operation.path = value
        syncRaw()
      }, ctx.signal)
      path.input.placeholder = "/items/0/name"
      path.input.setAttribute("list", paths.id)
      const remove = iconButton(
        "aw-btn aw-gh aw-ic aw-xs2",
        "trash",
        `Remove ${stage.toLowerCase()} operation ${index + 1}`,
        () => {
          transform.patch.splice(index, 1)
          render()
          syncRaw()
        },
        ctx.signal,
      )
      row.append(group("aw-row aw-gap8", choice.field, remove), path.field)
      if (operation.op === "move" || operation.op === "copy") {
        const from = textField(`${stage} from pointer ${index + 1}`, operation.from ?? "", (value) => {
          operation.from = value
          syncRaw()
        }, ctx.signal)
        from.input.placeholder = "/source/path"
        row.append(from.field)
      } else if (operation.op !== "remove" && choiceOf(operation) !== "nullify") {
        const value = textField(`${stage} JSON value ${index + 1}`, encodeValue(operation), (text) => {
          operation.value = decodeValue(text)
          syncRaw()
        }, ctx.signal)
        value.input.placeholder = '"text", 42, true or {"a":1}'
        row.append(value.field)
      }
      rows.append(row)
    })
  }

  raw.addEventListener(
    "change",
    () => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw.value || "[]")
      } catch (error) {
        status.textContent = `Raw JSON not parsed: ${(error as Error).message}. The saved operations are unchanged.`
        return
      }
      if (!Array.isArray(parsed)) {
        status.textContent = "Raw JSON must be an array of operations. The saved operations are unchanged."
        return
      }
      transform.patch = parsed as PatchOp[]
      render()
      report()
    },
    { signal: ctx.signal },
  )

  const add = dashButton(ctx, "Add operation", () => {
    // A null value would read back as the "Nullify" convenience, so a new row starts empty.
    transform.patch.push({ op: "replace", path: "", value: "" })
    render()
    syncRaw()
  })
  const load = button(
    "aw-btn aw-out aw-sm",
    "Load",
    () => {
      let parsed: unknown
      try {
        parsed = JSON.parse(sample ?? "")
      } catch {
        status.textContent = "The linked endpoint has no JSON sample response to read paths from."
        return
      }
      const found = pointers(parsed)
      paths.replaceChildren()
      for (const pointer of found.slice(0, 200)) {
        const option = el("option")
        option.value = pointer
        paths.append(option)
      }
      status.textContent = `${found.length} path${found.length === 1 ? "" : "s"} from the linked sample response are now suggested in the pointer fields.`
    },
    ctx.signal,
  )
  load.disabled = !sample
  load.title = sample ? "Suggest JSON Pointers from the linked sample response" : "Link an endpoint with a sample response first"

  // InterceptRule.html offers the four everyday operations as one-click adds beside the list. The
  // full set, including move, copy and test, stays on each row's own select.
  const quickAdd = group(
    "aw-row aw-gap6",
    ...PATCH_OPS.slice(0, 4).map(([choice, label]) => {
      const tone = { replace: "aw-gr", remove: "aw-rd", add: "aw-bl", nullify: "aw-am" }[choice as string] ?? ""
      const quick = button(`aw-bd ${tone} aw-quick`, label, () => {
        if (choice === "remove") transform.patch.push({ op: "remove", path: "" })
        else if (choice === "nullify") transform.patch.push({ op: "replace", path: "", value: null })
        else transform.patch.push({ op: choice as "replace" | "add", path: "", value: "" })
        render()
        syncRaw()
      }, ctx.signal)
      quick.setAttribute("aria-label", `Add ${stage.toLowerCase()} ${label.toLowerCase()} operation`)
      return quick
    }),
  )

  // The summary carries the name, so the textarea inside needs no second visible label; its own
  // aria-label still names the stage.
  const rawPanel = disclosure(
    "Raw JSON",
    group("aw-row aw-actions", el("span", "aw-grow"), formatJsonButton(raw, ctx.signal)),
    raw,
  )

  render()
  syncRaw()
  const section = el("div", "aw-fld")
  // Paths are read from the linked endpoint's sample response, so the Load control and the path
  // count belong to the response stage; the request stage gets the plain editor.
  section.append(
    response ? group("aw-row aw-actions", el("span", "aw-lbl aw-grow", "JSON Patch"), load) : el("span", "aw-lbl", "JSON Patch"),
    ...(response ? [quickAdd] : []),
    rows,
    add,
    response
      ? group("aw-row aw-between", rawPanel, pathHint)
      : rawPanel,
    status,
    paths,
  )
  return section
}

function transformCard(ctx: Ctx, transform: Transform, stage: "Request" | "Response", sample?: string, endpointName?: string): HTMLElement {
  const wrapper = card()
  wrapper.append(cardHeading(`${stage} transform`))
  if (stage === "Response") {
    const status = numberField("Status override", transform.status, (value) => (transform.status = value), ctx.signal, 0, 599)
    // The reference states the no-op beside the field rather than under it, and leaves the field
    // narrow: a status is three characters wide.
    status.input.classList.add("aw-w110")
    status.input.placeholder = "—"
    // The model stores "keep the original" as 0; the reference shows that state as an empty field,
    // so the zero is blanked after the field commits it.
    const blankZero = () => {
      if (!transform.status) status.input.value = ""
    }
    blankZero()
    status.input.addEventListener("change", blankZero, { signal: ctx.signal })
    wrapper.append(
      group(
        "aw-fld",
        el("span", "aw-lbl", "Status override"),
        group("aw-row", status.input, el("span", "aw-hint", "Blank keeps the original status; only 200–599 can be delivered.")),
      ),
    )
  }
  const set = el("textarea", "aw-ta aw-mono")
  set.value = transform.setHeaders
  set.placeholder = "Name: Value — one per line"
  set.setAttribute("aria-label", `${stage} set headers`)
  const setNotice = el("p", "aw-hint")
  setNotice.setAttribute("role", "status")
  const checkHeaders = () => {
    transform.setHeaders = set.value
    if (stage !== "Request") return
    const refused = Object.keys(parseHeaderLines(set.value)).filter(forbiddenRequestHeader)
    setNotice.textContent = refused.length
      ? `The browser forbids setting ${refused.join(", ")} on a request; remove ${refused.length === 1 ? "it" : "them"} to save.`
      : ""
  }
  set.addEventListener("input", checkHeaders, { signal: ctx.signal })
  checkHeaders()
  const remove = el("textarea", "aw-ta aw-mono")
  remove.value = transform.removeHeaders
  remove.placeholder = "One header name per line"
  remove.setAttribute("aria-label", `${stage} remove headers`)
  remove.addEventListener("input", () => (transform.removeHeaders = remove.value), { signal: ctx.signal })
  const find = textField("Body find", transform.body.find, (value) => (transform.body.find = value), ctx.signal)
  find.input.placeholder = "literal text"
  find.input.setAttribute("aria-label", `${stage} body find`)
  const replace = textField("Replace", transform.body.replace, (value) => (transform.body.replace = value), ctx.signal)
  replace.input.setAttribute("aria-label", `${stage} body replace`)
  const scope = selectField(
    `${stage} replace scope`,
    [
      ["first", "First match"],
      ["all", "All matches"],
    ] as const,
    transform.body.scope,
    (value) => (transform.body.scope = value),
    ctx.signal,
  )
  // InterceptRule.html orders one card per stage: headers, then the patch, then find/replace.
  // The scope select has no place in the reference's two-column row, so it sits with the note that
  // explains what a replacement does, in the same field-plus-hint shape the status override uses.
  scope.select.classList.add("aw-w140")
  wrapper.append(
    labeled("Set headers", set),
    setNotice,
    labeled("Remove headers", remove),
    patchEditor(ctx, transform, stage, sample, endpointName),
    group("aw-g2 aw-gap10", find.field, replace.field),
    group(
      "aw-row aw-gap8",
      scope.select,
      el(
        "span",
        "aw-hint",
        "Literal — no regular expressions. A rewritten body drops the original content-length and content-encoding.",
      ),
    ),
  )
  return wrapper
}


/* ── Paused requests (M7) ──────────────────────────────────────────────────── */

const headerLines = (headers: Record<string, string>) =>
  Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n")

/**
 * One waiting request. The reference screens have no paused queue, so this follows plan §8.5: id,
 * stage, method/URL, age, matching rule, the editable supported fields, Continue and Abort.
 */
function pausedCard(ctx: Ctx, entry: PausedEntry) {
  const wrapper = card()
  wrapper.classList.add("aw-paused")
  const stage = entry.stage === "request" ? "Request stage" : "Response stage"
  const path = el("span", "aw-grow aw-tr aw-mono aw-xs", entry.url)
  path.title = entry.url
  const age = document.createTextNode("0s")
  const ageLabel = el("span", "aw-xs aw-mu")
  ageLabel.append(age)
  const notice = el("p", "aw-hint")
  notice.setAttribute("role", "status")
  const stale = el("p", "aw-hint")

  const status = numberField(
    `Status for ${entry.id}`,
    entry.snapshot.status ?? 0,
    () => {},
    ctx.signal,
    100,
    599,
  )
  const headers = el("textarea", "aw-ta aw-mono")
  headers.value = headerLines(entry.snapshot.headers)
  headers.setAttribute("aria-label", `${stage} headers for ${entry.id}`)
  const body = el("textarea", "aw-ta aw-mono")
  body.value = entry.snapshot.body ?? ""
  body.setAttribute("aria-label", `${stage} body for ${entry.id}`)
  if (!entry.bodyEditable) {
    body.disabled = true
    body.placeholder = entry.bodyReason ?? "not editable at this stage"
  }

  const edited = (): PauseEdit | undefined => {
    const next: PauseEdit = { headers: parseHeaderLines(headers.value) }
    let changed = headerLines(next.headers) !== headerLines(entry.snapshot.headers)
    if (entry.bodyEditable) {
      next.body = body.value
      changed = changed || body.value !== (entry.snapshot.body ?? "")
    }
    if (entry.stage === "response") {
      const value = Math.min(599, Math.max(100, Math.round(Number(status.input.value) || 0)))
      next.status = value
      changed = changed || value !== entry.snapshot.status
    }
    return changed ? next : undefined
  }

  const resume = button(
    "aw-btn aw-pri aw-sm",
    "Continue",
    () => {
      const edit = edited()
      const refused =
        entry.stage === "request" && edit ? Object.keys(edit.headers).filter(forbiddenRequestHeader) : []
      if (refused.length) {
        notice.textContent = `The browser forbids setting ${refused.join(", ")} on a request; remove ${refused.length === 1 ? "that line" : "those lines"} to continue.`
        return
      }
      entry.resume(edit)
    },
    ctx.signal,
  )
  resume.prepend(icon("play", "aw-i12"))
  const stop = button("aw-btn aw-dst aw-sm", "Abort", () => entry.abort(), ctx.signal)

  wrapper.append(
    group(
      "aw-row aw-gap8",
      el("span", `aw-bd aw-m aw-${entry.method || "GET"}`, entry.method || "·"),
      path,
      el("span", "aw-bd aw-s", stage),
      ageLabel,
    ),
    el(
      "p",
      "aw-hint",
      `${entry.id} · ${entry.transport === "xhr" ? "XHR" : "fetch"} · rule ${entry.ruleLabel}`,
    ),
    stale,
    ...(entry.stage === "response" ? [status.field] : []),
    labeled(`${stage} headers`, headers),
    labeledAction(`${stage} body`, body, formatJsonButton(body, ctx.signal)),
    entry.bodyEditable
      ? el("p", "aw-hint", "Edits here are the final explicit override for this one request.")
      : el("p", "aw-hint", entry.bodyReason ?? "This body cannot be edited at this stage."),
    notice,
    group("aw-row aw-gap8", resume, stop),
  )
  return { wrapper, age, stale, entry }
}

export function pausedQueue(ctx: Ctx): HTMLElement {
  const wrapper = el("div", "aw-col aw-gap8")
  const count = el("span", "aw-bd aw-s", "0")
  const rows = el("div", "aw-col aw-gap8")
  const all = button("aw-btn aw-out aw-sm", "Continue all", () => ctx.continueAllPaused(), ctx.signal)
  wrapper.append(
    group("aw-row aw-gap8", el("span", "aw-lbl aw-grow", "Paused requests"), count, all),
    rows,
  )
  const cards = new Map<string, ReturnType<typeof pausedCard>>()
  const tick = () => {
    for (const made of cards.values())
      made.age.textContent = `${Math.max(0, Math.round((Date.now() - made.entry.at) / 1000))}s of ${Math.round((made.entry.deadlineAt - made.entry.at) / 1000)}s`
  }
  ctx.watch((state) => {
    count.textContent = String(state.paused.length)
    all.disabled = !state.paused.length
    const live = new Set(state.paused.map((entry) => entry.id))
    for (const [id, made] of [...cards])
      if (!live.has(id)) {
        made.wrapper.remove()
        cards.delete(id)
      }
    for (const entry of state.paused)
      if (!cards.has(entry.id)) {
        const made = pausedCard(ctx, entry)
        cards.set(entry.id, made)
        rows.append(made.wrapper)
      }
    // A rule edited or a profile switched while a request waits does not mutate that pause.
    for (const made of cards.values()) {
      const rule = state.config.rules?.find((item) => item.id === made.entry.ruleId)
      const stale =
        made.entry.profileId !== state.config.profile.id
          ? "Paused under a different profile — this request keeps the rule it matched."
          : !rule
            ? "The matching rule has been deleted — this request keeps the rule it matched."
            : rule.revision !== made.entry.revision
              ? "The matching rule has been edited since this request paused — the snapshot below is the one it matched."
              : ""
      made.stale.textContent = stale
    }
    if (!state.paused.length)
      rows.replaceChildren(
        el(
          "div",
          "aw-empty",
          "No paused requests. Enable a breakpoint on an intercept rule to pause matching traffic.",
        ),
      )
    else if (rows.firstElementChild?.classList.contains("aw-empty")) {
      rows.replaceChildren(...[...cards.values()].map((made) => made.wrapper))
    }
    tick()
  })
  const ticker = setInterval(tick, 1000)
  ctx.signal.addEventListener("abort", () => clearInterval(ticker), { once: true })
  return wrapper
}

function breakpointCard(ctx: Ctx, draft: InterceptRule): HTMLElement {
  const breakpoints = (draft.breakpoints ??= { request: false, response: false })
  const wrapper = card()
  const request = checkField(
    "Break on request",
    breakpoints.request,
    (value) => (breakpoints.request = value),
    ctx.signal,
  )
  const response = checkField(
    "Break on response",
    breakpoints.response,
    (value) => (breakpoints.response = value),
    ctx.signal,
  )
  wrapper.append(
    cardHeading("Breakpoints"),
    request.field,
    response.field,
    // The reference card carries no note, but these limits are real and are not guessable from
    // the two checkboxes, so they stay as one line rather than the earlier paragraph.
    el(
      "p",
      "aw-hint",
      `Paused requests wait on the Intercept screen: ${MAX_PAUSED_REQUESTS} at once, each continuing on its own after ${Math.round(PAUSE_DEADLINE_MS / 1000)}s. A caller's abort wins, and a request answered by a mock or a fault never pauses.`,
    ),
  )
  return wrapper
}

function interceptEditor(ctx: Ctx, screen: HTMLElement, original: InterceptRule, isNew: boolean) {
  const draft: InterceptRule = structuredClone(original)
  const detached = { value: false }
  const endpoints = ctx.state().config.endpoints
  const back = () => ctx.go("intercept")
  const notice = el("p", "aw-hint")
  notice.setAttribute("role", "status")

  const rebuild = () => {
    const heading = editorHeading(ctx, isNew ? "New intercept rule" : "Edit intercept rule", back)
    const label = textField("Label", draft.label, (value) => (draft.label = value), ctx.signal, false)
    const picker = endpointPicker(draft, endpoints, ctx, () => {
      detached.value = false
      rebuild()
    })
    const matcher = matcherFields(draft.matcher, ctx, () => {
      if (draft.endpointId) {
        detached.value = true
        notice.textContent = "Method or URL edited — this rule detaches from its endpoint on save."
      }
    })
    const linked = endpoints.find((item) => item.id === draft.endpointId)
    const sample = linked?.sampleResponse?.body
    const priority = numberField("Priority", draft.priority, (value) => (draft.priority = value), ctx.signal, -999, 999)
    const enabled = checkField("Rule enabled", draft.enabled, (value) => (draft.enabled = value), ctx.signal)

    const save = button(
      "aw-btn aw-pri aw-grow",
      "Save",
      () => {
        if (!draft.matcher.url.trim()) {
          notice.textContent = "Enter a URL to match."
          return
        }
        const refused = Object.keys(parseHeaderLines(draft.request.setHeaders)).filter(forbiddenRequestHeader)
        if (refused.length) {
          notice.textContent = `The browser forbids setting ${refused.join(", ")} on a request. Remove ${refused.length === 1 ? "that line" : "those lines"} from the request transform.`
          return
        }
        for (const [stage, transform] of [["request", draft.request], ["response", draft.response]] as const) {
          const problem = transform.patch.map(patchProblem).find(Boolean)
          if (problem) {
            notice.textContent = `${stage} JSON Patch: ${problem}`
            return
          }
        }
        if (detached.value) draft.endpointId = undefined
        ctx.saveRule({ ...draft, label: draft.label.trim() || "Intercept rule", revision: original.revision + 1 })
        back()
      },
      ctx.signal,
    )
    save.prepend(icon("edit", "aw-i14"))
    const remove = button(
      "aw-btn aw-dst aw-grow",
      "Delete",
      () => {
        ctx.deleteRule(draft.id)
        back()
      },
      ctx.signal,
    )
    remove.prepend(icon("trash", "aw-i14"))
    ctx.chrome({ title: draft.label || "Intercept rule", onBack: back, actions: isNew ? [save, button("aw-btn aw-out aw-grow", "Cancel", back, ctx.signal)] : [save, remove] })

    screen.replaceChildren(
      heading.row,
      label.field,
      picker,
      ...matcher,
      breakpointCard(ctx, draft),
      transformCard(ctx, draft.response, "Response", sample, linked?.alias),
      transformCard(ctx, draft.request, "Request", sample, linked?.alias),
      conditionFields(draft.matcher, ctx),
      group("aw-row aw-gap8", priority.field, enabled.field),
      notice,
    )
    screen.closest(".aw-body")?.scrollTo(0, 0)
    heading.title.focus({ preventScroll: true })
  }
  rebuild()
}

export function interceptScreen(ctx: Ctx): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const rules = (ctx.state().config.rules ?? []).filter((rule): rule is InterceptRule => rule.kind === "intercept")
  const open = (rule: InterceptRule, isNew = false) => interceptEditor(ctx, screen, rule, isNew)
  const create = (endpoint?: Endpoint) => {
    const rule = defaultInterceptRule(ctx.state().config.profile.id, ctx.nextRuleSeq())
    if (endpoint) {
      rule.endpointId = endpoint.id
      rule.label = labelFromEndpoint(endpoint)
      rule.matcher = matcherFromEndpoint(endpoint)
    }
    open(rule, true)
  }
  const summary = (rule: Rule) => {
    const intercept = rule as InterceptRule
    const count = (transform: Transform) =>
      Object.keys(parseHeaderLines(transform.setHeaders)).length +
      parseHeaderNames(transform.removeHeaders).length +
      transform.patch.length +
      (transform.body.find ? 1 : 0) +
      (transform.status ? 1 : 0)
    const request = count(intercept.request)
    const response = count(intercept.response)
    const pauses = [intercept.breakpoints?.request && "req", intercept.breakpoints?.response && "res"].filter(Boolean)
    return `${request} request · ${response} response${pauses.length ? ` · pause ${pauses.join("/")}` : ""}`
  }
  const linked = rules.filter((rule) => rule.endpointId)
  const adhoc = rules.filter((rule) => !rule.endpointId)
  const endpoints = ctx.state().config.endpoints
  const fromEndpoint = dashButton(ctx, "From endpoint", () => create(endpoints[0]))
  fromEndpoint.disabled = !endpoints.length
  fromEndpoint.title = endpoints.length ? "Create a rule linked to an endpoint" : "Add an endpoint first"
  screen.append(
    moduleHeader(ctx, "intercept", "API Interceptor", () => ctx.setModuleActive("intercept", !ctx.state().moduleActive.intercept)),
    pausedQueue(ctx),
    section(
      "Endpoint rules",
      linked.length,
      ruleList(ctx, linked, "No endpoint rules configured", summary, (rule) => open(rule as InterceptRule)),
      fromEndpoint,
    ),
    section(
      "Ad-hoc rules",
      adhoc.length,
      ruleList(ctx, adhoc, "No freestanding intercept rules", summary, (rule) => open(rule as InterceptRule)),
      dashButton(ctx, "Add rule", () => create()),
    ),
    matchedTraffic(ctx, "intercept"),
  )
  return screen
}

/* ── Route ─────────────────────────────────────────────────────────────────── */

function routeEditor(ctx: Ctx, screen: HTMLElement, original: RouteRule, isNew: boolean) {
  const draft: RouteRule = structuredClone(original)
  const back = () => ctx.go("route")
  const notice = el("p", "aw-hint")
  notice.setAttribute("role", "status")

  const rebuild = () => {
    const heading = editorHeading(ctx, isNew ? "New page rule" : "Edit page rule", back)
    const preview = el("p", "aw-hint aw-mono aw-xs")
    preview.setAttribute("role", "status")
    const refresh = () => {
      const problem = validateRewrite(draft.matcher.url, draft.pathRewrite)
      if (problem) {
        preview.textContent = problem
        return
      }
      const example = new URL(
        `${getPathname(draft.matcher.url).replace(/\*\*$/, "users/42").replace(/\*/g, "sample")}?active=1`,
        location.origin,
      ).href
      const target = routeTarget(draft, example)
      preview.textContent = target.error
        ? target.error
        : `${example} → ${target.to}${target.crossOrigin ? ` · cross-origin, credentials ${target.credentials}${target.stripped.length ? `, strips ${target.stripped.join(", ")}` : ""}` : ""}`
    }

    const label = textField("Label", draft.label, (value) => (draft.label = value), ctx.signal, false)
    label.input.placeholder = "e.g. Local API"
    const matcher = matcherFields(draft.matcher, ctx, refresh)
    const matchOrigin = textField("Match origin", draft.matchOrigin, (value) => {
      draft.matchOrigin = value
      refresh()
    }, ctx.signal)
    matchOrigin.input.placeholder = "Blank matches any origin"
    const destination = textField("Destination origin", draft.destinationOrigin, (value) => {
      const wasSameOrigin = draft.destinationOrigin === location.origin
      draft.destinationOrigin = value
      // A new cross-origin destination defaults to omit rather than inheriting the page's session.
      if (wasSameOrigin && value && !value.startsWith(location.origin) && draft.credentials !== "omit") {
        draft.credentials = "omit"
        rebuild()
        return
      }
      refresh()
    }, ctx.signal)
    // Built from parts: the bundle asserts that no absolute URL literal survives minification.
    destination.input.placeholder = `${location.protocol}//qa-api.example.test`
    const rewrite = textField("Path rewrite", draft.pathRewrite, (value) => {
      draft.pathRewrite = value
      refresh()
    }, ctx.signal)
    rewrite.input.placeholder = "/sandbox/**"
    const credentials = selectField(
      "Destination credentials",
      [
        ["omit", "omit"],
        ["same-origin", "same-origin"],
        ["include", "include"],
      ] as const,
      draft.credentials as "omit" | "same-origin" | "include",
      (value) => {
        draft.credentials = value
        refresh()
      },
      ctx.signal,
    )
    const preserve = checkField(
      "Preserve original path — a rewrite takes precedence",
      draft.preservePath,
      (value) => {
        draft.preservePath = value
        refresh()
      },
      ctx.signal,
    )
    const keepAuth = checkField(
      "Send Authorization to a cross-origin destination",
      draft.keepAuthorization,
      (value) => {
        draft.keepAuthorization = value
        refresh()
      },
      ctx.signal,
    )
    const priority = numberField("Priority", draft.priority, (value) => (draft.priority = value), ctx.signal, -999, 999)
    const enabled = checkField("Rule enabled — does not activate routing", draft.enabled, (value) => (draft.enabled = value), ctx.signal)

    const save = button(
      "aw-btn aw-pri aw-grow",
      "Save rule",
      () => {
        if (!draft.matcher.url.trim()) {
          notice.textContent = "Enter a URL pathname glob to match."
          return
        }
        const problem = validateRewrite(draft.matcher.url, draft.pathRewrite)
        if (problem) {
          notice.textContent = problem
          return
        }
        const probe = routeTarget(draft, new URL("/probe", location.origin).href)
        if (probe.error && !draft.pathRewrite.trim()) {
          notice.textContent = probe.error
          return
        }
        try {
          const destinationUrl = new URL(draft.destinationOrigin)
          if (destinationUrl.protocol !== "http:" && destinationUrl.protocol !== "https:")
            throw new Error("protocol")
        } catch {
          notice.textContent = "Destination origin must be an http or https URL."
          return
        }
        ctx.saveRule({ ...draft, label: draft.label.trim() || "Page rule", revision: original.revision + 1 })
        back()
      },
      ctx.signal,
    )
    save.prepend(icon("edit", "aw-i14"))
    const remove = button(
      "aw-btn aw-dst aw-grow",
      "Delete",
      () => {
        ctx.deleteRule(draft.id)
        back()
      },
      ctx.signal,
    )
    remove.prepend(icon("trash", "aw-i14"))
    ctx.chrome({ title: draft.label || "Page rule", onBack: back, actions: isNew ? [save, button("aw-btn aw-out aw-grow", "Cancel", back, ctx.signal)] : [save, remove] })

    const form = card()
    form.append(
      caption("Destination"),
      matchOrigin.field,
      destination.field,
      rewrite.field,
      group("aw-g2", credentials.field, priority.field),
      preserve.field,
      keepAuth.field,
      preview,
      el(
        "p",
        "aw-hint",
        "A rewrite is an exact path or one trailing “/**” capture. The original query string is preserved. This rewrites the URL before dispatch; it is not a proxy, so the destination's CORS response, cookies and mixed-content rules are still the browser's decision.",
      ),
    )
    refresh()
    screen.replaceChildren(
      heading.row,
      label.field,
      ...matcher,
      form,
      conditionFields(draft.matcher, ctx),
      enabled.field,
      notice,
    )
    screen.closest(".aw-body")?.scrollTo(0, 0)
    heading.title.focus({ preventScroll: true })
  }
  rebuild()
}

export function routeScreen(ctx: Ctx): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const rules = (ctx.state().config.rules ?? []).filter((rule): rule is RouteRule => rule.kind === "route")
  const open = (rule: RouteRule, isNew = false) => routeEditor(ctx, screen, rule, isNew)
  const summary = (rule: Rule) => {
    const route = rule as RouteRule
    try {
      return new URL(route.destinationOrigin).host
    } catch {
      return "no destination"
    }
  }
  screen.append(
    moduleHeader(ctx, "route", "Page Routing", () => ctx.setModuleActive("route", !ctx.state().moduleActive.route)),
    el(
      "p",
      "aw-hint",
      "Routes this frame’s fetch and XHR requests; browser restrictions apply. Cross-origin CORS, destination cookies, local-network access policy and mixed-content rules are unchanged.",
    ),
    section(
      "Rules",
      rules.length,
      ruleList(ctx, rules, "No page rules configured", summary, (rule) => open(rule as RouteRule)),
      dashButton(ctx, "New page rule", () =>
        open(defaultRouteRule(ctx.state().config.profile.id, ctx.nextRuleSeq()), true),
      ),
    ),
    matchedTraffic(ctx, "route"),
  )
  return screen
}
