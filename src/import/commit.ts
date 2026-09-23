/**
 * Conflicts and the transactional commit. Nothing here writes: it computes the next configuration
 * and a summary, so the caller can persist it in one transaction and keep the review intact when
 * the write fails.
 */
import type { Endpoint, Profile, ProfileSnapshot, Rule, WorkbenchConfig } from "../core/model"
import type { ImportCandidate } from "./candidate"
import { remap, type NativeImport } from "./native"

export type Resolution = "keep-both" | "replace" | "skip"

export type CandidateSelection = {
  key: string
  endpoint: Endpoint
  selected: boolean
  resolution: Resolution
  unresolved: number
}

export type ImportSummary = { added: number; replaced: number; skipped: number; unresolved: number; hosts: string[] }

/** Query strings and a trailing slash differ per call; the request identity does not. */
export function normalizedPath(path: string): string {
  const withoutQuery = path.split(/[?#]/)[0] ?? ""
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/$/, "") : withoutQuery
}

/**
 * A potential duplicate: the same method, host and normalized path, or the same alias. A display
 * name alone never counts as a match.
 */
export function conflictOf(endpoint: Endpoint, existing: readonly Endpoint[]): Endpoint | undefined {
  return existing.find(
    item =>
      (item.request.method === endpoint.request.method &&
        item.hostKey === endpoint.hostKey &&
        normalizedPath(item.request.path) === normalizedPath(endpoint.request.path)) ||
      item.alias === endpoint.alias,
  )
}

/** Rules and plan steps that point at an endpoint, so a replacement states what it affects. */
export function linkedTo(config: WorkbenchConfig, endpointId: string): { rules: string[]; plan: boolean } {
  const rules = (config.rules ?? []).filter(rule => rule.endpointId === endpointId).map(rule => rule.label)
  const plan = !!config.plan && (endpointId in config.plan.phases || config.plan.excluded.includes(endpointId))
  return { rules, plan }
}

function uniqueAlias(alias: string, taken: Set<string>): string {
  let value = alias
  for (let suffix = 2; taken.has(value); suffix++) value = `${alias}_${suffix}`
  taken.add(value)
  return value
}

function withHosts(profile: Profile, hosts: Record<string, string>): { profile: Profile; added: string[] } {
  const environment = { ...(profile.environments[profile.activeEnvironment] ?? {}) }
  const added: string[] = []
  for (const [key, origin] of Object.entries(hosts)) {
    if (key === "default" || environment[key]) continue
    environment[key] = origin
    added.push(key)
  }
  if (!added.length) return { profile, added }
  return {
    profile: { ...profile, environments: { ...profile.environments, [profile.activeEnvironment]: environment }, updatedAt: Date.now() },
    added,
  }
}

/**
 * Applies a reviewed candidate selection to the destination profile. A replacement keeps the
 * existing endpoint's id, so rules and plan references survive it.
 */
export function applyCandidates(
  config: WorkbenchConfig,
  selections: readonly CandidateSelection[],
  hosts: Record<string, string>,
): { config: WorkbenchConfig; summary: ImportSummary } {
  const endpoints = [...config.endpoints]
  const taken = new Set(endpoints.map(endpoint => endpoint.alias))
  const summary: ImportSummary = { added: 0, replaced: 0, skipped: 0, unresolved: 0, hosts: [] }
  for (const selection of selections) {
    if (!selection.selected || selection.resolution === "skip") {
      summary.skipped++
      continue
    }
    const existing = conflictOf(selection.endpoint, endpoints)
    if (selection.resolution === "replace" && existing) {
      const index = endpoints.indexOf(existing)
      endpoints[index] = {
        ...selection.endpoint,
        id: existing.id,
        profileId: existing.profileId,
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
        alias: existing.alias,
      }
      summary.replaced++
    } else {
      endpoints.push({
        ...selection.endpoint,
        profileId: config.profile.id,
        alias: uniqueAlias(selection.endpoint.alias, taken),
        updatedAt: Date.now(),
      })
      summary.added++
    }
    if (selection.unresolved) summary.unresolved++
  }
  const merged = withHosts(config.profile, hosts)
  summary.hosts = merged.added
  return { config: { ...config, profile: merged.profile, endpoints }, summary }
}

export type NativeMode = "new-profile" | "merge" | "replace"

export type NativeOutcome = {
  config: WorkbenchConfig
  summary: ImportSummary
  /** Set when the import installed a different profile as the live one. */
  activated?: ProfileSnapshot
  /** Set when the import only added a stored profile, which the user still has to select. */
  stored?: ProfileSnapshot
}

/**
 * Native import. `new-profile` stores a remapped copy without activating it (§8.11), `merge` adds
 * the imported endpoints and rules to the current profile, and `replace` installs the imported
 * snapshot as the live profile — the only mode that discards existing records.
 */
export function applyNative(config: WorkbenchConfig, native: NativeImport, mode: NativeMode, name?: string): NativeOutcome {
  const summary: ImportSummary = { added: 0, replaced: 0, skipped: 0, unresolved: 0, hosts: [] }
  if (mode === "new-profile") {
    const snapshot = remap(native, name)
    summary.added = snapshot.endpoints.length
    return {
      config: { ...config, savedProfiles: [...(config.savedProfiles ?? []), snapshot] },
      summary,
      stored: snapshot,
    }
  }
  if (mode === "merge") {
    const copy = remap(native)
    const endpoints = [...config.endpoints]
    const taken = new Set(endpoints.map(endpoint => endpoint.alias))
    const ids = new Map<string, string>()
    for (const endpoint of copy.endpoints) {
      if (conflictOf(endpoint, endpoints)) {
        summary.skipped++
        continue
      }
      const owned = { ...endpoint, profileId: config.profile.id, alias: uniqueAlias(endpoint.alias, taken) }
      ids.set(endpoint.id, owned.id)
      endpoints.push(owned)
      summary.added++
    }
    // Only rules whose endpoint came across are kept pointing at one; the rest stay unlinked.
    const rules: Rule[] = [
      ...(config.rules ?? []),
      ...(copy.rules ?? []).map(rule => ({ ...rule, profileId: config.profile.id, endpointId: rule.endpointId ? ids.get(rule.endpointId) : undefined })),
    ]
    const merged = withHosts(config.profile, Object.fromEntries(
      Object.entries(native.profile.environments[native.profile.activeEnvironment] ?? {}).filter(([, origin]) => origin),
    ))
    summary.hosts = merged.added
    return { config: { ...config, profile: merged.profile, endpoints, rules }, summary }
  }
  summary.added = native.endpoints.length
  summary.replaced = config.endpoints.length
  const snapshot: ProfileSnapshot = { profile: native.profile, endpoints: native.endpoints, rules: native.rules ?? [], plan: native.plan }
  return {
    config: { profile: native.profile, endpoints: native.endpoints, rules: native.rules ?? [], plan: native.plan, savedProfiles: config.savedProfiles ?? [] },
    summary,
    activated: snapshot,
  }
}

/** Human summary for the review and the post-commit message. */
export function summaryText(summary: ImportSummary): string {
  const parts = [`${summary.added} endpoint${summary.added === 1 ? "" : "s"} added`]
  if (summary.replaced) parts.push(`${summary.replaced} replaced`)
  if (summary.skipped) parts.push(`${summary.skipped} skipped`)
  if (summary.unresolved) parts.push(`${summary.unresolved} need variables`)
  if (summary.hosts.length) parts.push(`${summary.hosts.length} base URL${summary.hosts.length === 1 ? "" : "s"} added`)
  return `${parts.join(", ")}.`
}

export type { ImportCandidate }
