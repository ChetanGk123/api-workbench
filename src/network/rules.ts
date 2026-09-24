import type {
  ChaosRule,
  InterceptRule,
  MockRule,
  MockSlot,
  RouteRule,
  Rule,
  RuleKind,
  RuleMatcher,
} from "../core/model"
import {
  applyTransform,
  compileTransform,
  parseHeaderLines,
  transformHasWork,
  type CompiledTransform,
} from "./transform"

export { parseHeaderLines } from "./transform"

export type RequestKind = "fetch" | "xhr"

/**
 * `TESTER_MARK` is how a request the workbench's own tester dispatched through the page's wrapped
 * fetch is recognised afterwards. It is an unknown member of the fetch init, which the platform
 * ignores, so the request that leaves the page is the one the plan describes.
 */
export const TESTER_MARK = "__awTester"

export type RequestContext = Readonly<{
  kind: RequestKind
  method: string
  url: string
  headers: Readonly<Record<string, string>>
  body?: string
  signal?: AbortSignal
  /** Dispatched by the workbench tester rather than by the page. */
  fromTester?: boolean
}>

export type HeaderBag =
  | Headers
  | Record<string, string>
  | { headers?: Record<string, string> }
  | undefined

export function normalizeHeaders(all: HeaderBag): Record<string, string> {
  if (!all) return {}
  if (all instanceof Headers) return Object.fromEntries(all.entries())
  if ("headers" in all && all.headers && typeof all.headers === "object") {
    return normalizeHeaders(all.headers as Record<string, string>)
  }
  return Object.fromEntries(
    Object.entries(all).map(([key, value]) => [key.toLowerCase(), String(value)]),
  )
}

export function createRequestContext(input: {
  kind: RequestKind
  method: string
  url: string
  headers?: HeaderBag
  body?: string | Blob | FormData | URLSearchParams | ArrayBuffer | null
  signal?: AbortSignal
  fromTester?: boolean
}): RequestContext {
  return Object.freeze({
    kind: input.kind,
    method: input.method.toUpperCase(),
    url: input.url,
    headers: Object.freeze(normalizeHeaders(input.headers ?? {})),
    body: typeof input.body === "string" ? input.body : undefined,
    signal: input.signal,
    fromTester: input.fromTester,
  })
}

/* ── Matching ──────────────────────────────────────────────────────────────── */

const ABSOLUTE = /^[a-z]+:\/\//i

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** `*` matches inside one path segment, `**` spans segments. No user-provided regular expressions. */
export function globSource(pattern: string): string {
  let source = ""
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index] ?? ""
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*"
        index += 1
      } else source += "[^/]*"
      continue
    }
    source += escapeRegex(char)
  }
  return source
}

export function globToRegExp(pattern: string): RegExp {
  return new RegExp(`^${globSource(pattern)}$`, "i")
}

export function getPathname(url: string): string {
  if (ABSOLUTE.test(url)) return new URL(url).pathname
  const withoutHash = url.split("#")[0] ?? ""
  const queryIndex = withoutHash.indexOf("?")
  return queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash
}

export function getSearch(url: string): string {
  if (ABSOLUTE.test(url)) return new URL(url).search
  const withoutHash = url.split("#")[0] ?? ""
  const queryIndex = withoutHash.indexOf("?")
  return queryIndex >= 0 ? withoutHash.slice(queryIndex) : ""
}

/**
 * Matching is on the pathname, so a rule URL copied from a recorded request keeps matching when
 * its captured request id changes; query constraints are a separate condition. An absolute
 * pattern also pins the origin. A relative pattern matches that pathname on any origin — write an
 * absolute URL when a rule must be scoped to one host.
 */
export function matchUrl(pattern: string, url: string): boolean {
  const expression = globToRegExp(getPathname(pattern))
  if (!ABSOLUTE.test(pattern)) return expression.test(getPathname(url))
  if (!ABSOLUTE.test(url)) return false
  const target = new URL(url)
  return new URL(pattern).origin === target.origin && expression.test(target.pathname)
}

export function matchHeaders(expected: Record<string, string>, all: HeaderBag): boolean {
  const source = normalizeHeaders(all)
  for (const [name, value] of Object.entries(expected)) {
    const actual = source[name.toLowerCase()]
    if (actual == null || actual.toLowerCase() !== value.toLowerCase()) return false
  }
  return true
}

export function matchQuery(expected: Record<string, string[]>, url: string): boolean {
  const params = ABSOLUTE.test(url) ? new URL(url).searchParams : new URLSearchParams(getSearch(url))
  for (const [key, wanted] of Object.entries(expected)) {
    const values = params.getAll(key)
    if (!values.length) return false
    // A specified value matches any value recorded for that key.
    if (!values.some((value) => wanted.includes(value))) return false
  }
  return true
}

function pairs(text: string): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const [key, value] of new URLSearchParams(text.trim())) (result[key] ??= []).push(value)
  return result
}

function flatPairs(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of new URLSearchParams(text.trim())) result[key] = value
  return result
}

export type MatchResult = { matched: boolean; reason: string }

export function matchRequest(matcher: RuleMatcher, context: RequestContext): MatchResult {
  if (matcher.method !== "*" && matcher.method.toUpperCase() !== context.method)
    return { matched: false, reason: "method" }
  if (!matchUrl(matcher.url, context.url)) return { matched: false, reason: "url" }
  if (matcher.query.trim() && !matchQuery(pairs(matcher.query), context.url))
    return { matched: false, reason: "query" }
  if (matcher.headers.trim() && !matchHeaders(flatPairs(matcher.headers), context.headers))
    return { matched: false, reason: "headers" }
  if (matcher.bodyContains) {
    // An unavailable body is never a claimed match; the reason says so instead.
    if (context.body == null) return { matched: false, reason: "body condition not evaluated" }
    if (!context.body.includes(matcher.bodyContains)) return { matched: false, reason: "body" }
  }
  return { matched: true, reason: "matched" }
}

/** Higher priority wins; ties use ascending creation sequence and then the stable id. */
export function byPrecedence(left: Rule, right: Rule): number {
  if (left.priority !== right.priority) return right.priority - left.priority
  if (left.seq !== right.seq) return left.seq - right.seq
  return left.id.localeCompare(right.id)
}

/* ── Routing ───────────────────────────────────────────────────────────────── */

const doubles = (pattern: string) => (pattern.match(/\*\*/g) ?? []).length

/**
 * First-release rewrite grammar: an exact replacement path, or one trailing `/**` capture
 * reinserted into a trailing `/**` replacement. Anything else is rejected rather than guessed.
 */
export function validateRewrite(glob: string, rewrite: string): string | undefined {
  const target = rewrite.trim()
  if (!target) return undefined
  if (!target.includes("*")) return target.startsWith("/") ? undefined : 'A rewrite path must start with "/".'
  if (!target.endsWith("/**") || doubles(target) !== 1 || target.slice(0, -3).includes("*"))
    return 'A rewrite is either an exact path or one trailing "/**" capture.'
  const source = getPathname(glob)
  if (!source.endsWith("/**") || doubles(source) !== 1)
    return 'A trailing "/**" rewrite needs a matcher URL that also ends in "/**".'
  return undefined
}

export function rewritePathname(rule: RouteRule, pathname: string): string | { error: string } {
  const rewrite = rule.pathRewrite.trim()
  // The reference screen's rule: a rewrite always takes precedence over "preserve original path".
  if (!rewrite) return rule.preservePath ? pathname : "/"
  const problem = validateRewrite(rule.matcher.url, rewrite)
  if (problem) return { error: problem }
  if (!rewrite.endsWith("/**")) return rewrite
  const prefix = getPathname(rule.matcher.url).slice(0, -3)
  const captured = new RegExp(`^${globSource(prefix)}/(.*)$`, "i").exec(pathname)
  if (!captured) return { error: `rewrite could not capture a tail from ${pathname}` }
  return `${rewrite.slice(0, -3)}/${captured[1]}`
}

function sameOrigin(expected: string, url: string): boolean {
  try {
    return new URL(expected).origin === new URL(url).origin
  } catch {
    return false
  }
}

export type RoutePlan = {
  ruleId: string
  label: string
  from: string
  to: string
  credentials: RequestCredentials
  crossOrigin: boolean
  /** Request headers removed because the destination is a different origin. */
  stripped: string[]
  error?: string
}

/**
 * Resolves one route. The original query string is preserved, the result is normalized through
 * `URL`, and only HTTP(S) destinations are accepted. A rewrite never creates a proxy: the
 * destination's cookies and CORS response are the browser's to decide, not ours to copy.
 */
export function routeTarget(rule: RouteRule, url: string): RoutePlan {
  const base: RoutePlan = {
    ruleId: rule.id, label: rule.label, from: url, to: url,
    credentials: rule.credentials, crossOrigin: false, stripped: [],
  }
  let source: URL
  try {
    source = new URL(url)
  } catch {
    return { ...base, error: "request URL could not be parsed" }
  }
  let destination: URL
  try {
    destination = new URL(rule.destinationOrigin)
  } catch {
    return { ...base, error: `destination origin "${rule.destinationOrigin}" is not a URL` }
  }
  if (destination.protocol !== "http:" && destination.protocol !== "https:")
    return { ...base, error: "destination origin must be http or https" }
  const pathname = rewritePathname(rule, source.pathname)
  if (typeof pathname !== "string") return { ...base, error: pathname.error }
  const target = new URL(pathname + source.search, destination.origin)
  const crossOrigin = target.origin !== source.origin
  return {
    ...base,
    to: target.href,
    crossOrigin,
    stripped: crossOrigin && !rule.keepAuthorization ? ["authorization"] : [],
  }
}

/* ── Seeded sampling ───────────────────────────────────────────────────────── */

function hash(text: string): number {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 0x01000193)
  }
  return value >>> 0
}

/** mulberry32: small, deterministic, and enough for reproducing an ordered sample stream. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/* ── Transient engine state ────────────────────────────────────────────────── */

export type RuleActivity = {
  ruleId: string
  label: string
  method: string
  url: string
  outcome: string
  at: number
  /** The response body, only when the profile asks the traffic log to keep it. */
  body?: string
}

export type SyntheticResponse = {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}

export type RealFault = {
  preDelayMs: number
  deliveryDelayMs: number
  status?: { status: number; body: string }
  networkError?: boolean
  timeoutMs?: number
  malformedJson?: boolean
  replay?: { copies: number; gapMs: number }
}

export type InterceptPlan = {
  ruleId: string
  label: string
  request: CompiledTransform
  response: CompiledTransform
  requestWork: boolean
  responseWork: boolean
  /** Stage 3 and stage 8 pauses, frozen with the rest of the plan at intake. */
  pauseRequest: boolean
  pauseResponse: boolean
  /** Rule identity at intake, so a waiting pause can be reported as stale after an edit. */
  revision: number
  profileId: string
}

export type Plan = {
  provider: "mock" | "synthetic-chaos" | "network"
  mockRuleId?: string
  chaosRuleId?: string
  intercept?: InterceptPlan
  route?: RoutePlan
  /** Every composition decision, in order, for the "Why this rule?" trace. */
  why: string[]
  delayMs: number
  synthetic?: SyntheticResponse
  syntheticFailure?: "network-error" | "timeout"
  timeoutMs?: number
  real?: RealFault
  sequence?: { index: number; total: number; exhausted: boolean }
}

const STATUS_TEXT: Record<number, string> = {
  200: "OK", 201: "Created", 202: "Accepted", 204: "No Content", 301: "Moved Permanently",
  302: "Found", 304: "Not Modified", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
  404: "Not Found", 408: "Request Timeout", 409: "Conflict", 418: "I'm a Teapot",
  422: "Unprocessable Content", 429: "Too Many Requests", 500: "Internal Server Error",
  501: "Not Implemented", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout",
}

export function statusText(status: number): string {
  return STATUS_TEXT[status] ?? ""
}

function slotResponse(slot: MockSlot): SyntheticResponse {
  return {
    status: slot.status,
    statusText: statusText(slot.status),
    headers: parseHeaderLines(slot.headers),
    body: slot.body,
  }
}

/**
 * The rule engine owns everything transient: sequence cursors, hit counts, budgets and the
 * seeded sample stream. None of it is configuration, so none of it is exported to a profile.
 */
export function createRuleEngine() {
  let rules: Rule[] = []
  const active: Record<RuleKind, boolean> = { mock: false, chaos: false, intercept: false, route: false }
  const cursors = new Map<string, number>()
  const hits = new Map<string, number>()
  const samplers = new Map<string, () => number>()
  let sampleCount = 0

  const cursorKey = (rule: Rule) => `${rule.profileId}|${rule.id}|${rule.revision}`

  const sampler = (rule: ChaosRule) => {
    const key = cursorKey(rule)
    let next = samplers.get(key)
    if (!next) {
      next = rule.seed ? mulberry32(hash(`${rule.seed}|${rule.id}`)) : Math.random
      samplers.set(key, next)
    }
    return next
  }

  const pick = (kind: Rule["kind"], context: RequestContext): Rule | null => {
    for (const rule of rules.filter((item) => item.kind === kind && item.enabled).sort(byPrecedence))
      if (matchRequest(rule.matcher, context).matched) return rule
    return null
  }

  /** Reserved synchronously, in request-arrival order, before any delay can run. */
  const reserve = (rule: MockRule): { slot: MockSlot | null; index: number; exhausted: boolean } => {
    const total = rule.slots.length
    if (!total) return { slot: null, index: 0, exhausted: true }
    if (rule.mode === "static") return { slot: rule.slots[0]!, index: 0, exhausted: false }
    const key = cursorKey(rule)
    const index = cursors.get(key) ?? 0
    cursors.set(key, index + 1)
    if (index < total) return { slot: rule.slots[index]!, index, exhausted: false }
    if (rule.exhaustion === "loop") return { slot: rule.slots[index % total]!, index, exhausted: true }
    if (rule.exhaustion === "repeat-last") return { slot: rule.slots[total - 1]!, index, exhausted: true }
    return { slot: null, index, exhausted: true }
  }

  const count = (ruleId: string) => hits.set(ruleId, (hits.get(ruleId) ?? 0) + 1)

  return {
    get rules() {
      return rules
    },
    get active() {
      return active
    },
    get sampleCount() {
      return sampleCount
    },
    setRules(next: Rule[]) {
      const known = new Set(next.map((rule) => cursorKey(rule)))
      // An edit changes the revision, so its cursor and sample stream are dropped with the old key.
      for (const key of [...cursors.keys()]) if (!known.has(key)) cursors.delete(key)
      for (const key of [...samplers.keys()]) if (!known.has(key)) samplers.delete(key)
      rules = next
    },
    setActive(kind: RuleKind, value: boolean) {
      if (active[kind] === value) return
      active[kind] = value
      // A fresh activation restarts sequences; minimizing the panel does not.
      if (value)
        for (const rule of rules) if (rule.kind === kind) this.resetCursor(rule.id)
    },
    resetCursor(ruleId: string) {
      for (const rule of rules)
        if (rule.id === ruleId) {
          cursors.delete(cursorKey(rule))
          samplers.delete(cursorKey(rule))
        }
    },
    resetAll() {
      cursors.clear()
      samplers.clear()
      hits.clear()
      sampleCount = 0
    },
    cursor(rule: MockRule): number {
      return cursors.get(cursorKey(rule)) ?? 0
    },
    hits(ruleId: string): number {
      return hits.get(ruleId) ?? 0
    },
    /** Compiles the immutable plan for one request. Runs synchronously at intake. */
    plan(context: RequestContext): Plan {
      const why: string[] = []
      const interceptRule = active.intercept ? (pick("intercept", context) as InterceptRule | null) : null
      const intercept: InterceptPlan | null = interceptRule
        ? {
            ruleId: interceptRule.id,
            label: interceptRule.label,
            request: compileTransform(interceptRule.request),
            response: compileTransform(interceptRule.response),
            requestWork: transformHasWork(compileTransform(interceptRule.request)),
            responseWork: transformHasWork(compileTransform(interceptRule.response)),
            pauseRequest: !!interceptRule.breakpoints?.request,
            pauseResponse: !!interceptRule.breakpoints?.response,
            revision: interceptRule.revision,
            profileId: interceptRule.profileId,
          }
        : null
      const routeRule = active.route
        ? (rules
            .filter((item): item is RouteRule => item.kind === "route" && item.enabled)
            .sort(byPrecedence)
            .find(
              (item) =>
                matchRequest(item.matcher, context).matched &&
                (!item.matchOrigin.trim() || sameOrigin(item.matchOrigin, context.url)),
            ) ?? null)
        : null

      /** Stage 6: a response transform edits a synthetic response exactly as it edits a real one. */
      const withIntercept = (plan: Plan): Plan => {
        if (routeRule) why.push(`route ${routeRule.label} not applied: this request makes no network dispatch`)
        if (!intercept) return plan
        plan.intercept = intercept
        count(intercept.ruleId)
        why.push(`intercept ${intercept.label} matched`)
        if (intercept.requestWork)
          why.push("request transform not applied: this request is answered without a dispatch")
        if (intercept.pauseRequest || intercept.pauseResponse)
          why.push(
            "breakpoints not applied: a request answered without a dispatch is never paused in v1",
          )
        if (!intercept.responseWork) return plan
        if (!plan.synthetic) {
          why.push("response transform not applied: this outcome has no HTTP response to edit")
          return plan
        }
        const outcome = applyTransform(
          intercept.response,
          { headers: plan.synthetic.headers, body: plan.synthetic.body, status: plan.synthetic.status },
          "response",
        )
        const status = outcome.status ?? plan.synthetic.status
        plan.synthetic = {
          status,
          statusText: status === plan.synthetic.status ? plan.synthetic.statusText : statusText(status),
          headers: outcome.headers,
          body: outcome.body ?? plan.synthetic.body,
        }
        why.push(outcome.summary)
        return plan
      }

      const mock = active.mock ? (pick("mock", context) as MockRule | null) : null
      let chaos = active.chaos ? (pick("chaos", context) as ChaosRule | null) : null
      if (chaos) {
        if (chaos.budget > 0 && (hits.get(chaos.id) ?? 0) >= chaos.budget) {
          why.push(`chaos ${chaos.label}: hit budget ${chaos.budget} spent`)
          chaos = null
        } else {
          const sample = sampler(chaos)()
          sampleCount++
          const hit = sample * 100 < chaos.probability
          why.push(
            `chaos ${chaos.label}: sampled ${sample.toFixed(4)} vs ${chaos.probability}% → ${hit ? "apply" : "skip"}${chaos.seed ? ` (seed ${chaos.seed})` : ""}`,
          )
          // A failed sample means no chaos on this request; lower-priority rules are not retried.
          if (!hit) chaos = null
        }
      }
      if (mock) why.push(`mock ${mock.label} matched`)

      if (chaos && chaos.mode === "synthetic" && chaos.fault.kind === "replay") {
        // Replay dispatches real requests, so it has no synthetic form and applies no fault.
        why.push("replay is not applicable in synthetic mode; no fault applied")
        chaos = null
      }

      if (chaos && chaos.mode === "synthetic") {
        count(chaos.id)
        why.push("synthetic chaos supersedes any mock and dispatches nothing")
        const plan: Plan = { provider: "synthetic-chaos", chaosRuleId: chaos.id, mockRuleId: mock?.id, why, delayMs: 0 }
        const fault = chaos.fault
        if (fault.kind === "status")
          plan.synthetic = {
            status: fault.status,
            statusText: statusText(fault.status),
            headers: { "content-type": "application/json" },
            body: fault.body || JSON.stringify({ error: statusText(fault.status) || "Chaos fault" }),
          }
        else if (fault.kind === "latency" || fault.kind === "random-latency") {
          plan.delayMs =
            fault.kind === "latency"
              ? fault.delayMs
              : Math.round(
                  Math.min(fault.minMs, fault.maxMs) +
                    sampler(chaos)() * Math.abs(fault.maxMs - fault.minMs),
                )
          // Latency needs a response fixture. A matching mock supplies one, but reading it here
          // must not consume a sequence slot the mock never served, so the first slot is used.
          const slot = mock?.slots[0]
          if (slot) why.push(`response fixture taken from mock ${mock!.label} without consuming its sequence`)
          plan.synthetic = slot
            ? slotResponse(slot)
            : { status: 200, statusText: "OK", headers: { "content-type": "application/json" }, body: "{}" }
        } else if (fault.kind === "malformed-json")
          plan.synthetic = {
            status: 200,
            statusText: "OK",
            headers: { "content-type": "application/json" },
            body: '{"truncated": ',
          }
        else if (fault.kind === "timeout") {
          plan.syntheticFailure = "timeout"
          plan.timeoutMs = fault.timeoutMs
          plan.delayMs = fault.timeoutMs
        } else plan.syntheticFailure = "network-error"
        return withIntercept(plan)
      }

      if (mock) {
        count(mock.id)
        const reserved = reserve(mock)
        const plan: Plan = {
          provider: "mock",
          mockRuleId: mock.id,
          why,
          delayMs: reserved.slot?.delayMs ?? 0,
          sequence:
            mock.mode === "sequence"
              ? { index: reserved.index, total: mock.slots.length, exhausted: reserved.exhausted }
              : undefined,
        }
        if (mock.mode === "sequence")
          why.push(
            `sequence slot ${reserved.index + 1}/${mock.slots.length}${reserved.exhausted ? ` (exhausted → ${mock.exhaustion})` : ""}`,
          )
        if (!reserved.slot) {
          plan.syntheticFailure = "network-error"
          why.push("sequence exhausted with a simulated network error; no real traffic is sent")
          return withIntercept(plan)
        }
        if (reserved.slot.fault !== "none") {
          plan.syntheticFailure = reserved.slot.fault
          why.push(`mock fault ${reserved.slot.fault}`)
          return withIntercept(plan)
        }
        plan.synthetic = slotResponse(reserved.slot)
        if (chaos && chaos.mode === "real")
          why.push("real-traffic chaos does not apply to a mocked response")
        return withIntercept(plan)
      }

      const plan: Plan = { provider: "network", why, delayMs: 0, chaosRuleId: chaos?.id }
      if (chaos && chaos.mode === "real") {
        count(chaos.id)
        const fault = chaos.fault
        const real: RealFault = { preDelayMs: chaos.preDelayMs, deliveryDelayMs: 0 }
        if (fault.kind === "latency") real.deliveryDelayMs = fault.delayMs
        else if (fault.kind === "random-latency")
          real.deliveryDelayMs = Math.round(
            Math.min(fault.minMs, fault.maxMs) + sampler(chaos)() * Math.abs(fault.maxMs - fault.minMs),
          )
        else if (fault.kind === "status") real.status = { status: fault.status, body: fault.body }
        else if (fault.kind === "network-error") real.networkError = true
        else if (fault.kind === "timeout") real.timeoutMs = fault.timeoutMs
        else if (fault.kind === "malformed-json") real.malformedJson = true
        else if (fault.kind === "replay")
          real.replay = { copies: Math.max(0, Math.min(2, fault.copies)), gapMs: fault.gapMs }
        plan.real = real
        why.push(`real-traffic fault ${fault.kind} after one dispatch`)
      } else if (!chaos && !mock) why.push("no active rule matched; captured transport")
      if (intercept) {
        plan.intercept = intercept
        count(intercept.ruleId)
        const pauses = [intercept.pauseRequest && "request", intercept.pauseResponse && "response"].filter(Boolean)
        why.push(
          `intercept ${intercept.label} matched${
            intercept.requestWork || intercept.responseWork || pauses.length
              ? pauses.length
                ? ` with ${pauses.join(" and ")} breakpoint${pauses.length === 1 ? "" : "s"}`
                : ""
              : " with no configured operations"
          }`,
        )
      }
      if (routeRule) {
        const target = routeTarget(routeRule, context.url)
        if (target.error) why.push(`route ${routeRule.label} skipped: ${target.error}`)
        else {
          plan.route = target
          count(routeRule.id)
          why.push(
            `route ${routeRule.label}: ${target.from} → ${target.to}` +
              (target.crossOrigin
                ? ` (cross-origin · credentials ${target.credentials}${target.stripped.length ? ` · stripped ${target.stripped.join(", ")}` : ""})`
                : ""),
          )
        }
      }
      return plan
    },
  }
}

export type RuleEngine = ReturnType<typeof createRuleEngine>
