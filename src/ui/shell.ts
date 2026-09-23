import theme from "../../design/reference/aw-theme.css"
import additions from "./theme.css"
import { el, icon, button, iconButton, dropdown } from "./dom"
import type { Store } from "../core/store"
import { SCREENS, TABS, renderScreen, type Ctx, type ScreenId, type UIState } from "./screens"

export type ShellOptions = {
  version: string
  store: Store<UIState>
  onClose: () => void
  addEndpoint: Ctx["addEndpoint"]
  updateEndpoint: Ctx["updateEndpoint"]
  deleteEndpoint: Ctx["deleteEndpoint"]
  updateProfile: Ctx["updateProfile"]
  exportConfig: Ctx["exportConfig"]
  runOnce: Ctx["runOnce"]
  saveProfileAs: Ctx["saveProfileAs"]
  selectProfile: Ctx["selectProfile"]
  deleteProfile: Ctx["deleteProfile"]
  commitImport: Ctx["commitImport"]
  reorderEndpoint: Ctx["reorderEndpoint"]
  startRecording: Ctx["startRecording"]
  stopRecording: Ctx["stopRecording"]
  resetRecorder: Ctx["resetRecorder"]
  createProfileFromRecordings: Ctx["createProfileFromRecordings"]
  saveRule: Ctx["saveRule"]
  deleteRule: Ctx["deleteRule"]
  toggleRule: Ctx["toggleRule"]
  setModuleActive: Ctx["setModuleActive"]
  resetSequence: Ctx["resetSequence"]
  nextRuleSeq: Ctx["nextRuleSeq"]
  continueAllPaused: Ctx["continueAllPaused"]
  plan: Ctx["plan"]
  updatePlan: Ctx["updatePlan"]
  savePlanAs: Ctx["savePlanAs"]
  selectPlan: Ctx["selectPlan"]
  startRun: Ctx["startRun"]
  stopRun: Ctx["stopRun"]
  openRun: Ctx["openRun"]
  exportRun: Ctx["exportRun"]
}

export function createShell(options: ShellOptions) {
  const { store } = options
  const listeners = new AbortController()
  const signal = listeners.signal

  const host = el("div")
  host.id = "api-workbench"
  const root = host.attachShadow({ mode: "open" })
  // A constructed sheet avoids HTML parsing, Trusted Types and any external asset request,
  // and keeps every rule inside the shadow root.
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(theme + additions)
  root.adoptedStyleSheets = [sheet]

  const panel = el("section", "aw-root")
  panel.setAttribute("aria-label", "API Workbench")
  const launcher = el("section", "aw-root aw-min")
  launcher.setAttribute("aria-label", "API Workbench (minimized)")
  launcher.hidden = true

  let panelFocus: HTMLElement | null = null
  const minimize = () => {
    panelFocus = root.activeElement instanceof HTMLElement ? root.activeElement : null
    store.set({ minimized: true })
    apply()
    restoreButton.focus({ preventScroll: true })
  }
  const restore = () => {
    store.set({ minimized: false })
    apply()
    ;(panelFocus?.isConnected ? panelFocus : body).focus({ preventScroll: true })
  }
  const close = () => options.onClose()

  const logo = () => {
    const badge = el("div", "aw-logo")
    badge.append(icon("bolt"))
    return badge
  }
  // The chevron promised a profile list, so the trigger opens one. A themed menu rather than a
  // native <select>: the browser's popup cannot carry the panel's surface, radius or check marks.
  const profileMenus: Array<ReturnType<typeof dropdown>> = []
  const profile = () => {
    const control = dropdown({
      label: "Active profile",
      triggerClass: "aw-profile",
      layer: root,
      signal,
      onSelect: (value) => {
        options.selectProfile(value)
        // Re-render so the screen shows the newly active profile's endpoints, then re-sync the
        // trigger: a selection the store refused must not leave a stale name on screen.
        go(store.state.screen)
        syncProfiles()
      },
    })
    control.trigger.title = "Switch profile"
    profileMenus.push(control)
    return control.trigger
  }
  let profileKey = ""
  function syncProfiles() {
    const config = store.state.config
    const list = [
      config.profile,
      ...(config.savedProfiles ?? [])
        .map((item) => item.profile)
        .filter((item) => item.id !== config.profile.id),
    ]
    const key = `${config.profile.id}|${list.map((item) => `${item.id}:${item.name}`).join(",")}`
    if (key === profileKey) return
    profileKey = key
    for (const control of profileMenus)
      control.set(
        list.map((item) => ({ value: item.id, label: item.name })),
        config.profile.id,
      )
  }

  // Header
  const header = el("header", "aw-tb")
  header.append(
    logo(),
    el("span", "aw-brand", "API Workbench"),
    el("div", "aw-grow"),
    profile(),
    iconButton("aw-btn aw-gh aw-ic aw-sm", "gear", "Settings", () => go("settings"), signal),
    iconButton("aw-btn aw-gh aw-ic aw-sm", "download", "Import", () => go("import"), signal),
    iconButton("aw-btn aw-gh aw-ic aw-sm", "minus", "Minimize", minimize, signal),
    iconButton("aw-btn aw-gh aw-ic aw-sm", "close", "Close", close, signal),
  )

  // Tabs: internal navigation only, never a host-page link.
  const nav = el("nav", "aw-tabs")
  nav.setAttribute("aria-label", "Modules")
  const list = el("div", "aw-tl")
  const tabs = new Map<ScreenId, HTMLButtonElement>()
  for (const id of TABS) {
    const tab = el("button", "aw-tt")
    tab.type = "button"
    tab.append(icon(SCREENS[id].icon), document.createTextNode(SCREENS[id].label))
    tab.addEventListener("click", () => go(id), { signal })
    tabs.set(id, tab)
    list.append(tab)
  }
  nav.append(list)

  const subheader = el("div", "aw-sub")
  // The back target follows the screen: an editor returns to its list, a screen returns Home.
  let backTo: () => void = () => go("home")
  const back = button("aw-btn aw-gh aw-sm", "Back", () => backTo(), signal)
  back.prepend(icon("back", "aw-i14"))
  const subTitle = el("div", "aw-row aw-subtitle")
  let subIcon = icon("book", "aw-i14")
  const subLabel = el("span", "", "Endpoints")
  subTitle.append(subIcon, subLabel)
  // The reference leaves the right slot empty; the tester shortcut is useful from Endpoints only.
  const subTest = iconButton("aw-btn aw-gh aw-ic aw-sm", "flask", "Test", () => go("test"), signal)
  subheader.append(back, subTitle, subTest)

  const body = el("main", "aw-body")
  body.tabIndex = -1
  // The reference footer is the screen's action bar; it falls back to build and traffic status.
  const footer = el("footer", "aw-foot")
  const status = el("div", "aw-row aw-grow aw-gap8")
  const counter = el("span", "aw-xs aw-mu aw-grow aw-tr")
  status.append(el("span", "aw-bd aw-s", options.version), counter)
  footer.append(status)
  panel.append(header, nav, subheader, body, footer)

  // Minimized launcher
  const launcherState = el("span", "aw-bd")
  const launcherDot = el("span", "aw-dot")
  const launcherLabel = el("span", "aw-tr", "No active modules")
  launcherState.append(launcherDot, launcherLabel)
  const restoreButton = iconButton("aw-btn aw-gh aw-ic aw-sm", "expand", "Restore", restore, signal)
  launcher.append(
    logo(),
    el("span", "aw-brand", "AW"),
    launcherState,
    el("div", "aw-grow"),
    profile(),
    el("div", "aw-vsep"),
    restoreButton,
    iconButton("aw-btn aw-gh aw-ic aw-sm", "close", "Close", close, signal),
  )
  root.append(panel, launcher)

  // Screen mounting: watchers registered by a screen are dropped when it is replaced.
  let screenWatchers: Array<() => void> = []
  let screenListeners = new AbortController()
  const ctx: Ctx = {
    version: options.version,
    state: () => store.state,
    go: (id) => go(id),
    watch: (listener) => {
      listener(store.state)
      screenWatchers.push(store.subscribe(listener))
    },
    chrome: ({ title, onBack, actions }) => {
      if (title !== undefined) subLabel.textContent = title
      if (onBack) {
        backTo = onBack
        subTest.hidden = true
      }
      footer.replaceChildren(...(actions ?? [status]))
    },
    get signal() {
      return screenListeners.signal
    },
    addEndpoint: options.addEndpoint,
    updateEndpoint: options.updateEndpoint,
    deleteEndpoint: options.deleteEndpoint,
    updateProfile: options.updateProfile,
    exportConfig: options.exportConfig,
    runOnce: options.runOnce,
    saveProfileAs: options.saveProfileAs,
    selectProfile: options.selectProfile,
    deleteProfile: options.deleteProfile,
    commitImport: options.commitImport,
    reorderEndpoint: options.reorderEndpoint,
    startRecording: options.startRecording,
    stopRecording: options.stopRecording,
    resetRecorder: options.resetRecorder,
    createProfileFromRecordings: options.createProfileFromRecordings,
    saveRule: options.saveRule,
    deleteRule: options.deleteRule,
    toggleRule: options.toggleRule,
    setModuleActive: options.setModuleActive,
    resetSequence: options.resetSequence,
    nextRuleSeq: options.nextRuleSeq,
    continueAllPaused: options.continueAllPaused,
    plan: options.plan,
    updatePlan: options.updatePlan,
    savePlanAs: options.savePlanAs,
    selectPlan: options.selectPlan,
    startRun: options.startRun,
    stopRun: options.stopRun,
    openRun: options.openRun,
    exportRun: options.exportRun,
  }

  function go(id: ScreenId) {
    for (const control of profileMenus) control.close()
    if (store.state.minimized) restore()
    const focused = root.activeElement
    store.set({ screen: id })
    screenListeners.abort()
    screenListeners = new AbortController()
    for (const dispose of screenWatchers.splice(0)) dispose()
    for (const [tabId, tab] of tabs) {
      tab.classList.toggle("aw-on", tabId === id)
      if (tabId === id) tab.setAttribute("aria-current", "page")
      else tab.removeAttribute("aria-current")
    }
    // Every non-tab screen is reached from Home or the title bar, so it gets the Back sub-header
    // instead of a tab strip with nothing selected.
    const isSubscreen = !SCREENS[id].tab
    nav.hidden = isSubscreen
    subheader.hidden = !isSubscreen
    if (isSubscreen) {
      subIcon.replaceWith((subIcon = icon(SCREENS[id].icon, "aw-i14")))
      subLabel.textContent = SCREENS[id].label
      subTest.hidden = id !== "endpoints"
    }
    // Reset the shared chrome before the screen renders; screens override it via ctx.chrome.
    backTo = () => go("home")
    back.setAttribute("aria-label", "Back to Home")
    footer.replaceChildren(status)
    body.replaceChildren(renderScreen(ctx, id))
    body.setAttribute("aria-label", `${SCREENS[id].label} content`)
    body.scrollTop = 0
    body.scrollLeft = 0
    // Keep persistent navigation focused; a replaced screen's controls no longer exist.
    if (host.isConnected && (!focused || !focused.isConnected)) body.focus({ preventScroll: true })
  }

  // Position: fixed host, viewport-clamped, kept on both drag handles.
  const position = { x: 0, y: 0 }
  const place = (x: number, y: number) => {
    const box = host.getBoundingClientRect()
    position.x = Math.min(Math.max(x, 8), Math.max(8, window.innerWidth - box.width - 8))
    position.y = Math.min(Math.max(y, 8), Math.max(8, window.innerHeight - box.height - 8))
    host.style.left = `${position.x}px`
    host.style.top = `${position.y}px`
  }
  const draggable = (handle: HTMLElement) => {
    let offsetX = 0,
      offsetY = 0,
      dragging = false
    handle.addEventListener(
      "pointerdown",
      (event) => {
        if (
          event.button !== 0 ||
          (event.target as Element).closest("button,input,select,textarea,a")
        )
          return
        dragging = true
        offsetX = event.clientX - position.x
        offsetY = event.clientY - position.y
        handle.setPointerCapture(event.pointerId)
        handle.classList.add("aw-dragging")
        event.preventDefault()
      },
      { signal },
    )
    handle.addEventListener(
      "pointermove",
      (event) => {
        if (dragging) place(event.clientX - offsetX, event.clientY - offsetY)
      },
      { signal },
    )
    const stop = (event: PointerEvent) => {
      dragging = false
      handle.classList.remove("aw-dragging")
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
    }
    handle.addEventListener("pointerup", stop, { signal })
    handle.addEventListener("pointercancel", stop, { signal })
  }
  draggable(header)
  draggable(launcher)

  // Resize: one grip per edge and corner. A grip that moves the panel's left or top edge has to
  // move the host by the same amount, since the host is anchored by left/top.
  const grip = (edge: string) => {
    const handle = el("div", `aw-rs aw-rs-${edge}`)
    let active = false
    let startX = 0,
      startY = 0,
      startW = 0,
      startH = 0,
      left = 0,
      top = 0,
      minW = 0,
      minH = 0,
      maxW = 0,
      maxH = 0
    handle.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button !== 0) return
        const box = panel.getBoundingClientRect()
        const style = getComputedStyle(panel)
        startX = event.clientX
        startY = event.clientY
        startW = box.width
        startH = box.height
        left = position.x
        top = position.y
        minW = parseFloat(style.minWidth)
        minH = parseFloat(style.minHeight)
        // Growing west or north can only eat the gap to that viewport edge; growing east or
        // south, the gap to the opposite one. Without this the panel would grow off-screen and
        // place() would then slide it back under the pointer.
        maxW = Math.min(
          parseFloat(style.maxWidth),
          edge.includes("w") ? left + startW - 8 : window.innerWidth - left - 8,
        )
        maxH = Math.min(
          parseFloat(style.maxHeight),
          edge.includes("n") ? top + startH - 8 : window.innerHeight - top - 8,
        )
        active = true
        handle.setPointerCapture(event.pointerId)
        event.preventDefault()
      },
      { signal },
    )
    handle.addEventListener(
      "pointermove",
      (event) => {
        if (!active) return
        const dx = event.clientX - startX
        const dy = event.clientY - startY
        const width = edge.includes("e") ? startW + dx : edge.includes("w") ? startW - dx : startW
        const height = edge.includes("s") ? startH + dy : edge.includes("n") ? startH - dy : startH
        const w = Math.min(Math.max(width, minW), maxW)
        const h = Math.min(Math.max(height, minH), maxH)
        panel.style.width = `${w}px`
        panel.style.height = `${h}px`
        // Clamped sizes drive the move, so hitting a limit pins the edge instead of drifting.
        place(
          edge.includes("w") ? left + startW - w : left,
          edge.includes("n") ? top + startH - h : top,
        )
      },
      { signal },
    )
    const stopResize = (event: PointerEvent) => {
      active = false
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
    }
    handle.addEventListener("pointerup", stopResize, { signal })
    handle.addEventListener("pointercancel", stopResize, { signal })
    return handle
  }
  panel.append(...["n", "e", "s", "w", "nw", "ne", "sw", "se"].map(grip))
  window.addEventListener("resize", () => place(position.x, position.y), { signal })

  function apply() {
    for (const control of profileMenus) control.close()
    const state = store.state
    panel.hidden = state.minimized
    launcher.hidden = !state.minimized
    place(position.x, position.y)
  }

  const unsubscribe = store.subscribe((state) => {
    const paused = state.paused.length
    counter.textContent =
      `${state.observed} request${state.observed === 1 ? "" : "s"} observed · ${location.origin}` +
      (paused ? ` · ${paused} paused` : "")
    const active = [
      state.moduleActive.mock && "Mock",
      state.moduleActive.intercept && "Intercept",
      state.moduleActive.route && "Route",
      state.moduleActive.chaos && "Chaos",
    ].filter(Boolean)
    // A paused request is the launcher's headline: the page is waiting on the user, not on a rule.
    launcherLabel.textContent = paused
      ? `${paused} request${paused === 1 ? "" : "s"} paused`
      : active.length
        ? `${active.join(" + ")} active`
        : "No active modules"
    launcherState.title = paused
      ? `${launcherLabel.textContent} — restore the panel to continue or abort`
      : (launcherLabel.textContent ?? "")
    launcherDot.className = paused || active.length ? "aw-dot aw-a" : "aw-dot"
    syncProfiles()
  })

  return {
    host,
    mount() {
      syncProfiles()
      go(store.state.screen)
      counter.textContent = `0 requests observed · ${location.origin}`
      document.documentElement.append(host)
      const box = host.getBoundingClientRect()
      place(window.innerWidth - box.width - 16, 16)
    },
    restore() {
      restore()
      place(position.x, position.y)
    },
    destroy() {
      listeners.abort()
      screenListeners.abort()
      unsubscribe()
      for (const dispose of screenWatchers.splice(0)) dispose()
      host.remove()
    },
  }
}
