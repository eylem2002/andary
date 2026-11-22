// Type definitions for the HUD (JSDoc only, no runtime code). The world's shape mirrors
// docs/CONTRACTS.md §6; the HUD treats store state as read-only.

// The store's shapes are defined once, in core/store.js (CONTRACTS §5.1); the HUD reads them.
/** @typedef {import('../core/store.js').LogEntry} LogEntry */
/** @typedef {import('../core/store.js').Session} Session */
/** @typedef {import('../core/store.js').AgentState} AgentState */
/** @typedef {import('../core/store.js').Approval} Approval */
/** @typedef {import('../core/achievements.js').Achievement} Achievement */
/** @typedef {import('../core/store.js').StoreState} StoreState */
/** @typedef {import('../core/store.js').AgentUsage} AgentUsage */
/** @typedef {import('../core/store.js').StoreChange} StoreChange */
/** @typedef {import('../core/store.js').Store} Store */

/** @typedef {{ type: 'agent', id: string } | { type: 'building', key: string }} Selection */

/**
 * The subset of the World facade (CONTRACTS §6) the HUD calls.
 * @typedef {object} World
 * @property {(paused: boolean) => void} setPaused
 * @property {(q: 'high'|'low') => void} setQuality
 * @property {(h: number|'auto') => void} setTimeOfDay
 * @property {(w: import('../core/town-weather.js').TownWeather) => void} [setTownWeather]
 * @property {(ids: string[], options?: { grow?: boolean }) => void} [setLandmarks]
 * @property {() => number} getTimeOfDay
 * @property {(on: boolean) => void} setReducedMotion
 * @property {(mode: 'auto'|'always'|'off') => void} [setPlaceNames]
 * @property {(id: string, opts?: { follow?: boolean, zoom?: number }) => void} focusAgent
 * @property {(key: string) => void} focusBuilding
 * @property {() => void} stopFollow
 * @property {() => void} resetCamera
 * @property {(dir: 1|-1) => void} rotateCamera
 * @property {(factor: number) => void} zoomBy
 * @property {(event: 'select'|'hover', cb: (sel: Selection|null) => void) => () => void} on
 * @property {(sel: Selection|null) => void} select
 * @property {(id: string) => boolean} hasAgent
 */

/**
 * What the HUD asks of the app shell (main.js).
 * @typedef {object} Controls
 * @property {(id: string, decision: 'allow'|'deny', message?: string, always?: number, stop?: boolean) => boolean} decide  `message`: why,
 *   for a denial; `always`: with an allow, the index of the suggestion to save ("Allow always"); `stop`: with a
 *   denial, stop the agent too ("Deny and stop")
 * @property {(sessionId: string, agentId: string|null, text: string) => boolean} sendNote  a note for one agent's
 *   next step (§4.15); false when it cannot be sent (not connected, or the demo)
 * @property {(on: boolean) => void} setRemoteApprovals
 * @property {() => void} startDemo
 * @property {() => void} leaveDemo
 * @property {(paused: boolean) => void} setPaused
 * @property {(speed: 1|2|4) => void} setSpeed
 * @property {() => boolean} notifyTest   asks the server for a test phone notification
 * @property {(since: number) => boolean} requestDigest  asks what each crew did since a time (Catch me up); false when it cannot be asked
 */

/**
 * @typedef {'connecting'|'live'|'offline'|'signin'|'demo'} ConnectionStatus
 */

/**
 * View state the HUD keeps beside the store.
 * @typedef {object} ViewState
 * @property {'live'|'demo'} mode
 * @property {ConnectionStatus} connection
 * @property {boolean} serverAvailable     an Andary server answered (live mode is possible)
 * @property {boolean} demoForced          the URL asked for the demo (?demo=1), e.g. `andary demo`
 * @property {boolean} hosted              a demo on a static host, with no server to connect to
 * @property {boolean} worldFailed         the 3D town could not start (no WebGL); the panels stay
 * @property {{ remoteApprovals?: boolean, approvalTimeoutMs?: number, notify?: boolean, notifyLimits?: boolean, notifyUrl?: string|null, team?: { role: 'owner'|'viewer', members: string[] }|null }} serverSettings
 * @property {{ points: number, days: string[] }|null} progress  the town's growth (§4.9)
 * @property {import('../core/limits.js').AccountLimits[]} limits  plan limits from the andary-limits mod (§4.14)
 * @property {Selection|null} selection
 * @property {boolean} follow
 * @property {boolean} paused
 * @property {boolean} mobile
 * @property {boolean} sheetOpen
 * @property {string} tab
 */

/**
 * Everything a HUD component needs, passed to each create* function.
 * @typedef {object} HudContext
 * @property {Store} store
 * @property {import('./prefs.js').Prefs} prefs
 * @property {(patch: Partial<import('./prefs.js').Prefs>) => void} setPrefs
 * @property {ViewState} view
 * @property {() => World|null} world
 * @property {Controls} controls
 * @property {(sel: Selection|null, opts?: { camera?: boolean, from?: 'hud'|'world', focus?: boolean }) => void} select
 * @property {(on?: boolean) => void} setFollow
 * @property {(tab: string, opts?: { focus?: boolean }) => void} showTab
 * @property {(name: import('./hud-actions.js').DialogName) => void} openDialog
 * @property {(agentKey: string, changeId: string) => void} showDiff  opens a change's diff
 * @property {(action: string) => void} run   runs a toolbar/shortcut action by name
 * @property {ReturnType<typeof import('./sound.js').createSound>} sound
 * @property {ReturnType<typeof import('./announcer.js').createAnnouncer>} announcer
 * @property {ReturnType<typeof import('./toasts.js').createToasts>} toasts
 * @property {() => void} refresh   re-renders view-dependent parts (toolbar, masthead, panels)
 * @property {ReturnType<typeof import('./cinema.js').createCinema>} cinema   the director camera
 * @property {ReturnType<typeof import('./needs-you.js').createNeedsYou>} needsYou  what needs the viewer (core/attention.js)
 * @property {(item: import('../core/attention.js').AttentionItem) => void} goToNeed  goes to one thing that needs the viewer
 * @property {ReturnType<typeof import('./catch-up.js').createCatchUp>} catchUp  Catch me up: the dialog and the masthead's offer
 */

export {};
