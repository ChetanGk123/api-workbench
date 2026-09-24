// Runtime DOM is built with createElement/textContent only: no HTML parsing, no Trusted Types
// policy and no interpolation of imported data into markup.
import type { HeaderValue } from "../core/model"
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) element.textContent = text
  return element
}

type Shape = readonly [string, Record<string, string>]
const p = (d: string): Shape => ["path", { d }]
const circle = (cx: string, cy: string, r: string): Shape => ["circle", { cx, cy, r }]
const rect = (x: string, y: string, width: string, height: string): Shape => [
  "rect",
  { x, y, width, height, rx: "2" },
]

// Icon geometry copied from the reference screens so the bundle needs no icon font or sprite file.
export const ICONS = {
  bolt: [
    p(
      "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
    ),
  ],
  home: [
    p("M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"),
    p(
      "M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    ),
  ],
  flask: [
    p(
      "M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2",
    ),
    p("M8.5 2h7"),
    p("M7 16h10"),
  ],
  server: [rect("2", "2", "20", "8"), rect("2", "14", "20", "8"), p("M6 6h.01"), p("M6 18h.01")],
  shuffle: [
    p("m18 14 4 4-4 4"),
    p("m18 2 4 4-4 4"),
    p("M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-7.6a4 4 0 0 1 3.3-1.7H22"),
    p("M2 6h1.972a4 4 0 0 1 3.6 2.2"),
    p("M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"),
  ],
  route: [
    circle("6", "19", "3"),
    p("M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"),
    circle("18", "5", "3"),
  ],
  flame: [
    p(
      "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z",
    ),
  ],
  gear: [
    p(
      "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
    ),
    circle("12", "12", "3"),
  ],
  download: [p("M12 15V3"), p("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"), p("m7 10 5 5 5-5")],
  book: [
    p("M12 7v14"),
    p(
      "M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z",
    ),
  ],
  minus: [p("M5 12h14")],
  close: [p("M18 6 6 18"), p("m6 6 12 12")],
  expand: [
    p("M8 3H5a2 2 0 0 0-2 2v3"),
    p("M21 8V5a2 2 0 0 0-2-2h-3"),
    p("M3 16v3a2 2 0 0 0 2 2h3"),
    p("M16 21h3a2 2 0 0 0 2-2v-3"),
  ],
  selector: [p("m7 15 5 5 5-5"), p("m7 9 5-5 5 5")],
  right: [p("m9 18 6-6-6-6")],
  play: [p("M6 3 20 12 6 21Z")],
  stop: [rect("6", "6", "12", "12")],
  history: [
    p("M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"),
    p("M3 3v5h5"),
    p("M12 7v5l4 2"),
  ],
  plus: [p("M5 12h14"), p("M12 5v14")],
  back: [p("m15 18-6-6 6-6"), p("M9 12h10")],
  up: [p("m18 15-6-6-6 6")],
  down: [p("m6 9 6 6 6-6")],
  edit: [
    p(
      "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
    ),
  ],
  trash: [
    p("M3 6h18"),
    p("M19 6v14c0 1-1 2-2 2H7c-1 0-2-2-2-2V6"),
    p("M8 6V4c0-1 2-2 2-2h4c1 0 2 1 2 2v2"),
  ],
  link: [
    p("M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"),
    p("M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"),
  ],
  list: [p("m3 17 2 2 4-4"), p("m3 7 2 2 4-4"), p("M13 6h8"), p("M13 12h8"), p("M13 18h8")],
  check: [p("M20 6 9 17l-5-5")],
  save: [
    p("M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"),
    p("M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"),
    p("M7 3v4a1 1 0 0 0 1 1h7"),
  ],
  record: [circle("12", "12", "9"), circle("12", "12", "4")],
  wrench: [
    p(
      "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
    ),
  ],
  upload: [p("M12 3v12"), p("m17 8-5-5-5 5"), p("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4")],
  reset: [p("M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"), p("M3 3v5h5")],
  refresh: [
    p("M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"),
    p("M21 3v5h-5"),
    p("M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"),
    p("M8 16H3v5"),
  ],
  info: [circle("12", "12", "10"), p("M12 16v-4"), p("M12 8h.01")],
  search: [circle("11", "11", "8"), p("m21 21-4.3-4.3")],
  cpu: [
    rect("4", "4", "16", "16"),
    rect("9", "9", "6", "6"),
    p("M15 2v2"),
    p("M15 20v2"),
    p("M2 15h2"),
    p("M2 9h2"),
    p("M20 15h2"),
    p("M20 9h2"),
    p("M9 2v2"),
    p("M9 20v2"),
  ],
  layout: [
    rect("14", "3", "7", "7"),
    p("M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3"),
  ],
  globe: [
    circle("12", "12", "10"),
    p("M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"),
    p("M2 12h20"),
  ],
} satisfies Record<string, readonly Shape[]>
export type IconName = keyof typeof ICONS

export function icon(name: IconName, size = "aw-i14"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("class", `aw-i ${size}`.trim())
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("aria-hidden", "true")
  for (const [tag, attributes] of ICONS[name]) {
    const shape = document.createElementNS("http://www.w3.org/2000/svg", tag)
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value)
    svg.append(shape)
  }
  return svg
}

export function button(
  className: string,
  label: string,
  onClick: () => void,
  signal: AbortSignal,
): HTMLButtonElement {
  const element = el("button", className, label)
  element.type = "button"
  element.addEventListener("click", onClick, { signal })
  return element
}

export function iconButton(
  className: string,
  name: IconName,
  label: string,
  onClick: () => void,
  signal: AbortSignal,
): HTMLButtonElement {
  const element = button(className, "", onClick, signal)
  element.setAttribute("aria-label", label)
  element.title = label
  element.append(icon(name))
  return element
}

export type Choice = { value: string; label: string }

/**
 * A shadcn-style menu: a trigger plus a floating list of single-choice items. The menu is mounted
 * outside the panel so `.aw-root { overflow: hidden }` cannot clip it, and positioned from the
 * trigger's viewport rect. Escape, outside pointerdown, arrow keys, Home/End and Enter/Space are
 * handled here; the browser's own select popup is not used because it cannot be themed.
 */
export function dropdown(options: {
  label: string
  triggerClass: string
  layer: ParentNode
  onSelect: (value: string) => void
  signal: AbortSignal
}) {
  const { signal } = options
  const trigger = el("button", `aw-sel ${options.triggerClass}`.trim())
  trigger.type = "button"
  trigger.setAttribute("aria-label", options.label)
  trigger.setAttribute("aria-haspopup", "menu")
  trigger.setAttribute("aria-expanded", "false")
  const text = el("span", "aw-tr")
  trigger.append(text, icon("selector", "aw-i12"))

  const menu = el("div", "aw-menu")
  menu.setAttribute("role", "menu")
  menu.setAttribute("aria-label", options.label)
  menu.hidden = true
  options.layer.append(menu)

  let choices: Choice[] = []
  let current = ""
  const items = () => Array.from(menu.querySelectorAll<HTMLButtonElement>(".aw-mi"))

  const place = () => {
    const box = trigger.getBoundingClientRect()
    menu.style.minWidth = `${Math.max(box.width, 160)}px`
    // Measure before clamping, then flip above the trigger when there is no room below.
    const size = menu.getBoundingClientRect()
    const below = window.innerHeight - box.bottom - 8
    const flip = below < size.height && box.top - 8 > below
    menu.style.top = flip ? `${Math.max(8, box.top - 4 - size.height)}px` : `${box.bottom + 4}px`
    menu.style.left = `${Math.min(Math.max(8, box.left), Math.max(8, window.innerWidth - size.width - 8))}px`
  }

  const close = (restoreFocus = false) => {
    if (menu.hidden) return
    menu.hidden = true
    trigger.setAttribute("aria-expanded", "false")
    if (restoreFocus) trigger.focus({ preventScroll: true })
  }
  const open = () => {
    if (!choices.length) return
    menu.hidden = false
    trigger.setAttribute("aria-expanded", "true")
    place()
    ;(items().find((item) => item.dataset.value === current) ?? items()[0])?.focus({
      preventScroll: true,
    })
  }

  trigger.addEventListener("click", () => (menu.hidden ? open() : close(true)), { signal })
  trigger.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        open()
      }
    },
    { signal },
  )

  const move = (from: HTMLElement, step: number) => {
    const list = items()
    const next = list[(list.indexOf(from as HTMLButtonElement) + step + list.length) % list.length]
    next?.focus({ preventScroll: true })
  }
  menu.addEventListener(
    "keydown",
    (event) => {
      const target = event.target as HTMLElement
      if (event.key === "Escape") {
        event.preventDefault()
        close(true)
      } else if (event.key === "ArrowDown") {
        event.preventDefault()
        move(target, 1)
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        move(target, -1)
      } else if (event.key === "Home") {
        event.preventDefault()
        items()[0]?.focus({ preventScroll: true })
      } else if (event.key === "End") {
        event.preventDefault()
        items().at(-1)?.focus({ preventScroll: true })
      } else if (event.key === "Tab") close(true)
    },
    { signal },
  )
  // A pointerdown anywhere else dismisses; the composed path sees into the shadow root.
  document.addEventListener(
    "pointerdown",
    (event) => {
      const path = event.composedPath()
      if (!path.includes(menu) && !path.includes(trigger)) close()
    },
    { signal, capture: true },
  )
  window.addEventListener("resize", () => close(), { signal })

  return {
    trigger,
    menu,
    close,
    set(next: Choice[], value: string) {
      choices = next
      current = value
      text.textContent = next.find((choice) => choice.value === value)?.label ?? ""
      menu.replaceChildren()
      for (const choice of next) {
        const item = el("button", "aw-mi")
        item.type = "button"
        item.setAttribute("role", "menuitemradio")
        item.setAttribute("aria-checked", String(choice.value === value))
        item.dataset.value = choice.value
        item.append(icon("check", "aw-i14"), el("span", "aw-tr", choice.label))
        item.title = choice.label
        item.addEventListener(
          "click",
          () => {
            close(true)
            options.onSelect(choice.value)
          },
          { signal },
        )
        menu.append(item)
      }
    },
  }
}

/* ── Shared layout helpers ─────────────────────────────────────────────────── */

export function card(): HTMLElement {
  return el("section", "aw-card aw-cp aw-col aw-gap12")
}

/**
 * A card's own heading. The reference screens set every one of these as `.aw-h` at 13px, which is
 * the panel heading one step down — not the rule-off uppercase caption that separates sections.
 */
export function cardHeading(text: string, ...extra: Node[]): HTMLElement {
  const heading = el("div", "aw-h aw-cardh", text)
  if (!extra.length) return heading
  return group("aw-row aw-gap8", heading, ...extra)
}

export function caption(text: string): HTMLElement {
  return el("div", "aw-cap aw-capl", text)
}

/** The shared header-row editor: a name/value pair per row, committed on change. */
export function headerFields(signal: AbortSignal, values: HeaderValue[], save: (headers: HeaderValue[]) => void): HTMLElement {
  const section = el("div", "aw-col aw-gap10")
  const rows = el("div", "aw-col aw-gap6")
  let headers = values.map(header => ({ ...header }))
  const render = () => {
    rows.replaceChildren()
    for (const header of headers) {
      const name = el("input", "aw-in aw-mono")
      name.value = header.name
      name.placeholder = "Header name"
      name.setAttribute("aria-label", "Header name")
      const value = el("input", "aw-in aw-mono")
      value.value = header.value
      value.placeholder = "Header value"
      value.setAttribute("aria-label", "Header value")
      const commit = () => { header.name = name.value; header.value = value.value; save(headers.map(item => ({ ...item }))) }
      name.addEventListener("change", commit, { signal: signal })
      value.addEventListener("change", commit, { signal: signal })
      rows.append(group("aw-header-row", name, value, iconButton("aw-btn aw-gh aw-ic", "close", "Remove header", () => {
        headers = headers.filter(item => item !== header)
        save(headers.map(item => ({ ...item })))
        render()
      }, signal)))
    }
  }
  const add = button("aw-btn aw-out aw-sm aw-self", "Add header", () => {
    headers.push({ name: "", value: "" })
    render()
    rows.lastElementChild?.querySelector("input")?.focus()
  }, signal)
  add.prepend(icon("plus", "aw-i14"))
  render()
  section.append(rows, add)
  return section
}

export function group(className: string, ...children: Node[]): HTMLElement {
  const element = el("div", className)
  element.append(...children)
  return element
}

export function labeled(label: string, input: HTMLElement): HTMLElement {
  const wrapper = el("label", "aw-fld")
  wrapper.append(el("span", "aw-lbl", label), input)
  return wrapper
}

/** `labeled()` with a control beside the label; the action stays outside the <label> element. */
export function labeledAction(label: string, input: HTMLElement, action: HTMLElement): HTMLElement {
  const wrapper = el("div", "aw-fld")
  wrapper.append(group("aw-row aw-actions", el("span", "aw-lbl aw-grow", label), action), input)
  return wrapper
}

/** The indented form of `value`, or null when it is not JSON or is already indented. */
export function prettyJson(value: string): string | null {
  if (!value.trim()) return null
  let pretty: string
  try {
    pretty = JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return null
  }
  return pretty === value ? null : pretty
}

/** A non-textarea target: the caller reads and writes the text itself. */
export type JsonField = { read: () => string; write: (value: string) => void }

/**
 * Reformats a field's JSON in place. The button is shown only while it would actually change
 * something — empty, non-JSON and already-indented content hide it — so it can never discard a
 * body that is still being written, and it disappears once its work is done.
 */
export function formatJsonButton(
  target: HTMLTextAreaElement | JsonField,
  signal: AbortSignal,
): HTMLButtonElement {
  const textarea = target instanceof HTMLTextAreaElement ? target : undefined
  const read = textarea ? () => textarea.value : (target as JsonField).read
  const write = textarea
    ? (value: string) => {
        textarea.value = value
        // Validators and draft bindings listen for input or change; assigning value fires neither.
        textarea.dispatchEvent(new Event("input", { bubbles: true }))
        textarea.dispatchEvent(new Event("change", { bubbles: true }))
      }
    : (target as JsonField).write
  const sync = () => {
    format.hidden = !!textarea?.disabled || prettyJson(read()) === null
  }
  const format = button("aw-btn aw-gh aw-xs2", "Format JSON", () => {
    const pretty = prettyJson(read())
    if (pretty !== null) write(pretty)
    sync()
  }, signal)
  if (textarea) {
    textarea.addEventListener("input", sync, { signal })
    textarea.addEventListener("change", sync, { signal })
  }
  sync()
  return format
}

export function disclosure(title: string, ...children: Node[]): HTMLDetailsElement {
  const details = el("details", "aw-col aw-gap10")
  const summary = el("summary", "aw-coll", title)
  summary.prepend(icon("right", "aw-i14"))
  details.append(summary, group("aw-col aw-gap10", ...children))
  return details
}

// A detached anchor keeps the download out of the host page's DOM.
/**
 * A modal confirmation inside the panel. A native <dialog> renders in the top layer, so
 * `.aw-root`'s overflow cannot clip it, and Esc, focus trapping and the backdrop need no code.
 * Resolves false on Cancel, Esc, or the screen being torn down while it is open.
 */
export function confirmDialog(
  host: Element,
  title: string,
  message: string,
  confirmLabel: string,
  signal: AbortSignal,
  /**
   * A notice is not a warning: it names its own dismissal and leads with its action. A `null`
   * cancelLabel drops the second button, for a notice whose only honest outcome is "seen".
   */
  options: { cancelLabel?: string | null; tone?: "danger" | "notice" } = {},
): Promise<boolean> {
  const notice = options.tone === "notice"
  const choice = options.cancelLabel !== null
  const dialog = el("dialog", "aw-dlg")
  dialog.setAttribute("aria-label", title)
  const form = el("form", "aw-col aw-gap10")
  form.method = "dialog"
  const cancel = el("button", "aw-btn aw-out aw-sm aw-grow", options.cancelLabel ?? "Cancel")
  const confirm = el("button", `aw-btn ${notice ? "aw-pri" : "aw-dst"} aw-sm aw-grow`, confirmLabel)
  confirm.value = "confirm"
  form.append(
    el("span", "aw-lbl", title),
    el("p", "aw-hint", message),
    choice ? group("aw-row aw-actions", cancel, confirm) : group("aw-row aw-actions", confirm),
  )
  dialog.append(form)
  const root = host.closest(".aw-root")
  root?.append(dialog)
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        dialog.remove()
        resolve(dialog.returnValue === "confirm")
      },
      { once: true },
    )
    // A screen torn down under an open dialog must not strand it in the top layer.
    signal.addEventListener("abort", () => dialog.close(), { once: true })
    dialog.showModal()
    // The top layer is positioned against the viewport, so the dialog is centred on the panel
    // after it is measurable, and clamped to stay on screen wherever the panel has been dragged.
    const box = root?.getBoundingClientRect()
    if (box) {
      const size = dialog.getBoundingClientRect()
      const place = (start: number, span: number, self: number, limit: number) =>
        `${Math.max(8, Math.min(limit - self - 8, start + (span - self) / 2))}px`
      dialog.style.left = place(box.x, box.width, size.width, window.innerWidth)
      dialog.style.top = place(box.y, box.height, size.height, window.innerHeight)
    }
    // The destructive action is never the focused default; a notice leads with its action.
    ;(notice || !choice ? confirm : cancel).focus()
  })
}

export function downloadFile(text: string, name: string, extension: string, type: string): string {
  const file = `${name.trim().replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || "profile"}.${extension}`
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = el("a")
  link.href = url
  link.download = file
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return file
}

export function downloadJson(json: string, name: string): string {
  return downloadFile(json, name, "json", "application/json")
}

/* ── Small form primitives ─────────────────────────────────────────────────── */

export function textField(label: string, value: string, onChange: (value: string) => void, signal: AbortSignal, mono = true) {
  const input = el("input", `aw-in${mono ? " aw-mono" : ""}`)
  input.value = value
  input.setAttribute("aria-label", label)
  input.addEventListener("input", () => onChange(input.value), { signal })
  return { input, field: labeled(label, input) }
}

export function numberField(
  label: string,
  value: number,
  onChange: (value: number) => void,
  signal: AbortSignal,
  min = 0,
  max = 1000000,
) {
  const input = el("input", "aw-in aw-mono")
  input.type = "number"
  input.min = String(min)
  input.max = String(max)
  input.value = String(value)
  input.setAttribute("aria-label", label)
  const commit = () => {
    const next = Math.min(max, Math.max(min, Math.round(Number(input.value) || 0)))
    input.value = String(next)
    onChange(next)
  }
  input.addEventListener("change", commit, { signal })
  return { input, field: labeled(label, input) }
}

export function selectField<T extends string>(
  label: string,
  choices: readonly (readonly [T, string])[],
  value: T,
  onChange: (value: T) => void,
  signal: AbortSignal,
) {
  const select = el("select", "aw-sel")
  select.setAttribute("aria-label", label)
  for (const [key, text] of choices) {
    const option = el("option", "", text)
    option.value = key
    option.selected = key === value
    select.append(option)
  }
  select.addEventListener("change", () => onChange(select.value as T), { signal })
  return { select, field: labeled(label, select) }
}

export function checkField(label: string, checked: boolean, onChange: (value: boolean) => void, signal: AbortSignal) {
  const wrapper = el("label", "aw-chk aw-xs")
  const input = el("input")
  input.type = "checkbox"
  input.checked = checked
  input.addEventListener("change", () => onChange(input.checked), { signal })
  wrapper.append(input, document.createTextNode(label))
  return { input, field: wrapper }
}

/** The reference's sliding switch, used where a whole module is turned on or off. */
export function switchBox(label: string, checked: boolean, onChange: (value: boolean) => void, signal: AbortSignal) {
  const control = el("button", `aw-sw${checked ? " aw-on" : ""}`)
  control.type = "button"
  control.setAttribute("role", "switch")
  control.setAttribute("aria-checked", String(checked))
  control.setAttribute("aria-label", label)
  control.append(el("span", "aw-th"))
  control.addEventListener("click", () => onChange(!checked), { signal })
  return control
}

/** The reference's tick-box toggle: a button, so a row click never submits or navigates. */
export function toggleBox(label: string, checked: boolean, onChange: (value: boolean) => void, signal: AbortSignal) {
  const control = el("button", `aw-cb${checked ? " aw-on" : ""}`)
  control.type = "button"
  control.setAttribute("role", "checkbox")
  control.setAttribute("aria-checked", String(checked))
  control.setAttribute("aria-label", label)
  control.append(icon("check", "aw-i12"))
  control.addEventListener("click", () => onChange(!checked), { signal })
  return control
}
