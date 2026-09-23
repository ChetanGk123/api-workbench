/**
 * Scan page: what this page offers as a request value. The scan lists names and masked previews
 * only — nothing is exported, nothing is polled, no getter is invoked, and a value is read again
 * at dispatch so a rotated token or an edited form field is the one that gets sent.
 */
import { readBinding, type ContextBinding, type ContextSource } from "./expressions"

export type ContextCandidate = {
  source: ContextSource
  key: string
  attribute?: string
  /** Masked: enough to recognise the value, never the whole secret. */
  preview: string
  /** A name suggestion for the binding, unique within one scan. */
  suggestedName: string
}

export const SOURCE_LABELS: Record<ContextSource, string> = {
  cookie: "Cookies",
  local: "Local storage",
  session: "Session storage",
  meta: "Meta tags",
  dom: "Form fields",
  global: "Page globals",
}

const MAX_PER_SOURCE = 40
const GLOBAL_DEPTH = 2

/** Shows shape and a few characters; a short value is still masked past its third character. */
export function mask(value: string): string {
  if (!value) return "(empty)"
  if (value.length <= 4) return `${value.slice(0, 1)}… (${value.length} chars)`
  return `${value.slice(0, 3)}…${value.slice(-1)} (${value.length} chars)`
}

function nameFor(source: ContextSource, key: string, taken: Set<string>): string {
  const base = `${source}_${key}`.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "").slice(0, 48) || source
  let name = base
  for (let suffix = 2; taken.has(name); suffix++) name = `${base}_${suffix}`
  taken.add(name)
  return name
}

function storageKeys(store: Storage): string[] {
  const keys: string[] = []
  for (let index = 0; index < store.length && keys.length < MAX_PER_SOURCE; index++) {
    const key = store.key(index)
    if (key) keys.push(key)
  }
  return keys
}

/** Own data-property descriptors under explicit roots only; a getter is never called. */
function walkGlobal(path: string, depth: number, out: Array<[string, string]>): void {
  if (out.length >= MAX_PER_SOURCE || depth > GLOBAL_DEPTH) return
  const segments = path.split(".").filter(Boolean)
  let current: unknown = window
  for (const segment of segments) {
    if (!current || typeof current !== "object") return
    const descriptor = Object.getOwnPropertyDescriptor(current, segment)
    if (!descriptor || !("value" in descriptor)) return
    current = descriptor.value
  }
  if (current === null || current === undefined) return
  if (typeof current !== "object") return out.push([path, String(current)]), undefined
  for (const key of Object.keys(current).slice(0, MAX_PER_SOURCE)) {
    if (out.length >= MAX_PER_SOURCE) return
    const descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (!descriptor || !("value" in descriptor)) continue
    const value = descriptor.value as unknown
    if (value === null || typeof value !== "object") out.push([`${path}.${key}`, String(value)])
    else walkGlobal(`${path}.${key}`, depth + 1, out)
  }
}

export function scanPage(sources: readonly ContextSource[], globalRoots: readonly string[] = []): ContextCandidate[] {
  if (typeof document === "undefined") return []
  const taken = new Set<string>()
  const candidates: ContextCandidate[] = []
  const add = (source: ContextSource, key: string, value: string, attribute?: string) =>
    candidates.push({
      source, key, ...(attribute ? { attribute } : {}), preview: mask(value),
      suggestedName: nameFor(source, key, taken),
    })

  if (sources.includes("cookie"))
    for (const part of document.cookie.split(";").slice(0, MAX_PER_SOURCE)) {
      const index = part.indexOf("=")
      if (index < 0) continue
      const key = part.slice(0, index).trim()
      if (key) add("cookie", key, part.slice(index + 1).trim())
    }
  for (const source of ["local", "session"] as const)
    if (sources.includes(source))
      try {
        const store = source === "local" ? localStorage : sessionStorage
        for (const key of storageKeys(store)) add(source, key, store.getItem(key) ?? "")
      } catch {
        /* Storage can be blocked by the page's settings; the other categories still scan. */
      }
  if (sources.includes("meta"))
    for (const meta of [...document.querySelectorAll("meta[name]")].slice(0, MAX_PER_SOURCE)) {
      const key = meta.getAttribute("name") ?? ""
      if (key) add("meta", key, meta.getAttribute("content") ?? "")
    }
  if (sources.includes("dom"))
    for (const field of [...document.querySelectorAll<HTMLInputElement>("input[name], select[name], textarea[name]")].slice(0, MAX_PER_SOURCE)) {
      const key = `${field.tagName.toLowerCase()}[name="${field.name}"]`
      // A password field's presence is useful; its characters are not previewed at all.
      add("dom", key, field.type === "password" ? "" : field.value, "value")
    }
  if (sources.includes("global"))
    for (const root of globalRoots) {
      const found: Array<[string, string]> = []
      walkGlobal(root.trim(), 1, found)
      for (const [path, value] of found) add("global", path, value)
    }
  return candidates
}

export function bindingFrom(candidate: ContextCandidate, name = candidate.suggestedName): ContextBinding {
  return {
    name,
    source: candidate.source,
    key: candidate.key,
    ...(candidate.attribute ? { attribute: candidate.attribute } : {}),
  }
}

/** A masked preview of what a saved binding resolves to right now, or why it does not. */
export function bindingPreview(binding: ContextBinding): string {
  const value = readBinding(binding)
  return value === undefined ? "not available on this page" : mask(value)
}
