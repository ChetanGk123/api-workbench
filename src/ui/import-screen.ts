/**
 * The Import screen: paste or load a source, detect its format, review what it would create, then
 * commit the reviewed selection in one transaction. Nothing here sends a request and nothing here
 * evaluates pasted code — the adapters parse text only.
 */
import {
  button,
  card,
  confirmDialog,
  disclosure,
  downloadFile,
  el,
  group,
  icon,
  labeled,
  labeledAction,
  formatJsonButton,
  selectField,
} from "./dom"
import type { Ctx } from "./screens"
import type { Endpoint, WorkbenchConfig } from "../core/model"
import { detect, FORMATS, formatInfo, type FormatId } from "../import/detect"
import { MAX_SOURCE_BYTES, parseRecordings, parseSource, type ParseOutcome } from "../import/parse"
import {
  applyCandidates,
  applyNative,
  conflictOf,
  linkedTo,
  summaryText,
  type CandidateSelection,
  type NativeMode,
  type Resolution,
} from "../import/commit"

type Row = { selected: boolean; resolution: Resolution; name: string; variant: number }

/** The draft survives Back and Minimize within a session; only an explicit Clear discards it. */
const draft: {
  text: string
  source: string
  override: FormatId | ""
  outcome?: ParseOutcome
  rows: Map<string, Row>
  nativeMode: NativeMode
  /** The profile the review was built against; a profile change forces a rebuild. */
  profileId: string
  status: string
} = { text: "", source: "", override: "", rows: new Map(), nativeMode: "new-profile", profileId: "", status: "" }

/** Shown once on the Endpoints screen after a successful commit, then cleared. */
let lastSummary = ""
export function takeImportSummary(): string {
  const summary = lastSummary
  lastSummary = ""
  return summary
}

function clearDraft(): void {
  draft.status = ""
  draft.text = ""
  draft.source = ""
  draft.override = ""
  draft.outcome = undefined
  draft.rows.clear()
  draft.nativeMode = "new-profile"
  draft.profileId = ""
}

function badge(text: string, tone: string): HTMLElement {
  return el("span", `aw-bd aw-xs ${tone}`, text)
}

export function importScreen(ctx: Ctx): HTMLElement {
  const screen = el("div", "aw-col aw-gap12")
  const status = el("p", "aw-hint", draft.status)
  status.setAttribute("role", "status")
  const say = (message: string) => {
    draft.status = message
    status.textContent = message
  }
  let busy = false
  let token = 0

  /* ── Source input ─────────────────────────────────────────────────────── */
  const source = el("textarea", "aw-ta aw-mono")
  source.setAttribute("aria-label", "Import source")
  source.placeholder = "Paste JSON, a cURL command or a fetch() call"
  source.style.height = "140px"
  source.value = draft.text
  const detected = el("p", "aw-xs aw-mu")
  // Detection while typing reads the draft, not a truncated prefix: a cut-off JSON document would
  // report itself as invalid. A very large draft is detected by Apply instead of on every keystroke.
  const DETECT_WHILE_TYPING = 256 * 1024
  const describe = () => {
    if (!draft.text.trim()) return (detected.textContent = "Nothing to import yet.")
    if (draft.override) return (detected.textContent = `Format override: ${formatInfo(draft.override).label} ${formatInfo(draft.override).version}`)
    if (draft.text.length > DETECT_WHILE_TYPING) return (detected.textContent = "Large source. Choose Apply to detect its format.")
    const detection = detect(draft.text)
    detected.textContent = detection.format
      ? `Detected: ${formatInfo(detection.format).label} ${detection.version}`
      : detection.reason
  }
  source.addEventListener("input", () => { draft.text = source.value; describe(); updateFooter() }, { signal: ctx.signal })
  const format = selectField(
    "Format",
    [["", "Detect automatically"], ...FORMATS.filter(item => item.id !== "recorder").map(item => [item.id, `${item.label} ${item.version}`] as const)] as const,
    draft.override,
    value => { draft.override = value as FormatId | ""; describe() },
    ctx.signal,
  )

  const file = el("input")
  file.type = "file"
  file.accept = ".json,.har,.txt,.curl,application/json,text/plain"
  file.setAttribute("aria-label", "Import file")
  const chooseFile = el("label", "aw-btn aw-out")
  chooseFile.append(icon("download", "aw-i14"), document.createTextNode("Choose file"), file)
  const loadFile = (selected: File) => {
    const reader = new FileReader()
    reader.addEventListener("load", () => {
      draft.text = String(reader.result ?? "")
      draft.source = selected.name
      source.value = draft.text
      describe()
      say(`Loaded ${selected.name}. Choose Apply to review it.`)
      updateFooter()
    }, { signal: ctx.signal })
    reader.addEventListener("error", () => say(`Could not read ${selected.name}. The draft is unchanged.`), { signal: ctx.signal })
    ctx.signal.addEventListener("abort", () => reader.abort(), { once: true })
    reader.readAsText(selected)
  }
  file.addEventListener("change", () => {
    const selected = file.files?.[0]
    file.value = ""
    if (!selected) return say("File selection cancelled. The draft is unchanged.")
    // An oversized file never reaches the draft, and never asks to replace one either.
    if (selected.size > MAX_SOURCE_BYTES)
      return say(`${selected.name} is larger than ${MAX_SOURCE_BYTES / (1024 * 1024)} MiB. The draft is unchanged.`)
    if (!draft.text.trim()) return loadFile(selected)
    void confirmDialog(chooseFile, "Replace draft", `Replace the current draft with ${selected.name}?`, "Replace draft", ctx.signal)
      .then(confirmed => (confirmed ? loadFile(selected) : say("Kept the current draft.")))
  }, { signal: ctx.signal })

  /* ── Review ───────────────────────────────────────────────────────────── */
  const reviewCard = el("div", "aw-col aw-gap12")
  const commit = button("aw-btn aw-pri aw-grow", "Import selected", () => void runCommit(), ctx.signal)
  const back = button("aw-btn aw-out aw-grow", "Back", () => ctx.go("home"), ctx.signal)
  const apply = button("aw-btn aw-pri", "Apply", () => void runApply(), ctx.signal)
  const wipe = () => {
    clearDraft()
    source.value = ""
    describe()
    say("Draft cleared.")
    paint()
  }
  // Loading a file over a draft already asks; discarding one outright must not be the cheaper action.
  const clearButton = button("aw-btn aw-gh aw-sm", "Clear draft", () => {
    if (!draft.text.trim() && !draft.outcome) return wipe()
    void confirmDialog(clearButton, "Clear draft", "Discard the pasted source and its review?", "Clear draft", ctx.signal)
      .then(confirmed => (confirmed ? wipe() : say("Kept the current draft.")))
  }, ctx.signal)
  /** Apply builds the review below a screenful of paste box and reference, so bring it into view. */
  const showReview = () => {
    const body = screen.closest(".aw-body")
    if (body instanceof HTMLElement) body.scrollTop = Math.max(0, reviewCard.offsetTop - body.offsetTop)
  }
  const cancelParse = button("aw-btn aw-gh aw-sm", "Cancel", () => { token++; busy = false; say("Parsing cancelled. The draft is unchanged."); paint() }, ctx.signal)

  const rowFor = (key: string, endpoint: Endpoint): Row => {
    const existing = draft.rows.get(key)
    if (existing) return existing
    const row: Row = { selected: true, resolution: "keep-both", name: endpoint.name, variant: 0 }
    draft.rows.set(key, row)
    return row
  }

  const selections = (config: WorkbenchConfig): CandidateSelection[] =>
    (draft.outcome?.normalized?.candidates ?? []).map(candidate => {
      const row = rowFor(candidate.key, candidate.endpoint)
      const variant = candidate.variants[row.variant]
      const endpoint: Endpoint = {
        ...candidate.endpoint,
        name: row.name.trim() || candidate.endpoint.name,
        request: variant
          ? {
              ...candidate.endpoint.request,
              body: variant.body.text,
              bodyKind: variant.body.kind,
              headers: [
                ...candidate.endpoint.request.headers.filter(header => header.name.toLowerCase() !== "content-type"),
                { name: "Content-Type", value: variant.contentType },
              ],
            }
          : candidate.endpoint.request,
      }
      return { key: candidate.key, endpoint, selected: row.selected, resolution: row.resolution, unresolved: candidate.unresolved.length }
    })

  const drawReview = () => {
    reviewCard.replaceChildren()
    const outcome = draft.outcome
    if (!outcome) return
    const config = ctx.state().config
    const stale = draft.profileId !== config.profile.id
    const head = card()
    const counts = outcome.native
      ? `${outcome.native.counts.endpoints} endpoints · ${outcome.native.counts.rules} rules · ${outcome.native.counts.environments} environments${outcome.native.counts.plan ? " · 1 test plan" : ""}`
      : `${outcome.sourceCount} source item${outcome.sourceCount === 1 ? "" : "s"} · ${outcome.normalized?.candidates.length ?? 0} importable · ${outcome.normalized?.skipped ?? 0} skipped`
    head.append(
      group("aw-row aw-actions", el("span", "aw-lbl aw-grow", "Import review"), badge(`${outcome.label} ${outcome.version}`, "aw-bl")),
      el("p", "aw-xs aw-mu", counts),
      el("p", "aw-xs aw-mu", `Destination profile: ${config.profile.name}`),
    )
    if (stale)
      head.append(el("p", "aw-hint aw-rd", "The active profile changed after this preview was built. Choose Apply again to retarget it before importing."))
    for (const diagnostic of outcome.diagnostics.slice(0, 20))
      head.append(el("p", `aw-xs ${diagnostic.level === "warning" ? "aw-am" : "aw-mu"}`, diagnostic.message))
    reviewCard.append(head)

    if (outcome.native) {
      const modes = card()
      const mode = selectField(
        "Import mode",
        [
          ["new-profile", "Add as a new profile and switch to it"],
          ["merge", "Merge into the current profile"],
          ["replace", "Replace the current profile"],
        ] as const,
        draft.nativeMode,
        value => { draft.nativeMode = value; drawReview() },
        ctx.signal,
      )
      const preview = applyNative(config, outcome.native, draft.nativeMode)
      modes.append(
        group("aw-row aw-actions", el("span", "aw-lbl aw-grow", "Native profile import"), badge(outcome.native.profile.name, "aw-gr")),
        mode.field,
        el("p", "aw-xs aw-mu", draft.nativeMode === "new-profile"
          ? `Stored as "${outcome.native.profile.name}" and made active. "${config.profile.name}" stays in the profile list.`
          : draft.nativeMode === "merge"
            ? `${preview.summary.added} endpoint${preview.summary.added === 1 ? "" : "s"} added, ${preview.summary.skipped} duplicate${preview.summary.skipped === 1 ? "" : "s"} skipped. Existing endpoints are kept.`
            : `Replaces ${config.endpoints.length} endpoint${config.endpoints.length === 1 ? "" : "s"}, ${(config.rules ?? []).length} rule${(config.rules ?? []).length === 1 ? "" : "s"} and the current plan with the imported profile.`),
      )
      reviewCard.append(modes)
      return
    }

    const list = el("div", "aw-card aw-list")
    list.setAttribute("aria-label", "Import candidates")
    for (const candidate of outcome.normalized?.candidates ?? []) {
      const row = rowFor(candidate.key, candidate.endpoint)
      const item = el("div", "aw-col aw-gap2 aw-endpoint-row")
      const select = el("input")
      select.type = "checkbox"
      select.checked = row.selected
      select.setAttribute("aria-label", `Include ${candidate.endpoint.name}`)
      select.addEventListener("change", () => { row.selected = select.checked; updateFooter() }, { signal: ctx.signal })
      const name = el("input", "aw-in aw-grow")
      name.value = row.name
      name.setAttribute("aria-label", `Name for ${candidate.key}`)
      name.addEventListener("input", () => { row.name = name.value }, { signal: ctx.signal })
      item.append(group("aw-row aw-gap8", select, el("span", `aw-bd aw-m aw-${candidate.endpoint.request.method}`, candidate.endpoint.request.method), name,
        candidate.count > 1 ? el("span", "aw-xs aw-mu", `×${candidate.count}`) : el("span", "aw-xs aw-mu", "")))
      const path = el("span", "aw-grow aw-tr aw-mono aw-xs aw-mu", candidate.endpoint.request.path)
      path.title = candidate.endpoint.request.path
      item.append(group("aw-row aw-endpoint-meta", path, el("span", "aw-xs aw-mu", candidate.endpoint.hostKey)))
      const marks = el("div", "aw-row aw-gap6 aw-wrap")
      if (candidate.unresolved.length) marks.append(badge(`needs ${candidate.unresolved.join(", ")}`, "aw-am"))
      if (candidate.sensitive.length) marks.append(badge(`sensitive: ${candidate.sensitive.join(", ")}`, "aw-vi"))
      if (candidate.endpoint.request.credentials !== "same-origin")
        marks.append(badge(`credentials: ${candidate.endpoint.request.credentials}`, "aw-bl"))
      if (marks.children.length) item.append(marks)
      if (candidate.variants.length > 1) {
        const variant = selectField(
          `Body example for ${candidate.key}`,
          candidate.variants.map((option, index) => [String(index), option.label] as const),
          String(row.variant),
          value => { row.variant = Number(value) },
          ctx.signal,
        )
        item.append(variant.field)
      }
      const existing = conflictOf(candidate.endpoint, ctx.state().config.endpoints)
      if (existing) {
        const links = linkedTo(ctx.state().config, existing.id)
        const conflict = selectField(
          `Conflict for ${candidate.key}`,
          [["keep-both", "Keep both"], ["replace", "Replace existing"], ["skip", "Skip"]] as const,
          row.resolution,
          value => { row.resolution = value; updateFooter() },
          ctx.signal,
        )
        item.append(el("p", "aw-xs aw-am", `Duplicate of "${existing.name}"${links.rules.length ? ` · linked rules: ${links.rules.join(", ")}` : ""}${links.plan ? " · referenced by the test plan" : ""}`), conflict.field)
      }
      if (candidate.diagnostics.length) {
        const details = disclosure(`${candidate.diagnostics.length} note${candidate.diagnostics.length === 1 ? "" : "s"}`,
          ...candidate.diagnostics.map(diagnostic => el("p", `aw-xs ${diagnostic.level === "warning" ? "aw-am" : "aw-mu"}`, diagnostic.message)))
        item.append(details)
      }
      item.append(el("p", "aw-xs aw-mu", candidate.source))
      list.append(item)
    }
    if (!(outcome.normalized?.candidates.length ?? 0)) list.append(el("div", "aw-empty", "Nothing importable in this source."))
    const actions = card()
    const setAll = (value: boolean) => {
      for (const row of draft.rows.values()) row.selected = value
      drawReview()
      updateFooter()
    }
    actions.append(group("aw-row aw-actions", el("span", "aw-lbl aw-grow", "Selection"),
      button("aw-btn aw-gh aw-sm", "Select all", () => setAll(true), ctx.signal),
      button("aw-btn aw-gh aw-sm", "Clear", () => setAll(false), ctx.signal)),
      el("p", "aw-hint", "The preview changes nothing until Import selected. Imported endpoints are never sent automatically."))
    reviewCard.append(actions, list)
  }

  const updateFooter = () => {
    const outcome = draft.outcome
    const stale = outcome && draft.profileId !== ctx.state().config.profile.id
    const chosen = outcome?.native ? 1 : selections(ctx.state().config).filter(item => item.selected && item.resolution !== "skip").length
    commit.disabled = busy || !outcome || !!stale || !chosen
    commit.textContent = outcome?.native ? "Import profile" : `Import selected${chosen ? ` (${chosen})` : ""}`
    commit.hidden = !outcome
    apply.disabled = busy || !draft.text.trim()
    cancelParse.hidden = !busy
  }

  const paint = () => {
    drawReview()
    updateFooter()
  }

  const runApply = async () => {
    if (busy || !draft.text.trim()) return
    busy = true
    updateFooter()
    say("Parsing…")
    const current = ++token
    // One yield before the parse keeps Cancel, Back and the rest of the panel usable.
    await new Promise(resolve => setTimeout(resolve, 0))
    if (current !== token || ctx.signal.aborted) return
    const outcome = parseSource(draft.text, ctx.state().config.profile.id, draft.override || undefined)
    busy = false
    if (outcome.error) {
      draft.outcome = undefined
      draft.rows.clear()
      say(outcome.error)
      paint()
      return
    }
    draft.outcome = outcome
    draft.rows.clear()
    draft.profileId = ctx.state().config.profile.id
    say(`${outcome.label} ${outcome.version} read. Review the ${outcome.native ? "profile" : "candidates"} below, then Import.`)
    paint()
    showReview()
  }

  const runCommit = async () => {
    const outcome = draft.outcome
    if (!outcome || busy) return
    const config = ctx.state().config
    if (draft.profileId !== config.profile.id) return say("The active profile changed. Choose Apply again before importing.")
    busy = true
    updateFooter()
    say("Saving…")
    const applied = outcome.native
      ? applyNative(config, outcome.native, draft.nativeMode)
      : { ...applyCandidates(config, selections(config), outcome.normalized?.hosts ?? {}), activated: undefined, stored: undefined }
    const error = await ctx.commitImport(applied.config, !!applied.activated)
    busy = false
    if (error) {
      // The review and the draft survive a failed write, so the user can retry or export.
      say(`Import failed: ${error}. Nothing was saved; the review is unchanged.`)
      paint()
      return
    }
    // The mode is read before the draft is cleared: clearing resets it to the default.
    const switched = !!outcome.native && draft.nativeMode === "new-profile"
    const message = switched
      ? `Switched to "${applied.stored?.profile.name ?? ""}" with ${applied.summary.added} endpoints.`
      : summaryText(applied.summary)
    clearDraft()
    source.value = ""
    lastSummary = message
    ctx.go("endpoints")
  }

  /* ── Recorded calls, as a draft source ────────────────────────────────── */
  // Not a recorder: starting and stopping live on Home and the Record screen. This is the one thing
  // only Import can do with a recording — turn it into a draft that merges into the active profile,
  // where Record creates a whole new one.
  const useRecorded = button("aw-btn aw-out aw-sm", "Use recorded calls", () => {
    if (ctx.state().recording) ctx.stopRecording()
    const outcome = parseRecordings(ctx.state().recordings, ctx.state().config.profile.id)
    draft.outcome = outcome.error ? undefined : outcome
    draft.rows.clear()
    draft.profileId = ctx.state().config.profile.id
    say(outcome.error ?? `Recorded ${outcome.sourceCount} call${outcome.sourceCount === 1 ? "" : "s"}. Review the candidates below, then Import.`)
    paint()
    showReview()
  }, ctx.signal)
  ctx.watch(state => {
    useRecorded.textContent = `Use recorded calls${state.recordings.length ? ` (${state.recordings.length})` : ""}`
    useRecorded.disabled = !state.recordings.length
  })

  const input = card()
  input.append(
    labeledAction("Paste or load JSON, cURL, or fetch()", source, formatJsonButton(source, ctx.signal)),
    detected,
    group("aw-row aw-actions", apply, chooseFile, useRecorded, cancelParse,
      clearButton,
      button("aw-btn aw-gh aw-sm", "Export draft", () => {
        if (!draft.text.trim()) return say("Nothing to export yet.")
        say(`Exported ${downloadFile(draft.text, draft.source || "import-draft", "txt", "text/plain")}.`)
      }, ctx.signal)),
    format.field,
    status,
  )

  const formats = card()
  formats.append(el("div", "aw-lbl", "Supported formats"))
  const tones: Record<FormatId, string> = {
    native: "aw-gr", swagger: "aw-bl", openapi: "aw-bl", har: "aw-am", postman: "aw-vi", curl: "", fetch: "", recorder: "aw-gr",
  }
  for (const item of FORMATS)
    formats.append(group("aw-row aw-xs aw-format", el("span", `aw-bd ${tones[item.id]}`, `${item.label} ${item.version}`), el("span", "aw-mu aw-grow", item.note)))
  formats.append(disclosure("Format help and examples",
    ...[
      "Native: the JSON written by Settings → Export profile + endpoints.",
      "Swagger 2.0 / OpenAPI 3.0: JSON documents. YAML, remote $ref and schema execution are not supported.",
      "HAR 1.2: DevTools → Network → Export HAR. Restricted headers are imported as diagnostics.",
      "Postman v2.1: Collection export. Scripts are reported, never run; environment files are a separate format.",
      "cURL: DevTools → Copy → Copy as cURL (bash or cmd). File references need the file chosen yourself.",
      "fetch(): DevTools → Copy → Copy as fetch. Only a literal URL and a literal options object are read.",
    ].map(line => el("p", "aw-xs aw-mu", line))))

  screen.append(input, reviewCard, formats)
  ctx.chrome({ actions: [commit, back] })
  describe()
  paint()
  return screen
}
