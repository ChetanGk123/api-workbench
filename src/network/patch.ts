import type { PatchOp } from "../core/model"

/**
 * RFC 6902 JSON Patch over RFC 6901 JSON Pointers. Operations are applied in listed order on an
 * isolated clone and committed only if every one succeeds, so a failing operation leaves the
 * original body untouched. Prototype-chain segments are rejected and traversal is own-property
 * only, so a patch can never reach `Object.prototype`.
 */
const BLOCKED = new Set(["__proto__", "constructor", "prototype"])

export type PatchOutcome = { ok: true; value: unknown } | { ok: false; error: string }

export function parsePointer(pointer: string): string[] | { error: string } {
  if (pointer === "") return []
  if (!pointer.startsWith("/")) return { error: `JSON Pointer must start with "/": ${pointer || "(empty)"}` }
  // Unescape ~1 before ~0, as RFC 6901 requires.
  const tokens = pointer
    .slice(1)
    .split("/")
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"))
  for (const token of tokens)
    if (BLOCKED.has(token)) return { error: `blocked path segment "${token}" in ${pointer}` }
  return tokens
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** RFC 6901 array index: "0" or a digit string with no leading zero. */
function arrayIndex(token: string, length: number, allowEnd: boolean): number | null {
  if (token === "-") return allowEnd ? length : null
  if (!/^(0|[1-9][0-9]*)$/.test(token)) return null
  const index = Number(token)
  if (index > length || (index === length && !allowEnd)) return null
  return index
}

function read(root: unknown, tokens: string[]): PatchOutcome {
  let current = root
  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = arrayIndex(token, current.length, false)
      if (index === null) return { ok: false, error: `no array member "${token}"` }
      current = current[index]
    } else if (isRecord(current)) {
      if (!Object.hasOwn(current, token)) return { ok: false, error: `missing path segment "${token}"` }
      current = current[token]
    } else return { ok: false, error: `cannot traverse "${token}" on a non-container` }
  }
  return { ok: true, value: current }
}

type Slot = { container: unknown[] | Record<string, unknown>; token: string }

function locate(root: unknown, tokens: string[]): Slot | { error: string } {
  const parent = read(root, tokens.slice(0, -1))
  if (!parent.ok) return { error: parent.error }
  const token = tokens[tokens.length - 1]!
  if (Array.isArray(parent.value) || isRecord(parent.value))
    return { container: parent.value as Slot["container"], token }
  return { error: `cannot address "${token}" on a non-container` }
}

function put(root: unknown, tokens: string[], value: unknown, insert: boolean): PatchOutcome {
  // An empty pointer addresses the whole document.
  if (!tokens.length) return { ok: true, value }
  const slot = locate(root, tokens)
  if ("error" in slot) return { ok: false, error: slot.error }
  if (Array.isArray(slot.container)) {
    const index = arrayIndex(slot.token, slot.container.length, insert)
    if (index === null) return { ok: false, error: `no array index "${slot.token}"` }
    if (insert) slot.container.splice(index, 0, value)
    else slot.container[index] = value
    return { ok: true, value: root }
  }
  if (!insert && !Object.hasOwn(slot.container, slot.token))
    return { ok: false, error: `missing path segment "${slot.token}"` }
  slot.container[slot.token] = value
  return { ok: true, value: root }
}

function drop(root: unknown, tokens: string[]): PatchOutcome {
  if (!tokens.length) return { ok: false, error: "cannot remove the whole document" }
  const slot = locate(root, tokens)
  if ("error" in slot) return { ok: false, error: slot.error }
  if (Array.isArray(slot.container)) {
    const index = arrayIndex(slot.token, slot.container.length, false)
    if (index === null) return { ok: false, error: `no array index "${slot.token}"` }
    slot.container.splice(index, 1)
    return { ok: true, value: root }
  }
  if (!Object.hasOwn(slot.container, slot.token))
    return { ok: false, error: `missing path segment "${slot.token}"` }
  delete slot.container[slot.token]
  return { ok: true, value: root }
}

function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((item, index) => equal(item, right[index]))
  if (isRecord(left) && isRecord(right)) {
    const names = Object.keys(left)
    return (
      names.length === Object.keys(right).length &&
      names.every((name) => Object.hasOwn(right, name) && equal(left[name], right[name]))
    )
  }
  return false
}

export function applyPatch(document: unknown, operations: readonly PatchOp[]): PatchOutcome {
  let working: unknown
  try {
    working = structuredClone(document)
  } catch {
    return { ok: false, error: "body value is not cloneable" }
  }
  for (const operation of operations) {
    const path = parsePointer(operation.path)
    if ("error" in path) return { ok: false, error: path.error }
    let result: PatchOutcome
    switch (operation.op) {
      case "add":
        result = path.length ? put(working, path, operation.value, true) : { ok: true, value: operation.value }
        break
      case "replace":
        result = path.length ? put(working, path, operation.value, false) : { ok: true, value: operation.value }
        break
      case "remove":
        result = drop(working, path)
        break
      case "test": {
        const current = read(working, path)
        result = !current.ok
          ? current
          : equal(current.value, operation.value)
            ? { ok: true, value: working }
            : { ok: false, error: `test failed at ${operation.path}` }
        break
      }
      case "move":
      case "copy": {
        const from = parsePointer(operation.from ?? "")
        if ("error" in from) return { ok: false, error: from.error }
        if (operation.op === "move" && path.join("/").startsWith(from.join("/")) && path.length > from.length)
          return { ok: false, error: `cannot move ${operation.from} into its own child` }
        const source = read(working, from)
        if (!source.ok) result = source
        else {
          let value: unknown
          try {
            value = structuredClone(source.value)
          } catch {
            return { ok: false, error: "source value is not cloneable" }
          }
          const removed = operation.op === "move" ? drop(working, from) : { ok: true as const, value: working }
          result = !removed.ok ? removed : put(working, path, value, true)
        }
        break
      }
      default:
        return { ok: false, error: `unsupported operation "${String((operation as PatchOp).op)}"` }
    }
    if (!result.ok) return result
    working = result.value
  }
  return { ok: true, value: working }
}

/** Every JSON Pointer in a sample document, for the editor's path suggestions. */
export function pointers(value: unknown, prefix = "", collected: string[] = []): string[] {
  if (prefix) collected.push(prefix)
  const escape = (token: string) => token.replace(/~/g, "~0").replace(/\//g, "~1")
  if (Array.isArray(value)) value.forEach((item, index) => pointers(item, `${prefix}/${index}`, collected))
  else if (isRecord(value))
    for (const [name, item] of Object.entries(value)) pointers(item, `${prefix}/${escape(name)}`, collected)
  return collected
}
