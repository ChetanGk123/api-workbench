/**
 * The shared conversion pipeline: detect, parse with the format's adapter, normalize into
 * candidates, and report what could not be represented. Every adapter runs on text only — no
 * adapter and no detector may touch the network — and no adapter evaluates pasted code.
 */
import { normalize, type Diagnostic, type Normalized, type SourceRequest } from "./candidate"
import { detect, formatInfo, type Detection, type FormatId } from "./detect"
import { parseHar } from "./har"
import { parseOpenApi } from "./openapi"
import { parsePostman } from "./postman"
import { parseCurlBatch } from "./curl"
import { parseFetchSnippet } from "./fetch-snippet"
import { parseNative, type NativeImport } from "./native"
import { candidatesFrom } from "../recorder/promote"
import type { Recording } from "../recorder/recorder"

/** Section 8.10's suggested initial file limit. */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024

export type ParseOutcome = {
  format?: FormatId
  label: string
  version: string
  detection: Detection
  /** Items the source offered, before validation. */
  sourceCount: number
  normalized?: Normalized
  native?: NativeImport
  diagnostics: Diagnostic[]
  error?: string
}

const failure = (detection: Detection, error: string): ParseOutcome => ({
  label: detection.format ? formatInfo(detection.format).label : "",
  version: detection.version,
  format: detection.format,
  detection,
  sourceCount: 0,
  diagnostics: [],
  error,
})

/**
 * A forced Format reads the source with that adapter and nothing else. When the adapter then
 * rejects it, say which format the source actually looks like: the adapter's own message describes
 * the document it was told to expect, which reads as "your file is broken" rather than "the Format
 * control is wrong".
 */
export function parseSource(text: string, profileId: string, override?: FormatId): ParseOutcome {
  const outcome = readSource(text, profileId, override)
  if (!outcome.error || !override) return outcome
  const detected = detect(text).format
  if (!detected || detected === override) return outcome
  return {
    ...outcome,
    error: `${outcome.error} Format is set to ${formatInfo(override).label}, but this source looks like ${formatInfo(detected).label}. Choose Detect automatically or ${formatInfo(detected).label}.`,
  }
}

function readSource(text: string, profileId: string, override?: FormatId): ParseOutcome {
  const detection = override ? { ...detect(text), format: override } : detect(text)
  if (text.length > MAX_SOURCE_BYTES) return failure(detection, `Source is larger than ${MAX_SOURCE_BYTES / (1024 * 1024)} MiB.`)
  const format = detection.format
  if (!format) return failure(detection, detection.reason)
  const info = formatInfo(format)
  const base = { format, label: info.label, version: detection.version || info.version, detection }
  if (format === "native" || format === "swagger" || format === "openapi" || format === "har" || format === "postman") {
    let document: Record<string, unknown>
    try {
      document = JSON.parse(text) as Record<string, unknown>
    } catch (error) {
      return failure(detection, error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON.")
    }
    if (format === "native") {
      const result = parseNative(document)
      if (result.error) return { ...base, sourceCount: 0, diagnostics: result.diagnostics, error: result.error }
      return { ...base, sourceCount: result.native?.counts.endpoints ?? 0, native: result.native, diagnostics: result.diagnostics }
    }
    const parsed =
      format === "har" ? parseHar(document)
      : format === "postman" ? parsePostman(document)
      : parseOpenApi(document, format === "swagger")
    return finish(base, parsed.requests, parsed.sourceCount, parsed.diagnostics, profileId)
  }
  const parsed = format === "curl" ? parseCurlBatch(text) : parseFetchSnippet(text)
  const fatal = parsed.diagnostics.find(diagnostic => diagnostic.level === "error")
  if (!parsed.requests.length && fatal) return { ...base, sourceCount: parsed.sourceCount, diagnostics: parsed.diagnostics, error: fatal.message }
  return finish(base, parsed.requests, parsed.sourceCount, parsed.diagnostics, profileId)
}

function finish(
  base: Pick<ParseOutcome, "format" | "label" | "version" | "detection">,
  requests: readonly SourceRequest[],
  sourceCount: number,
  diagnostics: Diagnostic[],
  profileId: string,
): ParseOutcome {
  const normalized = normalize(requests, profileId)
  const outcome: ParseOutcome = {
    ...base,
    sourceCount,
    normalized,
    diagnostics: [...diagnostics, ...normalized.diagnostics],
  }
  if (!normalized.candidates.length) outcome.error = "Nothing importable in this source."
  return outcome
}

/** The recorder is an internal typed source that goes through the same review and commit flow. */
export function parseRecordings(recordings: readonly Recording[], profileId: string): ParseOutcome {
  const derived = candidatesFrom(recordings, profileId)
  const normalized: Normalized = {
    candidates: derived.candidates.map(candidate => ({
      ...candidate,
      source: `Recorder · ${candidate.key}`,
      diagnostics: candidate.count > 1 ? [{ level: "info", message: `${candidate.count} recorded calls collapsed into this endpoint.` }] : [],
      unresolved: [],
      sensitive: candidate.endpoint.request.headers.filter(header => /^(authorization|x-api-key|api-key|x-csrf-token|x-xsrf-token)$/i.test(header.name)).map(header => header.name),
      variants: [],
    })),
    hosts: Object.fromEntries(Object.entries(derived.hosts).filter(([key]) => key !== "default")),
    skipped: derived.skipped,
    diagnostics: derived.skipped
      ? [{ level: "warning", message: `${derived.skipped} captured call${derived.skipped === 1 ? "" : "s"} cannot become an endpoint (unsupported method or URL).` }]
      : [],
  }
  const info = formatInfo("recorder")
  return {
    format: "recorder",
    label: info.label,
    version: info.version,
    detection: { format: "recorder", version: info.version, reason: "Captured in this frame." },
    sourceCount: recordings.length,
    normalized,
    diagnostics: normalized.diagnostics,
    error: normalized.candidates.length ? undefined : "Nothing captured yet. Start recording, then use the page.",
  }
}
