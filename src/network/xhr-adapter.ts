import { createRequestContext, type Pipeline, type Plan, type SyntheticResponse } from "./pipeline"

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
                return ready() ? url : ""
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
        const real = plan.provider === "network" ? plan.real : undefined
        // A binary response type cannot be rebuilt from text, so the fault is skipped, not faked.
        const supported = !real || deliverable(xhr.responseType)
        if (real && !supported) lifecycle.settle("error", `real-traffic chaos skipped: responseType ${xhr.responseType}`)
        if (plan.provider === "network" && (!real || !supported)) {
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
        const ruleIds = [plan.chaosRuleId, plan.mockRuleId].filter((id): id is string => !!id)
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
            source: real ? "network" : plan.provider === "synthetic-chaos" ? "synthetic-chaos" : "mock",
            error,
            ruleIds,
          })
        }
        let inner: XMLHttpRequest | undefined
        const clear = () => {
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

        if (real) {
          // Real-traffic chaos: the page's object stays synthetic while one inner native request
          // carries the actual transport, so the fault is applied to a real response exactly once.
          const replayBody = typeof body === "string" ? body : undefined
          if (real.replay)
            pipeline.scheduleReplay(plan, () => {
              const copy = new Captured()
              copy.open(method, url, true)
              for (const [name, value] of Object.entries(requestHeaders)) copy.setRequestHeader(name, value)
              copy.withCredentials = xhr.withCredentials
              copy.send(replayBody)
            })
          const dispatch = () => {
            pipeline.counters.dispatched++
            inner = new Captured()
            inner.open(method, url, true)
            for (const [name, value] of Object.entries(requestHeaders)) inner.setRequestHeader(name, value)
            inner.withCredentials = xhr.withCredentials
            inner.addEventListener("load", () => {
              const headers: Record<string, string> = {}
              for (const line of inner!.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
                const separator = line.indexOf(":")
                if (separator > 0)
                  headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim()
              }
              let deliveryBody = inner!.responseText
              let status = inner!.status
              if (real.status) {
                status = real.status.status
                deliveryBody = real.status.body || deliveryBody
              } else if (real.malformedJson) deliveryBody = deliveryBody.slice(0, Math.max(1, deliveryBody.length - 1))
              if (real.status || real.malformedJson) {
                delete headers["content-length"]
                delete headers["content-encoding"]
              }
              state.delivery = { status, statusText: inner!.statusText, headers, body: deliveryBody }
              inner = undefined
              if (real.networkError) {
                lifecycle?.settle("error", "real-traffic chaos: simulated failure after dispatch")
                fail("error")
                return
              }
              timer = setTimeout(deliver, real.deliveryDelayMs)
            })
            inner.addEventListener("error", () => {
              inner = undefined
              fail("error")
            })
            inner.send(body)
            // The chaos timeout is bounded independently of the caller's own xhr.timeout.
            if (real.timeoutMs) chaosDeadline = setTimeout(() => fail("timeout"), real.timeoutMs)
          }
          if (real.preDelayMs > 0) timer = setTimeout(dispatch, real.preDelayMs)
          else dispatch()
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
