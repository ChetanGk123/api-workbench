/**
 * The native profile + endpoints export. A supported older document is migrated on read; a newer
 * schema is rejected without touching stored data. Importing as a copy remaps every id as one
 * coherent set, so rules and plan references keep pointing at the endpoints they came with.
 */
import {
  createId,
  defaultProfile,
  defaultTestPlan,
  type Endpoint,
  type Profile,
  type ProfileSnapshot,
  type Rule,
  type TestPlan,
} from "../core/model"
import type { Diagnostic } from "./candidate"

/** The schema this build writes and can read. */
export const SCHEMA_VERSION = 1

export type NativeImport = ProfileSnapshot & {
  schemaVersion: number
  counts: { endpoints: number; rules: number; environments: number; plan: boolean }
}

type Doc = Record<string, unknown>
const record = (value: unknown): Doc => (value && typeof value === "object" ? (value as Doc) : {})
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

export function parseNative(document: Doc): { native?: NativeImport; error?: string; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const schemaVersion = Number(document.schemaVersion ?? SCHEMA_VERSION)
  if (!Number.isFinite(schemaVersion) || schemaVersion > SCHEMA_VERSION)
    return { error: `This export uses schema ${String(document.schemaVersion)}, which this build cannot read. Nothing was changed.`, diagnostics }
  if (schemaVersion < SCHEMA_VERSION) diagnostics.push({ level: "info", message: `Migrated from schema ${schemaVersion} to ${SCHEMA_VERSION}.` })
  const source = record(document.profile)
  if (typeof source.id !== "string" || !Array.isArray(document.endpoints))
    return { error: "Not a Workbench export: it needs a profile object and an endpoints array.", diagnostics }
  const fallback = defaultProfile()
  const profile: Profile = {
    ...fallback,
    ...(source as unknown as Profile),
    environments: Object.keys(record(source.environments)).length ? (source.environments as Profile["environments"]) : fallback.environments,
    activeEnvironment: typeof source.activeEnvironment === "string" && source.activeEnvironment ? source.activeEnvironment : "default",
    globalHeaders: list(source.globalHeaders) as Profile["globalHeaders"],
    settings: { ...fallback.settings, ...record(source.settings) } as Profile["settings"],
  }
  const endpoints = (document.endpoints as Endpoint[]).filter(endpoint => endpoint && typeof endpoint.id === "string" && record(endpoint).request)
  if (endpoints.length !== (document.endpoints as unknown[]).length)
    diagnostics.push({ level: "warning", message: `${(document.endpoints as unknown[]).length - endpoints.length} endpoint record(s) were malformed and skipped.` })
  const rules = list(document.rules).filter(rule => typeof record(rule).id === "string" && typeof record(rule).kind === "string") as Rule[]
  const plan = record(document.plan).id ? (document.plan as TestPlan) : undefined
  return {
    native: {
      schemaVersion,
      profile,
      endpoints,
      rules,
      plan,
      counts: { endpoints: endpoints.length, rules: rules.length, environments: Object.keys(profile.environments).length, plan: !!plan },
    },
    diagnostics,
  }
}

/** Import as a copy: new ids for the profile, endpoints, rules and plan, with references remapped. */
export function remap(native: NativeImport, name?: string): ProfileSnapshot {
  const profileId = createId("profile")
  const now = Date.now()
  const ids = new Map<string, string>()
  const endpoints = native.endpoints.map(endpoint => {
    const id = createId("endpoint")
    ids.set(endpoint.id, id)
    return { ...endpoint, id, profileId }
  })
  const rules = (native.rules ?? []).map(rule => ({
    ...rule,
    id: createId("rule"),
    profileId,
    endpointId: rule.endpointId ? ids.get(rule.endpointId) ?? undefined : undefined,
  }))
  const source = native.plan ?? defaultTestPlan(profileId)
  const plan: TestPlan = {
    ...source,
    id: createId("plan"),
    profileId,
    phases: Object.fromEntries(Object.entries(source.phases).flatMap(([key, phase]) => {
      const mapped = ids.get(key)
      return mapped ? [[mapped, phase] as const] : []
    })),
    excluded: source.excluded.flatMap(key => {
      const mapped = ids.get(key)
      return mapped ? [mapped] : []
    }),
  }
  return {
    profile: { ...native.profile, id: profileId, name: name ?? native.profile.name, revision: 1, createdAt: now, updatedAt: now },
    endpoints,
    rules,
    plan,
  }
}
