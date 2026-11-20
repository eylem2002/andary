// The director turns TownEvents into choreography in the 3D world (CONTRACTS.md §6): who walks
// where, what they do there and what they say. Each agent has a small queue of building visits so
// a burst of fast tool calls never turns into minutes of walking: agents run when they fall behind,
// teleport when far behind (merging repeated visits), and the queue is capped. Speech is throttled
// per agent and mixes plain information with jokes from humor.js.
//
// Events older than HISTORIC_MS (history replayed when a browser connects) only place agents;
// they play no effects and say nothing.

import { modelLabel } from './catalog.js';
import { agentKeyOf, normalizeAgentId } from './ids.js';
import { clip, oneLine, own, str } from './text.js';
import * as defaultHumor from './humor.js';
import { agentState, contextFor, enqueue, makeVisit, pump, release, say, scoped, sessionOf, settle, wake } from './director-queue.js';

/** @typedef {import('./catalog.js').BuildingKey} BuildingKey */
/** @typedef {import('./events.js').TownEvent} TownEvent */
/** @typedef {import('./store.js').StoreState} StoreState */
/** @typedef {import('./store.js').StoreChange} StoreChange */
/** @typedef {import('./store.js').AgentState} AgentState */
/** @typedef {import('./store.js').Approval} Approval */
/** @typedef {import('./achievements.js').Achievement} Achievement */

/**
 * The World facade methods the director drives (CONTRACTS.md §6).
 * @typedef {object} WorldApi
 * @property {(spec: object) => void} addAgent
 * @property {(id: string, patch: object) => void} updateAgent
 * @property {(id: string, opts?: object) => Promise<void>|void} removeAgent
 * @property {(id: string, key: string, opts?: object) => Promise<boolean>|boolean|void} goTo
 * @property {(id: string, activity: string) => void} setActivity
 * @property {(id: string, status: string) => void} setStatus
 * @property {(id: string, text: string, opts?: object) => void} say
 * @property {(id: string, emoji: string) => void} emote
 * @property {(id: string, text: string|null) => void} setBadge
 * @property {(id: string, kind: 'rain'|'storm'|null) => void} weather
 * @property {(kind: string, at: object, opts?: object) => void} effect
 * @property {(fromId: string, to: object) => Promise<void>|void} sendMessage
 * @property {(kind: string, action?: string) => void} vehicle
 * @property {(key: string, text: string|null) => void} setBuildingStat
 * @property {(key: string, color?: string) => void} pulseBuilding
 * @property {(items: {text: string, status: string}[], title?: string) => void} setBoard
 * @property {(level: number) => void} setNodeModules
 * @property {(id: string, label: string) => void} addWorktree
 * @property {(id: string) => void} removeWorktree
 */

/**
 * @typedef {object} DirectorOptions
 * @property {object} world  the World facade (§6); methods are looked up per call, so a world that
 *   is still loading, a fake one, or one missing a method never breaks the director
 * @property {{subscribe: (listener: (change: StoreChange) => void) => () => void, getState: () => StoreState}} store
 * @property {{quip: (situation: string, context?: Record<string, unknown>, random?: () => number) => string}} [humor]
 * @property {() => number} [random]
 * @property {() => number} [now]
 * @property {(fn: () => void, ms: number) => unknown} [setTimer]
 * @property {(handle: unknown) => void} [clearTimer]
 * @property {StoreChange[]|null} [backlog]  the store's changes from before the director started
 *   (recordChanges), played in order so the town misses none of them; without one, agents already
 *   in the store are placed without ceremony
 */

/**
 * One building visit in an agent's queue.
 * @typedef {object} Visit
 * @property {BuildingKey} building
 * @property {'tool'|'permit'|'idle'|'spa'|'hall'} kind
 * @property {string|null} tool
 * @property {Set<string>} toolUseIds  tool calls this visit stands for (several once merged)
 * @property {() => void} arrive        reaction on arrival (the latest wins when visits merge)
 * @property {(() => void)[]} settles  tool results that came in before the agent got there
 * @property {boolean} arrived
 * @property {boolean} hold            keep the agent here until released (permit office, spa)
 * @property {boolean} historic        queued by a replayed event: travel by teleport
 */

/**
 * What the director remembers about an agent in the world.
 * @typedef {object} Runtime
 * @property {string} key
 * @property {string} sessionId
 * @property {string} name
 * @property {string} role
 * @property {string} type
 * @property {string} color
 * @property {Visit[]} queue
 * @property {Visit|null} current
 * @property {boolean} walking
 * @property {'walk'|'run'|'teleport'} pace  pace of the current walk
 * @property {number} walkSeq     bumps on every goTo so a superseded walk's answer is ignored
 * @property {BuildingKey} at
 * @property {number} arrivedAt
 * @property {'run'|'teleport'|null} rush  catch-up pace while behind; cleared once caught up
 * @property {unknown} pumpTimer
 * @property {unknown} sayTimer
 * @property {{line: string, style: object}[]} speech  important lines waiting for the gap
 * @property {unknown} sleepTimer
 * @property {unknown} leaveTimer
 * @property {unknown[]} nagTimers
 * @property {number} lastSayAt
 * @property {boolean} idle
 * @property {boolean} sleeping
 * @property {'permit'|'spa'|null} holdReason  why the agent is held, until released
 * @property {boolean} leaving
 * @property {string|null} comboTool
 * @property {number} comboCount
 * @property {number} failStreak
 * @property {'rain'|'storm'|null} weather
 * @property {string|null} status  last status sent to the world
 * @property {string|null} badge   last badge sent to the world
 */

const SLEEP_AFTER_MS = 120_000;
/** Store changes kept for a director that has not started yet; past this, it catches up from the state. */
const MAX_BACKLOG = 5000;
const NAG_AFTER_MS = Object.freeze([15_000, 40_000, 80_000, 150_000]);
const HISTORIC_MS = 30_000;

/**
 * Whether an event was already old when it arrived (history replayed to a new tab): such events
 * place agents but are not news. Shared with the director camera (ui/shots.js).
 * @param {{ ts?: number, rx?: number }} event
 * @param {number} now
 */
export function isHistoric(event, now) {
  const at = Number(event.rx ?? event.ts);
  return Number.isFinite(at) && now - at > HISTORIC_MS;
}
const INFORMATIVE_SHARE = 0.6;
const LEAVE_DELAY_MS = 1500;
const BOAT_GAP_MS = 20_000;
const BOAT_CHANCE = 0.35;
const SHORT_GOAL = 40;

const WORLD_METHODS = Object.freeze([
  'addAgent',
  'updateAgent',
  'removeAgent',
  'goTo',
  'setActivity',
  'setStatus',
  'say',
  'emote',
  'setBadge',
  'weather',
  'effect',
  'sendMessage',
  'vehicle',
  'setBuildingStat',
  'pulseBuilding',
  'setBoard',
  'setNodeModules',
  'addWorktree',
  'removeWorktree',
]);

/** Effects a building plays when an agent starts work there. */
const BUILDING_EFFECTS = Object.freeze({
  library: 'books',
  workshop: 'sparks',
  terminal: 'smoke',
  detective: 'magnify',
  web: 'signal',
  harbor: 'signal',
  academy: 'bulb',
  spa: 'steam',
});

/** "42 reads": what one unit of work is called at each building. */
const STAT_UNITS = Object.freeze({
  hall: ['briefing', 'briefings'],
  library: ['read', 'reads'],
  workshop: ['edit', 'edits'],
  terminal: ['command', 'commands'],
  detective: ['search', 'searches'],
  web: ['fetch', 'fetches'],
  board: ['update', 'updates'],
  post: ['delivery', 'deliveries'],
  harbor: ['shipment', 'shipments'],
  permits: ['permit', 'permits'],
  spa: ['session', 'sessions'],
  academy: ['lesson', 'lessons'],
  cafe: ['coffee', 'coffees'],
  grove: ['tree', 'trees'],
  station: ['arrival', 'arrivals'],
});

const SPAWN_SITUATIONS = Object.freeze({ Explore: 'spawn.explore', Plan: 'spawn.plan', 'general-purpose': 'spawn.general' });
const STOP_SITUATIONS = Object.freeze({ rate_limit: 'stop.rate_limit', overloaded: 'stop.overloaded' });
const LEAD_ALIASES = new Set(['lead', 'team-lead', 'team lead', 'main', 'foreman', 'leader', 'manager']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/** Events that do not end a hold (permit office, spa): the ones that create or extend it. */
const KEEPS_HOLD = new Set(['permission.request', 'notify', 'compact.start']);
/** Events that mean an agent is active again (it leaves the café, wakes up). */
const WAKES = new Set(['prompt', 'tool.start', 'permission.request', 'compact.start', 'spawn.request', 'message.send']);

/** @typedef {ReturnType<typeof createContext>} Director */

/**
 * Wraps the world so a missing method or a throwing call never breaks the director.
 * @param {object} world
 * @param {(error: unknown) => void} report
 * @returns {WorldApi}
 */
function safeWorld(world, report) {
  /** @type {Record<string, (...args: any[]) => any>} */
  const facade = {};
  for (const name of WORLD_METHODS) {
    facade[name] = (...args) => {
      const method = /** @type {any} */ (world)?.[name];
      if (typeof method !== 'function') return undefined;
      try {
        return method.apply(world, args);
      } catch (error) {
        report(error);
        return undefined;
      }
    };
  }
  return /** @type {WorldApi} */ (/** @type {unknown} */ (facade));
}

/** @param {DirectorOptions} options */
function createContext(options) {
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(/** @type {any} */ (handle)));
  const humor = options.humor ?? defaultHumor;
  const random = options.random ?? Math.random;
  const report = (/** @type {unknown} */ error) => console.error('andary director', error);
  /** @type {Set<unknown>} */
  const timers = new Set();
  const d = {
    world: safeWorld(options.world, report),
    store: options.store,
    random,
    now: options.now ?? Date.now,
    report,
    timers,
    clearTimer,
    /** @param {string} situation @param {Record<string, unknown>} [context] */
    quip: (situation, context) => humor.quip(situation, context, random),
    /** True while handling an event replayed from history: place agents, but no show. */
    historic: false,
    /** Whether the latest event was historic (achievement changes follow their event). */
    lastHistoric: false,
    disposed: false,
    /** @type {Map<string, Runtime>} */
    crew: new Map(),
    /** @type {string|null} agent of the latest event, credited with achievements */
    lastAgentKey: null,
    /** @type {string|null} session whose todos/tasks the Goal Board shows */
    boardSession: null,
    /** @type {Map<string, string>} worktree id → sessionId */
    worktrees: new Map(),
    installs: 0,
    /** @type {Map<string, number>} MCP server → last boat trip */
    boats: new Map(),
    /** @type {Map<string, number>} sessionId → completed todos last seen */
    todoDone: new Map(),
    /**
     * Runs fn later, outside any event (so never "historic").
     * @param {() => void} fn
     * @param {number} ms
     */
    later(fn, ms) {
      const handle = setTimer(() => {
        timers.delete(handle);
        if (!d.disposed) scoped(d, false, fn)();
      }, Math.max(0, ms));
      timers.add(handle);
      return handle;
    },
    /** @param {unknown} handle */
    cancel(handle) {
      if (handle == null) return;
      clearTimer(handle);
      timers.delete(handle);
    },
  };
  return d;
}

// ---------------------------------------------------------------------------------------------
// Agents in the world.

/**
 * @param {AgentState} agent
 * @param {BuildingKey} at
 * @returns {Runtime}
 */
function newRuntime(agent, at) {
  return {
    key: agent.key,
    sessionId: agent.sessionId,
    name: agent.name,
    role: agent.role,
    type: agent.type,
    color: agent.color,
    queue: [],
    current: null,
    walking: false,
    pace: 'walk',
    walkSeq: 0,
    at,
    arrivedAt: -Infinity,
    rush: null,
    pumpTimer: null,
    sayTimer: null,
    speech: [],
    sleepTimer: null,
    leaveTimer: null,
    nagTimers: [],
    lastSayAt: -Infinity,
    idle: false,
    sleeping: false,
    holdReason: null,
    leaving: false,
    comboTool: null,
    comboCount: 0,
    failStreak: 0,
    weather: null,
    status: null,
    badge: null,
  };
}

/**
 * Puts a store agent into the world.
 * @param {Director} d
 * @param {string} key
 * @param {{spawnAt: BuildingKey, entrance: 'portal'|'bus'|'pop'|'none'}} placement
 */
function addToWorld(d, key, { spawnAt, entrance }) {
  const existing = d.crew.get(key);
  if (existing) return existing;
  const agent = agentState(d, key);
  if (!agent || agent.status === 'done') return null;
  const rt = newRuntime(agent, spawnAt);
  d.crew.set(key, rt);
  const { name, color, role, type, hat } = agent;
  d.world.addAgent({ id: key, name, color, role, type, hat, spawnAt, entrance: d.historic ? 'none' : entrance });
  return rt;
}

/**
 * The runtime for an event's agent, adding the agent first if the town has not seen it yet
 * (the town opened mid-session). Leaving agents get no new work.
 * @param {Director} d
 * @param {string} key
 */
function ensure(d, key) {
  const rt = d.crew.get(key);
  if (rt) return rt.leaving ? null : rt;
  const agent = agentState(d, key);
  if (!agent) return null;
  return addToWorld(d, key, { spawnAt: 'hall', entrance: agent.role === 'lead' ? 'pop' : 'portal' });
}

/**
 * Stops an agent's pending plans. Queued speech is kept unless `silence` is set, so a helper's
 * last report still shows while it walks out.
 * @param {Director} d
 * @param {Runtime} rt
 * @param {{silence?: boolean}} [opts]
 */
function cancelTimers(d, rt, opts = {}) {
  for (const handle of [rt.pumpTimer, rt.sleepTimer, rt.leaveTimer, ...rt.nagTimers]) d.cancel(handle);
  rt.pumpTimer = rt.sleepTimer = rt.leaveTimer = null;
  rt.nagTimers = [];
  if (!opts.silence) return;
  d.cancel(rt.sayTimer);
  rt.sayTimer = null;
  rt.speech = [];
}

/**
 * Walks an agent to a building, then removes it with the given exit.
 * @param {Director} d
 * @param {Runtime} rt
 * @param {'portal'|'bus'|'poof'} exit
 * @param {number} delay
 */
function retire(d, rt, exit, delay) {
  cancelTimers(d, rt);
  rt.queue = [];
  rt.leaving = true;
  const historic = d.historic;
  const exitWorld = () => {
    if (d.disposed) return;
    if (exit === 'bus' && !historic) d.world.vehicle('bus', 'depart');
    const forget = () => {
      if (d.crew.get(rt.key) === rt) d.crew.delete(rt.key);
    };
    Promise.resolve(d.world.removeAgent(rt.key, { exit })).then(forget, forget);
  };
  const walkOut = () => {
    if (exit === 'poof') return exitWorld();
    const target = exit === 'bus' ? 'station' : 'hall';
    rt.walkSeq += 1;
    const trip = rt.at === target ? true : d.world.goTo(rt.key, target, { pace: historic ? 'teleport' : 'walk' });
    Promise.resolve(trip).then(exitWorld, exitWorld);
  };
  if (delay > 0) rt.leaveTimer = d.later(walkOut, delay);
  else walkOut();
}

// ---------------------------------------------------------------------------------------------
// Small world helpers.

/** Status pill, sent only when it changes. @param {Director} d @param {Runtime} rt @param {string} status */
function setStatus(d, rt, status) {
  if (rt.status === status) return;
  rt.status = status;
  d.world.setStatus(rt.key, status);
}

/** Combo chip, sent only when it changes. @param {Director} d @param {Runtime} rt @param {string|null} badge */
function setBadge(d, rt, badge) {
  if (rt.badge === badge) return;
  rt.badge = badge;
  d.world.setBadge(rt.key, badge);
}

/** @param {Director} d @param {Runtime} rt @param {'rain'|'storm'} kind */
function setWeather(d, rt, kind) {
  if (rt.weather === kind || (rt.weather === 'storm' && kind === 'rain')) return;
  rt.weather = kind;
  d.world.weather(rt.key, kind);
}

/** @param {Director} d @param {Runtime} rt */
function clearWeather(d, rt) {
  if (!rt.weather) return;
  rt.weather = null;
  d.world.weather(rt.key, null);
}

/** @param {Director} d @param {BuildingKey} building */
function updateBuildingStat(d, building) {
  const count = d.store.getState().stats.byBuilding?.[building] ?? 0;
  const units = own(STAT_UNITS, building);
  if (!count || !units) return;
  d.world.setBuildingStat(building, `${count} ${count === 1 ? units[0] : units[1]}`);
}

/** @param {Runtime} rt @param {string} tool @returns {number} how many times in a row */
function bumpCombo(rt, tool) {
  rt.comboCount = rt.comboTool === tool ? rt.comboCount + 1 : 1;
  rt.comboTool = tool;
  return rt.comboCount;
}

/**
 * The Goal Board shows the todos (or shared tasks) of the most recently active session.
 * @param {Director} d
 * @param {string|null} sessionId  session that just changed, or null to pick another
 */
function refreshBoard(d, sessionId) {
  const sessions = d.store.getState().sessions.filter((s) => s.status !== 'ended');
  const session =
    sessions.find((s) => s.id === sessionId) ??
    sessions.filter((s) => s.tasks.length || s.todos.length).sort((a, b) => b.lastActivity - a.lastActivity)[0];
  if (!session) {
    d.boardSession = null;
    d.world.setBoard([], undefined);
    return;
  }
  d.boardSession = session.id;
  const useTasks = session.tasks.length > 0;
  const items = useTasks ? session.tasks.map((t) => ({ text: t.subject, status: t.status })) : session.todos;
  d.world.setBoard(items.slice(0, 12), `${session.project} · ${useTasks ? 'tasks' : 'todos'}`);
}

/** @param {Director} d @param {string} sessionId @param {string} [prefix] */
function removeWorktrees(d, sessionId, prefix = '') {
  for (const [id, owner] of d.worktrees) {
    if (owner !== sessionId || !id.startsWith(`${sessionId}:wt:${prefix}`)) continue;
    d.worktrees.delete(id);
    d.world.removeWorktree(id);
  }
}

/** @param {Director} d @param {string} id @param {string} sessionId @param {string} label */
function plantWorktree(d, id, sessionId, label) {
  if (d.worktrees.has(id)) return;
  d.worktrees.set(id, sessionId);
  d.world.addWorktree(id, clip(oneLine(label), 28) || 'worktree');
}

/** The agent a SendMessage goes to: a crew member by name, or the lead by its usual aliases. */
/** @param {Director} d @param {string} sessionId @param {unknown} to */
function recipientKey(d, sessionId, to) {
  const name = oneLine(to).toLowerCase();
  if (!name) return null;
  if (LEAD_ALIASES.has(name)) return agentKeyOf(sessionId, null);
  const session = sessionOf(d, sessionId);
  const agents = d.store.getState().agents;
  const key = session?.agentKeys.find((k) => agents[k]?.name.toLowerCase() === name);
  return key && d.crew.has(key) ? key : null;
}

// ---------------------------------------------------------------------------------------------
// Tool calls.

/** @param {TownEvent} e */
function arrivalSituation(e) {
  const { tool, building, commandKind } = e.data;
  if (commandKind) return `cmd.${commandKind}`;
  if (tool === 'Write' || tool === 'NotebookEdit') return 'arrive.write';
  return `arrive.${building}`;
}

/** Extra show for particular tools and commands when an agent arrives to use them. */
/** @type {ReadonlyArray<(d: Director, rt: Runtime, e: TownEvent) => void>} */
const ARRIVAL_EXTRAS = Object.freeze([
  (d, rt, e) => {
    if (e.data.commandKind === 'install' || e.data.commandKind === 'deps') d.world.effect('boxes', { building: e.data.building });
  },
  (d, rt, e) => {
    if (e.data.commandKind === 'rm-rf') d.world.emote(rt.key, '😬');
    if (e.data.commandKind === 'docker') d.world.emote(rt.key, '🐳');
  },
  (d, rt, e) => {
    const server = e.data.mcpServer;
    if (!server) return;
    const last = d.boats.get(server);
    const due = last === undefined || (d.now() - last > BOAT_GAP_MS && d.random() < BOAT_CHANCE);
    if (!due) return;
    d.boats.set(server, d.now());
    d.world.vehicle('boat', 'trip');
  },
  (d, rt, e) => {
    if (e.data.tool === 'AskUserQuestion') d.world.emote(rt.key, '❓');
    if (e.data.tool === 'Skill') d.world.emote(rt.key, '🎓');
  },
]);

/** @param {Director} d @param {Runtime} rt @param {TownEvent} e */
function arriveForTool(d, rt, e) {
  const { building, activity, tool, summary } = e.data;
  d.world.setActivity(rt.key, activity);
  if (d.historic) return;
  d.world.pulseBuilding(building, rt.color);
  const effect = own(BUILDING_EFFECTS, building);
  if (effect) d.world.effect(effect, { building });
  for (const extra of ARRIVAL_EXTRAS) extra(d, rt, e);
  if (d.random() < INFORMATIVE_SHARE) say(d, rt, summary, { tone: SHELL_TOOLS.has(tool) ? 'code' : 'speech' });
  else say(d, rt, d.quip(arrivalSituation(e), contextFor(d, rt, e)));
}

/** @param {Director} d @param {TownEvent} e */
function onToolStart(d, e) {
  const rt = ensure(d, e.agentKey);
  if (!rt) return;
  setStatus(d, rt, e.data.tool === 'AskUserQuestion' ? 'waiting' : 'working');
  if (e.data.tool === 'EnterWorktree') {
    plantWorktree(d, `${e.sessionId}:wt:enter:${oneLine(e.data.input?.name) || e.id}`, e.sessionId, e.data.input?.name ?? 'worktree');
  }
  if (e.data.tool === 'ExitWorktree') removeWorktrees(d, e.sessionId, 'enter:');
  const visit = makeVisit(d, e.data.building, 'tool', () => arriveForTool(d, rt, e), { toolUseId: e.data.toolUseId, tool: e.data.tool });
  enqueue(d, rt, visit);
}

/** Celebrations for commands that finished well; everything else gets a check mark. */
/** @type {Readonly<Record<string, (d: Director, rt: Runtime, e: TownEvent) => void>>} */
const SUCCESS_SHOWS = Object.freeze({
  test: (d, rt, e) => {
    d.world.effect('fireworks', { building: e.data.building });
    d.world.setActivity(rt.key, 'celebrate');
    say(d, rt, d.quip('success.tests', contextFor(d, rt, e)), { priority: 'high', tone: 'shout' });
  },
  install: (d, rt, e) => {
    d.installs += 1;
    d.world.setNodeModules(Math.min(5, d.installs));
    d.world.effect('boxes', { building: e.data.building });
    say(d, rt, d.quip('success.install', contextFor(d, rt, e)));
  },
  'git-commit': (d, rt, e) => {
    d.world.vehicle('mailtruck', 'trip');
    say(d, rt, d.quip('success.commit', contextFor(d, rt, e)));
  },
  'git-push': (d, rt, e) => {
    d.world.vehicle('mailtruck', 'trip');
    d.world.effect('confetti', { building: e.data.building });
    say(d, rt, d.quip('success.push', contextFor(d, rt, e)), { priority: 'high' });
  },
  build: (d, rt, e) => {
    d.world.effect('check', { agent: rt.key });
    say(d, rt, d.quip('success.build', contextFor(d, rt, e)));
  },
});

/** @param {Director} d @param {Runtime} rt @param {TownEvent} e */
function succeeded(d, rt, e) {
  clearWeather(d, rt);
  rt.failStreak = 0;
  const combo = bumpCombo(rt, e.data.tool);
  setBadge(d, rt, combo >= 2 ? `×${combo}` : null);
  updateBuildingStat(d, e.data.building);
  if (d.historic) return;
  const show = own(SUCCESS_SHOWS, e.data.commandKind);
  if (show) show(d, rt, e);
  else if (combo < 2) d.world.effect('check', { agent: rt.key });
}

/** @param {Director} d @param {TownEvent} e */
function onToolEnd(d, e) {
  const rt = ensure(d, e.agentKey);
  if (rt) settle(d, rt, e.data.toolUseId, () => succeeded(d, rt, e));
}

/** @param {Director} d @param {Runtime} rt @param {TownEvent} e */
function failed(d, rt, e) {
  rt.comboTool = null;
  rt.comboCount = 0;
  setBadge(d, rt, null);
  setStatus(d, rt, 'error');
  d.world.setActivity(rt.key, 'facepalm');
  if (e.data.errorKind === 'interrupted') {
    say(d, rt, d.quip('fail.interrupted', contextFor(d, rt, e)), { priority: 'high' });
    return;
  }
  rt.failStreak += 1;
  const testsRed = e.data.commandKind === 'test';
  if (testsRed || rt.failStreak >= 2) setWeather(d, rt, 'rain');
  if (d.historic) return;
  d.world.effect('cross', { agent: rt.key });
  if (testsRed) d.world.effect('smoke', { building: e.data.building });
  const situation = rt.failStreak >= 2 ? 'fail.repeated' : `fail.${e.data.errorKind}`;
  say(d, rt, d.quip(situation, { ...contextFor(d, rt, e), n: rt.failStreak }), { priority: 'high' });
}

/** @param {Director} d @param {TownEvent} e */
function onToolFail(d, e) {
  const rt = ensure(d, e.agentKey);
  if (rt) settle(d, rt, e.data.toolUseId, () => failed(d, rt, e));
}

// ---------------------------------------------------------------------------------------------
// Waiting for permission, idling, compaction.

/** @param {Director} d @param {Runtime} rt @param {number} level @param {Record<string, unknown>} context */
function nag(d, rt, level, context) {
  if (rt.holdReason !== 'permit') return;
  if (level >= 3) d.world.emote(rt.key, '⏳');
  say(d, rt, d.quip(`wait.${level}`, context), { priority: 'high', tone: level >= 4 ? 'shout' : 'speech' });
}

/**
 * Sends the agent to the Permit Office until the request is answered. The visit goes in front of
 * the visit for the tool that needs the permit, so the agent waits first and works after.
 * @param {Director} d
 * @param {Runtime} rt
 * @param {TownEvent|null} e
 */
function startWaiting(d, rt, e) {
  if (rt.holdReason === 'permit') return;
  rt.holdReason = 'permit';
  const context = contextFor(d, rt, e ?? undefined);
  const visit = makeVisit(
    d,
    'permits',
    'permit',
    () => {
      // Answered while on the way: walk on without queueing at the counter.
      if (rt.holdReason !== 'permit') return;
      d.world.setActivity(rt.key, 'wait');
      if (d.historic) return;
      d.world.emote(rt.key, '📝');
      say(d, rt, d.quip('permission.request', context), { priority: 'high' });
      rt.nagTimers = NAG_AFTER_MS.map((ms, i) => d.later(() => nag(d, rt, i + 1, context), ms));
    },
    { hold: true },
  );
  const tool = e?.data?.tool;
  const index = tool ? rt.queue.findLastIndex((v) => v.kind === 'tool' && v.tool === tool) : -1;
  if (index < 0) return enqueue(d, rt, visit);
  rt.queue.splice(index, 0, visit);
  pump(d, rt);
}

/** @param {Director} d @param {TownEvent} e */
function onPermissionRequest(d, e) {
  const rt = ensure(d, e.agentKey);
  if (!rt) return;
  setStatus(d, rt, 'waiting');
  startWaiting(d, rt, e);
}

/** @param {Director} d @param {TownEvent} e */
function onPermissionDenied(d, e) {
  const rt = ensure(d, e.agentKey);
  if (!rt) return;
  setStatus(d, rt, 'working');
  settle(d, rt, e.data.toolUseId, () => {
    if (d.historic) return;
    d.world.emote(rt.key, '🙅');
    say(d, rt, d.quip('permission.denied', contextFor(d, rt, e)), { priority: 'high' });
  });
}

/** @param {Director} d @param {Runtime} rt */
function fallAsleep(d, rt) {
  rt.sleepTimer = null;
  if (!rt.idle || rt.leaving) return;
  rt.sleeping = true;
  d.world.setActivity(rt.key, 'sleep');
  d.world.effect('zzz', { agent: rt.key });
  say(d, rt, d.quip('sleep', contextFor(d, rt)), { tone: 'thought' });
}

/**
 * Turn over: celebrate where it finished, then wait at the café, and nap after a while.
 * @param {Director} d
 * @param {Runtime} rt
 * @param {{celebrate?: boolean, message?: string}} [opts]
 */
function goIdle(d, rt, opts = {}) {
  if (rt.idle) return;
  rt.idle = true;
  setStatus(d, rt, 'idle');
  if (opts.celebrate && !d.historic) {
    d.world.setActivity(rt.key, 'celebrate');
    d.world.effect('check', { agent: rt.key });
    const message = clip(oneLine(opts.message), 110);
    say(d, rt, message || d.quip('turn.done', contextFor(d, rt)), { priority: 'high', ms: 5000 });
  }
  const atCafe = () => {
    if (!rt.idle) return; // woke up on the way: no coffee break after all
    d.world.setActivity(rt.key, 'sip');
    say(d, rt, d.quip('idle', contextFor(d, rt)), { tone: 'thought' });
    d.cancel(rt.sleepTimer);
    rt.sleepTimer = d.later(() => fallAsleep(d, rt), SLEEP_AFTER_MS);
  };
  enqueue(d, rt, makeVisit(d, 'cafe', 'idle', atCafe));
}

/** @param {Director} d @param {TownEvent} e */
function onTurnStop(d, e) {
  const rt = ensure(d, e.agentKey);
  if (rt) goIdle(d, rt, { celebrate: true, message: e.data.lastMessage });
}

/** @param {Director} d @param {TownEvent} e */
function onTurnFail(d, e) {
  const rt = ensure(d, e.agentKey);
  if (!rt) return;
  setStatus(d, rt, 'error');
  d.world.setActivity(rt.key, 'facepalm');
  setWeather(d, rt, 'storm');
  if (d.historic) return;
  d.world.emote(rt.key, '⛈️');
  const error = String(e.data.error ?? 'unknown').replace(/_/g, ' ');
  const situation = own(STOP_SITUATIONS, e.data.error) ?? 'stop.other';
  say(d, rt, d.quip(situation, { ...contextFor(d, rt, e), error }), { priority: 'high', tone: 'shout' });
}

/** @type {Readonly<Record<string, (d: Director, rt: Runtime, e: TownEvent) => void>>} */
const NOTIFY_SHOWS = Object.freeze({
  permission_prompt: (d, rt) => {
    setStatus(d, rt, 'waiting');
    startWaiting(d, rt, null);
  },
  idle_prompt: (d, rt) => goIdle(d, rt),
  agent_needs_input: (d, rt, e) => {
    setStatus(d, rt, 'waiting');
    if (d.historic) return;
    d.world.emote(rt.key, '🙋');
    say(d, rt, d.quip('notify.attention', contextFor(d, rt, e)), { priority: 'high' });
  },
});

/** @param {Director} d @param {TownEvent} e */
function onNotify(d, e) {
  const show = own(NOTIFY_SHOWS, e.data.notificationType);
  const rt = show ? ensure(d, e.agentKey) : null;
  if (show && rt) show(d, rt, e);
}

/** @param {Director} d @param {TownEvent} e */
function onCompactStart(d, e) {
  const rt = ensure(d, e.agentKey);
  if (!rt) return;
  rt.holdReason = 'spa';
  const atSpa = () => {
    if (rt.holdReason !== 'spa') return;
    d.world.setActivity(rt.key, 'spa');
    if (d.historic) return;
    d.world.effect('steam', { building: 'spa' });
    say(d, rt, d.quip('compact.start', contextFor(d, rt, e)), { priority: 'high', tone: 'thought' });
  };
  enqueue(d, rt, makeVisit(d, 'spa', 'spa', atSpa, { hold: true }));
}

/** @param {Director} d @param {TownEvent} e */
function onCompactEnd(d, e) {
  const rt = ensure(d, e.agentKey);
  if (!rt || d.historic) return;
  d.world.effect('bulb', { agent: rt.key });
  say(d, rt, d.quip('compact.end', contextFor(d, rt, e)), { priority: 'high' });
}

// ---------------------------------------------------------------------------------------------
// Crews: sessions, prompts, helpers.

/** @param {Director} d @param {TownEvent} e */
function onSessionStart(d, e) {
  const known = d.crew.get(e.agentKey);
  if (known) {
    // A resume or post-compaction restart of a session already in town: just refresh the hat.
    const agent = agentState(d, known.key);
    if (agent) d.world.updateAgent(known.key, { hat: agent.hat });
    return;
  }
  if (!d.historic) d.world.vehicle('bus', 'arrive');
  const rt = addToWorld(d, e.agentKey, d.historic ? { spawnAt: 'hall', entrance: 'none' } : { spawnAt: 'station', entrance: 'bus' });
  if (!rt) return;
  setStatus(d, rt, 'idle');
  const greet = () => {
    d.world.setActivity(rt.key, 'wave');
    const situation = e.data.source === 'resume' ? 'session.resume' : 'session.start';
    say(d, rt, d.quip(situation, contextFor(d, rt, e)), { priority: 'high' });
  };
  enqueue(d, rt, makeVisit(d, 'hall', 'hall', greet));
}

/** @param {Director} d @param {TownEvent} e */
function onSessionEnd(d, e) {
  for (const rt of [...d.crew.values()]) {
    if (rt.sessionId !== e.sessionId || rt.leaving) continue;
    if (rt.role !== 'lead') {
      retire(d, rt, 'poof', 0);
      continue;
    }
    d.world.setActivity(rt.key, 'wave');
    say(d, rt, d.quip('session.end', contextFor(d, rt, e)), { priority: 'high' });
    retire(d, rt, 'bus', 0);
  }
  removeWorktrees(d, e.sessionId);
  d.todoDone.delete(e.sessionId);
  if (d.boardSession === e.sessionId) refreshBoard(d, null);
}

/** @param {Director} d @param {TownEvent} e */
function onPrompt(d, e) {
  const rt = ensure(d, e.agentKey);
  if (!rt) return;
  clearWeather(d, rt);
  rt.failStreak = 0;
  setStatus(d, rt, 'working');
  const goal = clip(oneLine(e.data.prompt), 80);
  const react = () => {
    d.world.setActivity(rt.key, 'think');
    if (d.historic) return;
    d.world.emote(rt.key, '📜');
    // Long goals read badly inside a joke, so only short ones are quoted in one.
    const plain = goal && (goal.length > SHORT_GOAL || d.random() < INFORMATIVE_SHARE);
    const context = { ...contextFor(d, rt, e), goal: goal.length > SHORT_GOAL ? undefined : goal };
    say(d, rt, plain ? `On it: ${goal}` : d.quip('prompt', context), { priority: 'high', ms: 5000 });
  };
  enqueue(d, rt, makeVisit(d, 'hall', 'hall', react));
}

/** @param {Runtime} rt */
function spawnSituation(rt) {
  if (rt.role === 'teammate') return 'spawn.teammate';
  return own(SPAWN_SITUATIONS, rt.type) ?? 'spawn.other';
}

/** @param {Director} d @param {TownEvent} e */
function onSubagentStart(d, e) {
  if (d.crew.has(e.agentKey)) return;
  const rt = addToWorld(d, e.agentKey, { spawnAt: 'hall', entrance: 'portal' });
  if (!rt) return;
  setStatus(d, rt, 'working');
  d.world.setActivity(rt.key, 'wave');
  if (d.historic) return;
  d.world.effect('portal', { building: 'hall' });
  say(d, rt, d.quip(spawnSituation(rt), contextFor(d, rt, e)), { priority: 'high' });
}

/** @param {Director} d @param {TownEvent} e */
function onSubagentStop(d, e) {
  const rt = d.crew.get(e.agentKey);
  if (!rt || rt.leaving) return;
  setStatus(d, rt, 'done');
  setBadge(d, rt, null);
  if (!d.historic) {
    const last = clip(oneLine(e.data.lastMessage), 110);
    say(d, rt, last || d.quip('subagent.done', contextFor(d, rt, e)), { priority: 'high', ms: 5000 });
    d.world.setActivity(rt.key, 'celebrate');
    d.world.effect('confetti', { agent: rt.key });
  }
  retire(d, rt, 'portal', d.historic ? 0 : LEAVE_DELAY_MS);
}

/** @param {Director} d @param {TownEvent} e */
function onTeammateIdle(d, e) {
  const rt = ensure(d, e.agentKey);
  if (rt && rt.role !== 'lead') goIdle(d, rt);
}

/** @param {Director} d @param {TownEvent} e */
function onModelSwitch(d, e) {
  const rt = ensure(d, e.agentKey);
  if (!rt) return;
  // The store has already chosen the hat (leads wear their model's).
  const hat = agentState(d, rt.key)?.hat;
  if (hat) d.world.updateAgent(rt.key, { hat });
  if (d.historic) return;
  d.world.effect('sparks', { agent: rt.key });
  const family = /(opus|sonnet|haiku)/i.exec(str(e.data.to))?.[1]?.toLowerCase() ?? 'other';
  say(d, rt, d.quip(`model.${family}`, { ...contextFor(d, rt, e), model: modelLabel(e.data.to) }), { priority: 'high' });
}

/** @param {Director} d @param {TownEvent} e */
function onSpawnRequest(d, e) {
  if (e.data.isolation !== 'worktree') return;
  plantWorktree(d, `${e.sessionId}:wt:${e.data.toolUseId ?? e.id}`, e.sessionId, e.data.name || e.data.description || e.data.subagentType);
  const rt = d.crew.get(e.agentKey);
  if (rt && !d.historic) say(d, rt, d.quip('worktree', { ...contextFor(d, rt, e), name: e.data.name || e.data.subagentType }));
}

/** @param {Director} d @param {TownEvent} e */
function onMessage(d, e) {
  const rt = ensure(d, e.agentKey);
  if (!rt || d.historic) return;
  const target = recipientKey(d, e.sessionId, e.data.to);
  const landed = () => {
    if (target && !d.disposed) d.world.emote(target, '📨');
  };
  Promise.resolve(d.world.sendMessage(rt.key, target ? { agent: target } : { building: 'post' })).then(landed, () => {});
  const summary = clip(oneLine(e.data.summary), 80);
  const plain = summary && d.random() < INFORMATIVE_SHARE;
  say(d, rt, plain ? `✉️ ${summary}` : d.quip('message.send', { ...contextFor(d, rt, e), to: e.data.to }));
}

// ---------------------------------------------------------------------------------------------
// The Goal Board.

/** @param {Director} d @param {TownEvent} e */
function onBoardChange(d, e) {
  refreshBoard(d, e.sessionId);
}

/** @param {Director} d @param {TownEvent} e */
function onTaskCompleted(d, e) {
  refreshBoard(d, e.sessionId);
  const rt = d.crew.get(e.agentKey);
  if (!rt || d.historic) return;
  d.world.effect('check', { building: 'board' });
  say(d, rt, d.quip('task.done', contextFor(d, rt, e)));
}

/** @param {Director} d @param {TownEvent} e */
function onTodos(d, e) {
  refreshBoard(d, e.sessionId);
  const todos = Array.isArray(e.data.todos) ? e.data.todos : [];
  const done = todos.filter((t) => t.status === 'completed').length;
  const before = d.todoDone.get(e.sessionId) ?? 0;
  d.todoDone.set(e.sessionId, done);
  const rt = d.crew.get(e.agentKey);
  if (!rt || d.historic || done <= before) return;
  if (done === todos.length && todos.length >= 2) {
    d.world.effect('confetti', { building: 'board' });
    say(d, rt, d.quip('todos.all', contextFor(d, rt, e)), { priority: 'high' });
  } else {
    say(d, rt, d.quip('todo.done', contextFor(d, rt, e)));
  }
}

/** @type {Readonly<Record<string, (d: Director, e: TownEvent) => void>>} */
const EVENT_SHOWS = Object.freeze({
  'session.start': onSessionStart,
  'session.end': onSessionEnd,
  prompt: onPrompt,
  'tool.start': onToolStart,
  'tool.end': onToolEnd,
  'tool.fail': onToolFail,
  'permission.request': onPermissionRequest,
  'permission.denied': onPermissionDenied,
  notify: onNotify,
  'subagent.start': onSubagentStart,
  'subagent.stop': onSubagentStop,
  'turn.stop': onTurnStop,
  'turn.fail': onTurnFail,
  'task.created': onBoardChange,
  'task.completed': onTaskCompleted,
  'teammate.idle': onTeammateIdle,
  'compact.start': onCompactStart,
  'compact.end': onCompactEnd,
  'model.switch': onModelSwitch,
  'todos.set': onTodos,
  'task.upsert': onBoardChange,
  'spawn.request': onSpawnRequest,
  'message.send': onMessage,
});

// ---------------------------------------------------------------------------------------------
// Store changes.

/** @param {Director} d @param {{key: string, name: string, role: string, hat: string}[]} relabels */
function applyRelabels(d, relabels) {
  for (const { key, name, role, hat } of relabels) {
    const rt = d.crew.get(key);
    if (!rt) continue;
    rt.name = name;
    rt.role = role;
    d.world.updateAgent(key, { name, role, hat });
  }
}

/** @param {Director} d @param {TownEvent} e */
function onEvent(d, e) {
  d.historic = isHistoric(e, d.now());
  if (Array.isArray(e.data?.relabels)) applyRelabels(d, e.data.relabels);
  const rt = d.crew.get(e.agentKey);
  if (rt && !rt.leaving && !KEEPS_HOLD.has(e.kind)) release(d, rt);
  if (rt && !rt.leaving && WAKES.has(e.kind)) wake(d, rt);
  own(EVENT_SHOWS, e.kind)?.(d, e);
  d.lastAgentKey = e.agentKey;
  d.lastHistoric = d.historic;
}

/** @type {Readonly<Record<string, (d: Director, rt: Runtime) => void>>} */
const APPROVAL_SHOWS = Object.freeze({
  allowed: (d, rt) => {
    setStatus(d, rt, 'working');
    d.world.emote(rt.key, '✅');
    say(d, rt, d.quip('permission.allowed', contextFor(d, rt)), { priority: 'high' });
  },
  denied: (d, rt) => {
    setStatus(d, rt, 'working');
    d.world.emote(rt.key, '🙅');
    say(d, rt, d.quip('permission.denied', contextFor(d, rt)), { priority: 'high' });
  },
  expired: (d, rt) => {
    d.world.emote(rt.key, '⌛');
    say(d, rt, d.quip('permission.expired', contextFor(d, rt)), { priority: 'high' });
  },
});

/** @param {Director} d @param {Approval} approval */
function onApproval(d, approval) {
  const show = own(APPROVAL_SHOWS, approval?.status);
  if (!show) return;
  const rt = d.crew.get(agentKeyOf(str(approval.sessionId), normalizeAgentId(approval.agentId)));
  if (!rt || rt.leaving) return;
  d.historic = false;
  // An expired town approval moves to the terminal: the agent keeps waiting.
  if (approval.status !== 'expired') release(d, rt);
  show(d, rt);
}

/** @param {Director} d @param {Achievement} achievement */
function onAchievement(d, achievement) {
  if (d.lastHistoric) return;
  d.world.effect('confetti', { building: 'hall' });
  const rt = d.lastAgentKey ? d.crew.get(d.lastAgentKey) : null;
  if (!rt || rt.leaving) return;
  d.world.emote(rt.key, '🏆');
  say(d, rt, d.quip('achievement', { ...contextFor(d, rt), title: achievement.title }), { priority: 'high', tone: 'shout' });
}

/** @param {Director} d */
function onReset(d) {
  for (const rt of d.crew.values()) {
    cancelTimers(d, rt, { silence: true });
    rt.leaving = true;
    Promise.resolve(d.world.removeAgent(rt.key, { exit: 'poof' })).catch(() => {});
  }
  d.crew.clear();
  for (const id of d.worktrees.keys()) d.world.removeWorktree(id);
  d.worktrees.clear();
  d.todoDone.clear();
  d.boats.clear();
  d.installs = 0;
  d.boardSession = null;
  d.lastAgentKey = null;
  d.world.setBoard([], undefined);
  d.world.setNodeModules(0);
}

/** @type {Readonly<Record<string, (d: Director, change: any) => void>>} */
const CHANGE_SHOWS = Object.freeze({
  event: (d, change) => onEvent(d, change.event),
  approval: (d, change) => onApproval(d, change.approval),
  achievement: (d, change) => onAchievement(d, change.achievement),
  reset: (d) => onReset(d),
});

/** Agents already in the store when the director starts are placed without ceremony. */
/** @param {Director} d */
function syncFromStore(d) {
  d.historic = true;
  for (const agent of Object.values(d.store.getState().agents)) {
    const rt = addToWorld(d, agent.key, { spawnAt: agent.building || 'hall', entrance: 'none' });
    if (!rt) continue;
    setStatus(d, rt, agent.status);
    d.world.setActivity(agent.key, agent.activity || 'idle');
  }
  refreshBoard(d, null);
  d.historic = false;
}

/**
 * Keeps the store's changes until the director starts. The app starts the store and the HUD
 * first and builds the 3D world after (it blocks the page for a moment); the director then plays
 * this backlog, so crews that arrived meanwhile still come in by bus. Returns null instead when
 * the store already had sessions or the backlog grew past `limit`: the director then places the
 * store's agents without ceremony.
 * @param {{subscribe: (listener: (change: StoreChange) => void) => () => void, getState: () => StoreState}} store
 * @param {number} [limit]
 * @returns {{ stop: () => StoreChange[]|null }}
 */
export function recordChanges(store, limit = MAX_BACKLOG) {
  /** @type {StoreChange[]|null} */
  let backlog = store.getState().sessions.length ? null : [];
  const unsubscribe = store.subscribe((change) => {
    if (!backlog) return;
    if (backlog.length >= limit) backlog = null;
    else backlog.push(change);
  });
  return {
    stop() {
      unsubscribe();
      return backlog;
    },
  };
}

/**
 * Subscribes to the store and drives the world until disposed.
 * @param {DirectorOptions} options
 * @returns {{dispose: () => void}}
 */
export function createDirector(options) {
  const d = createContext(options);
  /** @param {StoreChange} change */
  const play = (change) => {
    if (d.disposed || !change) return;
    const show = own(CHANGE_SHOWS, change.type);
    if (show) scoped(d, d.historic, () => show(d, change))();
  };
  if (Array.isArray(options.backlog)) for (const change of options.backlog) play(change);
  else syncFromStore(d);
  const unsubscribe = d.store.subscribe(play);
  return {
    dispose() {
      if (d.disposed) return;
      d.disposed = true;
      unsubscribe();
      for (const handle of d.timers) d.clearTimer(handle);
      d.timers.clear();
    },
  };
}
