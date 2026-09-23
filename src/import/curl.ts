/**
 * DevTools "Copy as cURL", bash and cmd dialects. The command is tokenized as text: no shell is
 * run, no command substitution is expanded and no file is read. An unsupported flag is reported
 * with its position instead of being ignored.
 */
import type { Diagnostic, SourceRequest } from "./candidate"
import type { ParsedSource } from "./openapi"

type Token = { text: string; index: number; quoted: boolean; substitution?: boolean }

/**
 * Splits one command into tokens. Handles single quotes, double quotes with backslash escapes,
 * bash `\` line continuations, cmd `^` continuations and cmd `""` escapes inside double quotes.
 */
export function tokenize(command: string): Token[] {
  const tokens: Token[] = []
  let current = ""
  let start = 0
  let quoted = false
  let substitution = false
  let has = false
  const push = () => {
    if (has) tokens.push({ text: current, index: start, quoted, ...(substitution ? { substitution: true } : {}) })
    current = ""
    has = false
    quoted = false
    substitution = false
  }
  for (let index = 0; index < command.length; index++) {
    const character = command[index]!
    if (/\s/.test(character)) {
      push()
      continue
    }
    if (character === "\\" && (command[index + 1] === "\n" || command[index + 1] === "\r")) {
      index += command[index + 1] === "\r" && command[index + 2] === "\n" ? 2 : 1
      continue
    }
    if (character === "^" && (command[index + 1] === "\n" || command[index + 1] === "\r")) {
      index += command[index + 1] === "\r" && command[index + 2] === "\n" ? 2 : 1
      continue
    }
    if (!has) { start = index; has = true }
    // Outside quotes a backslash escapes the next character, which is how bash's `'\''` reads.
    if (character === "\\" && index + 1 < command.length) {
      current += command[++index]
      quoted = true
      continue
    }
    if (character === "'") {
      quoted = true
      const end = command.indexOf("'", index + 1)
      const body = command.slice(index + 1, end < 0 ? undefined : end)
      // Chrome's bash dialect escapes an embedded quote as `'\''`.
      current += body
      index = end < 0 ? command.length : end
      continue
    }
    if (character === '"') {
      quoted = true
      index++
      for (; index < command.length; index++) {
        const inner = command[index]!
        if (inner === "\\" && index + 1 < command.length) {
          const next = command[++index]!
          current += next === "n" ? "\n" : next === "r" ? "\r" : next === "t" ? "\t" : next
          continue
        }
        if (inner === '"' && command[index + 1] === '"') { current += '"'; index++; continue }
        if (inner === '"') break
        if (inner === "$" && command[index + 1] === "(") substitution = true
        if (inner === "`") substitution = true
        current += inner
      }
      continue
    }
    if (character === "$" && command[index + 1] === "(") substitution = true
    if (character === "`") substitution = true
    current += character
  }
  push()
  return tokens
}

const NO_ARGUMENT = /^(--compressed|--location|-L|--insecure|-k|--globoff|-g|--silent|-s|--show-error|-S|--fail|-f|--http[\d.]+|--no-[\w-]+|--verbose|-v|--path-as-is)$/
const HEAD_ONLY = /^(-I|--head)$/

export function parseCurl(command: string, index = 0): ParsedSource {
  const diagnostics: Diagnostic[] = []
  const tokens = tokenize(command).filter(token => token.text !== "$" || token.quoted)
  if (!tokens.length) return { requests: [], sourceCount: 0, diagnostics: [{ level: "error", message: "Empty cURL command." }] }
  let cursor = 0
  if (tokens[cursor]?.text.toLowerCase() === "curl") cursor++
  // Reported once per token, including tokens consumed as a flag's value.
  for (const token of tokens)
    if (token.substitution)
      diagnostics.push({ level: "warning", message: `Shell substitution at character ${token.index} is kept as literal text and never executed.` })
  let method = ""
  let url = ""
  const headers: Array<{ name: string; value: string }> = []
  const data: string[] = []
  let dataKind: "text" | "json" | "urlencoded" = "text"
  const form: string[] = []
  let credentials: RequestCredentials = "same-origin"
  const next = (flag: string): Token | undefined => {
    const token = tokens[++cursor]
    if (!token) diagnostics.push({ level: "error", message: `${flag} at character ${tokens[cursor - 1]?.index ?? 0} has no value.` })
    return token
  }
  for (; cursor < tokens.length; cursor++) {
    const token = tokens[cursor]!
    const flag = token.quoted ? "" : token.text
    if (!flag.startsWith("-")) {
      if (!url) url = token.text
      else diagnostics.push({ level: "warning", message: `Extra argument at character ${token.index} ignored: ${token.text.slice(0, 60)}` })
      continue
    }
    const [name, inlineValue] = flag.startsWith("--") && flag.includes("=") ? [flag.slice(0, flag.indexOf("=")), flag.slice(flag.indexOf("=") + 1)] : [flag, undefined]
    const value = () => (inlineValue !== undefined ? { text: inlineValue, index: token.index, quoted: false } : next(name))
    if (name === "-X" || name === "--request") method = (value()?.text ?? "").toUpperCase()
    else if (name === "-H" || name === "--header") {
      const header = value()?.text ?? ""
      const separator = header.indexOf(":")
      if (separator < 0) diagnostics.push({ level: "warning", message: `Header without a colon at character ${token.index}: ${header.slice(0, 60)}` })
      else {
        const headerName = header.slice(0, separator).trim()
        const headerValue = header.slice(separator + 1).trim()
        // The browser owns the cookie jar: the credentials intent is translated, the header is not.
        if (headerName.toLowerCase() === "cookie") {
          credentials = "include"
          diagnostics.push({ level: "info", message: "Cookie header replaced by credentials: include; the browser sends its own cookies." })
        } else headers.push({ name: headerName, value: headerValue })
      }
    } else if (name === "-b" || name === "--cookie") {
      value()
      credentials = "include"
      diagnostics.push({ level: "info", message: "Cookie flag replaced by credentials: include; the browser sends its own cookies." })
    } else if (name === "-d" || name === "--data" || name === "--data-raw" || name === "--data-binary" || name === "--data-ascii" || name === "--data-urlencode") {
      const raw = value()?.text ?? ""
      if (raw.startsWith("@")) diagnostics.push({ level: "warning", message: `File reference ${raw.slice(0, 60)} at character ${token.index} is not read; choose the file yourself.` })
      else {
        data.push(raw)
        if (name === "--data-urlencode") dataKind = "urlencoded"
      }
    } else if (name === "-F" || name === "--form") {
      const raw = value()?.text ?? ""
      if (raw.includes("=@")) diagnostics.push({ level: "warning", message: `Form file field ${raw.split("=")[0]} needs a file selected before sending.` })
      else form.push(raw)
    } else if (name === "-u" || name === "--user") {
      const raw = value()?.text ?? ""
      headers.push({ name: "Authorization", value: `Basic ${btoa(raw)}` })
    } else if (name === "-A" || name === "--user-agent") { value(); diagnostics.push({ level: "info", message: "User-Agent is browser-controlled and was not imported." }) }
    else if (name === "-e" || name === "--referer") { value(); diagnostics.push({ level: "info", message: "Referer is browser-controlled and was not imported." }) }
    else if (name === "--url") url = value()?.text ?? url
    else if (HEAD_ONLY.test(name)) method = method || "HEAD"
    else if (NO_ARGUMENT.test(name)) {
      if (name === "-k" || name === "--insecure") diagnostics.push({ level: "info", message: "Certificate checks are browser-controlled; --insecure was not imported." })
    } else {
      diagnostics.push({ level: "warning", message: `Unsupported flag ${name} at character ${token.index}.` })
      // A flag we do not know may carry a value; skip it only when the next token is not the URL.
      const candidate = tokens[cursor + 1]
      if (candidate && candidate.text.startsWith("-")) continue
      if (candidate && !/^[a-z][a-z\d+.-]*:\/\//i.test(candidate.text) && !candidate.text.startsWith("/")) cursor++
    }
  }
  if (!url) return { requests: [], sourceCount: 1, diagnostics: [...diagnostics, { level: "error", message: "No URL in the cURL command." }] }
  let body: SourceRequest["body"]
  if (form.length) body = { kind: "urlencoded", text: form.map(field => field.replace(/^([^=]*)=/, (whole, key: string) => `${encodeURIComponent(key)}=`)).join("&") }
  else if (data.length) {
    const joined = data.join("&")
    const contentType = headers.find(header => header.name.toLowerCase() === "content-type")?.value ?? ""
    const kind = /json/i.test(contentType) || /^\s*[[{]/.test(joined) ? "json" : /x-www-form-urlencoded/i.test(contentType) ? "urlencoded" : dataKind
    body = { kind, text: joined }
  }
  const resolved = method || (body ? "POST" : "GET")
  return {
    requests: [{
      key: `${resolved} ${url.split("#")[0]}`,
      name: `${resolved} ${url.replace(/^[a-z]+:\/\/[^/]+/i, "").split("?")[0] || "/"}`,
      method: resolved,
      url,
      headers,
      body,
      credentials,
      source: `cURL command${index ? ` ${index + 1}` : ""}`,
      diagnostics: [],
    }],
    sourceCount: 1,
    diagnostics,
  }
}

/** Several commands pasted together, one per `curl` at the start of a line. */
export function parseCurlBatch(text: string): ParsedSource {
  const parts = text.split(/\n(?=\s*(?:\$\s*)?curl[\s\\])/).map(part => part.trim()).filter(Boolean)
  const results = parts.map((part, index) => parseCurl(part, parts.length > 1 ? index : 0))
  return {
    requests: results.flatMap(result => result.requests),
    sourceCount: results.length,
    diagnostics: results.flatMap(result => result.diagnostics),
  }
}
