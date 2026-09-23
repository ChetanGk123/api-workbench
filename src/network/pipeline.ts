import { RULE_KINDS, type Rule, type RuleKind } from "../core/model"
import { createBreakpoints, type Breakpoints } from "../breakpoints/registry"
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
export type { InterceptPlan, Plan, RequestContext, RequestKind, RoutePlan, RuleActivity, SyntheticResponse } from "./rules"

export type BodyAnalysis = Readonly<{
  kind: "text" | "omitted"
  preview: string
  truncated: boolean
  length: number
}>

export type TraceEvent = {
  id: string
  kind: "request" | "response" | "abort" | "error"
  transport: string
  context: RequestContext
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

export function createPipeline(report: (message: string) => void, breakpoints?: Breakpoints) {
  let active = true
  const pending = new Set<() => void>()
  const trace: TraceEvent[] = []
  const trafficListeners = new Set<(event: TrafficEvent) => void>()
  const activityListeners = new Set<(activity: RuleActivity) => void>()
  const engine = createRuleEngine()
  const pauses = breakpoints ?? createBreakpoints({ report })
  let nextId = 1
  let traceIndex = 0
  // Primary application requests and actual network dispatches are different counts.
  const counters = { primary: 0, dispatched: 0, replayed: 0 }

  const addTrace = (
    kind: TraceEvent["kind"],
    context: RequestContext,
    transport: string,
    detail?: string,
  ) => {
    const entry: TraceEvent = {
      id: `trace-${++traceIndex}`,
      kind,
      transport,
      context,
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

  return {
    trace,
    engine,
    breakpoints: pauses,
    counters,
    setRules(next: Rule[]) {
      engine.setRules(next)
    },
    setActive(kind: RuleKind, value: boolean) {
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
      const aborted = context.signal?.aborted ?? false
      const lifecycleTrace: TraceEvent[] = []
      const entry = addTrace("request", context, transport)
      lifecycleTrace.push(entry)
      if (aborted) lifecycleTrace.push(addTrace("abort", context, transport, "cancelled"))
      const settle = (kind: TraceEvent["kind"], detail?: string) => {
        const grown = addTrace(kind, context, transport, detail)
        lifecycleTrace.push(grown)
        return grown
      }
      const ruleIds = [
        plan.chaosRuleId,
        plan.mockRuleId,
        plan.intercept?.ruleId,
        plan.route?.ruleId,
      ].filter((id): id is string => !!id)
      const finish = (outcome: string) => {
        for (const ruleId of ruleIds)
          announce({
            ruleId,
            label: plan.provider,
            method: context.method,
            url: context.url,
            outcome,
            at: Date.now(),
          })
      }
      return { plan, cancelled: aborted, trace: lifecycleTrace, settle, entry, finish }
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
    own,
    close() {
      active = false
      // Paused requests are continued before owned timers settle, so nothing awaits a dead promise.
      pauses.dispose()
      for (const kind of RULE_KINDS) engine.setActive(kind, false)
      for (const finish of [...pending]) finish()
      pending.clear()
      trafficListeners.clear()
      activityListeners.clear()
    },
  }
}
export type Pipeline = ReturnType<typeof createPipeline>

export { normalizeHeaders }
