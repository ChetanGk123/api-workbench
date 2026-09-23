import { el, icon, button, iconButton, card, caption, group, labeled, disclosure } from "./dom"
import {
  CHAOS_PRESETS,
  MAX_REPLAY_COPIES,
  defaultChaosRule,
  defaultMockRule,
  defaultMockSlot,
  matcherFromEndpoint,
  type ChaosFault,
  type ChaosRule,
  type Endpoint,
  type MockRule,
  type MockSlot,
  type Rule,
  type RuleMatcher,
} from "../core/model"
import type { Ctx, ScreenId } from "./screens"

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

/* ── Small form primitives ─────────────────────────────────────────────────── */

function textField(label: string, value: string, onChange: (value: string) => void, signal: AbortSignal, mono = true) {
  const input = el("input", `aw-in${mono ? " aw-mono" : ""}`)
  input.value = value
  input.setAttribute("aria-label", label)
  input.addEventListener("input", () => onChange(input.value), { signal })
  return { input, field: labeled(label, input) }
}

function numberField(
  label: string,
  value: number,
  onChange: (value: number) => void,
  signal: AbortSignal,
  min = 0,
  max = 1000000,
) {
  const input = el("input", "aw-in aw-mono")
  input.type = "number"
  input.min = String(min)
  input.max = String(max)
  input.value = String(value)
  input.setAttribute("aria-label", label)
  const commit = () => {
    const next = Math.min(max, Math.max(min, Math.round(Number(input.value) || 0)))
    input.value = String(next)
    onChange(next)
  }
  input.addEventListener("change", commit, { signal })
  return { input, field: labeled(label, input) }
}

function selectField<T extends string>(
  label: string,
  choices: readonly (readonly [T, string])[],
  value: T,
  onChange: (value: T) => void,
  signal: AbortSignal,
) {
  const select = el("select", "aw-sel")
  select.setAttribute("aria-label", label)
  for (const [key, text] of choices) {
    const option = el("option", "", text)
    option.value = key
    option.selected = key === value
    select.append(option)
  }
  select.addEventListener("change", () => onChange(select.value as T), { signal })
  return { select, field: labeled(label, select) }
}

function checkField(label: string, checked: boolean, onChange: (value: boolean) => void, signal: AbortSignal) {
  const wrapper = el("label", "aw-chk aw-xs")
  const input = el("input")
  input.type = "checkbox"
  input.checked = checked
  input.addEventListener("change", () => onChange(input.checked), { signal })
  wrapper.append(input, document.createTextNode(label))
  return { input, field: wrapper }
}

/** The reference's tick-box toggle: a button, so a row click never submits or navigates. */
function toggleBox(label: string, checked: boolean, onChange: (value: boolean) => void, signal: AbortSignal) {
  const control = el("button", `aw-cb${checked ? " aw-on" : ""}`)
  control.type = "button"
  control.setAttribute("role", "checkbox")
  control.setAttribute("aria-checked", String(checked))
  control.setAttribute("aria-label", label)
  control.append(icon("check", "aw-i12"))
  control.addEventListener("click", () => onChange(!checked), { signal })
  return control
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

function moduleHeader(ctx: Ctx, kind: "mock" | "chaos", title: string, onToggle: () => void): HTMLElement {
  const head = el("div", "aw-row aw-gap10")
  const tile = el("div", "aw-tile")
  tile.append(icon(kind === "mock" ? "server" : "flame"))
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
  return group("aw-col aw-gap12", head, activate, hint)
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
  const headers = textField("Match headers", matcher.headers, (value) => (matcher.headers = value), ctx.signal)
  headers.input.placeholder = "k=v&k2=v2"
  const body = textField("Body contains", matcher.bodyContains, (value) => (matcher.bodyContains = value), ctx.signal)
  body.input.placeholder = "substring"
  const section = card()
  section.append(
    group("aw-row", el("span", "aw-h aw-cap", "Conditional match"), el("span", "aw-bd", "Optional")),
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
      const endpoint = endpoints.find((item) => item.id === value)
      draft.endpointId = endpoint?.id
      if (endpoint) draft.matcher = { ...draft.matcher, ...matcherFromEndpoint(endpoint) }
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

function ruleRow(ctx: Ctx, rule: Rule, summary: string, onOpen: () => void): HTMLElement {
  const screen: ScreenId = rule.kind === "mock" ? "mock" : "chaos"
  const row = el("div", "aw-row aw-gap8 aw-endpoint-row")
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
  const open = button("aw-grow aw-col aw-endpoint-name aw-tr", "", onOpen, ctx.signal)
  open.append(el("span", "", rule.label))
  const meta = el("span", "aw-row aw-gap6 aw-endpoint-meta aw-mono aw-xs")
  meta.append(
    el("span", `aw-bd aw-m aw-${rule.matcher.method === "*" ? "GET" : rule.matcher.method}`, rule.matcher.method),
    el("span", "aw-tr aw-grow", rule.matcher.url),
    el("span", "aw-bd aw-s", summary),
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
      "aw-btn aw-gh aw-ic aw-xs2",
      "trash",
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

function ruleList(ctx: Ctx, rules: Rule[], empty: string, summary: (rule: Rule) => string, onOpen: (rule: Rule) => void): HTMLElement {
  const list = el("div", "aw-card aw-list")
  if (!rules.length) return el("div", "aw-empty", empty)
  for (const rule of rules) list.append(ruleRow(ctx, rule, summary(rule), () => onOpen(rule)))
  return list
}

function section(title: string, count: number, ...children: Node[]): HTMLElement {
  const wrapper = el("div", "aw-col aw-gap8")
  wrapper.append(group("aw-row", el("span", "aw-lbl aw-grow", title), el("span", "aw-bd aw-s", String(count))))
  wrapper.append(...children)
  return wrapper
}

function dashButton(ctx: Ctx, label: string, onClick: () => void): HTMLButtonElement {
  const control = button("aw-btn aw-dash aw-w", label, onClick, ctx.signal)
  control.prepend(icon("plus", "aw-i14"))
  return control
}

function matchedTraffic(ctx: Ctx, kind: "mock" | "chaos"): HTMLElement {
  const rows = el("div", "aw-card aw-list")
  const wrapper = el("div", "aw-col aw-gap8")
  const count = el("span", "aw-bd aw-s", "0")
  wrapper.append(
    group("aw-row", el("span", "aw-lbl aw-grow", kind === "mock" ? "Matched traffic" : "Fault log"), count),
    rows,
  )
  ctx.watch((state) => {
    const ids = new Set((state.config.rules ?? []).filter((rule) => rule.kind === kind).map((rule) => rule.id))
    const entries = state.matched.filter((item) => ids.has(item.ruleId)).slice(-12).reverse()
    count.textContent = String(entries.length)
    rows.replaceChildren()
    for (const entry of entries) {
      const path = el("span", "aw-grow aw-tr aw-mono aw-xs", entry.url ? new URL(entry.url).pathname : "—")
      path.title = entry.url
      rows.append(
        group(
          "aw-li aw-row aw-gap8",
          el("span", `aw-bd aw-m aw-${entry.method || "GET"}`, entry.method || "·"),
          path,
          el("span", "aw-xs aw-mu", entry.outcome),
        ),
      )
    }
    if (!entries.length)
      rows.replaceChildren(
        el("div", "aw-empty", kind === "mock" ? "No matched traffic yet" : "No faults applied yet"),
      )
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
    labeled(`Body ${index + 1}`, body),
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
        slot.body = recorded.body
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
      rule.label = `Mock ${endpoint.name}`
      rule.matcher = matcherFromEndpoint(endpoint)
    }
    open(rule, true)
  }
  const summary = (rule: Rule) => {
    const mock = rule as MockRule
    return mock.mode === "sequence" ? `${mock.slots.length} step sequence` : String(mock.slots[0]?.status ?? 200)
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
      rule.label = `${rule.label} · ${endpoint.name}`
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
