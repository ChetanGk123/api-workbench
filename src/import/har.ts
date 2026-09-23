/**
 * HAR 1.2. Each selected entry becomes a candidate; repeated URLs with different bodies stay
 * distinct candidates, identical ones collapse with a count. Response bodies are kept as samples,
 * including base64 content, and timings are recorded as diagnostics rather than as checks.
 */
import type { Diagnostic, SourceRequest } from "./candidate"
import type { ParsedSource } from "./openapi"

const MAX_ENTRIES = 1000
type Doc = Record<string, unknown>
const record = (value: unknown): Doc => (value && typeof value === "object" ? (value as Doc) : {})
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const pairs = (value: unknown) =>
  list(value).map(item => ({ name: String(record(item).name ?? ""), value: String(record(item).value ?? "") })).filter(pair => pair.name)

function decodeBase64(text: string): string | undefined {
  try {
    const binary = atob(text)
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return undefined
  }
}

export function parseHar(document: Doc): ParsedSource {
  const diagnostics: Diagnostic[] = []
  const log = record(document.log)
  const version = String(log.version ?? "")
  if (version && version !== "1.2") diagnostics.push({ level: "info", message: `HAR version ${version} read with the 1.2 reader.` })
  const entries = list(log.entries)
  const requests: SourceRequest[] = []
  for (const [index, rawEntry] of entries.entries()) {
    if (requests.length >= MAX_ENTRIES) {
      diagnostics.push({ level: "warning", message: `Stopped after ${MAX_ENTRIES} entries.` })
      break
    }
    const entry = record(rawEntry)
    const request = record(entry.request)
    const method = String(request.method ?? "")
    const url = String(request.url ?? "")
    if (!method || !url) {
      diagnostics.push({ level: "warning", message: `Entry ${index + 1} has no request method or URL.` })
      continue
    }
    const itemDiagnostics: Diagnostic[] = []
    const postData = record(request.postData)
    const mimeType = String(postData.mimeType ?? "")
    let body: SourceRequest["body"]
    if (typeof postData.text === "string" && postData.text) {
      const kind = /json/i.test(mimeType) ? "json" : /x-www-form-urlencoded/i.test(mimeType) ? "urlencoded" : "text"
      body = { kind, text: postData.text }
    } else if (list(postData.params).length) {
      const params = list(postData.params).map(item => record(item))
      const files = params.filter(item => item.fileName !== undefined)
      if (files.length) itemDiagnostics.push({ level: "warning", message: `${files.length} multipart file field${files.length === 1 ? "" : "s"} cannot be replayed; the file is not in the HAR.` })
      const fields = params.filter(item => item.fileName === undefined)
      if (fields.length)
        body = {
          kind: /multipart/i.test(mimeType) ? "text" : "urlencoded",
          text: fields.map(item => `${encodeURIComponent(String(item.name ?? ""))}=${String(item.value ?? "")}`).join("&"),
        }
      if (/multipart/i.test(mimeType)) itemDiagnostics.push({ level: "warning", message: "Multipart body imported as text fields; file parts stay unavailable." })
    }

    const response = record(entry.response)
    const content = record(response.content)
    let sample: SourceRequest["sample"]
    if (typeof response.status === "number" && response.status > 0) {
      let text = typeof content.text === "string" ? content.text : ""
      if (text && content.encoding === "base64") {
        const decoded = decodeBase64(text)
        if (decoded === undefined) {
          itemDiagnostics.push({ level: "warning", message: "Base64 response content could not be decoded; the sample is omitted." })
          text = ""
        } else text = decoded
      }
      if (!text && typeof content.text !== "string")
        itemDiagnostics.push({ level: "info", message: content.size === 0 ? "Response body was empty." : "Response body omitted by the exporter." })
      sample = { status: response.status, headers: pairs(response.headers), body: text }
    } else itemDiagnostics.push({ level: "info", message: "Entry has no completed response." })
    const time = Number(entry.time)
    if (Number.isFinite(time) && time > 0) itemDiagnostics.push({ level: "info", message: `Recorded timing: ${Math.round(time)} ms (metadata, not a check).` })

    const query = pairs(request.queryString)
    requests.push({
      // Identity includes the body, so repeated URLs with different bodies stay separate.
      key: `${method} ${url.split("#")[0]}${body ? ` ${body.text.slice(0, 200)}` : ""}`,
      name: `${method} ${url.split("?")[0]?.replace(/^[a-z]+:\/\/[^/]+/i, "") || "/"}`,
      method,
      url,
      headers: pairs(request.headers),
      body,
      credentials: pairs(request.cookies).length || pairs(request.headers).some(header => header.name.toLowerCase() === "cookie") ? "include" : "same-origin",
      sample,
      source: `HAR entry ${index + 1}${query.length ? ` · ${query.length} query parameter${query.length === 1 ? "" : "s"}` : ""}`,
      diagnostics: itemDiagnostics,
    })
  }
  return { requests, sourceCount: entries.length, diagnostics }
}
