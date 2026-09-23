/**
 * The repeated-request runner. This is a browser-local scheduler: event-loop timing, tab
 * throttling, connection limits and one shared session make its numbers a comparison between
 * runs in this tab, not a statement about server capacity.
 */
import {
  MAX_SAMPLES_PER_ENDPOINT,
  RAMP_STEP_MS,
  type Endpoint,
  type Profile,
  type TestPlan,
} from "../core/model"
import { createScope, prepare, type Scope } from "./expressions"
import { executeRequest, type OnceFetch, type OnceResult, type RequestOutcome } from "./once"
import { preflight, type Preflight, type PlanStep } from "./plan"

export type StepResult = {
  endpointId: string
  endpointName: string
  alias: string
  method: string
  phase: "setup" | "load"
  /** Iteration index for Flow, repetition index for Independent; 0 for setup. */
  index: number
  outcome: RequestOutcome
  status?: number
  durationMs?: number
  headersMs?: number
  /** Time between being admitted by the scheduler and dispatch. */
  queuedMs: number
  error?: string
  failedChecks: string[]
}

export type RunState = {
  id: string
  planName: string
  strategy: TestPlan["strategy"]
  mode: TestPlan["mode"]
  iterations: number
  concurrency: number
  startedAt: number
  endedAt?: number
  state: "preflight-failed" | "running" | "completed" | "stopped" | "setup-failed"
  /** Requests the preflight planned; the run never dispatches more than this. */
  planned: number
  completed: number
  /** Finished iterations (Flow) or finished jobs (Independent). */
  progress: number
  progressTotal: number
  errors: string[]
  warnings: string[]
  counts: Record<RequestOutcome, number>
  /** Per endpoint, in plan order. */
  endpoints: EndpointStats[]
  /** The most recent results, bounded for display. */
  recent: StepResult[]
}

export type EndpointStats = {
  endpointId: string
  name: string
  alias: string
  method: string
  phase: "setup" | "load"
  counts: Record<RequestOutcome, number>
  /** Bounded latency samples; `sampleCount` says how many requests they represent. */
  samples: number[]
  sampleCount: number
}

export const OUTCOMES: RequestOutcome[] = [
  "passed",
  "failed-check",
  "network-error",
  "timeout",
  "aborted",
  "skipped-dependency",
  "blocked",
]

const zeroCounts = (): Record<RequestOutcome, number> =>
  Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])) as Record<RequestOutcome, number>

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  ms <= 0 && !signal.aborted
    ? Promise.resolve()
    : new Promise((resolve) => {
        const timer = setTimeout(done, ms)
        function done() {
          clearTimeout(timer)
          signal.removeEventListener("abort", done)
          resolve()
        }
        signal.addEventListener("abort", done, { once: true })
      })

export type RunOptions = {
  plan: TestPlan
  profile: Profile
  endpoints: Endpoint[]
  fetcher: OnceFetch
  signal: AbortSignal
  onProgress?: (state: RunState) => void
  /** Injected in tests so scheduling can be checked without real timers or randomness. */
  random?: () => number
  now?: () => number
}

const MAX_RECENT = 200

export async function startRun(options: RunOptions): Promise<RunState> {
  const { plan, profile, endpoints, fetcher } = options
  // The caller's Stop and the failure policy's own stop share one signal, so both end the run
  // the same way: owned requests abort and nothing new is scheduled.
  const controller = new AbortController()
  const signal = controller.signal
  let stoppedByPolicy = false
  if (options.signal.aborted) controller.abort()
  else options.signal.addEventListener("abort", () => controller.abort(), { once: true })
  const check = preflight(plan, endpoints, profile)
  const iterations = Math.max(1, Math.round(plan.iterations))
  const concurrency = Math.max(1, Math.round(plan.concurrency))
  const state: RunState = {
    id: `run-${Date.now().toString(36)}`,
    planName: plan.name,
    strategy: plan.strategy,
    mode: plan.mode,
    iterations,
    concurrency,
    startedAt: Date.now(),
    state: check.errors.length ? "preflight-failed" : "running",
    planned: check.requestCount,
    completed: 0,
    progress: 0,
    progressTotal: plan.strategy === "flow" ? iterations : check.load.length * iterations,
    errors: [...check.errors],
    warnings: [...check.warnings],
    counts: zeroCounts(),
    endpoints: [...check.setup, ...check.load].map((step) => ({
      endpointId: step.endpoint.id,
      name: step.endpoint.name,
      alias: step.endpoint.alias,
      method: step.endpoint.request.method,
      phase: step.phase,
      counts: zeroCounts(),
      samples: [],
      sampleCount: 0,
    })),
    recent: [],
  }
  const publish = () => options.onProgress?.({ ...state, endpoints: state.endpoints.map((item) => ({ ...item })), recent: [...state.recent] })
  if (check.errors.length) {
    state.endedAt = Date.now()
    publish()
    return state
  }

  // Counters are run-scoped and reserved in scheduler order; bindings resolve again per dispatch.
  const runScope = createScope({
    bindings: plan.bindings,
    ...(options.random ? { random: options.random } : {}),
    ...(options.now ? { now: options.now } : {}),
  })

  const record = (step: PlanStep, index: number, queuedMs: number, result: OnceResult): StepResult => {
    const entry: StepResult = {
      endpointId: step.endpoint.id,
      endpointName: step.endpoint.name,
      alias: step.endpoint.alias,
      method: step.endpoint.request.method,
      phase: step.phase,
      index,
      outcome: result.outcome,
      ...(result.status === undefined ? {} : { status: result.status }),
      ...(result.outcome === "skipped-dependency" || result.outcome === "blocked" ? {} : { durationMs: result.durationMs }),
      ...(result.headersMs === undefined ? {} : { headersMs: result.headersMs }),
      queuedMs,
      ...(result.error ? { error: result.error } : {}),
      failedChecks: result.checks.filter((item) => item.state === "failed").map((item) => item.detail),
    }
    state.counts[entry.outcome] += 1
    state.completed += 1
    const stats = state.endpoints.find((item) => item.endpointId === step.endpoint.id)
    if (stats) {
      stats.counts[entry.outcome] += 1
      // Only a real dispatch contributes a latency sample; blocked and skipped steps never do.
      if (entry.durationMs !== undefined && (entry.outcome === "passed" || entry.outcome === "failed-check")) {
        stats.sampleCount += 1
        if (stats.samples.length < MAX_SAMPLES_PER_ENDPOINT) stats.samples.push(entry.durationMs)
      }
    }
    state.recent = [entry, ...state.recent].slice(0, MAX_RECENT)
    publish()
    return entry
  }

  const skip = (step: PlanStep, index: number, reason: string) =>
    record(step, index, 0, {
      endpointId: step.endpoint.id, outcome: "skipped-dependency", durationMs: 0, body: "",
      truncated: false, checks: [], error: reason,
    })

  /** Runs one ordered list of steps against one context. Failed producers skip their dependents. */
  const runSteps = async (
    steps: PlanStep[],
    refs: Record<string, unknown>,
    index: number,
    admittedAt: number,
  ): Promise<boolean> => {
    const failed = new Set<string>()
    let allPassed = true
    for (const step of steps) {
      if (signal.aborted) return false
      const blockedBy = step.dependsOn.filter((alias) => failed.has(alias))
      if (blockedBy.length) {
        failed.add(step.endpoint.alias)
        allPassed = false
        skip(step, index, `Skipped: ${blockedBy.join(", ")} did not produce a result`)
        continue
      }
      const scope: Scope = prepare(runScope, refs)
      // Queue time: from this job being admitted by a worker to this step starting.
      const queuedMs = Math.round(performance.now() - admittedAt)
      const result = await executeRequest(step.endpoint, profile, fetcher, scope, signal)
      const entry = record(step, index, queuedMs, result)
      if (entry.outcome === "passed" || entry.outcome === "failed-check") refs[step.endpoint.alias] = result.value
      if (entry.outcome !== "passed") {
        allPassed = false
        // A step that produced no usable value cannot satisfy its dependents.
        if (entry.outcome !== "failed-check") failed.add(step.endpoint.alias)
        if (plan.onFailure === "stop") {
          stoppedByPolicy = true
          controller.abort()
          return false
        }
      }
    }
    return allPassed
  }

  const setupRefs: Record<string, unknown> = {}
  if (check.setup.length) {
    const ok = await runSteps(check.setup, setupRefs, 0, performance.now())
    if (!ok || signal.aborted) {
      state.state = signal.aborted ? "stopped" : "setup-failed"
      if (!signal.aborted) state.errors.push("Setup did not complete, so the load phase did not run.")
      state.endedAt = Date.now()
      publish()
      return state
    }
  }

  /** Workers share one queue; ramp-up staggers when each worker is admitted. */
  const pool = async (take: () => (() => Promise<void>) | undefined) => {
    const workers = Array.from({ length: concurrency }, async (_unused, worker) => {
      if (plan.rampUp && worker) await wait(worker * RAMP_STEP_MS, signal)
      for (;;) {
        if (signal.aborted) return
        const job = take()
        if (!job) return
        await job()
        if (plan.delayMs > 0) await wait(plan.delayMs, signal)
      }
    })
    await Promise.all(workers)
  }

  if (plan.strategy === "flow") {
    let next = 0
    await pool(() => {
      if (next >= iterations) return undefined
      const iteration = next++
      const admittedAt = performance.now()
      return async () => {
        // Each iteration starts from a copy of setup output; job variables never leak sideways.
        await runSteps(check.load, { ...setupRefs }, iteration, admittedAt)
        state.progress += 1
        publish()
      }
    })
  } else {
    // A fair shared scheduler: one queue per endpoint, admitted round-robin under one global limit.
    const queues = check.load.map((step) => ({ step, remaining: iterations }))
    let cursor = 0
    const repetition = new Map<string, number>()
    await pool(() => {
      for (let attempt = 0; attempt < queues.length; attempt++) {
        const slot = queues[(cursor + attempt) % queues.length]
        if (!slot || slot.remaining <= 0) continue
        slot.remaining -= 1
        cursor = (cursor + attempt + 1) % queues.length
        const index = repetition.get(slot.step.endpoint.id) ?? 0
        repetition.set(slot.step.endpoint.id, index + 1)
        const admittedAt = performance.now()
        return async () => {
          // Each (endpoint, repetition) is its own context over read-only setup output.
          await runSteps([slot.step], { ...setupRefs }, index, admittedAt)
          state.progress += 1
          publish()
        }
      }
      return undefined
    })
  }

  state.state = signal.aborted ? "stopped" : "completed"
  if (stoppedByPolicy) state.errors.push("Stopped after a failed step, because the failure policy is Stop.")
  state.endedAt = Date.now()
  publish()
  return state
}

export type { Preflight }
