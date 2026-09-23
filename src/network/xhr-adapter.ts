import { createRequestContext, type Pipeline, type Plan, type SyntheticResponse } from "./pipeline"
import { statusText } from "./rules"
import { applyTransform, textLike } from "./transform"

type Delivery = SyntheticResponse

const EMPTY: Delivery = { status: 0, statusText: "", headers: {}, body: "" }

/** Text-shaped response types only: rebuilding a binary body from text would corrupt it. */
function deliverable(responseType: XMLHttpRequestResponseType): boolean {
  return responseType === "" || responseType === "text" || responseType === "json"
}

// Keep real native XHR objects, events, upload targets and synchronous transport.
// Only a selected synthetic response overrides script-visible response fields.
export function xhrAdapter(
  Captured: typeof XMLHttpRequest,
  pipeline: Pipeline,
): typeof XMLHttpRequest {
  return new Proxy(Captured, {
    construct(Target, args, newTarget) {
      const xhr = Reflect.construct(Target, args, newTarget) as XMLHttpRequest
      if (!pipeline.active) return xhr
      const open = xhr.open.bind(xhr)
      const send = xhr.send.bind(xhr)
      const abort = xhr.abort.bind(xhr)
      const getHeader = xhr.getResponseHeader.bind(xhr)
      const getHeaders = xhr.getAllResponseHeaders.bind(xhr)
      const setHeader = xhr.setRequestHeader.bind(xhr)
      let method = "",
        url = "",
        async = true,
        sent = false,
        generation = 0
      const requestHeaders: Record<string, string> = {}
      let synthetic:
        | { state: number; failed: boolean; response: unknown; delivery: Delivery }
        | undefined
      let responseUrl: string | undefined
      let cancel: (() => void) | undefined
      let rescheduleTimeout = () => {}
      let lifecycle: ReturnType<typeof pipeline.beginRequest> | undefined
      const nativeGet = (key: string) => Reflect.get(Target.prototype, key, xhr)
      const invalid = () => new DOMException("Invalid XHR state", "InvalidStateError")
      const ready = () => !!synthetic && synthetic.state >= 2 && !synthetic.failed
      const text = () => (synthetic && synthetic.state >= 3 && !synthetic.failed ? synthetic.delivery.body : "")
      for (const key of [
        "readyState",
        "status",
        "statusText",
        "responseURL",
        "response",
        "responseText",
        "responseXML",
      ]) {
        Object.defineProperty(xhr, key, {
          configurable: true,
          get() {
            if (!synthetic) return nativeGet(key)
            switch (key) {
              case "readyState":
                return synthetic.state
              case "status":
                return ready() ? synthetic.delivery.status : 0
              case "statusText":
                return ready() ? synthetic.delivery.statusText : ""
              case "responseURL":
                return ready() ? (responseUrl ?? url) : ""
              case "responseText":
                if (xhr.responseType && xhr.responseType !== "text") throw invalid()
                return text()
              case "responseXML":
                if (xhr.responseType && xhr.responseType !== "document") throw invalid()
                return null
              case "response":
                if (!xhr.responseType || xhr.responseType === "text") return text()
                return synthetic.state === 4 && !synthetic.failed ? synthetic.response : null
            }
          },
        })
      }
      let timeoutPrototype = Target.prototype
      while (!Object.hasOwn(timeoutPrototype, "timeout"))
        timeoutPrototype = Object.getPrototypeOf(timeoutPrototype)
      const timeoutDescriptor = Object.getOwnPropertyDescriptor(timeoutPrototype, "timeout")!
      Object.defineProperty(xhr, "timeout", {
        configurable: true,
        get: () => timeoutDescriptor.get!.call(xhr),
        set: (value) => {
          timeoutDescriptor.set!.call(xhr, value)
          rescheduleTimeout()
        },
      })
      xhr.open = function (
        verb: string,
        target: string | URL,
        asynchronous: boolean = true,
        username?: string | null,
        password?: string | null,
      ) {
        // Native backing state stays OPENED when a mock never calls native send.
        const notifyOpened = !!synthetic && nativeGet("readyState") === 1
        cancel?.()
        generation++
        sent = false
        synthetic = undefined
        responseUrl = undefined
        for (const key of Object.keys(requestHeaders)) delete requestHeaders[key]
        // Delegate validation and OPENED event to the native implementation.
        method = verb
        url = new URL(target, document.baseURI).href
        async = asynchronous
        open(verb, target, asynchronous, username, password)
        if (notifyOpened) xhr.dispatchEvent(new Event("readystatechange"))
      }
      xhr.setRequestHeader = function (name, value) {
        if (synthetic && sent) throw invalid()
        const key = name.toLowerCase()
        requestHeaders[key] = requestHeaders[key] ? `${requestHeaders[key]}, ${value}` : value
        setHeader(name, value)
      }
      xhr.getResponseHeader = (name) =>
        !synthetic ? getHeader(name) : ready() ? (synthetic.delivery.headers[name.toLowerCase()] ?? null) : null
      xhr.getAllResponseHeaders = () =>
        !synthetic
          ? getHeaders()
          : ready()
            ? Object.entries(synthetic.delivery.headers)
                .map(([name, value]) => `${name}: ${value}\r\n`)
                .join("")
            : ""
      xhr.abort = () => {
        if (!synthetic) {
          abort()
          return
        }
        if (sent) fail("abort")
        else synthetic.state = 0
      }
      let fail = (_kind: "abort" | "timeout" | "error") => {}
      xhr.send = (body) => {
        if (xhr.readyState !== 1 || sent) throw invalid()
        const requestContext = createRequestContext({
          kind: "xhr",
          method,
          url,
          headers: requestHeaders,
          body: typeof body === "string" ? body : undefined,
        })
        lifecycle = pipeline.beginRequest(requestContext, "XHR")
        const plan: Plan = async
          ? lifecycle.plan
          : { provider: "network", why: ["synchronous send always uses captured transport"], delayMs: 0 }
        const network = plan.provider === "network"
        const real = network ? plan.real : undefined
        const route = network ? plan.route : undefined
        const intercept = network ? plan.intercept : undefined
        const requestWork = !!intercept?.requestWork
        const responseWork = !!intercept?.responseWork
        const pauseRequest = !!intercept?.pauseRequest
        const pauseResponse = !!intercept?.pauseResponse
        // A real dispatch is wrapped whenever a fault, a route, a transform or a pause touches it.
        const wrapped = !!(real || route || requestWork || responseWork || pauseRequest || pauseResponse)
        // A binary response type cannot be rebuilt from text, so the work is skipped, not faked.
        const supported = !wrapped || deliverable(xhr.responseType)
        if (wrapped && !supported)
          lifecycle.settle("error", `intercept, route and chaos skipped: responseType ${xhr.responseType}`)
        if (network && (!wrapped || !supported)) {
          const started = performance.now()
          pipeline.counters.dispatched++
          let published = false
          const publish = (error?: string) => {
            if (published || !pipeline.observing) return
            published = true
            const responseType = xhr.responseType
            const bodyStatus = error
              ? "unreadable"
              : responseType && responseType !== "text"
                ? "omitted"
                : xhr.status === 204
                  ? "omitted"
                  : xhr.responseText.length > 16384
                    ? "truncated"
                    : "captured"
            const headers: Record<string, string> = {}
            for (const line of xhr
              .getAllResponseHeaders()
              .trim()
              .split(/[\r\n]+/)) {
              const separator = line.indexOf(":")
              if (separator > 0)
                headers[line.slice(0, separator).trim().toLowerCase()] = line
                  .slice(separator + 1)
                  .trim()
            }
            pipeline.publishTraffic({
              request: requestContext,
              response: error
                ? undefined
                : {
                    status: xhr.status,
                    headers,
                    body:
                      bodyStatus === "omitted" || bodyStatus === "unreadable"
                        ? undefined
                        : xhr.responseText.slice(0, 16384),
                    bodyStatus,
                  },
              durationMs: Math.round(performance.now() - started),
              source: "network",
              error,
              ruleIds: [],
            })
          }
          xhr.addEventListener("load", () => publish(), { once: true })
          xhr.addEventListener("error", () => publish("network error"), { once: true })
          xhr.addEventListener("abort", () => publish("aborted"), { once: true })
          send(body)
          return
        }
        sent = true
        synthetic = { state: 1, failed: false, response: null, delivery: plan.synthetic ?? EMPTY }
        const current = ++generation
        const state = synthetic
        let timer: ReturnType<typeof setTimeout>,
          deadline: ReturnType<typeof setTimeout>,
          chaosDeadline: ReturnType<typeof setTimeout>
        let release = () => {}
        const started = performance.now()
        const valid = () => current === generation && synthetic === state
        const emit = (type: string) => {
          const length = state.failed || state.state < 3 ? 0 : new TextEncoder().encode(state.delivery.body).length
          xhr.dispatchEvent(
            type === "readystatechange"
              ? new Event(type)
              : new ProgressEvent(type, {
                  lengthComputable: !state.failed && state.state >= 3,
                  loaded: length,
                  total: length,
                }),
          )
          return valid()
        }
        const ruleIds = [plan.chaosRuleId, plan.mockRuleId, plan.intercept?.ruleId, plan.route?.ruleId].filter(
      (id): id is string => !!id,
    )
        const publish = (error?: string) => {
          if (!pipeline.observing) return
          pipeline.publishTraffic({
            request: requestContext,
            response: error
              ? undefined
              : {
                  status: state.delivery.status,
                  headers: state.delivery.headers,
                  body: state.delivery.body,
                  bodyStatus: "captured",
                },
            durationMs: Math.round(performance.now() - started),
            source: wrapped ? "network" : plan.provider === "synthetic-chaos" ? "synthetic-chaos" : "mock",
            error,
            ruleIds,
          })
        }
        let inner: XMLHttpRequest | undefined
        // XHR has no caller signal, so this one mirrors the request's life: aborting it releases
        // any pause still waiting for a request the page has already abandoned.
        const gone = new AbortController()
        // True only while this request is waiting at a breakpoint. Closing the workbench resumes
        // every pause, so the flow finishes itself on the captured transport; delivering an empty
        // synthetic response from the shutdown handler as well would be a second, bogus outcome.
        let awaiting = false
        const clear = () => {
          gone.abort()
          clearTimeout(timer)
          clearTimeout(deadline)
          clearTimeout(chaosDeadline)
          release()
          cancel = undefined
          rescheduleTimeout = () => {}
        }
        cancel = () => {
          clear()
          inner?.abort()
        }
        fail = (kind) => {
          const wasCancelled = !!inner
          clear()
          if (wasCancelled) inner?.abort()
          sent = false
          state.failed = true
          state.state = 4
          lifecycle?.settle(kind === "abort" ? "abort" : "error", kind)
          lifecycle?.finish(kind === "abort" ? "aborted during wait; reserved slot consumed" : kind)
          if (kind !== "abort") publish(kind)
          if (!emit("readystatechange") || !emit(kind) || !emit("loadend")) return
          if (kind === "abort") state.state = 0
        }
        const deliver = () => {
          clear()
          state.state = 2
          if (!emit("readystatechange") || !sent) return
          state.state = 3
          if (!emit("readystatechange") || !sent || !emit("progress") || !sent) return
          const bytes = new TextEncoder().encode(state.delivery.body)
          state.response =
            xhr.responseType === "json"
              ? safeJson(state.delivery.body)
              : xhr.responseType === "arraybuffer"
                ? bytes.buffer
                : xhr.responseType === "blob"
                  ? new Blob([bytes], { type: state.delivery.headers["content-type"] ?? "" })
                  : null
          state.state = 4
          sent = false
          lifecycle?.settle("response", `${plan.provider} · ${plan.why.join(" · ")}`)
          lifecycle?.finish(`${plan.provider} ${state.delivery.status}`)
          publish()
          if (!emit("readystatechange") || !emit("load")) return
          emit("loadend")
        }
        // Closing the workbench settles owned work: an in-flight real dispatch is aborted, a
        // pending synthetic response is delivered rather than left hanging.
        release = pipeline.own(() => {
          if (awaiting) return
          if (inner) fail("abort")
          else if (plan.syntheticFailure) fail(plan.syntheticFailure === "timeout" ? "timeout" : "error")
          else deliver()
        })
        rescheduleTimeout = () => {
          clearTimeout(deadline)
          if (xhr.timeout > 0)
            deadline = setTimeout(
              () => fail("timeout"),
              Math.max(0, xhr.timeout - (performance.now() - started)),
            )
        }

        if (wrapped) {
          // The page's object stays synthetic while one inner native request carries the actual
          // transport, so a route, a transform and a fault each apply to a real response once.
          const fault = real ?? { preDelayMs: 0, deliveryDelayMs: 0 }
          const target = route?.to ?? url
          responseUrl = target
          // Stage 3: the request transform edits the headers and body that are actually sent.
          let sendHeaders: Record<string, string> = { ...requestHeaders }
          let sendBody = body
          if (requestWork) {
            const outcome = applyTransform(
              intercept!.request,
              { headers: sendHeaders, body: typeof body === "string" ? body : undefined },
              "request",
            )
            sendHeaders = outcome.headers
            if (outcome.bodyChanged) sendBody = outcome.body ?? null
            lifecycle?.settle("request", outcome.summary)
          }
          for (const name of route?.stripped ?? []) delete sendHeaders[name]
          const credentials = route ? route.credentials === "include" : xhr.withCredentials
          const replayBody = typeof sendBody === "string" ? sendBody : undefined
          if (fault.replay)
            pipeline.scheduleReplay(plan, () => {
              const copy = new Captured()
              copy.open(method, target, true)
              for (const [name, value] of Object.entries(sendHeaders)) copy.setRequestHeader(name, value)
              copy.withCredentials = credentials
              copy.send(replayBody)
            })
          const dispatch = async () => {
            // Stage 3 pause: after the request transform and before any upstream dispatch.
            if (pauseRequest) {
              awaiting = true
              const outcome = await pipeline.breakpoints.pause({
                stage: "request",
                transport: "xhr",
                method,
                url: target,
                ruleId: intercept!.ruleId,
                ruleLabel: intercept!.label,
                revision: intercept!.revision,
                profileId: intercept!.profileId,
                snapshot: { headers: { ...sendHeaders }, body: typeof sendBody === "string" ? sendBody : undefined },
                bodyEditable: typeof sendBody === "string",
                bodyReason: typeof sendBody === "string" ? undefined : "this request sends no text body",
                signal: gone.signal,
              })
              awaiting = false
              if (!valid() || !sent) return
              if (outcome.diagnostic) lifecycle?.settle("request", `request breakpoint: ${outcome.diagnostic}`)
              if (outcome.action === "abort") {
                lifecycle?.settle("abort", "request breakpoint: aborted before any dispatch")
                fail("abort")
                return
              }
              if (outcome.edit) {
                sendHeaders = outcome.edit.headers
                if (outcome.edit.body !== undefined) sendBody = outcome.edit.body
                lifecycle?.settle("request", "request breakpoint: continued with edited request")
              }
            }
            pipeline.counters.dispatched++
            inner = new Captured()
            inner.open(method, target, true)
            for (const [name, value] of Object.entries(sendHeaders)) inner.setRequestHeader(name, value)
            inner.withCredentials = credentials
            inner.addEventListener("load", async () => {
              const headers: Record<string, string> = {}
              for (const line of inner!.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
                const separator = line.indexOf(":")
                if (separator > 0)
                  headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim()
              }
              let deliveryBody = inner!.responseText
              let status = inner!.status
              let delivered = inner!.statusText
              // Stage 6 before stage 7: real-traffic chaos sees the transformed response.
              if (responseWork) {
                const readable = textLike(headers["content-type"])
                const outcome = applyTransform(
                  intercept!.response,
                  { headers: { ...headers }, body: readable ? deliveryBody : undefined, status },
                  "response",
                )
                lifecycle?.settle("response", outcome.summary)
                for (const name of Object.keys(headers)) delete headers[name]
                Object.assign(headers, outcome.headers)
                if (outcome.bodyChanged) deliveryBody = outcome.body ?? deliveryBody
                if (outcome.status != null && outcome.status !== status) {
                  status = outcome.status
                  delivered = statusText(status) || delivered
                }
              }
              if (real?.status) {
                status = real.status.status
                delivered = statusText(status) || delivered
                deliveryBody = real.status.body || deliveryBody
              } else if (real?.malformedJson)
                deliveryBody = deliveryBody.slice(0, Math.max(1, deliveryBody.length - 1))
              if (real?.status || real?.malformedJson) {
                delete headers["content-length"]
                delete headers["content-encoding"]
              }
              state.delivery = { status, statusText: delivered, headers, body: deliveryBody }
              inner = undefined
              if (real?.networkError) {
                lifecycle?.settle("error", "real-traffic chaos: simulated failure after dispatch")
                fail("error")
                return
              }
              // Stage 8: the last explicit override. Nothing is emitted to the page while paused,
              // so the readyState/event sequence it eventually sees is still the native one.
              if (pauseResponse) {
                awaiting = true
                const readable = textLike(headers["content-type"])
                const outcome = await pipeline.breakpoints.pause({
                  stage: "response",
                  transport: "xhr",
                  method,
                  url: target,
                  ruleId: intercept!.ruleId,
                  ruleLabel: intercept!.label,
                  revision: intercept!.revision,
                  profileId: intercept!.profileId,
                  snapshot: { headers: { ...headers }, body: readable ? deliveryBody : undefined, status },
                  bodyEditable: readable,
                  bodyReason: readable ? undefined : "response body is not a text-shaped media type",
                  signal: gone.signal,
                })
                awaiting = false
                if (!valid() || !sent) return
                if (outcome.diagnostic) lifecycle?.settle("response", `response breakpoint: ${outcome.diagnostic}`)
                if (outcome.action === "abort") {
                  lifecycle?.settle(
                    "abort",
                    "response breakpoint: aborted after the upstream request had already completed",
                  )
                  fail("abort")
                  return
                }
                if (outcome.edit) {
                  const finalStatus = outcome.edit.status ?? status
                  const finalHeaders = { ...outcome.edit.headers }
                  const body = outcome.edit.body ?? (readable ? deliveryBody : state.delivery.body)
                  if (body !== deliveryBody) {
                    delete finalHeaders["content-length"]
                    delete finalHeaders["content-encoding"]
                  }
                  state.delivery = {
                    status: finalStatus,
                    statusText: finalStatus === status ? delivered : statusText(finalStatus) || delivered,
                    headers: finalHeaders,
                    body,
                  }
                  lifecycle?.settle("response", "response breakpoint: final edit applied")
                }
              }
              timer = setTimeout(deliver, fault.deliveryDelayMs)
            })
            inner.addEventListener("error", () => {
              inner = undefined
              // A routed cross-origin failure is opaque to script: report it, never explain it away.
              if (route)
                lifecycle?.settle(
                  "error",
                  `routed to ${route.to}; the browser reports one opaque failure for CORS, DNS, TLS and network errors, and the destination may still have received the request`,
                )
              fail("error")
            })
            inner.send(sendBody)
            // The chaos timeout is bounded independently of the caller's own xhr.timeout.
            if (fault.timeoutMs) chaosDeadline = setTimeout(() => fail("timeout"), fault.timeoutMs)
          }
          if (fault.preDelayMs > 0) timer = setTimeout(() => void dispatch(), fault.preDelayMs)
          else void dispatch()
        } else if (plan.syntheticFailure) {
          timer = setTimeout(
            () => fail(plan.syntheticFailure === "timeout" ? "timeout" : "error"),
            plan.delayMs,
          )
        } else {
          timer = setTimeout(deliver, plan.delayMs)
        }
        rescheduleTimeout()
        emit("loadstart")
      }
      return xhr
    },
  })
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}
