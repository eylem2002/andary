// Type definitions for the HUD (JSDoc only, no runtime code). The store and world shapes mirror
// docs/CONTRACTS.md §5.1 and §6; the HUD treats store state as read-only.

/**
 * @typedef {object} LogEntry
 * @property {string|number} id
 * @property {number} ts
 * @property {string} sessionId
 * @property {string} agentKey
 * @property {string} agentName
 * @property {string} color
 * @property {string} kind
 * @property {string} [icon]
 * @property {string} text
 * @property {'info'|'success'|'warn'|'error'} level
 */

/**
 * @typedef {object} Session
 * @property {string} id
 * @property {string} project
 * @property {string} cwd
 * @property {string} [title]
 * @property {string} color
 * @property {string} [model]
 * @property {string} [permissionMode]
 * @property {'working'|'waiting'|'idle'|'ended'} status
 * @property {string} [goal]
 * @property {number} startedAt
 * @property {number} lastActivity
 * @property {string[]} agentKeys
 * @property {{ text: string, status: 'pending'|'in_progress'|'completed' }[]} todos
 * @property {{ id: string, subject: string, status: 'pending'|'in_progress'|'completed', owner?: string }[]} tasks
 * @property {string|null} [member]  the teammate whose session this is, in a team town
 */

/**
 * @typedef {object} AgentState
 * @property {string} key
 * @property {string} sessionId
 * @property {string|null} agentId
 * @property {string} name
 * @property {'lead'|'subagent'|'teammate'} role
 * @property {string} type
 * @property {string} color
 * @property {string} [hat]
 * @property {'working'|'waiting'|'idle'|'error'|'done'} status
 * @property {string} building
 * @property {string} activity
 * @property {string} [currentTool]
 * @property {string} [summary]
 * @property {string} [description]
 * @property {number} startedAt
 * @property {number} lastActivity
 * @property {Record<string, number>} toolCounts
 * @property {string[]} files
 * @property {{ id: string, path: string, tool: string, ts: number, whole: boolean, hunks: { before: string, after: string }[] }[]} [changes]
 * @property {LogEntry[]} recent
 * @property {number} errors
 * @property {string} [lastMessage]
 */

/**
 * @typedef {object} Approval
 * @property {string} id
 * @property {'pending'|'allowed'|'denied'|'expired'|'resolved'} status
 * @property {boolean} held
 * @property {string} sessionId
 * @property {string|null} agentId
 * @property {string} toolName
 * @property {any} toolInput
 * @property {string} [cwd]
 * @property {number} createdAt
 * @property {number|null} expiresAt
 * @property {'town'|'terminal'|'timeout'} [decidedBy]
 * @property {string} [message]
 */

/**
 * @typedef {object} Achievement
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {number} unlockedAt
 */

/**
 * @typedef {object} StoreState
 * @property {Session[]} sessions
 * @property {Record<string, AgentState>} agents
 * @property {Approval[]} approvals
 * @property {LogEntry[]} log
 * @property {{ events: number, toolCalls: number, failures: number, approvals: number, subagents: number, byBuilding: Record<string, number> }} stats
 * @property {Achievement[]} achievements
 * @property {Record<string, AgentUsage>} usage
 * @property {{ date: string, tokens: number, costUsd: number }[]} usageDays
 */

/**
 * @typedef {object} AgentUsage
 * @property {{ input: number, output: number, cacheRead: number, cacheWrite: number }} tokens
 * @property {number} costUsd
 * @property {boolean} unpriced
 * @property {string|null} model
 */

/**
 * @typedef {{ type: 'event', event: { kind: string, ts: number, sessionId: string, agentKey: string } }
 *   | { type: 'approval', approval: Approval }
 *   | { type: 'achievement', achievement: Achievement }
 *   | { type: 'usage', agentKey: string }
 *   | { type: 'reset' }} StoreChange
 */

/**
 * @typedef {object} Store
 * @property {(envelope: object) => object[]} ingest
 * @property {(approval: Approval) => void} setApproval
 * @property {(record: unknown, days?: unknown) => void} setUsage
 * @property {(listener: (change: StoreChange) => void) => () => void} subscribe
 * @property {() => StoreState} getState
 * @property {() => void} reset
 */

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
 * @property {(id: string, decision: 'allow'|'deny') => boolean} decide
 * @property {(on: boolean) => void} setRemoteApprovals
 * @property {() => void} startDemo
 * @property {() => void} leaveDemo
 * @property {(paused: boolean) => void} setPaused
 * @property {(speed: 1|2|4) => void} setSpeed
 * @property {() => boolean} notifyTest   asks the server for a test phone notification
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
 * @property {{ remoteApprovals?: boolean, approvalTimeoutMs?: number, notify?: boolean, notifyUrl?: string|null, team?: { role: 'owner'|'viewer', members: string[] }|null }} serverSettings
 * @property {{ points: number, days: string[] }|null} progress  the town's growth (§4.9)
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
 * @property {(name: 'help'|'settings'|'setup'|'diff'|'usage'|'leaderboard') => void} openDialog
 * @property {(agentKey: string, changeId: string) => void} showDiff  opens a change's diff
 * @property {(action: string) => void} run   runs a toolbar/shortcut action by name
 * @property {ReturnType<typeof import('./sound.js').createSound>} sound
 * @property {ReturnType<typeof import('./announcer.js').createAnnouncer>} announcer
 * @property {ReturnType<typeof import('./toasts.js').createToasts>} toasts
 * @property {() => void} refresh   re-renders view-dependent parts (toolbar, masthead, panels)
 * @property {ReturnType<typeof import('./cinema.js').createCinema>} cinema   the director camera
 */

export {};
