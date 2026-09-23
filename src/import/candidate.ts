/**
 * The normalized candidate model every import adapter produces. Adapters parse their own format
 * into `SourceRequest`s; this module turns those into endpoints, so the endpoint editor,
 * mock-from-sample action and test plans behave identically whatever the source format was.
 *
 * Nothing here touches the network: no adapter and no detector may call a browser networking API.
 */
import {
  createId,
  defaultEndpoint,
  forbiddenRequestHeader,
  type BodyKind,
  type Endpoint,
  type HeaderValue,
  type HttpMethod,
} from "../core/model"

export type Severity = "info" | "warning" | "error"
export type Diagnostic = { level: Severity; message: string }

export const METHODS: readonly string[] = [
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
] satisfies readonly HttpMethod[]

export type SourceBody = { kind: BodyKind; text: string }

/** One alternative request body offered by the source (media type or named example). */
export type Variant = { label: string; contentType: string; body: SourceBody }

/** A parsed source item, before it is validated into an endpoint. */
export type SourceRequest = {
  /** Source identity: operation id, folder path, HAR entry index, recorder key. Used for conflicts. */
  key: string
  name: string
  method: string
  /** Absolute URL or page-relative path. May contain unresolved `{{name}}` templates. */
  url: string
  headers: HeaderValue[]
  body?: SourceBody
  credentials?: RequestCredentials
  sample?: { status: number; headers: HeaderValue[]; body: string }
  /** Provenance kept beside the diagnostics, e.g. `Postman · Auth/Login`. */
  source: string
  /** Preferred alias; collisions are resolved in the returned set. */
  alias?: string
  diagnostics?: Diagnostic[]
  variants?: Variant[]
}

export type ImportCandidate = {
  key: string
  endpoint: Endpoint
  /** Source items that collapsed into this candidate. */
  count: number
  source: string
  diagnostics: Diagnostic[]
  /** `{{name}}` templates with no value yet. The tester blocks a run until they are configured. */
  unresolved: string[]
  /** Fields carrying credentials in the source, listed so a commit is never a silent secret copy. */
  sensitive: string[]
  variants: Variant[]
}

export function pageOrigin(): string {
  return typeof location === "undefined" ? "" : location.origin
}

const SENSITIVE_HEADERS = /^(authorization|proxy-authorization|x-api-key|api-key|x-auth-token|x-csrf-token|x-xsrf-token|token)$/i
const SENSITIVE_QUERY = /^(access_token|api_key|apikey|key|password|secret|signature|token)$/i

/** `{{name}}` references that are not built-in calls: values the user still has to supply. */
export function unresolvedNames(...texts: Array<string | undefined>): string[] {
  const names = new Set<string>()
  for (const text of texts)
    for (const match of (text ?? "").matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      const name = match[1] ?? ""
      if (name && !name.startsWith("$")) names.add(name)
    }
  return [...names]
}

export function aliasFrom(preferred: string, method: string, path: string): string {
  const base = preferred.trim()
    ? preferred.trim().replace(/[^a-z\d]+/gi, "_").replace(/^_+|_+$/g, "")
    : `${method.toLowerCase()}_${path.split("/").filter(Boolean).map(part => part.replace(/[^a-z\d]+/gi, "_")).join("_") || "root"}`
  return (base || "endpoint").slice(0, 64).toLowerCase()
}

/** `http://api.test:8080` → `api.test_8080`; the page's own origin stays `default`. */
export function hostKeyOf(origin: string): string {
  if (!origin || origin === pageOrigin()) return "default"
  return origin.replace(/^[a-z][a-z\d+.-]*:\/\//i, "").replace(/^[^@]*@/, "").replace(/[^a-z\d.-]/gi, "_")
}

/** Splits an absolute URL without `new URL()`, so an unresolved `{{var}}` survives parsing. */
export function splitUrl(url: string): { origin: string; path: string } {
  const absolute = /^([a-z][a-z\d+.-]*:\/\/[^/?#]*)([^]*)$/i.exec(url.trim())
  if (!absolute) return { origin: "", path: url.trim() || "/" }
  return { origin: absolute[1] ?? "", path: absolute[2] || "/" }
}

export type Normalized = {
  candidates: ImportCandidate[]
  /** Host key → origin, ready to be merged into the destination profile's environment map. */
  hosts: Record<string, string>
  skipped: number
  diagnostics: Diagnostic[]
}

function toCandidate(request: SourceRequest, profileId: string): ImportCandidate | null {
  const method = request.method.toUpperCase()
  if (!METHODS.includes(method)) return null
  const { origin, path } = splitUrl(request.url)
  if (!path.startsWith("/") && !path.startsWith("{{")) return null
  const diagnostics = [...(request.diagnostics ?? [])]
  const sensitive: string[] = []
  const headers: HeaderValue[] = []
  for (const header of request.headers) {
    const name = header.name.trim()
    if (!name) continue
    // A browser refuses these on a replay, so they are recorded as diagnostics rather than
    // saved as headers that would silently never be sent.
    if (forbiddenRequestHeader(name)) {
      diagnostics.push({ level: "info", message: `Browser-controlled header not imported: ${name}` })
      continue
    }
    if (SENSITIVE_HEADERS.test(name)) sensitive.push(name)
    headers.push({ name, value: header.value })
  }
  for (const [key] of new URLSearchParams(path.split("?")[1] ?? ""))
    if (SENSITIVE_QUERY.test(key)) sensitive.push(`query ${key}`)
  const base = defaultEndpoint(profileId)
  const endpoint: Endpoint = {
    ...base,
    id: createId("endpoint"),
    name: request.name.trim() || `${method} ${path.split("?")[0]}`,
    alias: aliasFrom(request.alias ?? request.name, method, path.split("?")[0] ?? ""),
    hostKey: hostKeyOf(origin),
    request: {
      method: method as HttpMethod,
      path,
      headers,
      bodyKind: request.body?.kind ?? "none",
      body: request.body?.text ?? "",
      credentials: request.credentials ?? "same-origin",
    },
    checks: base.checks,
    sampleResponse: request.sample,
  }
  return {
    key: request.key,
    endpoint,
    count: 1,
    source: request.source,
    diagnostics,
    unresolved: unresolvedNames(path, ...headers.map(header => header.value), endpoint.request.body),
    sensitive: [...new Set(sensitive)],
    variants: request.variants ?? [],
  }
}

/**
 * Validates parsed source requests into candidates. Items sharing a key collapse into one
 * candidate with a count; items with an unsupported method or an unusable URL are skipped and
 * counted rather than silently dropped.
 */
export function normalize(requests: readonly SourceRequest[], profileId: string): Normalized {
  const byKey = new Map<string, ImportCandidate>()
  const hosts: Record<string, string> = {}
  const diagnostics: Diagnostic[] = []
  let skipped = 0
  for (const request of requests) {
    const candidate = toCandidate(request, profileId)
    if (!candidate) {
      skipped++
      diagnostics.push({ level: "warning", message: `Skipped ${request.source}: unsupported method or URL (${request.method} ${request.url.slice(0, 120)})` })
      continue
    }
    const existing = byKey.get(candidate.key)
    // The later item carries the freshest sample; the count keeps the repetition visible.
    if (existing) byKey.set(candidate.key, { ...candidate, endpoint: { ...candidate.endpoint, id: existing.endpoint.id }, count: existing.count + 1 })
    else byKey.set(candidate.key, candidate)
    const origin = splitUrl(request.url).origin
    if (origin && candidate.endpoint.hostKey !== "default") hosts[candidate.endpoint.hostKey] = origin
  }
  const taken = new Set<string>()
  const candidates = [...byKey.values()].map(candidate => {
    let alias = candidate.endpoint.alias
    for (let suffix = 2; taken.has(alias); suffix++) alias = `${candidate.endpoint.alias}_${suffix}`
    taken.add(alias)
    if (alias !== candidate.endpoint.alias)
      candidate.diagnostics.push({ level: "info", message: `Alias collision resolved: ${candidate.endpoint.alias} → ${alias}` })
    return { ...candidate, endpoint: { ...candidate.endpoint, alias } }
  })
  return { candidates, hosts, skipped, diagnostics }
}
