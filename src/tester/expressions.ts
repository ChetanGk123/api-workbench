/**
 * The `{{ … }}` grammar shared by URLs, headers and bodies. Every expression is parsed into a
 * built-in call or an endpoint reference with a bounded property path. Nothing here executes
 * JavaScript: there is no `eval`, no `new Function`, and `$eval` is a restricted parser over
 * prepared bindings (see `evalRestricted`).
 */

export type Site = "url" | "header" | "text" | "json"

export type ContextSource = "cookie" | "local" | "session" | "meta" | "dom" | "global"

/** A page value the user selected in Scan page. Resolved again at every dispatch. */
export type ContextBinding = {
  name: string
  source: ContextSource
  /** Cookie name, storage key, meta name, DOM selector or dotted global path. */
  key: string
  /** DOM only: `value`, `textContent`, or an attribute name. */
  attribute?: string
}

export type Scope = {
  /** Endpoint alias → the value that endpoint produced for this request. */
  refs: Record<string, unknown>
  bindings: ContextBinding[]
  /** Named counters, shared by the whole run and reserved in scheduler order. */
  counters: Map<string, number>
  random: () => number
  now: () => number
  /** Reservations for one prepared request: the same expression twice reuses one value. */
  reservations: Map<string, unknown>
}

export type Resolved = { value: unknown; error?: undefined } | { value?: undefined; error: string }

export function createScope(overrides: Partial<Scope> = {}): Scope {
  return {
    refs: {},
    bindings: [],
    counters: new Map(),
    random: Math.random,
    now: () => Date.now(),
    reservations: new Map(),
    ...overrides,
  }
}

/** A fresh request reservation set over the same run-scoped counters and refs. */
export function prepare(scope: Scope, refs: Record<string, unknown> = scope.refs): Scope {
  return { ...scope, refs, reservations: new Map() }
}

/* ── Reading a bounded property path ───────────────────────────────────────── */

const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"])
const MAX_PATH_SEGMENTS = 16

/** Own enumerable data properties and array indices only; never invokes a getter. */
export function readPath(root: unknown, segments: readonly string[]): { value?: unknown; missing?: string } {
  let current = root
  if (segments.length > MAX_PATH_SEGMENTS) return { missing: segments.join(".") }
  for (const segment of segments) {
    if (FORBIDDEN.has(segment)) return { missing: segment }
    if (current === null || current === undefined) return { missing: segment }
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return { missing: segment }
      current = current[Number(segment)]
      continue
    }
    if (typeof current !== "object") return { missing: segment }
    const descriptor = Object.getOwnPropertyDescriptor(current, segment)
    if (!descriptor || !("value" in descriptor)) return { missing: segment }
    current = descriptor.value
  }
  return { value: current }
}

export function splitPath(path: string): string[] {
  // `items[0].id` and `items.0.id` are the same documented path.
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
}

/* ── Expression parsing ────────────────────────────────────────────────────── */

export type Expression =
  | { kind: "builtin"; name: string; args: Array<string | number>; source: string }
  | { kind: "ref"; alias: string; segments: string[]; source: string }

const ARGUMENT = /\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(-?\d+(?:\.\d+)?))\s*/y

export function parseExpression(source: string): Expression | { error: string } {
  const text = source.trim()
  if (!text) return { error: "Empty expression" }
  if (text.length > 512) return { error: "Expression is too long" }
  if (!text.startsWith("$")) {
    if (!/^[A-Za-z_][\w-]*(?:[.[\]\d\w-]*)$/.test(text)) return { error: `Unsupported expression: ${text}` }
    const [alias, ...rest] = splitPath(text)
    if (!alias) return { error: `Unsupported expression: ${text}` }
    return { kind: "ref", alias, segments: rest, source: text }
  }
  const call = /^\$([A-Za-z]\w*)\s*(\(([\s\S]*)\))?$/.exec(text)
  if (!call) return { error: `Unsupported built-in: ${text}` }
  const [, name, hasArgs, inner = ""] = call
  const args: Array<string | number> = []
  if (hasArgs && inner.trim()) {
    let index = 0
    for (;;) {
      ARGUMENT.lastIndex = index
      const match = ARGUMENT.exec(inner)
      if (!match) return { error: `Only string and number arguments are allowed: ${text}` }
      const [, doubleQuoted, singleQuoted, numeric] = match
      if (numeric !== undefined) args.push(Number(numeric))
      else args.push(unescape(doubleQuoted ?? singleQuoted ?? ""))
      index = ARGUMENT.lastIndex
      if (index >= inner.length) break
      if (inner[index] !== ",") return { error: `Only string and number arguments are allowed: ${text}` }
      index += 1
    }
  }
  return { kind: "builtin", name: name ?? "", args, source: text }
}

function unescape(value: string): string {
  return value.replace(/\\(.)/g, (_match, char: string) =>
    char === "n" ? "\n" : char === "t" ? "\t" : char === "r" ? "\r" : char,
  )
}

/* ── Page readers ──────────────────────────────────────────────────────────── */

export function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined
  for (const part of document.cookie.split(";")) {
    const index = part.indexOf("=")
    if (index < 0) continue
    if (part.slice(0, index).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(index + 1).trim())
    } catch {
      return part.slice(index + 1).trim()
    }
  }
  return undefined
}

export function readDom(selector: string, attribute = "textContent"): string | undefined {
  if (typeof document === "undefined") return undefined
  let element: Element | null
  try {
    element = document.querySelector(selector)
  } catch {
    return undefined
  }
  if (!element) return undefined
  if (attribute === "value") return "value" in element ? String((element as HTMLInputElement).value) : undefined
  if (attribute === "textContent") return element.textContent ?? ""
  return element.getAttribute(attribute) ?? undefined
}

function readStorage(kind: "local" | "session", key: string): string | undefined {
  try {
    const store = kind === "local" ? localStorage : sessionStorage
    return store.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

/** Own data-property descriptors from an explicit dotted root path; no getter is invoked. */
export function readGlobal(path: string): unknown {
  if (typeof window === "undefined") return undefined
  return readPath(window as unknown as Record<string, unknown>, splitPath(path)).value
}

export function readBinding(binding: ContextBinding): string | undefined {
  if (binding.source === "cookie") return readCookie(binding.key)
  if (binding.source === "local" || binding.source === "session") return readStorage(binding.source, binding.key)
  if (binding.source === "meta") return readDom(`meta[name="${cssEscape(binding.key)}"]`, "content")
  if (binding.source === "dom") return readDom(binding.key, binding.attribute ?? "value")
  const value = readGlobal(binding.key)
  return value === undefined ? undefined : typeof value === "string" ? value : JSON.stringify(value)
}

/** Enough escaping for an attribute-selector literal; selectors here are workbench-authored. */
export function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&")
}

/* ── Resolution ────────────────────────────────────────────────────────────── */

export const BUILTINS = [
  "$uuid",
  "$timestamp",
  "$counter",
  "$randomInt",
  "$cookie",
  "$dom",
  "$eval",
  "$localStorage",
  "$sessionStorage",
  "$meta",
  "$context",
] as const

/** Built-ins whose value is reserved once per prepared request and reused inside it. */
const RESERVED = new Set(["uuid", "timestamp", "counter", "randomInt"])

function uuid(random: () => number): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else for (let index = 0; index < 16; index++) bytes[index] = Math.floor(random() * 256)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function resolveExpression(source: string, scope: Scope): Resolved {
  const parsed = parseExpression(source)
  if ("error" in parsed) return { error: parsed.error }
  if (parsed.kind === "ref") {
    if (!(parsed.alias in scope.refs)) return { error: `No value for {{${parsed.alias}}} yet` }
    const read = readPath(scope.refs[parsed.alias], parsed.segments)
    if (read.missing !== undefined) return { error: `{{${parsed.source}}} has no value at "${read.missing}"` }
    return { value: read.value }
  }
  const { name, args } = parsed
  if (RESERVED.has(name) && scope.reservations.has(parsed.source))
    return { value: scope.reservations.get(parsed.source) }
  const reserve = (value: unknown): Resolved => {
    if (RESERVED.has(name)) scope.reservations.set(parsed.source, value)
    return { value }
  }
  switch (name) {
    case "uuid":
      return reserve(uuid(scope.random))
    case "timestamp":
      return reserve(scope.now())
    case "counter": {
      const [key, start = 1, step = 1] = args
      if (typeof key !== "string" || !key) return { error: '$counter needs a name: $counter("order", 1, 1)' }
      if (typeof start !== "number" || typeof step !== "number" || !Number.isFinite(start) || !Number.isFinite(step))
        return { error: "$counter start and increment must be finite numbers" }
      const next = scope.counters.has(key) ? (scope.counters.get(key) ?? 0) + step : start
      scope.counters.set(key, next)
      return reserve(next)
    }
    case "randomInt": {
      const [min, max] = args
      if (typeof min !== "number" || typeof max !== "number" || !Number.isSafeInteger(min) || !Number.isSafeInteger(max))
        return { error: "$randomInt bounds must be safe integers" }
      if (max < min) return { error: "$randomInt maximum is below its minimum" }
      return reserve(min + Math.floor(scope.random() * (max - min + 1)))
    }
    case "cookie": {
      const [key] = args
      if (typeof key !== "string" || !key) return { error: '$cookie needs a name: $cookie("XSRF-TOKEN")' }
      const value = readCookie(key)
      return value === undefined ? { error: `No readable cookie named "${key}"` } : { value }
    }
    case "dom": {
      const [selector, attribute] = args
      if (typeof selector !== "string" || !selector) return { error: '$dom needs a selector: $dom("meta[name=csrf]", "content")' }
      if (attribute !== undefined && typeof attribute !== "string") return { error: "$dom attribute must be a string" }
      const value = readDom(selector, attribute ?? "textContent")
      return value === undefined ? { error: `No element or attribute for ${selector}` } : { value }
    }
    case "localStorage":
    case "sessionStorage": {
      const [key] = args
      if (typeof key !== "string" || !key) return { error: `$${name} needs a key` }
      const value = readStorage(name === "localStorage" ? "local" : "session", key)
      return value === undefined ? { error: `No ${name} item named "${key}"` } : { value }
    }
    case "meta": {
      const [key] = args
      if (typeof key !== "string" || !key) return { error: '$meta needs a name: $meta("csrf-token")' }
      const value = readDom(`meta[name="${cssEscape(key)}"]`, "content")
      return value === undefined ? { error: `No <meta name="${key}"> on this page` } : { value }
    }
    case "context": {
      const [key] = args
      if (typeof key !== "string" || !key) return { error: '$context needs a binding name: $context("csrf")' }
      const binding = scope.bindings.find((item) => item.name === key)
      if (!binding) return { error: `No context binding named "${key}". Add it with Scan page.` }
      const value = readBinding(binding)
      return value === undefined ? { error: `Context binding "${key}" is not available on this page` } : { value }
    }
    case "eval": {
      const [expression] = args
      if (typeof expression !== "string") return { error: "$eval takes one quoted expression" }
      return evalRestricted(expression, scope)
    }
    default:
      return { error: `Unknown built-in $${name}` }
  }
}

/* ── The restricted $eval parser ───────────────────────────────────────────── */

type EvalToken = { type: "num" | "str" | "name" | "op"; value: string }

const EVAL_OPERATORS = ["===", "!==", "==", "!=", "<=", ">=", "&&", "||", "<", ">", "+", "-", "*", "/", "%", "!", "(", ")", "?", ":"]
const PRECEDENCE: Record<string, number> = {
  "||": 1, "&&": 2,
  "==": 3, "!=": 3, "===": 3, "!==": 3,
  "<": 4, "<=": 4, ">": 4, ">=": 4,
  "+": 5, "-": 5,
  "*": 6, "/": 6, "%": 6,
}

function tokenize(source: string): EvalToken[] | { error: string } {
  const tokens: EvalToken[] = []
  let index = 0
  while (index < source.length) {
    const char = source[index] ?? ""
    if (/\s/.test(char)) { index += 1; continue }
    if (/[\d]/.test(char) || (char === "." && /\d/.test(source[index + 1] ?? ""))) {
      const match = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(source.slice(index))
      if (!match) return { error: "Invalid number" }
      tokens.push({ type: "num", value: match[0] })
      index += match[0].length
      continue
    }
    if (char === '"' || char === "'") {
      const end = source.indexOf(char, index + 1)
      if (end < 0) return { error: "Unterminated string" }
      tokens.push({ type: "str", value: source.slice(index + 1, end) })
      index = end + 1
      continue
    }
    if (/[A-Za-z_$]/.test(char)) {
      const match = /^[A-Za-z_$][\w$]*(?:\.[\w$]+|\[\d+\])*/.exec(source.slice(index))
      if (!match) return { error: "Invalid name" }
      tokens.push({ type: "name", value: match[0] })
      index += match[0].length
      continue
    }
    const operator = EVAL_OPERATORS.find((candidate) => source.startsWith(candidate, index))
    if (!operator) return { error: `Unsupported character "${char}" in $eval` }
    tokens.push({ type: "op", value: operator })
    index += operator.length
  }
  return tokens
}

/**
 * Literals, arithmetic, comparison, boolean operators, a conditional and bounded own-property
 * paths over prepared bindings. Statements, assignment, calls, indexing by expression and any
 * identifier that is not a binding are rejected before a value is produced.
 */
export function evalRestricted(source: string, scope: Scope): Resolved {
  if (source.length > 512) return { error: "$eval expression is too long" }
  if (/[;{}=]|=>/.test(source.replace(/[=!<>]=|={2,3}/g, "")))
    return { error: "$eval allows expressions only: no statements, assignment or functions" }
  const tokens = tokenize(source)
  if ("error" in tokens) return { error: tokens.error }
  if (!tokens.length) return { error: "$eval expression is empty" }
  let position = 0
  let failure: string | undefined
  const peek = () => tokens[position]

  const primary = (): unknown => {
    const token = tokens[position]
    if (!token) { failure ??= "Unexpected end of $eval expression"; return undefined }
    position += 1
    if (token.type === "num") return Number(token.value)
    if (token.type === "str") return token.value
    if (token.type === "op") {
      if (token.value === "(") {
        const value = expression(0)
        if (peek()?.value !== ")") { failure ??= "Missing )"; return undefined }
        position += 1
        return value
      }
      if (token.value === "!") return !truthy(primary())
      if (token.value === "-") {
        const value = primary()
        return typeof value === "number" ? -value : (failure ??= "- needs a number", undefined)
      }
      failure ??= `Unexpected "${token.value}" in $eval`
      return undefined
    }
    if (token.value === "true") return true
    if (token.value === "false") return false
    if (token.value === "null") return null
    if (token.value.startsWith("$")) { failure ??= "$eval cannot call built-ins"; return undefined }
    const [alias, ...segments] = splitPath(token.value)
    if (!alias || !(alias in scope.refs)) { failure ??= `Unknown name "${token.value}" in $eval`; return undefined }
    const read = readPath(scope.refs[alias], segments)
    if (read.missing !== undefined) { failure ??= `"${token.value}" has no value at "${read.missing}"`; return undefined }
    return read.value
  }

  const expression = (minimum: number): unknown => {
    let left = primary()
    for (;;) {
      const token = peek()
      if (!token || token.type !== "op") break
      if (token.value === "?" && minimum <= 0) {
        position += 1
        const whenTrue = expression(0)
        if (peek()?.value !== ":") { failure ??= "Missing : in conditional"; return undefined }
        position += 1
        const whenFalse = expression(0)
        left = truthy(left) ? whenTrue : whenFalse
        continue
      }
      const precedence = PRECEDENCE[token.value]
      if (precedence === undefined || precedence < minimum) break
      position += 1
      const right = expression(precedence + 1)
      left = apply(token.value, left, right)
    }
    return left
  }

  const apply = (operator: string, left: unknown, right: unknown): unknown => {
    switch (operator) {
      case "&&": return truthy(left) ? right : left
      case "||": return truthy(left) ? left : right
      case "==": case "===": return Object.is(left, right) || left === right
      case "!=": case "!==": return !(Object.is(left, right) || left === right)
      case "+":
        if (typeof left === "string" || typeof right === "string") return `${stringify(left)}${stringify(right)}`
        break
    }
    if (typeof left !== "number" || typeof right !== "number") {
      failure ??= `"${operator}" needs numbers in $eval`
      return undefined
    }
    switch (operator) {
      case "+": return left + right
      case "-": return left - right
      case "*": return left * right
      case "/": return right === 0 ? ((failure ??= "$eval divided by zero"), undefined) : left / right
      case "%": return right === 0 ? ((failure ??= "$eval divided by zero"), undefined) : left % right
      case "<": return left < right
      case "<=": return left <= right
      case ">": return left > right
      case ">=": return left >= right
      default: failure ??= `Unsupported operator "${operator}"`; return undefined
    }
  }

  const value = expression(0)
  if (failure) return { error: failure }
  if (position < tokens.length) return { error: `Unexpected "${tokens[position]?.value}" in $eval` }
  return { value }
}

function truthy(value: unknown): boolean {
  return !(value === false || value === null || value === undefined || value === 0 || value === "")
}

/* ── Template rendering ────────────────────────────────────────────────────── */

const TEMPLATE = /\{\{([^{}]*)\}\}/g

export function stringify(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return String(value)
  if (typeof value === "object") return JSON.stringify(value) ?? ""
  return String(value)
}

/** Escapes by where the value lands, so a value can never change the shape around it. */
export function escapeFor(site: Site, value: string): string {
  if (site === "url") return encodeURIComponent(value)
  if (site === "header") return value.replace(/[\r\n\u0000]+/g, " ").trim()
  if (site === "json") return JSON.stringify(value).slice(1, -1)
  return value
}

export function hasExpressions(template: string): boolean {
  TEMPLATE.lastIndex = 0
  return TEMPLATE.test(template)
}

/** Every alias an endpoint template refers to; built-ins are not dependencies. */
export function referencedAliases(template: string): string[] {
  const found = new Set<string>()
  for (const [, source = ""] of template.matchAll(TEMPLATE)) {
    const parsed = parseExpression(source)
    if ("error" in parsed) continue
    if (parsed.kind === "ref") found.add(parsed.alias)
  }
  return [...found]
}

export function renderTemplate(template: string, site: Site, scope: Scope): { value?: string; error?: string } {
  let error: string | undefined
  const value = template.replace(TEMPLATE, (_match, source: string) => {
    const resolved = resolveExpression(source, scope)
    if (resolved.error) { error ??= resolved.error; return "" }
    return escapeFor(site, stringify(resolved.value))
  })
  return error ? { error } : { value }
}

// `[^{}]` cannot cross an expression boundary, so a built-in's quoted arguments are safe here.
const WHOLE_JSON_VALUE = /"\{\{([^{}]*)\}\}"/g

/**
 * An expression occupying an entire JSON value keeps the value's type: `"id": "{{u.id}}"` sends
 * the number, object or array the producer returned, not its text form. Expressions inside a
 * larger string are escaped as JSON string content.
 */
export function renderJsonBody(template: string, scope: Scope): { value?: string; error?: string } {
  let error: string | undefined
  const whole = template.replace(WHOLE_JSON_VALUE, (match, source: string) => {
    const resolved = resolveExpression(source, scope)
    if (resolved.error) { error ??= resolved.error; return match }
    const encoded = JSON.stringify(resolved.value ?? null)
    return encoded === undefined ? "null" : encoded
  })
  if (error) return { error }
  return renderTemplate(whole, "json", scope)
}
