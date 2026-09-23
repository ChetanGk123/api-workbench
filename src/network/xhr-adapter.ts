import { createRequestContext, mockBody, type Pipeline } from "./pipeline"

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
      let synthetic: { state: number; failed: boolean; response: unknown } | undefined
      let cancel: (() => void) | undefined
      let rescheduleTimeout = () => {}
      let lifecycle: ReturnType<typeof pipeline.beginRequest> | undefined
      const nativeGet = (key: string) => Reflect.get(Target.prototype, key, xhr)
      const invalid = () => new DOMException("Invalid XHR state", "InvalidStateError")
      const text = () => (synthetic && synthetic.state >= 3 && !synthetic.failed ? mockBody : "")
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
                return synthetic.state >= 2 && !synthetic.failed ? 200 : 0
              case "statusText":
                return synthetic.state >= 2 && !synthetic.failed ? "OK" : ""
              case "responseURL":
                return synthetic.state >= 2 && !synthetic.failed ? url : ""
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
        !synthetic
          ? getHeader(name)
          : synthetic.state >= 2 && !synthetic.failed && name.toLowerCase() === "content-type"
            ? "application/json"
            : null
      xhr.getAllResponseHeaders = () =>
        !synthetic
          ? getHeaders()
          : synthetic.state >= 2 && !synthetic.failed
            ? "content-type: application/json\r\n"
            : ""
      xhr.abort = () => {
        if (!synthetic) {
          abort()
          return
        }
        if (sent) fail("abort")
        else synthetic.state = 0
      }
      let fail = (_kind: "abort" | "timeout") => {}
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
        const decision = async ? lifecycle.decision : null
        if (!decision) {
          const started = performance.now()
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
        synthetic = { state: 1, failed: false, response: null }
        const current = ++generation
        const state = synthetic
        let timer: ReturnType<typeof setTimeout>, deadline: ReturnType<typeof setTimeout>
        let release = () => {}
        const started = performance.now()
        const valid = () => current === generation && synthetic === state
        const emit = (type: string) => {
          xhr.dispatchEvent(
            type === "readystatechange"
              ? new Event(type)
              : new ProgressEvent(type, {
                  lengthComputable: !state.failed && state.state >= 3,
                  loaded:
                    state.failed || state.state < 3 ? 0 : new TextEncoder().encode(mockBody).length,
                  total:
                    state.failed || state.state < 3 ? 0 : new TextEncoder().encode(mockBody).length,
                }),
          )
          return valid()
        }
        const clear = () => {
          clearTimeout(timer)
          clearTimeout(deadline)
          release()
          cancel = undefined
          rescheduleTimeout = () => {}
        }
        cancel = clear
        fail = (kind) => {
          clear()
          sent = false
          state.failed = true
          state.state = 4
          lifecycle?.settle(kind === "abort" ? "abort" : "error", kind)
          if (!emit("readystatechange") || !emit(kind) || !emit("loadend")) return
          if (kind === "abort") state.state = 0
        }
        const finish = () => {
          clear()
          state.state = 2
          if (!emit("readystatechange") || !sent) return
          state.state = 3
          if (!emit("readystatechange") || !sent || !emit("progress") || !sent) return
          const bytes = new TextEncoder().encode(mockBody)
          state.response =
            xhr.responseType === "json"
              ? JSON.parse(mockBody)
              : xhr.responseType === "arraybuffer"
                ? bytes.buffer
                : xhr.responseType === "blob"
                  ? new Blob([bytes], { type: "application/json" })
                  : null
          state.state = 4
          sent = false
          lifecycle?.settle("response", "synthetic mock response")
          if (!emit("readystatechange") || !emit("load")) return
          emit("loadend")
        }
        release = pipeline.own(finish)
        rescheduleTimeout = () => {
          clearTimeout(deadline)
          if (xhr.timeout > 0)
            deadline = setTimeout(
              () => fail("timeout"),
              Math.max(0, xhr.timeout - (performance.now() - started)),
            )
        }
        timer = setTimeout(finish, decision.delay)
        rescheduleTimeout()
        emit("loadstart")
      }
      return xhr
    },
  })
}
