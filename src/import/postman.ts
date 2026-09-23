/**
 * Postman Collection v2.1. Folder structure, enabled headers and queries, supported body modes,
 * collection variables and bearer/basic/API-key auth. Scripts are reported, never executed, and an
 * unsupported auth type is reported as an unresolved configuration requirement.
 */
import type { Diagnostic, SourceRequest } from "./candidate"
import type { ParsedSource } from "./openapi"

const MAX_ITEMS = 500
const MAX_DEPTH = 16
type Doc = Record<string, unknown>
const record = (value: unknown): Doc => (value && typeof value === "object" ? (value as Doc) : {})
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown): string => (typeof value === "string" ? value : value === undefined || value === null ? "" : String(value))

/** `{key: value}` from an auth block's `[{key, value}]` array. */
function authValues(block: unknown): Record<string, string> {
  const values: Record<string, string> = {}
  for (const entry of list(block)) values[text(record(entry).key)] = text(record(entry).value)
  return values
}

function urlOf(raw: unknown): { url: string; disabledQuery: number } {
  if (typeof raw === "string") return { url: raw, disabledQuery: 0 }
  const url = record(raw)
  const query = list(url.query).map(item => record(item))
  const enabled = query.filter(item => !item.disabled)
  const search = enabled.map(item => `${encodeURIComponent(text(item.key))}=${text(item.value)}`).join("&")
  if (typeof url.raw === "string" && url.raw) {
    const base = url.raw.split("?")[0] ?? ""
    return { url: search ? `${base}?${search}` : query.length ? base : url.raw, disabledQuery: query.length - enabled.length }
  }
  const host = list(url.host).map(text).join(".") || text(url.host)
  const port = url.port ? `:${text(url.port)}` : ""
  const path = list(url.path).map(text).join("/")
  const protocol = text(url.protocol) || "https"
  return { url: `${host ? `${protocol}://${host}${port}` : ""}/${path}${search ? `?${search}` : ""}`, disabledQuery: query.length - enabled.length }
}

export function parsePostman(document: Doc): ParsedSource {
  const diagnostics: Diagnostic[] = []
  const variables: Record<string, string> = {}
  for (const entry of list(document.variable)) {
    const variable = record(entry)
    if (variable.disabled) continue
    const key = text(variable.key)
    if (key) variables[key] = text(variable.value)
  }
  const unresolved = new Set<string>()
  /** Collection variables are substituted; anything else stays an unresolved `{{name}}`. */
  const resolve = (value: string): string =>
    value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, name: string) => {
      if (Object.hasOwn(variables, name)) return variables[name] ?? ""
      if (!name.startsWith("$")) unresolved.add(name)
      return whole
    })

  const requests: SourceRequest[] = []
  const keys = new Set<string>()
  let sourceCount = 0
  if (list(document.event).some(event => list(record(event).script).length || record(record(event).script).exec))
    diagnostics.push({ level: "warning", message: "Collection scripts are not imported and never run." })

  /** Two requests with the same name in one folder are two candidates, not one. */
  const uniqueKey = (key: string): string => {
    let value = key
    for (let suffix = 2; keys.has(value); suffix++) value = `${key}#${suffix}`
    keys.add(value)
    return value
  }

  const walk = (items: unknown[], folder: string[], auth: unknown, depth: number) => {
    if (depth > MAX_DEPTH) {
      diagnostics.push({ level: "warning", message: `Folder nesting deeper than ${MAX_DEPTH} levels was not walked.` })
      return
    }
    for (const rawItem of items) {
      const item = record(rawItem)
      const name = text(item.name)
      const inheritedAuth = record(item.request).auth ?? item.auth ?? auth
      if (Array.isArray(item.item)) {
        walk(item.item, [...folder, name], item.auth ?? auth, depth + 1)
        continue
      }
      if (!item.request) continue
      sourceCount++
      if (requests.length >= MAX_ITEMS) {
        diagnostics.push({ level: "warning", message: `Stopped after ${MAX_ITEMS} requests.` })
        continue
      }
      const request = record(item.request)
      const itemDiagnostics: Diagnostic[] = []
      if (list(item.event).some(event => record(record(event).script).exec))
        itemDiagnostics.push({ level: "warning", message: "Request scripts (pre-request/tests) are not imported and never run." })
      const headerEntries = list(request.header).map(entry => record(entry))
      const disabledHeaders = headerEntries.filter(entry => entry.disabled).length
      const headers = headerEntries
        .filter(entry => !entry.disabled && text(entry.key))
        .map(entry => ({ name: text(entry.key), value: resolve(text(entry.value)) }))
      if (disabledHeaders) itemDiagnostics.push({ level: "info", message: `${disabledHeaders} disabled header${disabledHeaders === 1 ? "" : "s"} not imported.` })
      const { url, disabledQuery } = urlOf(request.url)
      if (disabledQuery > 0) itemDiagnostics.push({ level: "info", message: `${disabledQuery} disabled query parameter${disabledQuery === 1 ? "" : "s"} not imported.` })

      const bodyBlock = record(request.body)
      const mode = text(bodyBlock.mode)
      let body: SourceRequest["body"]
      if (mode === "raw") {
        const language = text(record(record(bodyBlock.options).raw).language)
        body = { kind: language === "json" ? "json" : "text", text: resolve(text(bodyBlock.raw)) }
      } else if (mode === "urlencoded") {
        const fields = list(bodyBlock.urlencoded).map(entry => record(entry)).filter(entry => !entry.disabled)
        body = { kind: "urlencoded", text: fields.map(entry => `${encodeURIComponent(text(entry.key))}=${resolve(text(entry.value))}`).join("&") }
      } else if (mode === "formdata") {
        const fields = list(bodyBlock.formdata).map(entry => record(entry)).filter(entry => !entry.disabled)
        const files = fields.filter(entry => text(entry.type) === "file")
        if (files.length) itemDiagnostics.push({ level: "warning", message: `${files.length} multipart file field${files.length === 1 ? "" : "s"} need a file selected before sending.` })
        const values = fields.filter(entry => text(entry.type) !== "file")
        itemDiagnostics.push({ level: "warning", message: "Multipart form-data imported as text fields; multipart encoding is not rebuilt." })
        body = { kind: "text", text: values.map(entry => `${text(entry.key)}=${resolve(text(entry.value))}`).join("\n") }
      } else if (mode === "graphql") {
        const graphql = record(bodyBlock.graphql)
        body = { kind: "json", text: JSON.stringify({ query: resolve(text(graphql.query)), variables: graphql.variables ?? {} }, null, 2) }
      } else if (mode === "file") itemDiagnostics.push({ level: "warning", message: "File body needs a file selected before sending; the collection holds only a path." })

      const authBlock = record(inheritedAuth)
      const type = text(authBlock.type)
      if (type === "bearer") headers.push({ name: "Authorization", value: `Bearer ${resolve(authValues(authBlock.bearer).token ?? "")}` })
      else if (type === "basic") {
        const values = authValues(authBlock.basic)
        headers.push({ name: "Authorization", value: `Basic ${btoa(`${resolve(values.username ?? "")}:${resolve(values.password ?? "")}`)}` })
      } else if (type === "apikey") {
        const values = authValues(authBlock.apikey)
        const key = resolve(values.key ?? "")
        const value = resolve(values.value ?? "")
        if ((values.in ?? "header") === "header") headers.push({ name: key || "X-API-Key", value })
        else itemDiagnostics.push({ level: "warning", message: `API key auth in "${values.in}" is not imported; add ${key} to the request yourself.` })
      } else if (type && type !== "noauth")
        itemDiagnostics.push({ level: "warning", message: `Unsupported auth type "${type}": configure this request's credentials before sending.` })

      const folderPath = folder.filter(Boolean).join("/")
      requests.push({
        key: uniqueKey(folderPath ? `${folderPath}/${name}` : name),
        name: name || url,
        alias: name,
        method: text(request.method) || "GET",
        url: resolve(url),
        headers,
        body,
        source: `Postman · ${folderPath ? `${folderPath}/` : ""}${name}`,
        diagnostics: itemDiagnostics,
      })
    }
  }
  walk(list(document.item), [], document.auth, 0)
  if (unresolved.size)
    diagnostics.push({ level: "warning", message: `Unresolved variables kept as templates: ${[...unresolved].slice(0, 12).join(", ")}` })
  return { requests, sourceCount, diagnostics }
}
