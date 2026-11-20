// The single source of truth the HUD renders and the director follows (CONTRACTS.md §5.1).
// It applies TownEvents to crews (sessions), agents, todos/tasks, approvals, the activity log and
// stats; works out who each event belongs to (subagent labels, teammate names); and unlocks
// achievements. The town may open mid-session, so every session or agent an event mentions is
// created on first sight.

import { ACHIEVEMENTS, achievementFor, createAchievementTracker } from './achievements.js';
import { BUILDINGS, BUILDING_KEYS, CREW_COLORS, hatForModel, modelLabel } from './catalog.js';
import {
  agentKeyOf,
  clip,
  isObject,
  normalize,
  normalizeAgentId,
  oneLine,
  own,
  relativePath,
  str,
  summarizeTool,
} from './events.js';

export { ACHIEVEMENTS };

/** @typedef {import('./catalog.js').BuildingKey} BuildingKey */
/** @typedef {import('./catalog.js').Activity} Activity */
/** @typedef {import('./events.js').TownEvent} TownEvent */
/** @typedef {import('./events.js').Envelope} Envelope */
/** @typedef {import('./achievements.js').Achievement} Achievement */
/** @typedef {'pending'|'in_progress'|'completed'} ItemStatus */
/** @typedef {'working'|'waiting'|'idle'|'error'|'done'} AgentStatus */

/**
 * @typedef {object} Session  one Claude Code session, shown as a crew
 * @property {string} id
 * @property {string} project        cwd basename
 * @property {string} cwd
 * @property {string} [title]
 * @property {string} color          crew colour, shared by every agent of the session
 * @property {string} [model]
 * @property {string} [permissionMode]
 * @property {'working'|'waiting'|'idle'|'ended'} status
 * @property {string} [goal]         latest prompt, trimmed
 * @property {number} startedAt
 * @property {number} lastActivity
 * @property {string[]} agentKeys
 * @property {{text: string, status: ItemStatus}[]} todos
 * @property {{id: string, subject: string, status: ItemStatus, owner?: string}[]} tasks
 * @property {number} [endedAt]
 * @property {string} [endReason]
 */

/**
 * @typedef {object} LogEntry
 * @property {number} id
 * @property {number} ts
 * @property {string} sessionId
 * @property {string} agentKey
 * @property {string} agentName
 * @property {string} color
 * @property {string} kind     TownEvent kind, or 'approval' / 'achievement'
 * @property {string} icon
 * @property {string} text
 * @property {'info'|'success'|'warn'|'error'} level
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
 * @property {string} hat
 * @property {AgentStatus} status
 * @property {BuildingKey} building
 * @property {Activity} activity
 * @property {string} [currentTool]
 * @property {string} [summary]
 * @property {string} [description]
 * @property {number} startedAt
 * @property {number} lastActivity
 * @property {Record<string, number>} toolCounts
 * @property {string[]} files       recent unique paths, newest last, ≤ 30
 * @property {FileChange[]} changes  edits and writes this agent made, newest last, ≤ 20
 * @property {LogEntry[]} recent    ≤ 30
 * @property {number} errors
 * @property {string} [lastMessage]
 * @property {string} [model]
 */

/**
 * @typedef {object} Approval  CONTRACTS.md §4.5 (read defensively: it crosses the network)
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
 * @typedef {object} Stats
 * @property {number} events
 * @property {number} toolCalls
 * @property {number} failures
 * @property {number} approvals   permission requests seen
 * @property {number} subagents   subagents and teammates spawned
 * @property {Record<BuildingKey, number>} byBuilding  tool calls per building
 */

/**
 * @typedef {object} StoreState
 * @property {Session[]} sessions          in order first seen
 * @property {Record<string, AgentState>} agents
 * @property {Approval[]} approvals        pending first, then most recent
 * @property {LogEntry[]} log              newest last
 * @property {Stats} stats
 * @property {Achievement[]} achievements
 * @property {Record<string, AgentUsage>} usage   agentKey → tokens and estimated cost (§4.8)
 * @property {UsageDay[]} usageDays             the last 30 days, oldest first
 */

/**
 * @typedef {object} AgentUsage
 * @property {{ input: number, output: number, cacheRead: number, cacheWrite: number }} tokens
 * @property {number} costUsd
 * @property {boolean} unpriced
 * @property {string|null} model
 */

/** @typedef {{ date: string, tokens: number, costUsd: number }} UsageDay */

/** @typedef {{type: 'event', event: TownEvent}|{type: 'approval', approval: Approval}|{type: 'achievement', achievement: Achievement}|{type: 'usage', agentKey: string}|{type: 'reset'}} StoreChange */

/**
 * @typedef {object} Store
 * @property {(envelope: Envelope|Record<string, any>) => TownEvent[]} ingest
 * @property {(event: TownEvent) => void} dispatch
 * @property {(approval: Approval) => void} setApproval
 * @property {(record: unknown, days?: unknown) => void} setUsage  one agent's usage totals, and the day totals
 * @property {(listener: (change: StoreChange) => void) => () => void} subscribe
 * @property {() => StoreState} getState
 * @property {() => void} reset
 */

/**
 * A pending or claimed Agent/Task tool call: where subagent labels come from.
 * @typedef {object} Spawn
 * @property {string|null} toolUseId
 * @property {string} subagentType
 * @property {string|null} name
 * @property {string|null} teamName
 * @property {string} description
 * @property {string|null} model
 * @property {string|null} claimedBy  agentKey that holds this identity
 */

/** @typedef {{icon: string, text: string, level: LogEntry['level']}} LogDraft */
/** @typedef {{key: string, name: string, role: AgentState['role'], hat: string}} Relabel */

const LEAD_NAME = 'Foreman';
/** Role names for unnamed subagents, by subagent_type; other types are Title Cased. */
const ROLE_NAMES = Object.freeze({ Explore: 'Scout', Plan: 'Architect', 'general-purpose': 'Builder' });
const TEAMMATE_HATS = Object.freeze(['beret', 'sunhat', 'wizard', 'crown']);
const MAX_RECENT = 30;
const MAX_ENDED_SESSIONS = 10;
const MAX_DONE_PER_SESSION = 8;
const MAX_APPROVALS = 100;
const MAX_SPAWNS_PER_SESSION = 50;
const MAX_RETIRED = 500;

/** @param {number} max */
function boundedPush(list, item, max) {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}

/** @param {string} type  "code-reviewer" → "Code Reviewer" */
function titleCase(type) {
  const words = type.split(/[-_\s]+/).filter(Boolean);
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || 'Helper';
}

/** @param {string} cwd @param {string} sessionId */
function projectName(cwd, sessionId) {
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || `session ${sessionId.slice(0, 8)}`;
}

/** @returns {Stats} */
function freshStats() {
  const byBuilding = /** @type {Record<BuildingKey, number>} */ (Object.fromEntries(BUILDING_KEYS.map((k) => [k, 0])));
  return { events: 0, toolCalls: 0, failures: 0, approvals: 0, subagents: 0, byBuilding };
}

/**
 * @param {(ts: number) => number} localHour
 * @param {number} maxLog
 */
function createModel(localHour, maxLog) {
  const model = {
    maxLog,
    /** @type {StoreState} */
    state: { sessions: [], agents: {}, approvals: [], log: [], stats: freshStats(), achievements: [], usage: {}, usageDays: [] },
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
    logSeq: 0,
    /** @type {Map<string, {tool: string, counted: boolean}>} permission requests awaiting an answer */
    awaiting: new Map(),
    /** @type {Set<string>} agents whose turn ended in StopFailure (idle, not working, while red) */
    turnFailed: new Set(),
    /** @type {Map<string, number>} finished subagents → when; late async hooks for them are dropped */
    retired: new Map(),
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
function helpersOf(m, sessionId) {
  const s = m.sessions.get(sessionId);
  return s ? s.agentKeys.map((k) => m.state.agents[k]).filter((a) => a && a.role !== 'lead') : [];
}

// ---------------------------------------------------------------------------------------------
// Sessions and agents.

/** @param {Model} m @param {TownEvent} e */
function newSession(m, e) {
  /** @type {Session} */
  const s = {
    id: e.sessionId,
    project: projectName(e.cwd, e.sessionId),
    cwd: e.cwd,
    title: undefined,
    color: CREW_COLORS[m.colorTurn++ % CREW_COLORS.length],
    model: undefined,
    permissionMode: undefined,
    status: 'idle',
    goal: undefined,
    startedAt: e.ts,
    lastActivity: e.ts,
    agentKeys: [],
    todos: [],
    tasks: [],
    endedAt: undefined,
    endReason: undefined,
  };
  m.sessions.set(s.id, s);
  m.state.sessions.push(s);
  createLead(m, s, e);
  return s;
}

/**
 * The session an event belongs to, created on first sight. Returns null for events that must not
 * create or revive anything: unknown hooks, an end of a session never seen, and async hooks that
 * fired before their session ended but arrived after (their ts precedes the end).
 * @param {Model} m
 * @param {TownEvent} e
 */
function sessionFor(m, e) {
  const s = m.sessions.get(e.sessionId);
  if (!s) return e.kind === 'unknown' || e.kind === 'session.end' ? null : newSession(m, e);
  if (s.status !== 'ended') return s;
  if (e.kind === 'session.end' || e.kind === 'unknown' || e.ts <= (s.endedAt ?? 0)) return null;
  s.status = 'idle';
  s.endedAt = undefined;
  s.endReason = undefined;
  createLead(m, s, e);
  return s;
}

/**
 * @param {Session} s
 * @param {string} key
 * @param {string|null} agentId
 * @param {number} ts
 * @returns {AgentState}
 */
function baseAgent(s, key, agentId, ts) {
  return {
    key,
    sessionId: s.id,
    agentId,
    name: LEAD_NAME,
    role: 'lead',
    type: 'main',
    color: s.color,
    hat: 'hardhat',
    status: 'idle',
    building: 'hall',
    activity: 'idle',
    currentTool: undefined,
    summary: undefined,
    description: undefined,
    startedAt: ts,
    lastActivity: ts,
    toolCounts: {},
    files: [],
    changes: [],
    recent: [],
    errors: 0,
    lastMessage: undefined,
    model: undefined,
  };
}

/** @param {Model} m @param {Session} s @param {AgentState} agent */
function register(m, s, agent) {
  m.state.agents[agent.key] = agent;
  if (!s.agentKeys.includes(agent.key)) s.agentKeys.push(agent.key);
  return agent;
}

/** @param {Model} m @param {Session} s @param {TownEvent} e */
function createLead(m, s, e) {
  const agent = baseAgent(s, agentKeyOf(s.id, null), null, e.ts);
  agent.type = (e.kind === 'session.start' && e.data.agentType) || 'main';
  agent.model = s.model;
  agent.hat = hatForModel(s.model) ?? 'hardhat';
  return register(m, s, agent);
}

/** @param {Model} m @param {string} sessionId @param {string} type */
function nextRoleName(m, sessionId, type) {
  const role = own(ROLE_NAMES, type) ?? titleCase(type);
  const counter = `${sessionId}\u0000${role}`;
  const n = (m.roleCounts.get(counter) ?? 0) + 1;
  m.roleCounts.set(counter, n);
  return `${role} ${n}`;
}

/** Teammates get hats that differ from each other and, while there are enough, from the lead's. */
/** @param {Model} m @param {Session} s */
function nextTeammateHat(m, s) {
  const leadHat = m.state.agents[agentKeyOf(s.id, null)]?.hat;
  const choices = TEAMMATE_HATS.filter((h) => h !== leadHat);
  const turn = m.hatTurns.get(s.id) ?? 0;
  m.hatTurns.set(s.id, turn + 1);
  return choices[turn % choices.length];
}

/** @param {Spawn|null|undefined} spawn @returns {AgentState['role']} */
function roleOf(spawn) {
  return spawn && (spawn.name || spawn.teamName) ? 'teammate' : 'subagent';
}

/**
 * FIFO match of a newly seen subagent with the oldest unclaimed Agent/Task call of its type.
 * @param {Model} m
 * @param {string} sessionId
 * @param {string|null} agentType
 * @param {string} agentKey
 */
function claimSpawn(m, sessionId, agentType, agentKey) {
  const wanted = (agentType ?? '').toLowerCase();
  const spawn = (m.spawns.get(sessionId) ?? []).find(
    (sp) => !sp.claimedBy && (!wanted || sp.subagentType.toLowerCase() === wanted),
  );
  if (!spawn) return null;
  spawn.claimedBy = agentKey;
  m.spawnOf.set(agentKey, spawn);
  return spawn;
}

/** @param {Model} m @param {Session} s @param {TownEvent} e */
function createHelper(m, s, e) {
  const spawn = m.spawnOf.get(e.agentKey) ?? claimSpawn(m, s.id, e.agentType, e.agentKey);
  const agent = baseAgent(s, e.agentKey, e.agentId, e.ts);
  agent.type = e.agentType || spawn?.subagentType || 'agent';
  agent.role = roleOf(spawn);
  agent.name = spawn?.name || nextRoleName(m, s.id, agent.type);
  agent.hat = agent.role === 'teammate' ? nextTeammateHat(m, s) : 'cap';
  agent.description = spawn?.description || undefined;
  agent.model = spawn?.model || undefined;
  agent.status = 'working';
  return register(m, s, agent);
}

/** @param {Model} m @param {Session} s @param {TownEvent} e */
function agentFor(m, s, e) {
  const existing = m.state.agents[e.agentKey];
  if (existing) return existing;
  return e.agentId ? createHelper(m, s, e) : createLead(m, s, e);
}

/**
 * Re-derives an agent's label after its identity changed.
 * @param {Model} m
 * @param {Session} s
 * @param {string} key
 * @param {Spawn|null} spawn
 * @param {Relabel[]} relabels
 */
function relabel(m, s, key, spawn, relabels) {
  const agent = m.state.agents[key];
  if (!agent || agent.role === 'lead') return;
  const role = roleOf(spawn);
  const name = spawn?.name || (agent.role === 'subagent' ? agent.name : nextRoleName(m, s.id, agent.type));
  const hat = role === agent.role ? agent.hat : role === 'teammate' ? nextTeammateHat(m, s) : 'cap';
  agent.description = spawn?.description || agent.description;
  if (name === agent.name && role === agent.role && hat === agent.hat) return;
  Object.assign(agent, { name, role, hat });
  relabels.push({ key, name, role, hat });
}

/**
 * Gives an agent the identity of `spawn` once a later event proves which spawn it came from;
 * whoever had claimed that spawn by FIFO gets the agent's previous identity instead.
 * @param {Model} m
 * @param {Session} s
 * @param {string} agentKey
 * @param {Spawn} spawn
 * @param {Relabel[]} relabels
 */
function assignSpawn(m, s, agentKey, spawn, relabels) {
  const previous = m.spawnOf.get(agentKey) ?? null;
  if (previous === spawn) return;
  const holder = spawn.claimedBy;
  spawn.claimedBy = agentKey;
  m.spawnOf.set(agentKey, spawn);
  if (previous) previous.claimedBy = null;
  if (holder && holder !== agentKey) {
    if (previous) {
      previous.claimedBy = holder;
      m.spawnOf.set(holder, previous);
    } else {
      m.spawnOf.delete(holder);
    }
    relabel(m, s, holder, previous, relabels);
  }
  relabel(m, s, agentKey, spawn, relabels);
}

/**
 * TeammateIdle / TaskCompleted name the teammate; trust that over a FIFO guess.
 * @param {Model} m
 * @param {Session} s
 * @param {AgentState} agent
 * @param {string|null} teammateName
 * @param {Relabel[]} relabels
 */
function reconcileTeammate(m, s, agent, teammateName, relabels) {
  if (!teammateName || !agent || agent.role === 'lead' || agent.name === teammateName) return;
  const spawn = (m.spawns.get(s.id) ?? []).find((sp) => sp.name === teammateName);
  if (spawn) return assignSpawn(m, s, agent.key, spawn, relabels);
  const hat = agent.role === 'teammate' ? agent.hat : nextTeammateHat(m, s);
  Object.assign(agent, { name: teammateName, role: 'teammate', hat });
  relabels.push({ key: agent.key, name: teammateName, role: 'teammate', hat });
}

/** Events that name a teammate but carry no agent_id belong to that teammate when we know it. */
/** @param {Model} m @param {TownEvent} e */
function attribute(m, e) {
  const name = e.data.teammateName;
  if (e.agentId || !name) return e;
  const s = m.sessions.get(e.sessionId);
  const match = s && helpersOf(m, s.id).find((a) => a.name === name);
  return match ? { ...e, agentKey: match.key, agentId: match.agentId, agentType: match.type } : e;
}

/** @param {Model} m @param {Session} s @param {string} key */
function dropAgent(m, s, key) {
  delete m.state.agents[key];
  s.agentKeys = s.agentKeys.filter((k) => k !== key);
  m.awaiting.delete(key);
  m.turnFailed.delete(key);
  m.spawnOf.delete(key);
}

/** @param {Model} m @param {Session} s */
function pruneDoneHelpers(m, s) {
  const done = helpersOf(m, s.id).filter((a) => a.status === 'done');
  const excess = done.length - MAX_DONE_PER_SESSION;
  if (excess <= 0) return;
  done
    .sort((a, b) => a.lastActivity - b.lastActivity)
    .slice(0, excess)
    .forEach((a) => dropAgent(m, s, a.key));
}

/** @param {Model} m */
function pruneEndedSessions(m) {
  const ended = m.state.sessions.filter((s) => s.status === 'ended');
  const excess = ended.length - MAX_ENDED_SESSIONS;
  if (excess <= 0) return;
  const drop = new Set(
    ended
      .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
      .slice(0, excess)
      .map((s) => s.id),
  );
  m.state.sessions = m.state.sessions.filter((s) => !drop.has(s.id));
  for (const id of drop) {
    m.sessions.delete(id);
    m.spawns.delete(id);
  }
}

/** @param {Model} m @param {Session} s */
function sessionStatus(m, s) {
  let working = false;
  for (const key of s.agentKeys) {
    const a = m.state.agents[key];
    if (!a) continue;
    if (a.status === 'waiting') return 'waiting';
    if (a.status === 'working' || (a.status === 'error' && !m.turnFailed.has(key))) working = true;
  }
  return working ? 'working' : 'idle';
}

/**
 * @param {AgentState} a
 * @param {BuildingKey|null} building
 * @param {Activity} activity
 */
function place(a, building, activity) {
  if (building) a.building = building;
  a.activity = activity;
}

/** @param {AgentState} a @param {string} path */
function rememberFile(a, path) {
  if (!path) return;
  const at = a.files.indexOf(path);
  if (at >= 0) a.files.splice(at, 1);
  boundedPush(a.files, path, MAX_RECENT);
}

/**
 * @typedef {object} FileChange  one finished Edit, MultiEdit, Write or NotebookEdit
 * @property {string} id        the event's id
 * @property {string} path      relative to the crew's folder where possible
 * @property {string} tool
 * @property {number} ts
 * @property {boolean} whole    the whole file was written (no "before" to compare with)
 * @property {{ before: string, after: string }[]} hunks
 */

const MAX_CHANGES = 20;
/** Longest text kept per side of a hunk (the server already cuts strings at 2,000 characters). */
const MAX_HUNK_CHARS = 4000;

/**
 * Keeps what a finished edit changed, so the inspector can show it as a diff.
 * @param {AgentState} a
 * @param {TownEvent} e
 * @param {Session} s
 */
function recordChange(a, e, s) {
  const hunks = changeHunks(e.data.tool, e.data.input);
  if (!hunks) return;
  const path = relativePath(e.data.file ?? '', e.cwd || s.cwd);
  if (!path) return;
  boundedPush(a.changes, { id: e.id, path, tool: e.data.tool, ts: e.ts, whole: hunks.whole, hunks: hunks.list }, MAX_CHANGES);
}

/**
 * The before and after text of an editing tool's input, or null for other tools.
 * @param {string} tool
 * @param {Record<string, any>} input
 * @returns {{ whole: boolean, list: { before: string, after: string }[] }|null}
 */
export function changeHunks(tool, input) {
  const text = (/** @type {unknown} */ v) => (typeof v === 'string' ? v.slice(0, MAX_HUNK_CHARS) : '');
  if (tool === 'Edit') return { whole: false, list: [{ before: text(input.old_string), after: text(input.new_string) }] };
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    return { whole: false, list: input.edits.slice(0, 20).filter((edit) => edit && typeof edit === 'object').map((edit) => ({ before: text(edit.old_string), after: text(edit.new_string) })) };
  }
  if (tool === 'Write') return { whole: true, list: [{ before: '', after: text(input.content) }] };
  if (tool === 'NotebookEdit') return { whole: false, list: [{ before: '', after: text(input.new_source) }] };
  return null;
}

/**
 * @param {Session} s
 * @param {{id: string|null, subject?: string|null, status?: string|null, owner?: string|null}} patch
 */
function upsertTask(s, patch) {
  const subject = patch.subject ?? '';
  let task = patch.id ? s.tasks.find((t) => t.id === patch.id) : undefined;
  // TaskCreate's response may lack the id; the TaskCreated hook has it. Match those by subject.
  task ??= s.tasks.find((t) => t.id.startsWith('~') && subject && t.subject === subject);
  if (patch.status === 'deleted') {
    if (task) s.tasks.splice(s.tasks.indexOf(task), 1);
    return;
  }
  if (!task) {
    task = { id: patch.id ?? `~${subject}`, subject: subject || `Task ${patch.id ?? ''}`.trim(), status: 'pending' };
    s.tasks.push(task);
  }
  if (patch.id) task.id = patch.id;
  if (subject) task.subject = subject;
  if (patch.status) task.status = /** @type {ItemStatus} */ (patch.status);
  if (patch.owner) task.owner = patch.owner;
}

// ---------------------------------------------------------------------------------------------
// Applying events. Each handler mutates state and returns a log line (or null for no log line).

const SESSION_SOURCES = Object.freeze({ startup: 'Arrived for work', resume: 'Resumed', clear: 'Started fresh', fork: 'Forked a session' });
const STOP_FAILURES = Object.freeze({
  rate_limit: 'Rate limited',
  overloaded: 'Servers overloaded',
  authentication_failed: 'Authentication failed',
  billing_error: 'Billing problem',
  server_error: 'Server error',
  max_output_tokens: 'Hit the output limit',
});
const SHIPPING_LOG = Object.freeze({
  test: ['✅', 'Tests passed'],
  'git-commit': ['📮', 'Committed'],
  'git-push': ['🚚', 'Pushed'],
  install: ['📦', 'Installed packages'],
  deps: ['📦', 'Installed dependencies'],
});
/** Tools whose derived event writes a better log line than the tool call itself. */
const QUIET_TOOLS = new Set(['SendMessage']);

/** @typedef {(m: Model, e: TownEvent, s: Session, a: AgentState, relabels: Relabel[]) => LogDraft|null} Apply */

/** @type {Apply} */
function applySessionStart(m, e, s, a) {
  const { model, title, permissionMode, source } = e.data;
  if (model) {
    s.model = model;
    a.model = model;
    a.hat = hatForModel(model) ?? a.hat;
  }
  if (title) s.title = title;
  if (permissionMode) s.permissionMode = permissionMode;
  if (source === 'compact') return null;
  place(a, 'hall', 'wave');
  return { icon: '🚌', text: `${own(SESSION_SOURCES, source) ?? 'Arrived'} in ${s.project}`, level: 'info' };
}

/** @type {Apply} */
function applySessionEnd(m, e, s) {
  for (const key of [...s.agentKeys]) dropAgent(m, s, key);
  s.status = 'ended';
  s.endedAt = e.ts;
  s.endReason = e.data.reason;
  pruneEndedSessions(m);
  return { icon: '👋', text: `Session ended (${String(e.data.reason).replace(/_/g, ' ')})`, level: 'info' };
}

/** @type {Apply} */
function applyPrompt(m, e, s, a) {
  const goal = clip(oneLine(e.data.prompt), 200);
  if (goal) s.goal = goal;
  if (e.data.title) s.title = e.data.title;
  a.status = 'working';
  m.turnFailed.delete(a.key);
  place(a, 'hall', 'think');
  return { icon: '💬', text: goal ? `New goal: ${goal}` : 'New prompt', level: 'info' };
}

/** @type {Apply} */
function applyToolStart(m, e, s, a) {
  const { tool, building, activity, summary, file } = e.data;
  a.status = 'working';
  a.currentTool = tool;
  a.summary = summary;
  a.toolCounts[tool] = (a.toolCounts[tool] ?? 0) + 1;
  place(a, building, activity);
  rememberFile(a, relativePath(file, e.cwd || s.cwd));
  m.turnFailed.delete(a.key);
  m.state.stats.toolCalls += 1;
  m.state.stats.byBuilding[building] = (m.state.stats.byBuilding[building] ?? 0) + 1;
  if (QUIET_TOOLS.has(tool)) return null;
  return { icon: BUILDINGS[building]?.icon ?? '🔧', text: summary, level: 'info' };
}

/** @type {Apply} */
function applyToolEnd(m, e, s, a) {
  recordChange(a, e, s);
  if (a.currentTool === e.data.tool) a.currentTool = undefined;
  if (a.status === 'waiting') a.status = 'working';
  const shipped = own(SHIPPING_LOG, e.data.commandKind);
  return shipped ? { icon: shipped[0], text: `${shipped[1]}: ${e.data.summary}`, level: 'success' } : null;
}

/** @type {Apply} */
function applyToolFail(m, e, s, a) {
  a.status = 'error';
  a.errors += 1;
  a.currentTool = undefined;
  place(a, null, 'facepalm');
  m.awaiting.delete(a.key);
  m.state.stats.failures += 1;
  if (e.data.isInterrupt) return { icon: '⏹️', text: `Interrupted: ${e.data.summary}`, level: 'warn' };
  return { icon: '❌', text: `${e.data.tool} failed (${e.data.error}): ${e.data.summary}`, level: 'error' };
}

/** @type {Apply} */
function applyPermissionRequest(m, e, s, a) {
  a.status = 'waiting';
  place(a, 'permits', 'wait');
  m.awaiting.set(a.key, { tool: e.data.tool, counted: false });
  m.state.stats.approvals += 1;
  return { icon: '🛂', text: `Needs permission: ${e.data.summary}`, level: 'warn' };
}

/** @type {Apply} */
function applyPermissionDenied(m, e, s, a) {
  a.status = 'working';
  m.awaiting.delete(a.key);
  const reason = e.data.reason ? ` (${clip(e.data.reason, 80)})` : '';
  return { icon: '🚫', text: `Permission denied: ${e.data.summary}${reason}`, level: 'warn' };
}

/** @type {Readonly<Record<string, (a: AgentState) => LogDraft['level']>>} */
const NOTIFY = Object.freeze({
  permission_prompt: (a) => {
    a.status = 'waiting';
    place(a, 'permits', 'wait');
    return 'warn';
  },
  agent_needs_input: (a) => {
    a.status = 'waiting';
    return 'warn';
  },
  idle_prompt: (a) => {
    if (a.status !== 'done') a.status = 'idle';
    place(a, 'cafe', 'sip');
    return 'info';
  },
});

/** @type {Apply} */
function applyNotify(m, e, s, a) {
  const react = own(NOTIFY, e.data.notificationType);
  const level = react ? react(a) : 'info';
  const text = e.data.message || e.data.title;
  return text ? { icon: '🔔', text, level } : null;
}

/** @type {Apply} */
function applySubagentStart(m, e, s, a) {
  a.status = 'working';
  place(a, 'hall', 'wave');
  m.state.stats.subagents += 1;
  const what = a.description ? `: ${a.description}` : '';
  return { icon: a.role === 'teammate' ? '🤝' : '✨', text: `Joined the crew${what}`, level: 'success' };
}

/** @type {Apply} */
function applySubagentStop(m, e, s, a) {
  a.status = 'done';
  a.currentTool = undefined;
  a.lastMessage = clip(e.data.lastMessage, 2000) || a.lastMessage;
  place(a, 'hall', 'celebrate');
  m.retired.set(a.key, e.ts);
  if (m.retired.size > MAX_RETIRED) m.retired.delete(m.retired.keys().next().value);
  pruneDoneHelpers(m, s);
  const said = e.data.lastMessage ? `: ${clip(oneLine(e.data.lastMessage), 160)}` : '';
  return { icon: '🏁', text: `Finished${said}`, level: 'success' };
}

/** @type {Apply} */
function applyTurnStop(m, e, s, a) {
  a.status = 'idle';
  a.currentTool = undefined;
  a.lastMessage = clip(e.data.lastMessage, 2000) || a.lastMessage;
  m.awaiting.delete(a.key);
  place(a, 'cafe', 'sip');
  const said = e.data.lastMessage ? clip(oneLine(e.data.lastMessage), 160) : 'Finished the turn';
  return { icon: '✅', text: e.data.lastMessage ? `Done: ${said}` : said, level: 'success' };
}

/** @type {Apply} */
function applyTurnFail(m, e, s, a) {
  a.status = 'error';
  a.errors += 1;
  a.currentTool = undefined;
  a.lastMessage = clip(e.data.lastMessage, 2000) || a.lastMessage;
  m.turnFailed.add(a.key);
  m.state.stats.failures += 1;
  place(a, null, 'facepalm');
  const label = own(STOP_FAILURES, e.data.error) ?? `Stopped (${String(e.data.error).replace(/_/g, ' ')})`;
  const details = e.data.errorDetails ? `: ${clip(e.data.errorDetails, 120)}` : '';
  return { icon: '⛈️', text: `${label}${details}`, level: 'error' };
}

/** @type {Apply} */
function applyTaskHook(m, e, s, a, relabels) {
  const { taskId, subject, teammateName } = e.data;
  const completed = e.kind === 'task.completed';
  const existing = taskId ? s.tasks.find((t) => t.id === taskId) : undefined;
  upsertTask(s, {
    id: taskId,
    subject,
    status: completed ? 'completed' : existing ? null : 'pending',
    owner: teammateName,
  });
  reconcileTeammate(m, s, a, teammateName, relabels);
  const label = taskId ? `Task #${taskId}` : 'Task';
  return completed
    ? { icon: '✔️', text: `${label} done: ${subject}`, level: 'success' }
    : { icon: '📌', text: `${label} created: ${subject}`, level: 'info' };
}

/** @type {Apply} */
function applyTeammateIdle(m, e, s, a, relabels) {
  reconcileTeammate(m, s, a, e.data.teammateName, relabels);
  if (a.role === 'lead') return { icon: '☕', text: `${e.data.teammateName ?? 'A teammate'} is idle`, level: 'info' };
  a.status = 'idle';
  a.currentTool = undefined;
  place(a, 'cafe', 'sip');
  return { icon: '☕', text: 'Idle, waiting for work', level: 'info' };
}

/** @type {Apply} */
function applyCompactStart(m, e, s, a) {
  a.status = 'working';
  place(a, 'spa', 'spa');
  return { icon: '♨️', text: `Compacting the context (${e.data.trigger})`, level: 'info' };
}

/** @type {Apply} */
function applyCompactEnd(m, e, s, a) {
  place(a, 'spa', 'idle');
  return { icon: '🧠', text: 'Context compacted', level: 'success' };
}

/** @type {Apply} */
function applyModelSwitch(m, e, s, a) {
  const { from, to } = e.data;
  if (!to) return null;
  a.model = to;
  if (a.role === 'lead') {
    s.model = to;
    a.hat = hatForModel(to) ?? a.hat;
  }
  return { icon: '🎩', text: `Model: ${from ? modelLabel(from) : '?'} → ${modelLabel(to)}`, level: 'info' };
}

/** @type {Apply} */
function applyTodos(m, e, s) {
  s.todos = e.data.todos.map((/** @type {{text: string, status: ItemStatus}} */ t) => ({ text: t.text, status: t.status }));
  return null;
}

/** @type {Apply} */
function applyTaskUpsert(m, e, s) {
  const { taskId, subject, status, owner } = e.data;
  if (taskId || subject) upsertTask(s, { id: taskId, subject, status, owner });
  return null;
}

/** @type {Apply} */
function applySpawnRequest(m, e, s) {
  const d = e.data;
  const list = m.spawns.get(s.id) ?? [];
  m.spawns.set(s.id, list);
  boundedPush(
    list,
    /** @type {Spawn} */ ({
      toolUseId: d.toolUseId,
      subagentType: d.subagentType,
      name: d.name,
      teamName: d.teamName,
      description: d.description,
      model: d.model,
      claimedBy: null,
    }),
    MAX_SPAWNS_PER_SESSION,
  );
  return null;
}

/** @type {Apply} */
function applySpawnResult(m, e, s, a, relabels) {
  const { agentId, toolUseId } = e.data;
  const spawn = toolUseId ? (m.spawns.get(s.id) ?? []).find((sp) => sp.toolUseId === toolUseId) : undefined;
  if (!agentId || !spawn) return null;
  const key = agentKeyOf(s.id, agentId);
  if (m.state.agents[key]) {
    assignSpawn(m, s, key, spawn, relabels);
  } else if (!spawn.claimedBy) {
    // Launched in the background before its SubagentStart arrived: remember who it will be.
    spawn.claimedBy = key;
    m.spawnOf.set(key, spawn);
  }
  return null;
}

/** @type {Apply} */
function applyMessage(m, e) {
  const to = e.data.to ?? 'the team';
  const gist = e.data.summary || clip(oneLine(e.data.message), 120);
  return { icon: '✉️', text: gist ? `To ${to}: ${gist}` : `Message to ${to}`, level: 'info' };
}

/** @type {Readonly<Record<string, Apply>>} */
const APPLY = Object.freeze({
  'session.start': applySessionStart,
  'session.end': applySessionEnd,
  prompt: applyPrompt,
  'tool.start': applyToolStart,
  'tool.end': applyToolEnd,
  'tool.fail': applyToolFail,
  'permission.request': applyPermissionRequest,
  'permission.denied': applyPermissionDenied,
  notify: applyNotify,
  'subagent.start': applySubagentStart,
  'subagent.stop': applySubagentStop,
  'turn.stop': applyTurnStop,
  'turn.fail': applyTurnFail,
  'task.created': applyTaskHook,
  'task.completed': applyTaskHook,
  'teammate.idle': applyTeammateIdle,
  'compact.start': applyCompactStart,
  'compact.end': applyCompactEnd,
  'model.switch': applyModelSwitch,
  'todos.set': applyTodos,
  'task.upsert': applyTaskUpsert,
  'spawn.request': applySpawnRequest,
  'spawn.result': applySpawnResult,
  'message.send': applyMessage,
});

/** @param {unknown} e @returns {e is TownEvent} */
function isTownEvent(e) {
  return isObject(e) && typeof e.kind === 'string' && typeof e.sessionId === 'string' && typeof e.agentKey === 'string' && isObject(e.data);
}

/**
 * @param {Model} m
 * @param {{ts: number, sessionId: string, agentKey: string, kind: string}} at
 * @param {Session|undefined} s
 * @param {AgentState|undefined} a
 * @param {LogDraft} draft
 */
function pushLog(m, at, s, a, draft) {
  /** @type {LogEntry} */
  const entry = {
    id: ++m.logSeq,
    ts: at.ts,
    sessionId: at.sessionId,
    agentKey: a?.key ?? at.agentKey,
    agentName: a?.name ?? LEAD_NAME,
    color: a?.color ?? s?.color ?? CREW_COLORS[0],
    kind: at.kind,
    icon: draft.icon,
    text: clip(oneLine(draft.text), 240),
    level: draft.level,
  };
  boundedPush(m.state.log, entry, m.maxLog);
  if (a) boundedPush(a.recent, entry, MAX_RECENT);
  return entry;
}

/**
 * Applies one event. Returns the event as applied (attributed, possibly with `data.relabels`),
 * or null when it was dropped.
 * @param {Model} m
 * @param {unknown} input
 * @returns {TownEvent|null}
 */
function apply(m, input) {
  if (!isTownEvent(input)) return null;
  const s = sessionFor(m, input);
  if (!s) return null;
  const e = attribute(m, { ...input, data: { ...input.data } });
  // Async hooks of a finished subagent can still trickle in; they must not resurrect it.
  if (m.retired.has(e.agentKey)) return null;
  const a = e.kind === 'session.end' ? m.state.agents[agentKeyOf(s.id, null)] : agentFor(m, s, e);
  m.state.stats.events += 1;
  /** @type {Relabel[]} */
  const relabels = [];
  const handler = own(APPLY, e.kind);
  const draft = handler && a ? handler(m, e, s, a, relabels) : null;
  if (relabels.length) e.data.relabels = relabels;
  s.lastActivity = Math.max(s.lastActivity, e.ts);
  if (a) a.lastActivity = Math.max(a.lastActivity, e.ts);
  if (s.status !== 'ended') s.status = sessionStatus(m, s);
  if (draft) pushLog(m, e, s, a, draft);
  return e;
}

// ---------------------------------------------------------------------------------------------
// Approvals (from the server, or created by demo mode).

/** @param {Approval[]} list */
function sortApprovals(list) {
  list.sort((x, y) => {
    const px = x.status === 'pending' ? 0 : 1;
    const py = y.status === 'pending' ? 0 : 1;
    return px - py || (y.createdAt ?? 0) - (x.createdAt ?? 0);
  });
  if (list.length > MAX_APPROVALS) {
    const keep = list.filter((a, i) => a.status === 'pending' || i < MAX_APPROVALS);
    list.splice(0, list.length, ...keep);
  }
}

/**
 * Counts an approved permission request once, whether it was approved in the town (status
 * 'allowed') or in the terminal (the tool then simply ran).
 * @param {Model} m
 * @param {string} key
 * @param {string} tool
 */
function countApproval(m, key, tool) {
  const waiting = m.awaiting.get(key);
  if (waiting?.counted) return [];
  m.awaiting.set(key, { tool, counted: true });
  return m.tracker.approvalAllowed();
}

const APPROVAL_LOG = Object.freeze({
  allowed: { icon: '👍', prefix: 'Approved', level: 'success' },
  denied: { icon: '🙅', prefix: 'Denied', level: 'warn' },
  expired: { icon: '⌛', prefix: 'No answer in time, the terminal asks instead', level: 'warn' },
});

/**
 * A pending request parks its agent at the Permit Office; an answer sends it back to work.
 * @param {Model} m
 * @param {AgentState} a
 * @param {string} key
 * @param {Approval['status']} status
 * @param {string} tool
 */
function waitForAnswer(m, a, key, status, tool) {
  if (status === 'pending') {
    a.status = 'waiting';
    place(a, 'permits', 'wait');
    if (!m.awaiting.has(key)) m.awaiting.set(key, { tool, counted: false });
  } else if ((status === 'allowed' || status === 'denied') && a.status === 'waiting') {
    a.status = 'working';
  }
}

/**
 * @param {Model} m
 * @param {Approval} approval
 * @param {number} ts
 * @returns {string[]} achievement ids unlocked
 */
function approvalChanged(m, approval, ts) {
  const s = m.sessions.get(approval.sessionId);
  const key = agentKeyOf(approval.sessionId, normalizeAgentId(approval.agentId));
  const a = m.state.agents[key];
  const tool = str(approval.toolName) || 'Tool';
  if (a) waitForAnswer(m, a, key, approval.status, tool);
  if (s && s.status !== 'ended') s.status = sessionStatus(m, s);
  const log = own(APPROVAL_LOG, approval.status);
  if (log) {
    const summary = summarizeTool(tool, approval.toolInput, approval.cwd ?? s?.cwd ?? '');
    const at = { ts, sessionId: approval.sessionId, agentKey: key, kind: 'approval' };
    pushLog(m, at, s, a, { icon: log.icon, text: `${log.prefix}: ${summary}`, level: /** @type {LogDraft['level']} */ (log.level) });
  }
  if (approval.status === 'denied') m.awaiting.delete(key);
  return approval.status === 'allowed' ? countApproval(m, key, tool) : [];
}

// ---------------------------------------------------------------------------------------------

/**
 * @param {{maxLog?: number, now?: () => number, localHour?: (ts: number) => number, onError?: (error: unknown) => void}} [options]
 *   now: clock for approvals and timestamp-less envelopes; localHour: for Night Shift;
 *   onError: where a throwing subscriber is reported (it never breaks ingestion).
 * @returns {Store}
 */
export function createStore(options = {}) {
  const maxLog = Number.isInteger(options.maxLog) && options.maxLog > 0 ? options.maxLog : 500;
  const now = options.now ?? Date.now;
  const localHour = options.localHour ?? ((ts) => new Date(ts).getHours());
  const onError = options.onError ?? ((error) => console.error('andary store listener failed', error));
  /** @type {Set<(change: StoreChange) => void>} */
  const listeners = new Set();
  let m = createModel(localHour, maxLog);

  /** @param {StoreChange} change */
  function emit(change) {
    for (const listener of [...listeners]) {
      try {
        listener(change);
      } catch (error) {
        onError(error);
      }
    }
  }

  /**
   * Records unlocked achievements (state and log first, so listeners see a consistent state).
   * @param {string[]} ids
   * @param {{ts: number, sessionId: string, agentKey: string}} at
   */
  function unlock(ids, at) {
    const unlocked = [];
    for (const id of ids) {
      const achievement = achievementFor(id, at.ts);
      if (!achievement) continue;
      m.state.achievements.push(achievement);
      const s = m.sessions.get(at.sessionId);
      const draft = { icon: '🏆', text: `Achievement unlocked: ${achievement.title}`, level: /** @type {const} */ ('success') };
      pushLog(m, { ...at, kind: 'achievement' }, s, m.state.agents[at.agentKey], draft);
      unlocked.push(achievement);
    }
    return unlocked;
  }

  /** @param {unknown} event */
  function commit(event) {
    const applied = apply(m, event);
    if (!applied) return null;
    const unlocked = unlock(m.tracker.observe(applied, m.view), applied);
    emit({ type: 'event', event: applied });
    for (const achievement of unlocked) emit({ type: 'achievement', achievement });
    // A terminal-approved tool just ran: count it for Rubber Stamp.
    const waiting = m.awaiting.get(applied.agentKey);
    if (applied.kind === 'tool.end' && waiting && waiting.tool === applied.data.tool) {
      const approved = waiting.counted ? [] : m.tracker.approvalAllowed();
      m.awaiting.delete(applied.agentKey);
      for (const achievement of unlock(approved, applied)) emit({ type: 'achievement', achievement });
    }
    return applied;
  }

  return {
    ingest(envelope) {
      const applied = [];
      for (const event of normalize(envelope, { now })) {
        const done = commit(event);
        if (done) applied.push(done);
      }
      return applied;
    },
    dispatch(event) {
      commit(event);
    },
    setApproval(approval) {
      if (!isObject(approval) || (typeof approval.id !== 'string' && typeof approval.id !== 'number')) return;
      const list = m.state.approvals;
      const index = list.findIndex((a) => a.id === approval.id);
      const previous = index >= 0 ? list[index] : null;
      /** @type {Approval} */
      const next = { ...previous, ...approval };
      if (index >= 0) list[index] = next;
      else list.push(next);
      sortApprovals(list);
      const ts = now();
      const ids = previous?.status === next.status ? [] : approvalChanged(m, next, ts);
      const at = { ts, sessionId: str(next.sessionId), agentKey: agentKeyOf(str(next.sessionId), normalizeAgentId(next.agentId)) };
      const unlocked = unlock(ids, at);
      emit({ type: 'approval', approval: next });
      for (const achievement of unlocked) emit({ type: 'achievement', achievement });
    },
    setUsage(record, days) {
      const usage = readUsage(record);
      if (usage) {
        m.state.usage[usage.key] = usage.value;
        emit({ type: 'usage', agentKey: usage.key });
      }
      if (Array.isArray(days)) m.state.usageDays = readDays(days);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState() {
      return m.state;
    },
    reset() {
      m = createModel(localHour, maxLog);
      emit({ type: 'reset' });
    },
  };
}

/** @param {unknown} n */
function amount(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * A usage record from the server or the demo, read defensively (it crosses the network).
 * @param {unknown} raw
 * @returns {{ key: string, value: AgentUsage }|null}
 */
function readUsage(raw) {
  if (!isObject(raw) || typeof raw.sessionId !== 'string' || !raw.sessionId) return null;
  const tokens = isObject(raw.tokens) ? raw.tokens : {};
  return {
    key: agentKeyOf(raw.sessionId, normalizeAgentId(typeof raw.agentId === 'string' ? raw.agentId : null)),
    value: {
      tokens: { input: amount(tokens.input), output: amount(tokens.output), cacheRead: amount(tokens.cacheRead), cacheWrite: amount(tokens.cacheWrite) },
      costUsd: amount(raw.costUsd),
      unpriced: raw.unpriced === true,
      model: typeof raw.model === 'string' ? raw.model : null,
    },
  };
}

/** @param {unknown[]} days @returns {UsageDay[]} */
function readDays(days) {
  return days
    .filter((day) => isObject(day) && typeof day.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.date))
    .map((day) => ({ date: /** @type {any} */ (day).date, tokens: amount(/** @type {any} */ (day).tokens), costUsd: amount(/** @type {any} */ (day).costUsd) }))
    .slice(-30);
}

