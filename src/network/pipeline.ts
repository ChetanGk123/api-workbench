import type { Rule } from "../core/model"
import {
  createRequestContext,
  createRuleEngine,
  matchUrl,
  matchHeaders,
  matchQuery,
  getPathname,
  getSearch,
  normalizeHeaders,
  type HeaderBag,
  type Plan,
  type RequestContext,
  type RequestKind,
  type RuleActivity,
} from "./rules"

export { createRequestContext, getPathname, getSearch } from "./rules"
export type { Plan, RequestContext, RequestKind, RuleActivity, SyntheticResponse } from "./rules"

export const mockBody = JSON.stringify({ source: "workbench", message: "Mock response — café ✓" })

export type BodyAnalysis = Readonly<{
  kind: "text" | "omitted"
  preview: string
  truncated: boolean
  length: number
}>

export type RuleCondition = {
  headers?: Record<string, string>
  query?: Record<string, string | string[]>
  body?: string
}

export type PipelineRule = {
  id: string
  enabled: boolean
  priority: number
  created: number
  method: string
  url: string
  delay?: number
  condition?: RuleCondition
}

export type PipelineDecision = {
  provider: "mock"
  ruleId: string
  delay: number
  why: string
}

export type TraceEvent = {
  id: string
  kind: "request" | "response" | "abort" | "error"
  transport: string
  context: RequestContext
  decision: PipelineDecision | null
  at: number
  detail?: string
}

export type TrafficEvent = Readonly<{
  request: RequestContext
  response?: {
    status: number
    headers: Readonly<Record<string, string>>
    body?: string
    bodyStatus: "captured" | "omitted" | "truncated" | "unreadable"
  }
  durationMs: number
  source: "network" | "mock" | "synthetic-chaos"
  error?: string
  ruleIds: readonly string[]
}>

function matchLegacyCondition(rule: PipelineRule, url: string, requestHeaders?: HeaderBag): boolean {
  if (!matchUrl(rule.url, url)) return false
  const condition = rule.condition
  if (!condition) return true
  if (condition.headers && !matchHeaders(condition.headers, requestHeaders)) return false
  if (condition.query) {
    const expected = Object.fromEntries(
      Object.entries(condition.query).map(([key, value]) => [
        key,
        Array.isArray(value) ? value : [value],
      ]),
    )
    if (!matchQuery(expected, url)) return false
  }
  if (condition.body) {
    const body = requestHeaders instanceof Headers ? (requestHeaders.get("x-body") ?? "") : ""
    if (!body.includes(condition.body)) return false
  }
  return true
}

export function createPipeline(report: (message: string) => void) {
  let active = true
  const settings = { enabled: false, delay: 0 }
  const pending = new Set<() => void>()
  const rules: PipelineRule[] = []
  const trace: TraceEvent[] = []
  const trafficListeners = new Set<(event: TrafficEvent) => void>()
  const activityListeners = new Set<(activity: RuleActivity) => void>()
  const engine = createRuleEngine()
  let nextId = 1
  let traceIndex = 0
  // Primary application requests and actual network dispatches are different counts.
  const counters = { primary: 0, dispatched: 0, replayed: 0 }

  const addRule = (rule: Partial<PipelineRule> & Pick<PipelineRule, "url">): PipelineRule => {
    const normalized: PipelineRule = {
      id: rule.id ?? `rule-${nextId++}`,
      enabled: rule.enabled ?? true,
      priority: rule.priority ?? 0,
      created: rule.created ?? Date.now() + nextId,
      method: (rule.method ?? "*").toUpperCase(),
      url: rule.url,
      delay: rule.delay ?? settings.delay,
      condition: rule.condition,
    }
    rules.push(normalized)
    return normalized
  }

  const addTrace = (
    kind: TraceEvent["kind"],
    context: RequestContext,
    transport: string,
    decision: PipelineDecision | null,
    detail?: string,
  ) => {
    const entry: TraceEvent = {
      id: `trace-${++traceIndex}`,
      kind,
      transport,
      context,
      decision,
      at: Date.now(),
      detail,
    }
    trace.push(entry)
    if (trace.length > 64) trace.shift()
    report(`${transport} ${context.method} · ${kind}${detail ? ` · ${detail}` : ""}`)
    return entry
  }

  const own = (finish: () => void) => {
    pending.add(finish)
    return () => pending.delete(finish)
  }

  const announce = (activity: RuleActivity) => {
    for (const listener of [...activityListeners]) listener(activity)
  }

  const resolveRule = (context: RequestContext, transport: string): PipelineDecision | null => {
    const { method, url, headers } = context
    const candidates = [...rules]
      .filter((rule) => rule.enabled)
      .sort((left, right) => {
        if (right.priority !== left.priority) return (right.priority ?? 0) - (left.priority ?? 0)
        if (left.created !== right.created) return left.created - right.created
        return left.id.localeCompare(right.id)
      })

    for (const rule of candidates) {
      if (rule.method !== "*" && rule.method !== method) continue
      if (!matchLegacyCondition(rule, url, headers)) continue
      return {
        provider: "mock",
        ruleId: rule.id,
        delay: rule.delay ?? settings.delay,
        why: `matched ${rule.id} (${rule.priority})`,
      }
    }

    if (!active) return null
    const legacy =
      settings.enabled &&
      method === "GET" &&
      getPathname(url) === "/api/mock-target" &&
      getSearch(url) === ""
    return legacy
      ? { provider: "mock", ruleId: "legacy-m0", delay: settings.delay, why: "legacy M0 matcher" }
      : null
  }

  const analyzeBody = (body: unknown, contentType?: string | null): BodyAnalysis => {
    if (body == null) return { kind: "omitted", preview: "", truncated: false, length: 0 }
    if (typeof body === "string") {
      const preview = body.length > 128 ? body.slice(0, 128) : body
      return { kind: "text", preview, truncated: body.length > 128, length: body.length }
    }
    if (
      typeof body === "object" &&
      "size" in body &&
      typeof (body as { size?: number }).size === "number"
    ) {
      const size = (body as { size: number }).size
      return { kind: "omitted", preview: "", truncated: size > 16384, length: size }
    }
    if (
      contentType &&
      /(json|text|xml|javascript|x-www-form-urlencoded)/i.test(contentType) &&
      typeof body === "string"
    ) {
      const preview = body.slice(0, 128)
      return { kind: "text", preview, truncated: body.length > 128, length: body.length }
    }
    return { kind: "omitted", preview: "", truncated: false, length: 0 }
  }

  /** The M0 feasibility mock and the M2 rule list are expressed as an ordinary plan. */
  const legacyPlan = (decision: PipelineDecision): Plan => ({
    provider: "mock",
    mockRuleId: decision.ruleId,
    why: [decision.why],
    delayMs: decision.delay,
    synthetic: {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      body: mockBody,
    },
  })

  return {
    settings,
    rules,
    trace,
    engine,
    counters,
    addRule,
    clearRules() {
      rules.length = 0
    },
    setRules(next: Rule[]) {
      engine.setRules(next)
    },
    setActive(kind: "mock" | "chaos", value: boolean) {
      engine.setActive(kind, value)
    },
    onActivity(listener: (activity: RuleActivity) => void) {
      activityListeners.add(listener)
      return () => activityListeners.delete(listener)
    },
    announce,
    analyzeBody,
    beginRequest(context: RequestContext, transport: string) {
      counters.primary++
      const plan = active
        ? engine.plan(context)
        : { provider: "network" as const, why: ["workbench closed"], delayMs: 0 }
      const decision = plan.provider === "network" && !plan.real ? resolveRule(context, transport) : null
      const effective = decision ? legacyPlan(decision) : plan
      const aborted = context.signal?.aborted ?? false
      const lifecycleTrace: TraceEvent[] = []
      const entry = addTrace("request", context, transport, decision)
      lifecycleTrace.push(entry)
      if (aborted) lifecycleTrace.push(addTrace("abort", context, transport, decision, "cancelled"))
      const settle = (kind: TraceEvent["kind"], detail?: string) => {
        const grown = addTrace(kind, context, transport, decision, detail)
        lifecycleTrace.push(grown)
        return grown
      }
      const ruleId = effective.chaosRuleId ?? effective.mockRuleId
      const finish = (outcome: string) => {
        if (!ruleId) return
        announce({
          ruleId,
          label: effective.provider,
          method: context.method,
          url: context.url,
          outcome,
          at: Date.now(),
        })
      }
      return { decision, plan: effective, cancelled: aborted, trace: lifecycleTrace, settle, entry, finish }
    },
    observe(listener: (event: TrafficEvent) => void) {
      trafficListeners.add(listener)
      return () => trafficListeners.delete(listener)
    },
    publishTraffic(event: TrafficEvent) {
      const frozen = Object.freeze({ ...event, ruleIds: Object.freeze([...event.ruleIds]) })
      for (const listener of trafficListeners) listener(frozen)
    },
    /**
     * Bounded duplicate dispatch. Copies are prepared before the primary request, use the captured
     * transport with frozen settings, never re-enter this pipeline, and are cancelled by close or
     * by the caller's abort. They cannot reverse server-side effects already applied.
     */
    scheduleReplay(
      plan: Plan,
      dispatch: (copy: number) => void,
      signal?: AbortSignal,
    ): () => void {
      const replay = plan.real?.replay
      if (!replay || replay.copies < 1) return () => {}
      const timers: Array<ReturnType<typeof setTimeout>> = []
      let release = () => {}
      const cancel = () => {
        for (const timer of timers) clearTimeout(timer)
        timers.length = 0
        release()
      }
      release = own(cancel)
      signal?.addEventListener("abort", cancel, { once: true })
      for (let copy = 1; copy <= replay.copies; copy++)
        timers.push(
          setTimeout(() => {
            if (!active || signal?.aborted) return
            counters.dispatched++
            counters.replayed++
            dispatch(copy)
            announce({
              ruleId: plan.chaosRuleId ?? "",
              label: "replay",
              method: "",
              url: "",
              outcome: `replay copy ${copy}/${replay.copies}`,
              at: Date.now(),
            })
          }, replay.gapMs * copy),
        )
      return cancel
    },
    get observing() {
      return trafficListeners.size > 0
    },
    get active() {
      return active
    },
    decide(
      method: string | RequestContext,
      url?: string,
      transport?: string,
      requestHeaders?: HeaderBag,
    ) {
      if (!active) return null
      if (typeof method === "string") {
        const effectiveTransport = transport ?? "network"
        const headerBag = typeof transport === "string" ? requestHeaders : undefined
        const context = createRequestContext({
          kind: effectiveTransport.toLowerCase() === "xhr" ? "xhr" : "fetch",
          method,
          url: url ?? "",
          headers: headerBag,
        })
        return resolveRule(context, effectiveTransport)
      }
      const effectiveTransport =
        typeof transport === "string" ? transport : method.kind === "xhr" ? "XHR" : "fetch"
      return resolveRule(method, effectiveTransport)
    },
    own,
    close() {
      active = false
      settings.enabled = false
      engine.setActive("mock", false)
      engine.setActive("chaos", false)
      for (const finish of [...pending]) finish()
      pending.clear()
      trafficListeners.clear()
      activityListeners.clear()
    },
  }
}
export type Pipeline = ReturnType<typeof createPipeline>

export { normalizeHeaders }
