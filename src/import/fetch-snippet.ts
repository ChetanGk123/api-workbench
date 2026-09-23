/**
 * DevTools "Copy as fetch". The snippet is read as data: the URL literal and the options object
 * literal are scanned out of the text and parsed with `JSON.parse`. Nothing is evaluated, so an
 * options object that depends on code (`JSON.stringify(x)`, a variable, a template expression)
 * is reported with its position instead of being run.
 */
import type { Diagnostic, SourceRequest } from "./candidate"
import type { ParsedSource } from "./openapi"

const BROWSER_CONTROLLED = ["mode", "referrer", "referrerPolicy", "cache", "redirect", "integrity", "keepalive", "signal", "priority", "window", "duplex"]

/** Reads one JS string literal at `start`; returns its value and the index after the closing quote. */
export function readStringLiteral(text: string, start: number): { value: string; end: number } | undefined {
  const quote = text[start]
  if (quote !== '"' && quote !== "'" && quote !== "`") return undefined
  let value = ""
  for (let index = start + 1; index < text.length; index++) {
    const character = text[index]!
    if (character === "\\") {
      const next = text[++index]
      if (next === undefined) return undefined
      if (next === "n") value += "\n"
      else if (next === "r") value += "\r"
      else if (next === "t") value += "\t"
      else if (next === "u") {
        const hex = text.slice(index + 1, index + 5)
        if (!/^[\da-f]{4}$/i.test(hex)) return undefined
        value += String.fromCharCode(parseInt(hex, 16))
        index += 4
      } else if (next === "x") {
        const hex = text.slice(index + 1, index + 3)
        if (!/^[\da-f]{2}$/i.test(hex)) return undefined
        value += String.fromCharCode(parseInt(hex, 16))
        index += 2
      } else value += next
      continue
    }
    if (character === quote) return { value, end: index + 1 }
    // A template expression is code, so the snippet is not a literal URL.
    if (quote === "`" && text.slice(index, index + 2) === "${") return undefined
    value += character
  }
  return undefined
}

/** The span of the balanced `{ … }` starting at `start`, ignoring braces inside string literals. */
function objectSpan(text: string, start: number): { source: string; end: number } | undefined {
  let depth = 0
  for (let index = start; index < text.length; index++) {
    const character = text[index]!
    if (character === '"' || character === "'" || character === "`") {
      const literal = readStringLiteral(text, index)
      if (!literal) return undefined
      index = literal.end - 1
      continue
    }
    if (character === "{" || character === "[") depth++
    else if (character === "}" || character === "]") {
      depth--
      if (!depth) return { source: text.slice(start, index + 1), end: index + 1 }
    }
  }
  return undefined
}

function parseOne(text: string, offset: number, index: number): ParsedSource {
  const diagnostics: Diagnostic[] = []
  const open = text.indexOf("(")
  const urlStart = text.slice(open + 1).search(/\S/) + open + 1
  const literal = readStringLiteral(text, urlStart)
  if (!literal)
    return { requests: [], sourceCount: 1, diagnostics: [{ level: "error", message: `Character ${offset + urlStart}: the fetch URL must be a literal string. Expressions are not evaluated.` }] }
  let init: Record<string, unknown> = {}
  const rest = text.slice(literal.end)
  const brace = rest.indexOf("{")
  if (brace >= 0) {
    const span = objectSpan(rest, brace)
    if (!span)
      return { requests: [], sourceCount: 1, diagnostics: [{ level: "error", message: `Character ${offset + literal.end + brace}: the options object is not a literal. Expressions are not evaluated.` }] }
    try {
      init = JSON.parse(span.source) as Record<string, unknown>
    } catch (error) {
      return {
        requests: [],
        sourceCount: 1,
        diagnostics: [{ level: "error", message: `Character ${offset + literal.end + brace}: the options object contains code or invalid JSON and was not evaluated${error instanceof Error ? ` (${error.message})` : ""}.` }],
      }
    }
  }
  const headers: Array<{ name: string; value: string }> = []
  const headerSource = init.headers
  if (Array.isArray(headerSource)) {
    for (const pair of headerSource) if (Array.isArray(pair)) headers.push({ name: String(pair[0]), value: String(pair[1]) })
  } else if (headerSource && typeof headerSource === "object") {
    for (const [name, value] of Object.entries(headerSource as Record<string, unknown>)) headers.push({ name, value: String(value) })
  }
  for (const option of BROWSER_CONTROLLED)
    if (init[option] !== undefined && init[option] !== null)
      diagnostics.push({ level: "info", message: `Browser-controlled option not imported: ${option}: ${JSON.stringify(init[option])}` })
  for (const option of Object.keys(init))
    if (!["headers", "body", "method", "credentials", ...BROWSER_CONTROLLED].includes(option))
      diagnostics.push({ level: "warning", message: `Unsupported option not imported: ${option}` })
  const method = String(init.method ?? "GET").toUpperCase()
  let body: SourceRequest["body"]
  if (typeof init.body === "string" && init.body) {
    const contentType = headers.find(header => header.name.toLowerCase() === "content-type")?.value ?? ""
    const kind = /json/i.test(contentType) || /^\s*[[{]/.test(init.body) ? "json" : /x-www-form-urlencoded/i.test(contentType) ? "urlencoded" : "text"
    body = { kind, text: init.body }
  } else if (init.body !== undefined && init.body !== null && typeof init.body !== "string")
    diagnostics.push({ level: "warning", message: "Only a literal string body is imported; this snippet's body is not a string." })
  const credentials = ["omit", "same-origin", "include"].includes(String(init.credentials)) ? (init.credentials as RequestCredentials) : "same-origin"
  return {
    requests: [{
      key: `${method} ${literal.value.split("#")[0]}`,
      name: `${method} ${literal.value.replace(/^[a-z]+:\/\/[^/]+/i, "").split("?")[0] || "/"}`,
      method,
      url: literal.value,
      headers,
      body,
      credentials,
      source: `fetch() snippet${index ? ` ${index + 1}` : ""}`,
      diagnostics: [],
    }],
    sourceCount: 1,
    diagnostics,
  }
}

export function parseFetchSnippet(text: string): ParsedSource {
  const starts: number[] = []
  for (const match of text.matchAll(/(?:^|[\s;])(?:await\s+)?fetch\s*\(/g)) starts.push(match.index + match[0].indexOf("fetch"))
  if (!starts.length) return { requests: [], sourceCount: 0, diagnostics: [{ level: "error", message: "No fetch(...) call found." }] }
  const results = starts.map((start, index) =>
    parseOne(text.slice(start, starts[index + 1] ?? text.length), start, starts.length > 1 ? index : 0),
  )
  return {
    requests: results.flatMap(result => result.requests),
    sourceCount: results.length,
    diagnostics: results.flatMap(result => result.diagnostics),
  }
}
