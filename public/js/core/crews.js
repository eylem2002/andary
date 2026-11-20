// Crews and their agents in the store's model (core/store.js): sessions are created on their first
// event, every event is attributed to the right agent (the lead, a subagent or an agent-team
// teammate, matched to the Agent call that spawned it), helpers get role names and hats, and
// finished helpers and ended sessions are pruned so a long day stays small.

import { CREW_COLORS, hatForModel } from './catalog.js';
import { agentKeyOf } from './ids.js';
import { own } from './text.js';
import { LEAD_NAME, MAX_DONE_PER_SESSION, MAX_ENDED_SESSIONS, ROLE_NAMES, TEAMMATE_HATS, helpersOf, projectName, titleCase } from './store-model.js';

/** @typedef {import('./store.js').BuildingKey} BuildingKey */
/** @typedef {import('./store.js').Activity} Activity */
/** @typedef {import('./store.js').TownEvent} TownEvent */
/** @typedef {import('./store.js').Session} Session */
/** @typedef {import('./store.js').AgentState} AgentState */
/** @typedef {import('./store.js').Spawn} Spawn */
/** @typedef {import('./store.js').Relabel} Relabel */
/** @typedef {import('./store-model.js').Model} Model */

// ---------------------------------------------------------------------------------------------
// Sessions and agents.

/** @param {Model} m @param {TownEvent} e */
export function newSession(m, e) {
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
    member: e.member ?? null,
    source: e.source ?? 'claude',
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
export function sessionFor(m, e) {
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
export function baseAgent(s, key, agentId, ts) {
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
export function register(m, s, agent) {
  m.state.agents[agent.key] = agent;
  if (!s.agentKeys.includes(agent.key)) s.agentKeys.push(agent.key);
  return agent;
}

/** @param {Model} m @param {Session} s @param {TownEvent} e */
export function createLead(m, s, e) {
  const agent = baseAgent(s, agentKeyOf(s.id, null), null, e.ts);
  // In a team town a teammate's lead carries their name, so the town shows whose crew it is.
  if (s.member) agent.name = s.member;
  agent.type = (e.kind === 'session.start' && e.data.agentType) || 'main';
  agent.model = s.model;
  agent.hat = hatForModel(s.model) ?? 'hardhat';
  return register(m, s, agent);
}

/** @param {Model} m @param {string} sessionId @param {string} type */
export function nextRoleName(m, sessionId, type) {
  const role = own(ROLE_NAMES, type) ?? titleCase(type);
  const counter = `${sessionId}\u0000${role}`;
  const n = (m.roleCounts.get(counter) ?? 0) + 1;
  m.roleCounts.set(counter, n);
  return `${role} ${n}`;
}

/** Teammates get hats that differ from each other and, while there are enough, from the lead's. */
/** @param {Model} m @param {Session} s */
export function nextTeammateHat(m, s) {
  const leadHat = m.state.agents[agentKeyOf(s.id, null)]?.hat;
  const choices = TEAMMATE_HATS.filter((h) => h !== leadHat);
  const turn = m.hatTurns.get(s.id) ?? 0;
  m.hatTurns.set(s.id, turn + 1);
  return choices[turn % choices.length];
}

/** @param {Spawn|null|undefined} spawn @returns {AgentState['role']} */
export function roleOf(spawn) {
  return spawn && (spawn.name || spawn.teamName) ? 'teammate' : 'subagent';
}

/**
 * FIFO match of a newly seen subagent with the oldest unclaimed Agent/Task call of its type.
 * @param {Model} m
 * @param {string} sessionId
 * @param {string|null} agentType
 * @param {string} agentKey
 */
export function claimSpawn(m, sessionId, agentType, agentKey) {
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
export function createHelper(m, s, e) {
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
export function agentFor(m, s, e) {
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
export function relabel(m, s, key, spawn, relabels) {
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
export function assignSpawn(m, s, agentKey, spawn, relabels) {
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
export function reconcileTeammate(m, s, agent, teammateName, relabels) {
  if (!teammateName || !agent || agent.role === 'lead' || agent.name === teammateName) return;
  const spawn = (m.spawns.get(s.id) ?? []).find((sp) => sp.name === teammateName);
  if (spawn) return assignSpawn(m, s, agent.key, spawn, relabels);
  const hat = agent.role === 'teammate' ? agent.hat : nextTeammateHat(m, s);
  Object.assign(agent, { name: teammateName, role: 'teammate', hat });
  relabels.push({ key: agent.key, name: teammateName, role: 'teammate', hat });
}

/** Events that name a teammate but carry no agent_id belong to that teammate when we know it. */
/** @param {Model} m @param {TownEvent} e */
export function attribute(m, e) {
  const name = e.data.teammateName;
  if (e.agentId || !name) return e;
  const s = m.sessions.get(e.sessionId);
  const match = s && helpersOf(m, s.id).find((a) => a.name === name);
  return match ? { ...e, agentKey: match.key, agentId: match.agentId, agentType: match.type } : e;
}

/** @param {Model} m @param {Session} s @param {string} key */
export function dropAgent(m, s, key) {
  delete m.state.agents[key];
  s.agentKeys = s.agentKeys.filter((k) => k !== key);
  m.awaiting.delete(key);
  m.turnFailed.delete(key);
  m.spawnOf.delete(key);
}

/** @param {Model} m @param {Session} s */
export function pruneDoneHelpers(m, s) {
  const done = helpersOf(m, s.id).filter((a) => a.status === 'done');
  const excess = done.length - MAX_DONE_PER_SESSION;
  if (excess <= 0) return;
  done
    .sort((a, b) => a.lastActivity - b.lastActivity)
    .slice(0, excess)
    .forEach((a) => dropAgent(m, s, a.key));
}

/** @param {Model} m */
export function pruneEndedSessions(m) {
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
export function sessionStatus(m, s) {
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
export function place(a, building, activity) {
  if (building) a.building = building;
  a.activity = activity;
}
