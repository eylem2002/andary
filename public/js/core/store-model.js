// The store's working memory (core/store.js): its state plus the indexes it keeps to attribute
// events (recent spawns, role counters, hats handed out, retired helpers), the open dialogs, the
// stuck rules' memory, who changed which file (for two agents on the same files), each lead's turn
// for its receipt, and the limits on all of them. Internal to the store's modules.
import { createDialogs } from './dialogs.js';
import { BUILDING_KEYS } from './catalog.js';
import { createAchievementTracker } from './achievements.js';
import { createConflicts } from './conflicts.js';
import { createLoops } from './loops.js';
import { createReceipts } from './receipts.js';

/** @typedef {import('./store.js').BuildingKey} BuildingKey */
/** @typedef {import('./store.js').StoreState} StoreState */
/** @typedef {import('./store.js').Session} Session */
/** @typedef {import('./store.js').Spawn} Spawn */
/** @typedef {import('./store.js').Stats} Stats */

export const LEAD_NAME = 'Foreman';
/** Role names for unnamed subagents, by subagent_type; other types are Title Cased. */
export const ROLE_NAMES = Object.freeze({ Explore: 'Scout', Plan: 'Architect', 'general-purpose': 'Builder' });
export const TEAMMATE_HATS = Object.freeze(['beret', 'sunhat', 'wizard', 'crown']);
export const MAX_RECENT = 30;
export const MAX_ENDED_SESSIONS = 10;
export const MAX_DONE_PER_SESSION = 8;
export const MAX_APPROVALS = 100;
export const MAX_SPAWNS_PER_SESSION = 50;
export const MAX_RETIRED = 500;

/** @param {number} max */
export function boundedPush(list, item, max) {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}

/** @param {string} type  "code-reviewer" → "Code Reviewer" */
export function titleCase(type) {
  const words = type.split(/[-_\s]+/).filter(Boolean);
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || 'Helper';
}

/** @param {string} cwd @param {string} sessionId */
export function projectName(cwd, sessionId) {
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || `session ${sessionId.slice(0, 8)}`;
}

/** @returns {Stats} */
export function freshStats() {
  const byBuilding = /** @type {Record<BuildingKey, number>} */ (Object.fromEntries(BUILDING_KEYS.map((k) => [k, 0])));
  return { events: 0, toolCalls: 0, failures: 0, approvals: 0, subagents: 0, byBuilding };
}

/**
 * @param {(ts: number) => number} localHour
 * @param {number} maxLog
 */
export function createModel(localHour, maxLog) {
  const model = {
    maxLog,
    /** @type {StoreState} */
    state: { sessions: [], agents: {}, approvals: [], dialogs: [], hazards: [], log: [], stats: freshStats(), achievements: [], usage: {}, usageDays: [], receipts: [], notes: [], prs: [] },
    /** What agents asked you and had no answer to yet (dialogs.js); state.dialogs is its list. */
    dialogs: createDialogs(),
    /** Who changed which file lately (conflicts.js); state.hazards is what it found. */
    conflicts: createConflicts(),
    /** @type {Map<string, Session>} */
    sessions: new Map(),
    /** @type {Map<string, Spawn[]>} recent Agent/Task calls per session, oldest first */
    spawns: new Map(),
    /** @type {Map<string, Spawn>} agentKey → the spawn its label came from */
    spawnOf: new Map(),
    /** @type {Map<string, number>} "session\0Scout" → how many Scouts so far */
    roleCounts: new Map(),
    /** @type {Map<string, number>} sessionId → teammate hats handed out */
    hatTurns: new Map(),
    colorTurn: 0,
    /** A team town's people (store.setPeople): each person's colour and agents name, and who hosts (local crews are theirs). */
    people: /** @type {{ host: string|null, colors: Map<string, string>, agents: Map<string, string> }} */ ({ host: null, colors: new Map(), agents: new Map() }),
    logSeq: 0,
    /** @type {Map<string, {tool: string, counted: boolean}>} permission requests awaiting an answer */
    awaiting: new Map(),
    /** @type {Set<string>} agents whose turn ended in StopFailure (idle, not working, while red) */
    turnFailed: new Set(),
    /** @type {Map<string, number>} finished subagents → when; late async hooks for them are dropped */
    retired: new Map(),
    /** each lead's turn so far, and the receipts of turns that ended (receipts.js); state.receipts lists them */
    receipts: createReceipts(),
    /** the stuck rules' memory of each agent's recent steps (loops.js), behind AgentState.stuck */
    loops: createLoops(),
    tracker: createAchievementTracker({ localHour }),
    view: /** @type {import('./achievements.js').TrackerView} */ (null),
  };
  model.view = {
    activeHelpers: (sessionId) => helpersOf(model, sessionId).filter((a) => a.status !== 'done').length,
    activeAgents: () => Object.values(model.state.agents).filter((a) => a.status !== 'done').length,
    session: (id) => model.sessions.get(id),
  };
  return model;
}

/** @typedef {ReturnType<typeof createModel>} Model */

/** @param {Model} m @param {string} sessionId */
export function helpersOf(m, sessionId) {
  const s = m.sessions.get(sessionId);
  return s ? s.agentKeys.map((k) => m.state.agents[k]).filter((a) => a && a.role !== 'lead') : [];
}
