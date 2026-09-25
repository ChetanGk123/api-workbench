import { mergeHeaders, type Check, type Endpoint, type HeaderValue, type Profile } from "../core/model"
import { createScope, prepare, renderJsonBody, renderTemplate, type Scope } from "./expressions"

/** Section 8.9's outcomes, kept distinct so a run never reports one "failed" total. */
export type RequestOutcome =
  | "passed"
  | "failed-check"
  | "network-error"
  | "timeout"
  | "aborted"
  | "skipped-dependency"
  | "blocked"

export type OnceResult = {
  endpointId: string
  outcome: RequestOutcome
  status?: number
  /** Dispatch to body complete, as consumed by the tester. */
  durationMs: number
  /** Dispatch to response headers. */
  headersMs?: number
  body: string
  truncated: boolean
  /** Response headers as delivered. Absent when the request never produced a response. */
  headers?: Record<string, string>
  /** Decoded body size in bytes, before any truncation to the profile's limit. */
  size?: number
  checks: Array<{ check: Check; state: "passed" | "failed" | "not-evaluated"; detail: string }>
  error?: string
  /** The decoded response, for `{{alias.path}}` references by later steps. */
  value?: unknown
}

export type OnceFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function resolveUrl(endpoint: Endpoint, profile: Profile, scope: Scope): { url?: string; error?: string } {
  const rendered = renderTemplate(endpoint.request.path, "url", scope)
  if (rendered.error) return { error: rendered.error }
  // Only substituted values are escaped, so a literal absolute URL survives rendering intact.
  const path = rendered.value ?? ""
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) return { url: path }
  const configuredOrigin = profile.environments[profile.activeEnvironment]?.[endpoint.hostKey] ?? ""
  const origin = configuredOrigin || (typeof location !== "undefined" ? location.origin : "")
  if (!origin) return { error: `No base URL for host "${endpoint.hostKey}"` }
  try {
    return { url: new URL(path || "/", origin).href }
  } catch {
    return { error: `Could not build a URL from "${path}"` }
  }
}

function getJsonPath(value: unknown, path: string): unknown {
  let current = value
  for (const part of path.replace(/^\$\.?/, "").split(".").filter(Boolean)) {
    if (!current || typeof current !== "object" || !(part in current)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function evaluateCheck(
  check: Check,
  status: number,
  headers: Headers,
  body: string,
  durationMs: number,
): { state: "passed" | "failed" | "not-evaluated"; detail: string } {
  if (check.kind === "status") {
    const passed = typeof check.value === "number" ? status === check.value : status >= check.value.min && status <= check.value.max
    return { state: passed ? "passed" : "failed", detail: `status ${status}` }
  }
  if (check.kind === "header") {
    const actual = headers.get(check.name)
    const passed = actual !== null && (check.value === undefined || actual === check.value)
    return { state: passed ? "passed" : "failed", detail: actual === null ? `missing ${check.name}` : `${check.name}: ${actual}` }
  }
  if (check.kind === "duration") return { state: durationMs <= check.maxMs ? "passed" : "failed", detail: `${durationMs} ms` }
  if (!body) return { state: "not-evaluated", detail: "response body omitted" }
  if (check.kind === "body-contains") return { state: body.includes(check.value) ? "passed" : "failed", detail: `contains ${check.value}` }
  try {
    const json: unknown = JSON.parse(body)
    const actual = getJsonPath(json, check.path)
    if (check.mode === "exists") return { state: actual === undefined ? "failed" : "passed", detail: check.path }
    if (check.mode === "type") return { state: typeof actual === check.value ? "passed" : "failed", detail: `${check.path}: ${typeof actual}` }
    return { state: Object.is(actual, check.value) ? "passed" : "failed", detail: `${check.path}: ${String(actual)}` }
  } catch {
    return { state: "not-evaluated", detail: "response is not valid JSON" }
  }
}

const blocked = (endpointId: string, error: string): OnceResult => ({
  endpointId, outcome: "blocked", durationMs: 0, body: "", truncated: false, checks: [], error,
})

/**
 * One prepared request. Every generated value is reserved on `scope` before dispatch and stays
 * stable for the whole request, so a preview and its dispatch carry the same values.
 */
export async function executeRequest(
  endpoint: Endpoint,
  profile: Profile,
  fetcher: OnceFetch,
  scope: Scope,
  signal?: AbortSignal,
): Promise<OnceResult> {
  const target = resolveUrl(endpoint, profile, scope)
  if (target.error) return blocked(endpoint.id, target.error)
  const headerValues: HeaderValue[] = mergeHeaders(profile.globalHeaders, endpoint.request.headers)
  const headers = new Headers()
  for (const header of headerValues) {
    const resolved = renderTemplate(header.value, "header", scope)
    if (resolved.error) return blocked(endpoint.id, resolved.error)
    headers.set(header.name, resolved.value ?? "")
  }
  let requestBody: string | undefined
  if (endpoint.request.bodyKind !== "none") {
    const rendered =
      endpoint.request.bodyKind === "json"
        ? renderJsonBody(endpoint.request.body, scope)
        : renderTemplate(endpoint.request.body, endpoint.request.bodyKind === "urlencoded" ? "url" : "text", scope)
    if (rendered.error) return blocked(endpoint.id, rendered.error)
    requestBody = rendered.value
  }
  if (signal?.aborted) return { ...blocked(endpoint.id, "Run stopped"), outcome: "aborted" }
  const started = performance.now()
  try {
    const response = await fetcher(target.url!, {
      method: endpoint.request.method,
      headers,
      body: requestBody,
      credentials: endpoint.request.credentials,
      signal,
    })
    const headersMs = Math.round(performance.now() - started)
    const raw = await response.text()
    const limit = Math.max(1, profile.settings.bodyLimitKb) * 1024
    const body = raw.slice(0, limit)
    const durationMs = Math.round(performance.now() - started)
    const checks = endpoint.checks.map((check) => ({ check, ...evaluateCheck(check, response.status, response.headers, body, durationMs) }))
    const outcome = checks.some((check) => check.state === "failed") ? "failed-check" : "passed"
    let value: unknown = body
    try {
      value = JSON.parse(body)
    } catch {
      /* A non-JSON body is still referenceable as text. */
    }
    return {
      endpointId: endpoint.id, outcome, status: response.status, durationMs, headersMs, body,
      truncated: raw.length > body.length, headers: Object.fromEntries(response.headers.entries()),
      size: new TextEncoder().encode(raw).length, checks, value,
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : ""
    const outcome: RequestOutcome = name === "AbortError" ? "aborted" : name === "TimeoutError" ? "timeout" : "network-error"
    return {
      endpointId: endpoint.id, outcome, durationMs: Math.round(performance.now() - started), body: "", truncated: false,
      checks: [], error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * A manual send. Its generated values live in a transient session scope, so a manual Run Once
 * never consumes a run's counter reservations.
 */
export async function executeOnce(
  endpoint: Endpoint,
  profile: Profile,
  fetcher: OnceFetch,
  variables: Record<string, unknown> = {},
  session: Scope = createScope(),
): Promise<OnceResult> {
  return executeRequest(endpoint, profile, fetcher, prepare(session, { ...session.refs, ...variables }))
}
