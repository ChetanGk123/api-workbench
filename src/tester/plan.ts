/**
 * Compiling a test plan: which endpoints run in which phase, in what order, and whether the plan
 * can run at all. Every reference between endpoints is a graph edge; the graph is validated before
 * a single request is dispatched.
 */
import { stepPhase, type Endpoint, type Profile, type TestPlan } from "../core/model"
import { referencedAliases } from "./expressions"

export type PlanStep = {
  endpoint: Endpoint
  phase: "setup" | "load"
  /** Aliases this step reads, in template order. */
  dependsOn: string[]
}

export type Preflight = {
  setup: PlanStep[]
  load: PlanStep[]
  errors: string[]
  warnings: string[]
  /** setup steps + (flow: load steps × iterations; independent: endpoints × iterations). */
  requestCount: number
  origins: string[]
  /** Names of selected endpoints whose method can change server state. */
  mutating: string[]
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/** Everything an endpoint's URL, headers and body refer to. */
export function dependenciesOf(endpoint: Endpoint): string[] {
  const templates = [
    endpoint.request.path,
    ...endpoint.request.headers.filter((header) => !header.removed).map((header) => header.value),
    endpoint.request.bodyKind === "none" ? "" : endpoint.request.body,
  ]
  const found = new Set<string>()
  for (const template of templates) for (const alias of referencedAliases(template)) found.add(alias)
  // An endpoint reading its own response is never satisfiable.
  found.delete(endpoint.alias)
  return [...found]
}

/** Kahn's algorithm over the selected steps; stable in plan order, so equal steps keep their order. */
function topological(steps: PlanStep[], visible: Map<string, PlanStep>): { ordered: PlanStep[]; cycle: string[] } {
  const remaining = new Map(steps.map((step) => [step.endpoint.id, step]))
  const ordered: PlanStep[] = []
  for (;;) {
    const ready = [...remaining.values()].filter((step) =>
      step.dependsOn.every((alias) => {
        const producer = visible.get(alias)
        return !producer || !remaining.has(producer.endpoint.id)
      }),
    )
    if (!ready.length) break
    for (const step of ready) {
      ordered.push(step)
      remaining.delete(step.endpoint.id)
    }
  }
  return { ordered, cycle: [...remaining.values()].map((step) => step.endpoint.alias) }
}

export function preflight(plan: TestPlan, endpoints: Endpoint[], profile: Profile): Preflight {
  const errors: string[] = []
  const warnings: string[] = []
  const selected = endpoints.filter((endpoint) => stepPhase(plan, endpoint.id) !== "skip")
  const byAlias = new Map<string, PlanStep>()
  const steps: PlanStep[] = selected.map((endpoint) => ({
    endpoint,
    phase: stepPhase(plan, endpoint.id) === "setup" ? "setup" : "load",
    dependsOn: dependenciesOf(endpoint),
  }))
  for (const step of steps) {
    if (byAlias.has(step.endpoint.alias))
      errors.push(`Two selected endpoints share the alias "${step.endpoint.alias}". Aliases identify producers, so they must be unique.`)
    else byAlias.set(step.endpoint.alias, step)
  }

  const setup = steps.filter((step) => step.phase === "setup")
  const load = steps.filter((step) => step.phase === "load")

  for (const step of steps)
    for (const alias of step.dependsOn) {
      const producer = byAlias.get(alias)
      if (!producer) {
        errors.push(`${step.endpoint.name} refers to {{${alias}.…}}, but no selected endpoint has the alias "${alias}".`)
        continue
      }
      if (step.phase === "setup" && producer.phase === "load")
        errors.push(`${step.endpoint.name} is a setup step but reads "${alias}" from the load phase. Setup cannot depend on a load-phase result.`)
      if (plan.strategy === "independent" && step.phase === "load" && producer.phase === "load")
        errors.push(
          `Independent runs have no ordered flow, so ${step.endpoint.name} cannot read "${alias}" from another load endpoint. Switch to Flow, or promote "${alias}" to setup after checking what it means to run it once.`,
        )
    }

  const orderedSetup = topological(setup, byAlias)
  if (orderedSetup.cycle.length) errors.push(`Setup endpoints depend on each other in a cycle: ${orderedSetup.cycle.join(" → ")}.`)
  const orderedLoad = plan.strategy === "flow" ? topological(load, byAlias) : { ordered: load, cycle: [] as string[] }
  if (orderedLoad.cycle.length) errors.push(`Load endpoints depend on each other in a cycle: ${orderedLoad.cycle.join(" → ")}.`)

  if (!load.length && !setup.length) errors.push("Select at least one endpoint before running.")
  if (!load.length && setup.length) warnings.push("This plan has setup steps only: nothing repeats.")
  if (plan.iterations > 1 && steps.some((step) => !SAFE_METHODS.has(step.endpoint.request.method)))
    warnings.push("Repeated iterations share this page's session and account. Mutating endpoints will act on the same data every iteration.")

  const origins = new Set<string>()
  const environment = profile.environments[profile.activeEnvironment] ?? {}
  for (const step of steps) {
    const path = step.endpoint.request.path
    const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(path)
    const base = absolute ? path : environment[step.endpoint.hostKey] || (typeof location === "undefined" ? "" : location.origin)
    try {
      origins.add(new URL(absolute ? path : base).origin)
    } catch {
      errors.push(`${step.endpoint.name} has no usable base URL for host "${step.endpoint.hostKey}". Set it in Endpoints.`)
    }
  }

  const iterations = Math.max(1, plan.iterations)
  return {
    setup: orderedSetup.ordered,
    load: orderedLoad.ordered,
    errors,
    warnings,
    requestCount: setup.length + load.length * iterations,
    origins: [...origins],
    mutating: steps.filter((step) => !SAFE_METHODS.has(step.endpoint.request.method)).map((step) => step.endpoint.name),
  }
}
