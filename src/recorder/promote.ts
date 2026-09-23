import { defaultEndpoint, type BodyKind, type Endpoint, type HttpMethod } from "../core/model"
import type { Recording } from "./recorder"

const METHODS: readonly string[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] satisfies readonly HttpMethod[]

/** One endpoint candidate plus how many recorded calls collapsed into it. */
export type Candidate = {
  /** `METHOD pathname`: the identity a draft keeps across further recording. */
  key: string
  endpoint: Endpoint
  count: number
}

export type Candidates = {
  candidates: Candidate[]
  /** Host key -> origin, ready to become the new profile's environment map. */
  hosts: Record<string, string>
  /** Records that cannot be represented as an endpoint (unsupported method or unparsable URL). */
  skipped: number
}

function pageOrigin(): string {
  return typeof location === "undefined" ? "" : location.origin
}

/** The page's own origin stays `default` so recorded paths keep working without configuration. */
function hostKeyOf(url: URL): string {
  return url.origin === pageOrigin() || !url.hostname
    ? "default"
    : url.hostname.replace(/[^a-z\d.-]/gi, "")
}

function aliasOf(method: string, pathname: string): string {
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-z\d]+/gi, "_"))
    .join("_")
  return `${method.toLowerCase()}_${segments || "root"}`.slice(0, 64)
}

function bodyKindOf(recording: Recording): BodyKind {
  if (!recording.body) return "none"
  const contentType = recording.headers["content-type"] ?? ""
  if (/json/i.test(contentType)) return "json"
  if (/x-www-form-urlencoded/i.test(contentType)) return "urlencoded"
  return "text"
}

export function endpointFromRecording(recording: Recording, profileId: string): Endpoint | null {
  if (!METHODS.includes(recording.method)) return null
  let url: URL
  try {
    url = new URL(recording.url)
  } catch {
    return null
  }
  const base = defaultEndpoint(profileId)
  return {
    ...base,
    name: `${recording.method} ${url.pathname}`,
    alias: aliasOf(recording.method, url.pathname),
    hostKey: hostKeyOf(url),
    request: {
      ...base.request,
      method: recording.method as HttpMethod,
      path: `${url.pathname}${url.search}`,
      // A redacted value is a marker, not a credential: it must never be replayed as a header.
      headers: Object.entries(recording.headers)
        .filter(([, value]) => value !== "[REDACTED]")
        .map(([name, value]) => ({ name, value })),
      bodyKind: bodyKindOf(recording),
      body: recording.body ?? "",
    },
    sampleResponse: recording.response
      ? {
          status: recording.response.status,
          headers: Object.entries(recording.response.headers).map(([name, value]) => ({
            name,
            value,
          })),
          body: recording.response.body ?? "",
        }
      : undefined,
  }
}

/**
 * Collapses a capture session into endpoint candidates. Repeated calls to the same method and
 * pathname are one endpoint — query strings differ per call, so the most recent one wins and the
 * count keeps the repetition visible. Aliases are made unique within the returned set.
 */
export function candidatesFrom(
  recordings: readonly Recording[],
  profileId: string,
): Candidates {
  const byKey = new Map<string, Candidate>()
  const hosts: Record<string, string> = {}
  let skipped = 0
  for (const recording of recordings) {
    const endpoint = endpointFromRecording(recording, profileId)
    if (!endpoint) {
      skipped++
      continue
    }
    const key = `${endpoint.request.method} ${endpoint.request.path.split("?")[0]}`
    const existing = byKey.get(key)
    // The latest call carries the freshest sample, so it replaces the draft and keeps the count.
    byKey.set(key, {
      key,
      endpoint: existing ? { ...endpoint, id: existing.endpoint.id } : endpoint,
      count: (existing?.count ?? 0) + 1,
    })
    if (endpoint.hostKey !== "default") hosts[endpoint.hostKey] = new URL(recording.url).origin
  }
  const taken = new Set<string>()
  const candidates = [...byKey.values()].map((candidate) => {
    let alias = candidate.endpoint.alias
    for (let suffix = 2; taken.has(alias); suffix++) alias = `${candidate.endpoint.alias}_${suffix}`
    taken.add(alias)
    return { ...candidate, endpoint: { ...candidate.endpoint, alias } }
  })
  if (pageOrigin()) hosts.default = pageOrigin()
  return { candidates, hosts, skipped }
}
