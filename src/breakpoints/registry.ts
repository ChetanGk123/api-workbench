import { MAX_PAUSED_REQUESTS, PAUSE_DEADLINE_MS } from "../core/model"
import type { RequestKind } from "../network/rules"

export type PauseStage = "request" | "response"

/** Only what the stage can actually edit: a request has no status to override. */
export type PauseEdit = {
  headers: Record<string, string>
  /** Undefined when this stage's body is unavailable or not text-shaped. */
  body?: string
  /** Response stage only. */
  status?: number
}

export type PauseRequest = {
  stage: PauseStage
  transport: RequestKind
  method: string
  url: string
  ruleId: string
  ruleLabel: string
  /** Rule identity when the pause began. An edit to the rule does not mutate a waiting pause. */
  revision: number
  profileId: string
  snapshot: PauseEdit
  bodyEditable: boolean
  /** Why the body cannot be edited, when it cannot. */
  bodyReason?: string
  signal?: AbortSignal
}

export type PausedEntry = PauseRequest & {
  id: string
  at: number
  deadlineAt: number
  /** Single-use: the first of resume/abort/deadline/caller-abort wins and the entry disappears. */
  resume: (edit?: PauseEdit) => void
  abort: () => void
}

export type PauseResult = {
  action: "continue" | "abort"
  edit?: PauseEdit
  reason?: unknown
  /** Present when the pause never actually happened, or ended without the user. */
  diagnostic?: string
}

/**
 * One paused request is one single-use continuation. It is resolved exactly once — by the user, by
 * the deadline, by the caller's abort signal, or by disposal — so no adapter is ever left awaiting
 * a promise that nothing can settle.
 */
export function createBreakpoints(options: {
  report: (message: string) => void
  limit?: number
  deadlineMs?: number
}) {
  const limit = options.limit ?? MAX_PAUSED_REQUESTS
  const deadlineMs = options.deadlineMs ?? PAUSE_DEADLINE_MS
  const entries = new Map<string, PausedEntry>()
  const listeners = new Set<(list: PausedEntry[]) => void>()
  let nextId = 1
  let disposed = false

  const announce = () => {
    const list = [...entries.values()]
    for (const listener of [...listeners]) listener(list)
  }

  const pause = (request: PauseRequest): Promise<PauseResult> => {
    if (disposed)
      return Promise.resolve({ action: "continue", diagnostic: "workbench closed; not paused" })
    if (request.signal?.aborted)
      return Promise.resolve({ action: "abort", reason: request.signal.reason })
    if (entries.size >= limit)
      return Promise.resolve({
        action: "continue",
        diagnostic: `queue limit reached: ${limit} requests are already paused, so this one continued unpaused`,
      })
    const id = `pause-${nextId++}`
    return new Promise<PauseResult>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      const settle = (result: PauseResult, note: string) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        request.signal?.removeEventListener("abort", onAbort)
        entries.delete(id)
        announce()
        options.report(`${request.stage} breakpoint ${id} ${note}`)
        resolve(result)
      }
      function onAbort() {
        settle({ action: "abort", reason: request.signal?.reason }, "released by the caller's abort")
      }
      const entry: PausedEntry = {
        ...request,
        id,
        at: Date.now(),
        deadlineAt: Date.now() + deadlineMs,
        resume: (edit) =>
          settle({ action: "continue", edit }, edit ? "continued with edits" : "continued unchanged"),
        abort: () =>
          settle(
            {
              action: "abort",
              diagnostic:
                request.stage === "response"
                  ? "aborted after the upstream request had already completed; a server-side effect is not undone"
                  : "aborted before any upstream dispatch",
            },
            "aborted from the queue",
          ),
      }
      timer = setTimeout(
        () =>
          settle(
            { action: "continue", diagnostic: `pause deadline ${deadlineMs} ms expired` },
            `continued automatically after ${deadlineMs} ms`,
          ),
        deadlineMs,
      )
      entries.set(id, entry)
      request.signal?.addEventListener("abort", onAbort, { once: true })
      announce()
      options.report(`${request.stage} breakpoint ${id} paused ${request.method} ${request.url}`)
    })
  }

  return {
    limit,
    deadlineMs,
    pause,
    get size() {
      return entries.size
    },
    list(): PausedEntry[] {
      return [...entries.values()]
    },
    onChange(listener: (list: PausedEntry[]) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    continueAll() {
      for (const entry of [...entries.values()]) entry.resume()
    },
    /** Closing the workbench continues every paused request unchanged; none is left hanging. */
    dispose() {
      disposed = true
      for (const entry of [...entries.values()]) entry.resume()
      listeners.clear()
    },
  }
}

export type Breakpoints = ReturnType<typeof createBreakpoints>
