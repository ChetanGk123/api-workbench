/**
 * Run statistics and export. Every number here comes from the run's own samples: averages are
 * computed from the underlying samples rather than from per-endpoint averages, and a statistic
 * with no samples is omitted rather than reported as zero.
 */
import { MAX_SAMPLES_PER_ENDPOINT } from "../core/model"
import { OUTCOMES, type EndpointStats, type RunState } from "./run"

export type Stats = {
  count: number
  avgMs?: number
  minMs?: number
  maxMs?: number
  p95Ms?: number
  /** True when more requests completed than the samples kept, so P95 covers part of the run. */
  truncated: boolean
}

/** Nearest rank: the sorted sample at `ceil(0.95 × n) - 1`. */
export function percentile(samples: readonly number[], fraction: number): number | undefined {
  if (!samples.length) return undefined
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))]
}

export function statsOf(samples: readonly number[], sampleCount = samples.length): Stats {
  if (!samples.length) return { count: sampleCount, truncated: sampleCount > 0 }
  const total = samples.reduce((sum, value) => sum + value, 0)
  return {
    count: sampleCount,
    avgMs: Math.round(total / samples.length),
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
    p95Ms: percentile(samples, 0.95),
    truncated: sampleCount > samples.length,
  }
}

export function overallStats(run: RunState): Stats {
  const samples = run.endpoints.flatMap((endpoint) => endpoint.samples)
  const sampleCount = run.endpoints.reduce((sum, endpoint) => sum + endpoint.sampleCount, 0)
  return statsOf(samples, sampleCount)
}

export function endpointStats(endpoint: EndpointStats): Stats {
  return statsOf(endpoint.samples, endpoint.sampleCount)
}

export function passedCount(run: RunState): number {
  return run.counts.passed
}

/** Everything that is not a pass, kept broken down rather than merged into one total. */
export function failedCount(run: RunState): number {
  return OUTCOMES.filter((outcome) => outcome !== "passed").reduce((sum, outcome) => sum + run.counts[outcome], 0)
}

const TIMING_NOTES = {
  durationMs: "Dispatch to response body fully read by the tester.",
  headersMs: "Dispatch to response headers.",
  queuedMs: "Worker admitting the job to this step starting.",
  p95: "Nearest rank: sorted sample at ceil(0.95 × n) − 1.",
  samples: `Latency samples are kept per endpoint up to ${MAX_SAMPLES_PER_ENDPOINT}; sampleCount is the number of requests they represent.`,
  source: "Browser-local timings from performance.now() in one tab. Not a server capacity measurement.",
}

export function runToJson(run: RunState, configurationRevision: number): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      configurationRevision,
      run: {
        id: run.id, plan: run.planName, strategy: run.strategy, mode: run.mode,
        state: run.state, startedAt: run.startedAt, endedAt: run.endedAt,
        iterations: run.iterations, concurrency: run.concurrency,
        plannedRequests: run.planned, completedRequests: run.completed,
        errors: run.errors, warnings: run.warnings,
      },
      outcomes: run.counts,
      overall: overallStats(run),
      endpoints: run.endpoints.map((endpoint) => ({
        id: endpoint.endpointId, name: endpoint.name, alias: endpoint.alias,
        method: endpoint.method, phase: endpoint.phase, outcomes: endpoint.counts,
        latency: endpointStats(endpoint),
      })),
      recent: run.recent,
      definitions: TIMING_NOTES,
    },
    null,
    2,
  )
}

/**
 * A cell is quoted when it contains a separator, quote or newline, and a leading `=`, `+`, `-`,
 * `@`, tab or carriage return is prefixed with `'` so a spreadsheet treats it as text.
 */
export function csvCell(value: string | number | undefined): string {
  if (value === undefined) return ""
  const text = String(value)
  const neutral = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /["\n\r,]/.test(neutral) ? `"${neutral.replaceAll('"', '""')}"` : neutral
}

export function runToCsv(run: RunState): string {
  const header = ["endpoint", "alias", "method", "phase", ...OUTCOMES, "samples", "avgMs", "minMs", "maxMs", "p95Ms"]
  const rows = run.endpoints.map((endpoint) => {
    const stats = endpointStats(endpoint)
    return [
      endpoint.name, endpoint.alias, endpoint.method, endpoint.phase,
      ...OUTCOMES.map((outcome) => endpoint.counts[outcome]),
      stats.count, stats.avgMs, stats.minMs, stats.maxMs, stats.p95Ms,
    ]
  })
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")
}
