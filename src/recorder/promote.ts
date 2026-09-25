import { defaultEndpoint, type BodyKind, type Endpoint, type HttpMethod } from "../core/model"
import { nameFor } from "../tester/context"
import type { ContextBinding } from "../tester/expressions"
import type { CredentialSource, Recording } from "./recorder"

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
  /**
   * Header names the capture redacted and could not trace, so the endpoint carries nothing for
   * them. Replaying without supplying them again is a different request from the one recorded,
   * which is worth saying out loud rather than leaving to be found as an authorisation failure.
   */
  dropped: string[]
  /** Bindings the restored headers read at send time; the new profile's plan carries them. */
  bindings: ContextBinding[]
}

export const REDACTED = "[REDACTED]"

/** The credential headers a recording held and could not trace to a page value. */
export function droppedHeaders(recording: Recording): string[] {
  return Object.entries(recording.headers)
    .filter(([name, value]) => value === REDACTED && !recording.credentials?.[name.toLowerCase()])
    .map(([name]) => name)
}

/** The binding a traced credential reads at send time. */
export function bindingFor(source: CredentialSource): ContextBinding {
  return { name: nameFor(source.source, source.key), source: source.source, key: source.key }
}

/**
 * A traced credential comes back as a template, never as the value: the header is rebuilt from
 * whatever the page holds at the moment the request is sent, so nothing secret is stored and a
 * rotated token still works.
 */
function restoredHeaders(recording: Recording): Array<{ name: string; value: string }> {
  return Object.entries(recording.credentials ?? {}).map(([name, source]) => ({
    name,
    value: `${source.prefix}{{$context("${bindingFor(source).name}")}}`,
  }))
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
      // One that was traced to a page value comes back as the binding that reads it at send time.
      headers: [
        ...Object.entries(recording.headers)
          .filter(([, value]) => value !== REDACTED)
          .map(([name, value]) => ({ name, value })),
        ...restoredHeaders(recording),
      ],
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
/** How captures collapse into one candidate: same method, same path, query ignored. */
export function candidateKey(endpoint: Endpoint): string {
  return `${endpoint.request.method} ${endpoint.request.path.split("?")[0]}`
}

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
    const key = candidateKey(endpoint)
    const existing = byKey.get(key)
    // The latest call carries the freshest sample, so it replaces the draft and keeps the count.
    byKey.set(key, {
      key,
      endpoint: existing ? { ...endpoint, id: existing.endpoint.id } : endpoint,
      count: (existing?.count ?? 0) + 1,
      dropped: [...new Set([...(existing?.dropped ?? []), ...droppedHeaders(recording)])],
      bindings: Object.values(recording.credentials ?? {}).map(bindingFor),
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
