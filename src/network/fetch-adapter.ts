import { createRequestContext, type Pipeline, type Plan, type SyntheticResponse } from "./pipeline"

function syntheticResponse(plan: Plan, url: string): Response {
  const synthetic = plan.synthetic as SyntheticResponse
  const status = synthetic.status
  // 204/304 must not carry a body, and Response rejects one.
  const body = status === 204 || status === 304 || status < 200 ? null : synthetic.body
  const response = new Response(body, {
    status,
    statusText: synthetic.statusText,
    headers: synthetic.headers,
  })
  Object.defineProperty(response, "url", { value: url, configurable: true })
  return response
}

function failure(plan: Plan): Error {
  return plan.syntheticFailure === "timeout"
    ? new DOMException(`Simulated timeout after ${plan.timeoutMs ?? plan.delayMs} ms`, "TimeoutError")
    : new TypeError("Failed to fetch")
}

export function fetchAdapter(captured: typeof fetch, pipeline: Pipeline): typeof fetch {
  return function (input, init) {
    if (!pipeline.active) return captured.call(window, input, init)
    // Do not coerce arbitrary objects or consume bodies on the pass-through path.
    let url: string
    try {
      if (!(typeof input === "string" || input instanceof URL || input instanceof Request))
        return captured.call(window, input, init)
      url = new URL(input instanceof Request ? input.url : input, document.baseURI).href
    } catch {
      return captured.call(window, input, init)
    }
    const method = init?.method ?? (input instanceof Request ? input.method : "GET")
    const signal = input instanceof Request ? input.signal : (init?.signal ?? undefined)
    const requestContext = createRequestContext({
      kind: "fetch",
      method,
      url,
      headers: input instanceof Request ? input.headers : new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : undefined,
      signal,
    })
    const lifecycle = pipeline.beginRequest(requestContext, "fetch")
    const plan = lifecycle.plan
    const decision = lifecycle.decision
    const ruleIds = [plan.chaosRuleId, plan.mockRuleId].filter((id): id is string => !!id)
    const started = performance.now()
    const publishReal = (response: Response, source: "network" | "synthetic-chaos" = "network") => {
      if (!pipeline.observing) return response
      const clone = response.clone()
      void clone
        .text()
        .then((body) =>
          pipeline.publishTraffic({
            request: requestContext,
            response: {
              status: response.status,
              headers: Object.fromEntries(response.headers.entries()),
              body,
              bodyStatus: body.length > 16384 ? "truncated" : "captured",
            },
            durationMs: Math.round(performance.now() - started),
            source,
            ruleIds,
          }),
        )
        .catch(() =>
          pipeline.publishTraffic({
            request: requestContext,
            response: {
              status: response.status,
              headers: Object.fromEntries(response.headers.entries()),
              bodyStatus: "unreadable",
            },
            durationMs: Math.round(performance.now() - started),
            source,
            ruleIds,
          }),
        )
      return response
    }
    const publishError = (error: unknown) =>
      pipeline.publishTraffic({
        request: requestContext,
        durationMs: Math.round(performance.now() - started),
        source: plan.provider === "network" ? "network" : plan.provider,
        error: error instanceof Error ? error.message : String(error),
        ruleIds,
      })

    if (plan.provider === "network") {
      const real = plan.real
      if (!real) {
        pipeline.counters.dispatched++
        return captured
          .call(window, input, init)
          .then((response) => publishReal(response))
          .catch((error) => {
            publishError(error)
            throw error
          })
      }
      // Replay copies are prepared from the frozen context before the primary dispatch, so a
      // consumed body can never be discovered too late.
      const replayable = !real.replay || !(input instanceof Request) || !input.bodyUsed
      const replayBody = typeof init?.body === "string" ? init.body : undefined
      const replayHeaders = Object.fromEntries(Object.entries(requestContext.headers))
      const cancelReplay =
        real.replay && replayable
          ? pipeline.scheduleReplay(
              plan,
              () => {
                void captured
                  .call(window, url, {
                    method: requestContext.method,
                    headers: replayHeaders,
                    body: replayBody,
                    credentials: init?.credentials ?? "same-origin",
                  })
                  .catch(() => {})
              },
              signal,
            )
          : () => {}
      if (real.replay && !replayable)
        lifecycle.settle("error", "replay skipped: request body is not replayable")

      const controller = new AbortController()
      const abortForward = () => controller.abort(signal?.reason)
      signal?.addEventListener("abort", abortForward, { once: true })
      let timedOut = false
      const deadline = real.timeoutMs
        ? setTimeout(() => {
            timedOut = true
            controller.abort(new DOMException("Simulated timeout", "TimeoutError"))
          }, real.timeoutMs)
        : undefined

      const wait = (ms: number) =>
        new Promise<void>((resolve, reject) => {
          if (ms <= 0) return resolve()
          const timer = setTimeout(done, ms)
          const release = pipeline.own(done)
          function done() {
            clearTimeout(timer)
            release()
            signal?.removeEventListener("abort", stop)
            if (signal?.aborted) reject(signal.reason)
            else resolve()
          }
          function stop() {
            done()
          }
          signal?.addEventListener("abort", stop, { once: true })
        })

      return wait(real.preDelayMs)
        .then(() => {
          pipeline.counters.dispatched++
          return captured.call(window, input, { ...(init ?? {}), signal: controller.signal })
        })
        .then(async (response) => {
          clearTimeout(deadline)
          await wait(real.deliveryDelayMs)
          if (real.networkError) {
            lifecycle.settle("error", "real-traffic chaos: simulated failure after dispatch")
            lifecycle.finish("network error after one dispatch")
            publishError(new TypeError("Failed to fetch"))
            throw new TypeError("Failed to fetch")
          }
          let delivered = response
          // A rewritten payload invalidates the transferred length and encoding of the original.
          const rewritten = () => {
            const headers = new Headers(response.headers)
            headers.delete("content-length")
            headers.delete("content-encoding")
            return headers
          }
          if (real.status) {
            delivered = new Response(real.status.body || (await response.clone().text()), {
              status: real.status.status,
              headers: rewritten(),
            })
          } else if (real.malformedJson) {
            const type = response.headers.get("content-type") ?? ""
            if (/json|text/i.test(type)) {
              const text = await response.clone().text()
              delivered = new Response(text.slice(0, Math.max(1, text.length - 1)), {
                status: response.status,
                headers: rewritten(),
              })
            } else lifecycle.settle("error", "malformed JSON skipped: unsupported response body")
          }
          lifecycle.settle("response", `real-traffic chaos applied · ${plan.why.join(" · ")}`)
          lifecycle.finish(`real ${delivered.status}`)
          return publishReal(delivered)
        })
        .catch((error) => {
          clearTimeout(deadline)
          cancelReplay()
          const thrown =
            timedOut && !signal?.aborted
              ? new DOMException(`Simulated timeout after ${real.timeoutMs} ms`, "TimeoutError")
              : error
          lifecycle.settle(signal?.aborted ? "abort" : "error", String((thrown as Error)?.message ?? thrown))
          publishError(thrown)
          throw thrown
        })
    }

    if (signal?.aborted) {
      lifecycle.settle("abort", String(signal.reason ?? "cancelled"))
      return Promise.reject(
        signal.reason ?? new DOMException("The operation was aborted.", "AbortError"),
      )
    }
    // Native Request validates options/precedence, only for a selected synthetic provider.
    let nativeRequest: Request
    try {
      nativeRequest = new Request(input, init)
    } catch (error) {
      return Promise.reject(error)
    }
    return new Promise<Response>((resolve, reject) => {
      const requestSignal = nativeRequest.signal
      let timer: ReturnType<typeof setTimeout>
      let release = () => {}
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        release()
        requestSignal.removeEventListener("abort", finish)
        if (requestSignal.aborted) {
          // The sequence slot this request reserved stays consumed; the trace records that.
          lifecycle.settle("abort", String(requestSignal.reason ?? "cancelled"))
          lifecycle.finish("aborted during wait; reserved slot consumed")
          reject(requestSignal.reason)
          return
        }
        if (plan.syntheticFailure) {
          const error = failure(plan)
          lifecycle.settle("error", `${plan.provider} · ${plan.syntheticFailure}`)
          lifecycle.finish(plan.syntheticFailure)
          publishError(error)
          reject(error)
          return
        }
        lifecycle.settle("response", `${plan.provider} · ${plan.why.join(" · ")}`)
        lifecycle.finish(`${plan.provider} ${plan.synthetic?.status ?? 0}`)
        const response = syntheticResponse(plan, url)
        pipeline.publishTraffic({
          request: requestContext,
          response: {
            status: plan.synthetic!.status,
            headers: plan.synthetic!.headers,
            body: plan.synthetic!.body,
            bodyStatus: "captured",
          },
          durationMs: Math.round(performance.now() - started),
          source: plan.provider === "synthetic-chaos" ? "synthetic-chaos" : "mock",
          ruleIds: decision ? [decision.ruleId] : ruleIds,
        })
        resolve(response)
      }
      release = pipeline.own(finish)
      requestSignal.addEventListener("abort", finish, { once: true })
      if (requestSignal.aborted) finish()
      else timer = setTimeout(finish, plan.delayMs)
    })
  }
}
