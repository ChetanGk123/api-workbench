/**
 * Content detection. A format is identified by its own discriminator — never by a file extension
 * and never by the mere presence of a field named `request`.
 */
import { SCHEMA_VERSION } from "./native"

export type FormatId = "native" | "swagger" | "openapi" | "har" | "postman" | "curl" | "fetch" | "recorder"

export type FormatInfo = { id: FormatId; label: string; version: string; note: string }

/** Every implemented adapter and the exact version it supports. Nothing else is listed as supported. */
export const FORMATS: readonly FormatInfo[] = [
  { id: "native", label: "Native", version: `schema ${SCHEMA_VERSION}`, note: "API Workbench profile + endpoints JSON" },
  { id: "swagger", label: "Swagger", version: "2.0", note: "JSON only · local $ref" },
  { id: "openapi", label: "OpenAPI", version: "3.0", note: "JSON only · local $ref" },
  { id: "har", label: "HAR", version: "1.2", note: "Entries with request and available response samples" },
  { id: "postman", label: "Postman", version: "Collection v2.1", note: "Nested folders, variables, bearer/basic/API-key auth" },
  { id: "curl", label: "cURL", version: "DevTools copy", note: "Chrome/Edge Copy as cURL (bash) and (cmd)" },
  { id: "fetch", label: "fetch()", version: "DevTools copy", note: "Chrome/Edge Copy as fetch · literal URL and options only" },
  { id: "recorder", label: "Recorder", version: "this frame", note: "Records this frame's fetch/XHR requests after recording starts" },
]

export function formatInfo(id: FormatId): FormatInfo {
  return FORMATS.find(format => format.id === id) ?? { id, label: id, version: "", note: "" }
}

export type Detection = { format?: FormatId; version: string; reason: string; ambiguous?: boolean }

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {}

export function detect(text: string): Detection {
  const trimmed = text.trim()
  if (!trimmed) return { version: "", reason: "Nothing to import yet." }
  if (/^(?:\$\s*)?curl[\s\\]/i.test(trimmed)) return { format: "curl", version: "DevTools copy", reason: "Starts with a cURL command." }
  if (/^(?:await\s+)?fetch\s*\(/.test(trimmed)) return { format: "fetch", version: "DevTools copy", reason: "Starts with a fetch() call." }
  if (!/^[[{]/.test(trimmed)) return { version: "", reason: "Not JSON, a cURL command or a fetch() call." }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    return { version: "", reason: error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON." }
  }
  const document = record(parsed)
  // Reported versions name the reader this build has, never the version the document declares: a
  // newer document is read by the reader named here, or rejected by the adapter.
  if (document.profile && Array.isArray(document.endpoints)) {
    const declared = String(document.schemaVersion ?? SCHEMA_VERSION)
    return {
      format: "native",
      version: `schema ${SCHEMA_VERSION}`,
      reason: declared === String(SCHEMA_VERSION)
        ? "Native profile + endpoints export."
        : `Native profile + endpoints export declaring schema ${declared}, read with the schema ${SCHEMA_VERSION} reader.`,
    }
  }
  if (typeof document.openapi === "string" && document.openapi.startsWith("3."))
    return {
      format: "openapi",
      version: "3.0",
      reason: document.openapi.startsWith("3.0")
        ? `OpenAPI ${document.openapi}.`
        : `OpenAPI ${document.openapi}, read with the 3.0 reader.`,
    }
  if (document.swagger === "2.0") return { format: "swagger", version: "2.0", reason: "Swagger 2.0." }
  const log = record(document.log)
  if (Array.isArray(log.entries)) {
    const declared = String(log.version ?? "1.2")
    return { format: "har", version: "1.2", reason: declared === "1.2" ? "HAR 1.2." : `HAR ${declared}, read with the 1.2 reader.` }
  }
  const info = record(document.info)
  const schema = String(info.schema ?? "")
  if (Array.isArray(document.item) && (schema.includes("v2.1.0") || info._postman_id))
    return {
      format: "postman",
      version: "Collection v2.1",
      reason: !schema || schema.includes("v2.1.0")
        ? "Postman collection v2.1."
        : `Postman collection declaring ${schema}, read with the v2.1 reader.`,
    }
  return { version: "", reason: "JSON with no recognised format discriminator. Choose a format to override detection." }
}
