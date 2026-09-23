import { forbiddenRequestHeader, type Transform } from "../core/model"
import { applyPatch } from "./patch"

export function parseHeaderLines(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of text.split(/[\r\n]+/)) {
    const separator = line.indexOf(":")
    if (separator <= 0) continue
    const name = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (name) headers[name] = value
  }
  return headers
}

export function parseHeaderNames(text: string): string[] {
  return text
    .split(/[\r\n,]+/)
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
}

export type CompiledTransform = {
  set: Record<string, string>
  remove: string[]
  patch: Transform["patch"]
  find: string
  replace: string
  all: boolean
  status: number
}

export function compileTransform(transform: Transform): CompiledTransform {
  return {
    set: parseHeaderLines(transform.setHeaders),
    remove: parseHeaderNames(transform.removeHeaders),
    patch: transform.patch,
    find: transform.body.find,
    replace: transform.body.replace,
    all: transform.body.scope === "all",
    status: transform.status,
  }
}

export function transformHasWork(compiled: CompiledTransform): boolean {
  return !!(
    Object.keys(compiled.set).length ||
    compiled.remove.length ||
    compiled.patch.length ||
    compiled.find ||
    compiled.status
  )
}

/** Only these media types are rewritten; anything else is skipped with a reason, never faked. */
export function textLike(contentType: string | null | undefined): boolean {
  return /(^|\/|\+)(json|text|xml|javascript|html|csv)|x-www-form-urlencoded/i.test(contentType ?? "")
}

export type TransformInput = {
  headers: Record<string, string>
  /** Undefined when the body was never available or is not a supported text type. */
  body?: string
  status?: number
}

export type TransformOutcome = {
  headers: Record<string, string>
  body?: string
  bodyChanged: boolean
  status?: number
  applied: string[]
  skipped: string[]
  /** One line for the "Why this rule?" trace. */
  summary: string
}

/**
 * Applies one compiled transform. Header edits, the patch and the literal find/replace run in that
 * order on an isolated copy; a failing patch is skipped with its reason and leaves the body as it
 * was, so a partially applied patch can never be delivered.
 */
export function applyTransform(
  compiled: CompiledTransform,
  input: TransformInput,
  stage: "request" | "response",
): TransformOutcome {
  const headers = { ...input.headers }
  const applied: string[] = []
  const skipped: string[] = []
  let body = input.body
  let bodyChanged = false
  let status = input.status

  if (stage === "response" && compiled.status) {
    // Response construction accepts 200–599 only; anything else is reported, never silently kept.
    if (compiled.status < 200 || compiled.status > 599)
      skipped.push(`status override ${compiled.status}: only 200–599 can be delivered`)
    else {
      status = compiled.status
      applied.push(`status → ${compiled.status}`)
    }
  }
  for (const [name, value] of Object.entries(compiled.set)) {
    if (stage === "request" && forbiddenRequestHeader(name)) {
      skipped.push(`set ${name}: the browser forbids setting this request header`)
      continue
    }
    headers[name] = value
    applied.push(`set ${name}`)
  }
  for (const name of compiled.remove) {
    if (stage === "request" && forbiddenRequestHeader(name)) {
      skipped.push(`remove ${name}: the browser owns this request header`)
      continue
    }
    if (name in headers) {
      delete headers[name]
      applied.push(`remove ${name}`)
    } else skipped.push(`remove ${name}: not present`)
  }

  if (compiled.patch.length) {
    if (body == null) skipped.push("JSON Patch: no supported text body available")
    else {
      let parsed: unknown
      try {
        parsed = JSON.parse(body)
      } catch {
        parsed = undefined
        skipped.push("JSON Patch: body is not valid JSON")
      }
      if (parsed !== undefined) {
        const result = applyPatch(parsed, compiled.patch)
        if (result.ok) {
          body = JSON.stringify(result.value)
          bodyChanged = true
          applied.push(`JSON Patch: ${compiled.patch.length} operation${compiled.patch.length === 1 ? "" : "s"}`)
        } else skipped.push(`JSON Patch: ${result.error}`)
      }
    }
  }

  if (compiled.find) {
    if (body == null) skipped.push("body replace: no supported text body available")
    else if (!body.includes(compiled.find)) skipped.push("body replace: text not found")
    else {
      body = compiled.all
        ? body.split(compiled.find).join(compiled.replace)
        : body.replace(compiled.find, () => compiled.replace)
      bodyChanged = true
      applied.push(`body replace (${compiled.all ? "all" : "first"})`)
    }
  }

  // A rewritten payload invalidates the transferred length and encoding of the original.
  if (bodyChanged) {
    delete headers["content-length"]
    delete headers["content-encoding"]
  }
  const summary = `${stage} transform: ${applied.length} applied${skipped.length ? `, ${skipped.length} skipped` : ""}${
    skipped.length ? ` (${skipped.join("; ")})` : ""
  }`
  return { headers, body, bodyChanged, status, applied, skipped, summary }
}
