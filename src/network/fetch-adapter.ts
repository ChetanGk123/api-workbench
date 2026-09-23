import { createRequestContext, type Pipeline, type Plan, type SyntheticResponse } from "./pipeline"
import { statusText } from "./rules"
import { applyTransform, textLike } from "./transform"

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
    const ruleIds = [plan.chaosRuleId, plan.mockRuleId, plan.intercept?.ruleId, plan.route?.ruleId].filter(
      (id): id is string => !!id,
    )
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
      const intercept = plan.intercept
      const requestWork = !!intercept?.requestWork
      const responseWork = !!intercept?.responseWork
      const pauseRequest = !!intercept?.pauseRequest
      const pauseResponse = !!intercept?.pauseResponse
      if (!real && !plan.route && !requestWork && !responseWork && !pauseRequest && !pauseResponse) {
        pipeline.counters.dispatched++
        return captured
          .call(window, input, init)
          .then((response) => publishReal(response))
          .catch((error) => {
            publishError(error)
            throw error
          })
      }
      // Stages 3 and 5 share one wrapper: request transform, route, then a single dispatch.
      const fault = real ?? { preDelayMs: 0, deliveryDelayMs: 0 }
      // Replay copies are prepared from the frozen context before the primary dispatch, so a
      // consumed body can never be discovered too late.
      const replayable = !fault.replay || !(input instanceof Request) || !input.bodyUsed
      const replayBody = typeof init?.body === "string" ? init.body : undefined
      const replayHeaders = Object.fromEntries(Object.entries(requestContext.headers))
      const cancelReplay =
        fault.replay && replayable
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
      if (fault.replay && !replayable)
        lifecycle.settle("error", "replay skipped: request body is not replayable")

      const controller = new AbortController()
      const abortForward = () => controller.abort(signal?.reason)
      signal?.addEventListener("abort", abortForward, { once: true })
      let timedOut = false
      const deadline = fault.timeoutMs
        ? setTimeout(() => {
            timedOut = true
            controller.abort(new DOMException("Simulated timeout", "TimeoutError"))
          }, fault.timeoutMs)
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

      /**
       * Only rebuilt when a request transform or a route needs it. The body is buffered as bytes,
       * so a binary or form payload is re-sent byte-for-byte rather than decoded and guessed at.
       */
      const dispatch = async (): Promise<Response> => {
        if (!plan.route && !requestWork && !pauseRequest) {
          pipeline.counters.dispatched++
          return captured.call(window, input, { ...(init ?? {}), signal: controller.signal })
        }
        let prepared: Request
        try {
          prepared = new Request(input, init)
        } catch (error) {
          lifecycle.settle("error", `request transform skipped: ${(error as Error).message}`)
          pipeline.counters.dispatched++
          return captured.call(window, input, { ...(init ?? {}), signal: controller.signal })
        }
        let headers = Object.fromEntries(prepared.headers.entries())
        const hasBody = prepared.method !== "GET" && prepared.method !== "HEAD"
        const raw = hasBody ? await prepared.clone().arrayBuffer() : undefined
        const text =
          raw && textLike(headers["content-type"]) ? new TextDecoder().decode(raw) : undefined
        let body: BodyInit | undefined = raw
        if (requestWork) {
          const outcome = applyTransform(intercept!.request, { headers, body: text }, "request")
          headers = outcome.headers
          if (outcome.bodyChanged) body = outcome.body
          lifecycle.settle("request", outcome.summary)
        }
        // Stage 3 pause: after the request transform and before any upstream dispatch.
        if (pauseRequest) {
          const outcome = await pipeline.breakpoints.pause({
            stage: "request",
            transport: "fetch",
            method: prepared.method,
            url: plan.route?.to ?? url,
            ruleId: intercept!.ruleId,
            ruleLabel: intercept!.label,
            revision: intercept!.revision,
            profileId: intercept!.profileId,
            snapshot: { headers: { ...headers }, body: text },
            bodyEditable: text !== undefined,
            bodyReason: !hasBody
              ? `a ${prepared.method} request sends no body`
              : text === undefined
                ? "request body is not a text-shaped media type"
                : undefined,
            signal,
          })
          if (outcome.diagnostic) lifecycle.settle("request", `request breakpoint: ${outcome.diagnostic}`)
          if (outcome.action === "abort") {
            lifecycle.settle("abort", "request breakpoint: aborted before any dispatch")
            throw outcome.reason ?? new DOMException("Aborted at a request breakpoint", "AbortError")
          }
          if (outcome.edit) {
            headers = outcome.edit.headers
            if (outcome.edit.body !== undefined && outcome.edit.body !== text) body = outcome.edit.body
            lifecycle.settle("request", "request breakpoint: continued with edited request")
          }
        }
        for (const name of plan.route?.stripped ?? []) delete headers[name]
        pipeline.counters.dispatched++
        return captured.call(window, plan.route?.to ?? url, {
          method: prepared.method,
          headers,
          body,
          credentials: plan.route ? plan.route.credentials : prepared.credentials,
          mode: prepared.mode === "navigate" ? undefined : prepared.mode,
          cache: prepared.cache,
          redirect: prepared.redirect,
          referrerPolicy: prepared.referrerPolicy,
          keepalive: prepared.keepalive,
          signal: controller.signal,
        })
      }

      return wait(fault.preDelayMs)
        .then(() => dispatch())
        .then(async (received) => {
          clearTimeout(deadline)
          await wait(fault.deliveryDelayMs)
          // Stage 6 runs before stage 7, so real-response chaos sees the transformed result.
          let response = received
          if (responseWork) {
            const current = Object.fromEntries(received.headers.entries())
            const readable = textLike(current["content-type"]) && received.body !== null
            const original = readable ? await received.clone().text() : undefined
            const outcome = applyTransform(
              intercept!.response,
              { headers: current, body: original, status: received.status },
              "response",
            )
            lifecycle.settle("response", outcome.summary)
            const status = outcome.status ?? received.status
            const empty = status === 204 || status === 304
            response = new Response(
              empty
                ? null
                : outcome.bodyChanged
                  ? outcome.body
                  : readable
                    ? original
                    : await received.clone().arrayBuffer(),
              { status, statusText: statusText(status) || received.statusText, headers: outcome.headers },
            )
            Object.defineProperty(response, "url", { value: received.url, configurable: true })
          }
          if (real?.networkError) {
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
          if (real?.status) {
            delivered = new Response(real.status.body || (await response.clone().text()), {
              status: real.status.status,
              headers: rewritten(),
            })
          } else if (real?.malformedJson) {
            const type = response.headers.get("content-type") ?? ""
            if (/json|text/i.test(type)) {
              const text = await response.clone().text()
              delivered = new Response(text.slice(0, Math.max(1, text.length - 1)), {
                status: response.status,
                headers: rewritten(),
              })
            } else lifecycle.settle("error", "malformed JSON skipped: unsupported response body")
          }
          // Stage 8: the last explicit override, after the response transform and real chaos.
          if (pauseResponse) {
            const readable = textLike(delivered.headers.get("content-type")) && delivered.body !== null
            const current = readable ? await delivered.clone().text() : undefined
            const outcome = await pipeline.breakpoints.pause({
              stage: "response",
              transport: "fetch",
              method: requestContext.method,
              url: delivered.url || plan.route?.to || url,
              ruleId: intercept!.ruleId,
              ruleLabel: intercept!.label,
              revision: intercept!.revision,
              profileId: intercept!.profileId,
              snapshot: {
                headers: Object.fromEntries(delivered.headers.entries()),
                body: current,
                status: delivered.status,
              },
              bodyEditable: readable,
              bodyReason: readable ? undefined : "response body is not a text-shaped media type",
              signal,
            })
            if (outcome.diagnostic) lifecycle.settle("response", `response breakpoint: ${outcome.diagnostic}`)
            if (outcome.action === "abort") {
              const reason =
                outcome.reason ?? new DOMException("Aborted at a response breakpoint", "AbortError")
              lifecycle.settle(
                "abort",
                "response breakpoint: aborted after the upstream request had already completed",
              )
              lifecycle.finish("aborted at a response breakpoint")
              publishError(reason)
              throw reason
            }
            if (outcome.edit) {
              const status = outcome.edit.status ?? delivered.status
              const edited = outcome.edit.body !== undefined && outcome.edit.body !== current
              const headers = new Headers(outcome.edit.headers)
              if (edited) {
                headers.delete("content-length")
                headers.delete("content-encoding")
              }
              const empty = status === 204 || status === 304
              const next = new Response(
                empty
                  ? null
                  : edited
                    ? outcome.edit.body
                    : readable
                      ? current
                      : await delivered.clone().arrayBuffer(),
                { status, statusText: statusText(status) || delivered.statusText, headers },
              )
              Object.defineProperty(next, "url", { value: delivered.url, configurable: true })
              delivered = next
              lifecycle.settle("response", "response breakpoint: final edit applied")
            }
          }
          lifecycle.settle("response", plan.why.join(" · "))
          lifecycle.finish(`real ${delivered.status}`)
          return publishReal(delivered)
        })
        .catch((error) => {
          clearTimeout(deadline)
          cancelReplay()
          const thrown =
            timedOut && !signal?.aborted
              ? new DOMException(`Simulated timeout after ${fault.timeoutMs} ms`, "TimeoutError")
              : error
          // A fetch TypeError is deliberately indistinguishable: never label it a solved CORS problem.
          const routed =
            plan.route && thrown instanceof TypeError
              ? ` · routed to ${plan.route.to}; the browser reports one opaque failure for CORS, DNS, TLS and network errors, and the destination may still have received the request`
              : ""
          lifecycle.settle(
            signal?.aborted ? "abort" : "error",
            `${String((thrown as Error)?.message ?? thrown)}${routed}`,
          )
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
