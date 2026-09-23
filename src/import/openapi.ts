/**
 * Swagger 2.0 and OpenAPI 3.0 (JSON). Local `$ref` only, with depth and cycle limits; a remote
 * reference is reported, never fetched. Missing values stay visible as `{{name}}` templates
 * instead of being filled with invented data.
 */
import type { Diagnostic, SourceRequest, Variant } from "./candidate"
import { METHODS } from "./candidate"

const MAX_REF_DEPTH = 8
const MAX_OPERATIONS = 500

type Doc = Record<string, unknown>
const record = (value: unknown): Doc => (value && typeof value === "object" ? (value as Doc) : {})
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

export type ParsedSource = { requests: SourceRequest[]; sourceCount: number; diagnostics: Diagnostic[] }

function jsonText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2)
}

export function parseOpenApi(document: Doc, swagger: boolean): ParsedSource {
  const diagnostics: Diagnostic[] = []
  const seenRefs = new Set<string>()

  /** Resolves a local `$ref` chain. A cycle or an over-deep chain resolves to the raw node. */
  const deref = (node: unknown, depth = 0): unknown => {
    const object = record(node)
    const ref = typeof object.$ref === "string" ? object.$ref : ""
    if (!ref) return node
    if (!ref.startsWith("#/")) {
      if (!seenRefs.has(ref)) { seenRefs.add(ref); diagnostics.push({ level: "warning", message: `Remote reference not followed: ${ref}` }) }
      return {}
    }
    if (depth >= MAX_REF_DEPTH) {
      diagnostics.push({ level: "warning", message: `Reference chain too deep at ${ref}` })
      return {}
    }
    let current: unknown = document
    for (const segment of ref.slice(2).split("/")) {
      current = record(current)[segment.replace(/~1/g, "/").replace(/~0/g, "~")]
      if (current === undefined) {
        diagnostics.push({ level: "warning", message: `Unresolved reference: ${ref}` })
        return {}
      }
    }
    return deref(current, depth + 1)
  }

  const baseUrl = (): string => {
    if (swagger) {
      const scheme = String(list(document.schemes)[0] ?? "https")
      const host = typeof document.host === "string" ? document.host : ""
      const basePath = typeof document.basePath === "string" ? document.basePath : ""
      return host ? `${scheme}://${host}${basePath}` : basePath
    }
    const server = record(list(document.servers)[0])
    let url = typeof server.url === "string" ? server.url : ""
    const variables = record(server.variables)
    url = url.replace(/\{([^{}]+)\}/g, (whole, name: string) => {
      const value = record(variables[name]).default
      if (typeof value === "string" && value) return value
      diagnostics.push({ level: "warning", message: `Server variable {${name}} has no default; it stays unresolved.` })
      return `{{${name}}}`
    })
    return url.replace(/\/$/, "")
  }

  const base = baseUrl()
  const requests: SourceRequest[] = []
  let sourceCount = 0
  const globalSecurity = list(document.security)

  for (const [template, rawItem] of Object.entries(record(document.paths))) {
    const item = record(deref(rawItem))
    const shared = list(item.parameters).map(parameter => record(deref(parameter)))
    for (const method of METHODS) {
      const operation = record(item[method.toLowerCase()])
      if (!Object.keys(operation).length) continue
      sourceCount++
      if (requests.length >= MAX_OPERATIONS) {
        diagnostics.push({ level: "warning", message: `Stopped after ${MAX_OPERATIONS} operations. Split the document to import the rest.` })
        continue
      }
      const itemDiagnostics: Diagnostic[] = []
      const parameters = [...shared]
      for (const parameter of list(operation.parameters).map(value => record(deref(value)))) {
        const index = parameters.findIndex(existing => existing.name === parameter.name && existing.in === parameter.in)
        if (index >= 0) parameters[index] = parameter
        else parameters.push(parameter)
      }
      let path = template
      const query: string[] = []
      const headers: Array<{ name: string; value: string }> = []
      let body: { kind: "none" | "text" | "json" | "urlencoded"; text: string } | undefined
      const form: string[] = []
      let skippedOptional = 0
      for (const parameter of parameters) {
        const name = String(parameter.name ?? "")
        if (!name) continue
        const schema = record(swagger ? parameter : deref(parameter.schema))
        const sample = parameter.example ?? parameter.default ?? schema.example ?? schema.default
        const value = sample === undefined ? `{{${name}}}` : String(sample)
        if (parameter.in === "path") path = path.replace(`{${name}}`, value)
        else if (parameter.in === "query") {
          if (parameter.required || sample !== undefined) query.push(`${encodeURIComponent(name)}=${value}`)
          else skippedOptional++
        } else if (parameter.in === "header") headers.push({ name, value })
        else if (parameter.in === "formData") {
          if (parameter.type === "file") itemDiagnostics.push({ level: "warning", message: `File form field "${name}" needs a file selected before sending.` })
          else form.push(`${encodeURIComponent(name)}=${value}`)
        } else if (parameter.in === "body") {
          const bodySchema = record(deref(parameter.schema))
          const example = parameter.example ?? bodySchema.example
          if (example === undefined) itemDiagnostics.push({ level: "warning", message: "Request body defined by schema only; no example in the source, so the body is left empty." })
          else body = { kind: "json", text: jsonText(example) }
        }
      }
      // Any `{name}` the parameter list never described stays a required input.
      path = path.replace(/(?<!\{)\{([^{}]+)\}(?!\})/g, (whole, name: string) => `{{${name}}}`)
      if (skippedOptional) itemDiagnostics.push({ level: "info", message: `${skippedOptional} optional query parameter${skippedOptional === 1 ? "" : "s"} not added.` })
      if (form.length) body = { kind: "urlencoded", text: form.join("&") }

      const variants: Variant[] = []
      if (!swagger) {
        const content = record(record(deref(operation.requestBody)).content)
        for (const [mediaType, rawMedia] of Object.entries(content)) {
          const media = record(deref(rawMedia))
          const examples = record(media.examples)
          const named = Object.entries(examples)
          const example = media.example ?? (named.length ? record(deref(named[0]?.[1])).value : undefined)
          const kind = /json/i.test(mediaType) ? "json" : /x-www-form-urlencoded/i.test(mediaType) ? "urlencoded" : "text"
          if (example === undefined) {
            itemDiagnostics.push({ level: "warning", message: `Request body ${mediaType} is schema-only; no example in the source.` })
            continue
          }
          for (const [label, value] of named.length ? named.map(([label, value]) => [`${mediaType} · ${label}`, record(deref(value)).value] as const) : [[mediaType, example] as const])
            variants.push({ label, contentType: mediaType, body: { kind, text: kind === "urlencoded" ? String(value) : jsonText(value) } })
        }
        const first = variants[0]
        if (first) {
          body = first.body
          headers.push({ name: "Content-Type", value: first.contentType })
        }
        if (variants.length > 1) itemDiagnostics.push({ level: "info", message: `${variants.length} request body examples available; choose one in the review.` })
      } else if (body || form.length) {
        const consumes = list(operation.consumes).length ? list(operation.consumes) : list(document.consumes)
        headers.push({ name: "Content-Type", value: String(consumes[0] ?? (form.length ? "application/x-www-form-urlencoded" : "application/json")) })
      }

      const security = list(operation.security).length ? list(operation.security) : globalSecurity
      const schemes = security.flatMap(requirement => Object.keys(record(requirement)))
      if (schemes.length)
        itemDiagnostics.push({ level: "info", message: `Security requirement not imported as a credential: ${[...new Set(schemes)].join(", ")}. Configure it in profile headers.` })

      // The lowest documented 2xx response with an example becomes the sample; nothing is invented.
      let sample: SourceRequest["sample"]
      for (const [status, rawResponse] of Object.entries(record(operation.responses)).sort()) {
        if (!/^2\d\d$/.test(status) || sample) continue
        const response = record(deref(rawResponse))
        const content = record(response.content)
        const media = record(deref(Object.values(content)[0]))
        const examples = record(media.examples)
        const example = media.example ?? record(deref(Object.values(examples)[0])).value ?? response.example ?? record(response.examples)["application/json"]
        if (example !== undefined) sample = { status: Number(status), headers: [], body: jsonText(example) }
      }

      const operationId = typeof operation.operationId === "string" ? operation.operationId : ""
      const summary = typeof operation.summary === "string" ? operation.summary : ""
      const search = query.length ? `?${query.join("&")}` : ""
      requests.push({
        // Path and method, never the operation id: two operations may share an id, and a
        // collision has to reach the review as two candidates with distinct aliases.
        key: `${method} ${template}`,
        name: summary || operationId || `${method} ${template}`,
        alias: operationId,
        method,
        url: `${base}${path}${search}`,
        headers,
        body,
        sample,
        variants,
        source: `${swagger ? "Swagger 2.0" : "OpenAPI 3.0"} · ${operationId || `${method} ${template}`}`,
        diagnostics: itemDiagnostics,
      })
    }
  }
  if (!base) diagnostics.push({ level: "info", message: "No server URL in the document; imported paths resolve against this page's origin." })
  return { requests, sourceCount, diagnostics }
}
