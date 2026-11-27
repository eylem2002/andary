// The single source of truth the HUD renders and the director follows (CONTRACTS.md §5.1).
// It applies TownEvents to crews (sessions), agents, todos/tasks, approvals, the activity log and
// stats; works out who each event belongs to (subagent labels, teammate names); keeps what each
// agent has asked you (store-dialogs.js) or waits for you on (waits.js), whether it seems stuck
// (loops.js), and where two agents work on the same files (conflicts.js); keeps a receipt of each
// lead's turn (receipts.js); watches each crew's spending, helpers and long turns (watch.js); keeps
// what ended sessions left running, as the server found it (leftovers.js); and unlocks achievements. The town may open mid-session, so every
// session or agent an event mentions is created on first sight.

import { ACHIEVEMENTS, achievementFor } from './achievements.js';
import { BUILDINGS, CREW_COLORS, hatForModel, modelLabel } from './catalog.js';
import { LEAD_NAME, MAX_APPROVALS, MAX_RECENT, MAX_RETIRED, MAX_SPAWNS_PER_SESSION, boundedPush, createModel, helpersOf } from './store-model.js';
import { agentFor, assignSpawn, attribute, dropAgent, nameCrew, personColor, place, pruneDoneHelpers, pruneEndedSessions, reconcileTeammate, repairGuesses, sessionFor, sessionStatus } from './crews.js';
import { recordChange, rememberFile } from './changes.js';
import { hazardText } from './conflicts.js';
import { NO_SESSION, normalize } from './events.js';
import { gitAddsOf, gitCommitsOf, gitHazardOf } from './git-commands.js';
import { agentKeyOf, normalizeAgentId } from './ids.js';
import { rulesText } from './permission-rules.js';
import { noteStateText } from './notes.js';
import { receiptLine } from './receipts.js';
import { readLeftovers } from './leftovers.js';
import { isEditCall } from './watch.js';
import { summarizeTool } from './summaries.js';
import { clip, isObject, oneLine, own, relativePath, str } from './text.js';
import { dialogsAfterApproval, dialogsAfterEvent } from './store-dialogs.js';
import { movesOn, stopLabel, waitAfter } from './waits.js';

export { ACHIEVEMENTS };

/** @typedef {import('./catalog.js').BuildingKey} BuildingKey */
/** @typedef {import('./changes.js').FileChange} FileChange */
/** @typedef {import('./store-model.js').Model} Model */
/** @typedef {import('./catalog.js').Activity} Activity */
/** @typedef {import('./events.js').TownEvent} TownEvent */
/** @typedef {import('./events.js').Envelope} Envelope */
/** @typedef {import('./achievements.js').Achievement} Achievement */
/** @typedef {'pending'|'in_progress'|'completed'} ItemStatus */
/** @typedef {'working'|'waiting'|'idle'|'error'|'done'} AgentStatus */

/**
 * @typedef {object} Session  one Claude Code session, shown as a crew
 * @property {string} id
 * @property {number} number         the crew's number in the HUD (keys 1–9): the lowest one free
 *   when it arrived, kept for as long as the crew is listed, even when older crews are pruned
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
 * @property {string|null} [member]  the teammate whose session this is, in a team town
 * @property {'claude'|'codex'} [source]  the agent behind the session (§4.12)
 */

/**
 * @typedef {object} LogEntry
 * @property {number} id
 * @property {number} ts
 * @property {string} sessionId
 * @property {string} agentKey
 * @property {string} agentName
 * @property {string} color
 * @property {string} kind     TownEvent kind, or 'approval' / 'achievement' / 'stuck' / 'conflict' / 'receipt' / 'watch' / 'leftover'
 * @property {string} icon
 * @property {string} text
 * @property {'info'|'success'|'warn'|'error'} level
 * @property {string} [receiptId]  a 'receipt' line: the receipt it stands for (StoreState.receipts)
 */

/**
 * @typedef {object} AgentState
 * @property {string} key
 * @property {string} sessionId
 * @property {string|null} agentId
 * @property {string} name
 * @property {string} [roleName]   the name its role gives it (Foreman, Scout 1, a teammate's name), when `name` is its person's agents name
 * @property {string} [shownAs]    the name the store last gave it (core/crews.js nameCrew)
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
 * @property {import('./waits.js').Wait|null} wait  what it waits for you on, if anything (waits.js)
 * @property {number} movedAt  when it last moved on (a prompt, a tool call…): a stop sent earlier is stale
 * @property {import('./loops.js').Stuck|null} stuck  why it seems stuck, if it does (loops.js)
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
 * @property {'claude'|'codex'} [source]  the agent that asked
 * @property {string} [cwd]
 * @property {number} createdAt
 * @property {number|null} expiresAt
 * @property {'town'|'terminal'|'timeout'} [decidedBy]
 * @property {'ran'|'denied'|'stopped'} [proof]  resolved: what showed the terminal answered (the tool ran, was denied, or the agent stopped)
 * @property {string} [message]
 * @property {string|null} [callKey]  the server's key for the call's input (§4.5), to find its dialog
 * @property {import('./permission-rules.js').OfferedSuggestion[]} [suggestions]  rules an allow may save ("Allow always")
 * @property {boolean} [canStop]   a deny from the town may also stop the agent ("Deny and stop", Claude Code only)
 * @property {string} [stopNote]   why it may not, when it may not
 * @property {boolean} [stopped]   denied from the town with a stop
 * @property {{ rules: import('./permission-rules.js').PermissionRule[], destination: string, at: number }} [always]  the rule an "Allow always" asked Claude Code to save, and when
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
 * @property {readonly import('./dialogs.js').Dialog[]} dialogs  open: asked and not answered yet, oldest first
 * @property {readonly import('./conflicts.js').Hazard[]} hazards  two agents on the same files now, oldest first
 * @property {LogEntry[]} log              newest last
 * @property {Stats} stats
 * @property {Achievement[]} achievements
 * @property {Record<string, AgentUsage>} usage   agentKey → tokens and estimated cost (§4.8)
 * @property {UsageDay[]} usageDays             the last 30 days, oldest first
 * @property {Note[]} notes                       the owner's notes to agents (§4.15), oldest first
 * @property {readonly import('./receipts.js').Receipt[]} receipts  a receipt per lead's turn that ended, newest last
 * @property {{ alerts: import('./watch.js').WatchAlert[], turns: Record<string, import('./watch.js').WatchTurn>, settings: import('./watch.js').WatchSettings }} watch
 *   the cost and helpers alerts, each crew's turn (for long turns), and the settings they follow (watch.js)
 * @property {{ sessionId: string, at: number, items: import('./leftovers.js').Leftover[] }[]} leftovers
 *   what ended sessions left listening, as the server found it (§4.16), oldest first
 */

/**
 * @typedef {object} AgentUsage
 * @property {{ input: number, output: number, cacheRead: number, cacheWrite: number }} tokens
 * @property {number} costUsd
 * @property {boolean} unpriced
 * @property {string|null} model
 * @property {{ tokens: number, at: number }|null} context  the context its newest message used, and
 *   when that was written; null until one is read and after a compaction (§4.8)
 * @property {number|null} compactedAt  when it last compacted, as far as the server saw
 */

/** @typedef {{ date: string, tokens: number, costUsd: number }} UsageDay */
/** @typedef {import('./notes.js').Note} Note */

/** @typedef {{type: 'event', event: TownEvent}|{type: 'approval', approval: Approval, previous?: string|null}|{type: 'achievement', achievement: Achievement}|{type: 'usage', agentKey: string}|{type: 'note', note: Note}|{type: 'people'}|{type: 'watch'}|{type: 'leftovers', sessionId: string}|{type: 'reset'}} StoreChange */

/**
 * @typedef {object} Store
 * @property {(envelope: Envelope|Record<string, any>) => TownEvent[]} ingest
 * @property {(event: TownEvent) => void} dispatch
 * @property {(approval: Approval) => void} setApproval
 * @property {(record: unknown, days?: unknown) => void} setUsage  one agent's usage totals, and the day totals
 * @property {(people: unknown) => void} setPeople  a team town's people ({name, color, host}[], color an index into CREW_COLORS): their crews take their colour
 * @property {(note: unknown) => void} setNote  a note to an agent, as the server last told of it (§4.15)
 * @property {(settings: unknown) => void} setWatchSettings  the cost and long-turn alerts' thresholds (watch.js); kept across resets
 * @property {(leftovers: unknown) => void} setLeftovers  what an ended session left running (§4.16), from the server
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
 * @property {number} ts               when the call's hook started: guesses pair helpers in this order
 * @property {string|null} claimedBy  agentKey that holds this identity
 * @property {boolean} proven          the Agent result or a teammate's name showed who holds it
 */

/** @typedef {{icon: string, text: string, level: LogEntry['level']}} LogDraft */
/** @typedef {{key: string, name: string, role: AgentState['role'], hat: string}} Relabel */

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
const SHIPPING_LOG = Object.freeze({
  test: ['✅', 'Tests passed'],
  'git-commit': ['📮', 'Committed'],
  'git-push': ['🚚', 'Pushed'],
  install: ['📦', 'Installed packages'],
  deps: ['📦', 'Installed dependencies'],
});
/** Tools whose derived event writes a better log line than the tool call itself. */
const QUIET_TOOLS = new Set(['SendMessage']);
/**
 * Events without a session id share one crew, and no SessionEnd will ever end it: it ends once
 * another crew's event comes this long after its last one, and is pruned like any ended crew.
 */
const NO_SESSION_IDLE_MS = 10 * 60_000;

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
function applySubagentStart(m, e, s, a, relabels) {
  // Its own tool calls may have arrived first; it started when this hook did.
  if (e.ts < a.startedAt) {
    a.startedAt = e.ts;
    repairGuesses(m, s, a.type, relabels);
  }
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
  const label = stopLabel(e.data.error);
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
function applySpawnRequest(m, e, s, a, relabels) {
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
      ts: e.ts,
      claimedBy: null,
      proven: false,
    }),
    MAX_SPAWNS_PER_SESSION,
  );
  // A helper of this type may have started before this call arrived (async hooks race).
  repairGuesses(m, s, d.subagentType, relabels);
  return null;
}

/** @type {Apply} */
function applySpawnResult(m, e, s, a, relabels) {
  const { agentId, toolUseId } = e.data;
  const spawn = toolUseId ? (m.spawns.get(s.id) ?? []).find((sp) => sp.toolUseId === toolUseId) : undefined;
  if (!agentId || !spawn || (spawn.proven && spawn.claimedBy !== agentKeyOf(s.id, agentId))) return null;
  // Also before the subagent's SubagentStart arrived (launched in the background): it starts
  // with the right label, even if another helper had guessed this call meanwhile.
  assignSpawn(m, s, agentKeyOf(s.id, agentId), spawn, relabels);
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
  /** @type {Relabel[]} */
  const relabels = [];
  const a = e.kind === 'session.end' ? m.state.agents[agentKeyOf(s.id, null)] : agentFor(m, s, e, relabels);
  m.state.stats.events += 1;
  const handler = own(APPLY, e.kind);
  const draft = handler && a ? handler(m, e, s, a, relabels) : null;
  if (a) setWait(a, e);
  // A teammate's crew (a team town) is theirs to answer: its dialogs are not kept.
  if (!s.member && dialogsAfterEvent(m.dialogs, e, a ? a.agentId : e.agentId)) m.state.dialogs = m.dialogs.list();
  const newlyStuck = followLoops(m, e, s, a);
  const hazards = followConflicts(m, e, s, a);
  nameCrew(m, s, relabels);
  if (relabels.length) e.data.relabels = relabels;
  s.lastActivity = Math.max(s.lastActivity, e.ts);
  if (a) a.lastActivity = Math.max(a.lastActivity, e.ts);
  if (s.status !== 'ended') s.status = sessionStatus(m, s);
  if (draft) pushLog(m, e, s, a, draft);
  for (const change of newlyStuck) logStuck(m, e, s, change);
  for (const hazard of hazards) logHazard(m, e, s, hazard);
  if (a) followTurn(m, e, s, a);
  if (!s.member) followWatch(m, e, s, a);
  return e;
}

/**
 * What each event means for the cost, helpers and long-turn rules (watch.js): your prompt to a
 * lead, a file changed, a helper started, the lead's turn ended, the session ended.
 * @param {TownEvent} e @param {AgentState|undefined} a
 * @returns {import('./watch.js').WatchStep['type']|null}
 */
function watchStepOf(e, a) {
  const lead = a?.role === 'lead';
  switch (e.kind) {
    case 'prompt':
      return lead ? 'prompt' : null;
    case 'tool.end':
      return isEditCall(e.data.tool, e.data.input) ? 'edit' : null;
    case 'subagent.start':
      return 'helper';
    case 'turn.stop':
    case 'turn.fail':
      return lead ? 'stop' : null;
    case 'session.end':
      return 'end';
    default:
      return null;
  }
}

/**
 * Keeps the cost and helpers alerts on state.watch, with a line in the activity log when one starts.
 * A teammate's crew (a team town) is theirs: its costs are never shared.
 * @param {Model} m @param {TownEvent} e @param {Session} s @param {AgentState|undefined} a
 */
function followWatch(m, e, s, a) {
  const type = watchStepOf(e, a);
  if (!type) return;
  logWatch(m, m.watch.record(/** @type {import('./watch.js').WatchStep} */ ({ type, sessionId: s.id, at: e.ts })), e.ts);
}

/**
 * The watch's alerts and turns onto the state, and a warning in the log for each alert that started.
 * @param {Model} m @param {import('./watch.js').WatchAlert[]} started @param {number} ts
 */
function logWatch(m, started, ts) {
  m.state.watch = { alerts: m.watch.alerts(), turns: m.watch.turns(), settings: m.watch.settings() };
  for (const alert of started) {
    const s = m.sessions.get(alert.sessionId);
    const key = agentKeyOf(alert.sessionId, null);
    pushLog(m, { ts, sessionId: alert.sessionId, agentKey: key, kind: 'watch' }, s, m.state.agents[key], { icon: alert.kind === 'fan-out' ? '👥' : '💸', text: alert.text, level: 'warn' });
  }
}

/**
 * Keeps the lead's turn (receipts.js); when it ends, its receipt gets a line in the activity log,
 * after the line of the turn's end: a warning when it has something to check.
 * @param {Model} m
 * @param {TownEvent} e
 * @param {Session} s
 * @param {AgentState} a
 */
function followTurn(m, e, s, a) {
  const receipt = m.receipts.record(e, a, { costs: m.state.usage, cwd: s.cwd, member: Boolean(s.member) });
  if (!receipt) return;
  m.state.receipts = m.receipts.list();
  const level = receipt.flag || receipt.othersEdited || receipt.test?.result === 'failed' ? 'warn' : 'info';
  const entry = pushLog(m, { ...e, kind: 'receipt' }, s, a, { icon: '🧾', text: receiptLine(receipt), level });
  entry.receiptId = receipt.id;
}

/**
 * The activity log's line when an agent starts to seem stuck, after the line of the event that
 * did it.
 * @param {Model} m
 * @param {TownEvent} e
 * @param {Session} s
 * @param {import('./loops.js').LoopChange} change
 */
function logStuck(m, e, s, change) {
  pushLog(m, { ...e, kind: 'stuck' }, s, m.state.agents[change.agent], { icon: '🔁', text: change.stuck?.text ?? '', level: 'warn' });
}

/** Events after which an agent starts afresh for the stuck rules: its turn ended, you sent a prompt, it finished. */
const FRESH_STARTS = new Set(['prompt', 'turn.stop', 'turn.fail', 'subagent.stop']);
/** Finished tool calls, for the stuck rules: a success, a failure, or a refusal (a failure too). */
const FINISHED_CALLS = new Set(['tool.end', 'tool.fail', 'permission.denied']);

/**
 * Runs the stuck rules (loops.js) on an event and keeps every alert it starts, changes or ends on
 * its agent: one agent's change can end another's alert. Returns the alerts that just started.
 * @param {Model} m
 * @param {TownEvent} e
 * @param {Session} s
 * @param {AgentState|undefined} a
 * @returns {import('./loops.js').LoopChange[]}
 */
function followLoops(m, e, s, a) {
  /** @type {import('./loops.js').LoopChange[]} */
  let changes = [];
  // A session's end forgets all its agents, those it no longer lists too.
  if (e.kind === 'session.end') changes = m.loops.resetAll((key) => key.startsWith(`${s.id}:`));
  else if (!a) return [];
  else if (startsAfresh(e, a)) changes = m.loops.reset(a.key);
  else if (FINISHED_CALLS.has(e.kind)) changes = m.loops.record(loopCall(e, s, a));
  for (const change of changes) {
    const agent = m.state.agents[change.agent];
    if (agent) agent.stuck = change.stuck;
  }
  return changes.filter((change) => change.started && m.state.agents[change.agent]);
}

/**
 * @param {TownEvent} e
 * @param {AgentState} a
 */
function startsAfresh(e, a) {
  if (FRESH_STARTS.has(e.kind)) return true;
  // A teammate going idle ends its turn; one the store cannot place lands on the lead: not its turn
  // (as waits.js has it).
  if (e.kind === 'teammate.idle') return a.role === 'teammate';
  // A compaction carries on with the same work, loops and all.
  if (e.kind === 'session.start') return e.data.source !== 'compact';
  // You interrupted it, so you are at its terminal: like a prompt, not a failure.
  return e.kind === 'tool.fail' && e.data.isInterrupt === true;
}

/**
 * A finished tool call as the stuck rules read it.
 * @param {TownEvent} e
 * @param {Session} s
 * @param {AgentState} a
 * @returns {import('./loops.js').LoopCall}
 */
function loopCall(e, s, a) {
  const ok = e.kind === 'tool.end';
  const error = e.kind === 'permission.denied' ? str(e.data.reason) || 'Permission denied' : str(e.data.errorText);
  return { agent: a.key, folder: e.cwd || s.cwd, tool: e.data.tool, input: e.data.input, ok, error: ok ? '' : error, at: e.ts };
}

/**
 * The agent's wait after an event (waits.js), and when it last moved on.
 * @param {AgentState} a
 * @param {TownEvent} e
 */
function setWait(a, e) {
  const next = waitAfter(a, e);
  if (next !== undefined) a.wait = next;
  if (movesOn(e)) a.movedAt = Math.max(a.movedAt, e.ts);
}

/** Shell tools whose command line may hold a git command (git-commands.js). */
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
/** Tools that start a helper: their call ending (unless launched in the background) ends it. */
const SPAWN_TOOLS = new Set(['Agent', 'Task']);

/** @typedef {import('./conflicts.js').Hazard} Hazard */
/** @typedef {(m: Model, e: TownEvent, s: Session, a: AgentState) => Hazard[]} ConflictStep */

/**
 * What each event does to the same-file and git rules (conflicts.js): a file change or a git
 * command may start a hazard, a refusal ends the command's, a commit that went through takes its
 * committer's changes out of harm's way, and a helper finishing (also without its SubagentStop:
 * its call ended, or the lead was interrupted) leaves its changes to its lead; its crew leaving
 * ends them all.
 * @type {Readonly<Record<string, ConflictStep>>}
 */
const CONFLICT_STEPS = Object.freeze({
  'tool.start': commandStarted,
  'tool.end': toolEnded,
  'tool.fail': (m, e, s) => (SPAWN_TOOLS.has(e.data.tool) ? finishHelper(m, s, e.data.toolUseId, null) : []),
  'permission.denied': (m, e, s, a) => (m.conflicts.refused({ agent: a.key, toolUseId: e.data.toolUseId, callKey: e.data.callKey }), []),
  'spawn.result': (m, e, s) => (e.data.status === 'async_launched' ? [] : finishHelper(m, s, e.data.toolUseId, e.data.agentId)),
  'subagent.stop': (m, e, s, a) => (m.conflicts.finished(a.key, leadOf(s, a)), []),
  'turn.stop': (m, e, s, a) => (e.data.interrupted === true && a.role === 'lead' ? helpersOf(m, s.id).flatMap((h) => finishHelper(m, s, null, h.agentId)) : []),
});

/**
 * Keeps the same-file and git rules' memory (conflicts.js) and the hazards they find on
 * state.hazards; they also end after half an hour. A teammate's crew (a team town) works on their
 * computer, so its files are left out.
 * @param {Model} m
 * @param {TownEvent} e
 * @param {Session} s
 * @param {AgentState|undefined} a
 * @returns {Hazard[]} the hazards that just started
 */
function followConflicts(m, e, s, a) {
  if (s.member) return [];
  const before = m.conflicts.list();
  m.conflicts.expire(e.ts);
  if (e.kind === 'session.end') m.conflicts.ended(s.id);
  const step = a ? own(CONFLICT_STEPS, e.kind) : undefined;
  const started = step && a ? step(m, e, s, a) : [];
  const after = m.conflicts.list();
  if (after.length !== before.length || after.some((hazard, i) => hazard !== before[i])) m.state.hazards = after;
  return started;
}

/**
 * Who did it, for the rules: a helper names its lead and when it started, as the lead's changes
 * from before then were handed to it.
 * @param {TownEvent} e @param {Session} s @param {AgentState} a
 * @returns {import('./conflicts.js').Actor}
 */
function actorOf(e, s, a) {
  return { agent: a.key, session: s.id, at: e.ts, lead: leadOf(s, a), since: a.startedAt };
}

/** A helper's lead, who keeps its changes when it finishes; null for a lead. @param {Session} s @param {AgentState} a */
function leadOf(s, a) {
  return a.role === 'lead' ? null : agentKeyOf(s.id, null);
}

/**
 * Where a shell command runs: the hook's folder, where its crew started, and the top of the hook
 * folder's work tree when the server found it on disk (`andary_root`, CONTRACTS §4.6).
 * @param {TownEvent} e @param {Session} s
 */
function placeOf(e, s) {
  return { folder: e.cwd || s.cwd, sessionFolder: s.cwd, root: e.data.root };
}

/** A shell command starting: a git hazard shows while it asks for permission or runs. @type {ConflictStep} */
function commandStarted(m, e, s, a) {
  if (!SHELL_TOOLS.has(e.data.tool)) return [];
  const options = { powershell: e.data.tool === 'PowerShell', staged: m.conflicts.staged(a.key), known: (/** @type {string} */ path) => m.conflicts.knows(path) };
  const git = gitHazardOf(e.data.input?.command, placeOf(e, s), options);
  return git ? m.conflicts.command({ ...actorOf(e, s, a), ...git, toolUseId: e.data.toolUseId, callKey: e.data.callKey }) : [];
}

/**
 * A tool that went through: a file change (a Write that made the file, or a Codex patch adding
 * one, makes an untracked file), or a command whose commits took changes in and whose adds wait
 * for the next commit.
 * @type {ConflictStep}
 */
function toolEnded(m, e, s, a) {
  if (!SHELL_TOOLS.has(e.data.tool)) {
    const created = e.data.tool === 'Write' && (e.data.response?.type === 'create' || e.data.sourceTool === 'apply_patch');
    return m.conflicts.changed({ ...actorOf(e, s, a), tool: e.data.tool, path: e.data.file, folder: e.cwd || s.cwd, created });
  }
  const options = { powershell: e.data.tool === 'PowerShell', staged: m.conflicts.staged(a.key) };
  const place = placeOf(e, s);
  for (const commit of gitCommitsOf(e.data.input?.command, place, options)) m.conflicts.committed({ agent: a.key, ...commit });
  m.conflicts.added(a.key, s.id, gitAddsOf(e.data.input?.command, place, options));
  return [];
}

/**
 * A helper is done for the rules: the one an Agent call started (proven by its result, or else
 * paired with it), or the one named.
 * @param {Model} m @param {Session} s @param {string|null} toolUseId @param {string|null} agentId
 * @returns {Hazard[]}
 */
function finishHelper(m, s, toolUseId, agentId) {
  const spawn = toolUseId ? (m.spawns.get(s.id) ?? []).find((sp) => sp.toolUseId === toolUseId) : undefined;
  const helper = agentId ? agentKeyOf(s.id, agentId) : spawn?.claimedBy;
  if (helper) m.conflicts.finished(helper, agentKeyOf(s.id, null));
  return [];
}

/**
 * The activity log's line when two agents start to work on the same files, after the line of the
 * event that did it: a warning for an alert, information for an edit's note.
 * @param {Model} m
 * @param {TownEvent} e
 * @param {Session} s
 * @param {import('./conflicts.js').Hazard} hazard
 */
function logHazard(m, e, s, hazard) {
  /** @type {LogDraft} */
  const draft = { icon: '👥', text: hazardText(hazard, m.state, e.ts), level: hazard.kind === 'edit' ? 'info' : 'warn' };
  pushLog(m, { ...e, kind: 'conflict' }, s, m.state.agents[hazard.agentKey], draft);
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
 * The rules an "Allow always" asked Claude Code to save, on one line with hidden characters
 * revealed ('' for any other answer). The approval crosses the network, so it is read defensively.
 * @param {Approval} approval
 */
function savedRules(approval) {
  return approval.status === 'allowed' && isObject(approval.always) ? clip(oneLine(rulesText(approval.always.rules)), 80) : '';
}

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
  const summary = summarizeTool(tool, approval.toolInput, approval.cwd ?? s?.cwd ?? '');
  if (a) waitForAnswer(m, a, key, approval.status, tool);
  dialogsAfterApproval(m.dialogs, approval, summary);
  m.state.dialogs = m.dialogs.list();
  if (s && s.status !== 'ended') s.status = sessionStatus(m, s);
  const log = own(APPROVAL_LOG, approval.status);
  if (log) {
    const saved = savedRules(approval);
    const at = { ts, sessionId: approval.sessionId, agentKey: key, kind: 'approval' };
    pushLog(m, at, s, a, { icon: log.icon, text: saved ? `Allowed; asked to save ${saved}` : `${approval.stopped === true ? 'Denied and stopped the agent' : log.prefix}: ${summary}`, level: /** @type {LogDraft['level']} */ (log.level) });
  }
  if (approval.status === 'denied') {
    m.awaiting.delete(key);
    // A git command refused in the town runs nothing: its alert ends.
    if (m.conflicts.refused({ agent: key, callKey: typeof approval.callKey === 'string' ? approval.callKey : null })) m.state.hazards = m.conflicts.list();
  }
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
  /** Kept across resets: the people do not change when the history is replayed. */
  let people = m.people;
  const watching = watchApi(() => m, emit, now);

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
    if (isTownEvent(event) && event.sessionId !== NO_SESSION) endIdleNoSession(event.ts);
    const applied = apply(m, event);
    if (!applied) return null;
    const unlocked = unlock(m.tracker.observe(applied, m.view), applied);
    emit({ type: 'event', event: applied });
    for (const achievement of unlocked) emit({ type: 'achievement', achievement });
    // A terminal-approved tool just ran: count it for Rubber Stamp.
    const waiting = m.awaiting.get(applied.agentKey);
    if (applied.kind === 'tool.end' && waiting && (waiting.tool === applied.data.tool || waiting.tool === applied.data.sourceTool)) {
      const approved = waiting.counted ? [] : m.tracker.approvalAllowed();
      m.awaiting.delete(applied.agentKey);
      for (const achievement of unlock(approved, applied)) emit({ type: 'achievement', achievement });
    }
    return applied;
  }

  /**
   * Ends the crew of events without a session id once it has been quiet for NO_SESSION_IDLE_MS,
   * through an ordinary session end, so the HUD and the town see it leave.
   * @param {number} ts
   */
  function endIdleNoSession(ts) {
    const end = idleEnd(m, ts);
    if (end) commit(end);
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
      // Handed back to the terminal without a new status (a release): its dialog is no longer held.
      if (previous?.status === next.status && previous.held !== next.held) {
        dialogsAfterApproval(m.dialogs, next, '');
        m.state.dialogs = m.dialogs.list();
      }
      const at = { ts, sessionId: str(next.sessionId), agentKey: agentKeyOf(str(next.sessionId), normalizeAgentId(next.agentId)) };
      const unlocked = unlock(ids, at);
      // The status before this change, so a reaction plays once (a late proof re-sends an expired one).
      emit({ type: 'approval', approval: next, previous: previous ? str(previous.status) : null });
      for (const achievement of unlocked) emit({ type: 'achievement', achievement });
    },
    setNote(raw) {
      const note = readNote(raw);
      if (note && noteChanged(m, note, now())) emit({ type: 'note', note });
    },
    setUsage(record, days) {
      const key = applyUsage(m, record, days, now());
      if (key) emit({ type: 'usage', agentKey: key });
    },
    ...watching.methods,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState() {
      return m.state;
    },
    setPeople(list) {
      people = readPeople(list);
      if (recolorPeople(m, people)) emit({ type: 'people' });
    },
    reset() {
      m = Object.assign(createModel(localHour, maxLog), { people });
      watching.restore(m);
      emit({ type: 'reset' });
    },
  };
}

/**
 * An agent's usage totals (and the last days'), from the server or the demo. Its crew's spending
 * goes to the cost alerts (watch.js), but not a teammate's crew's.
 * @param {Model} m @param {unknown} record @param {unknown} days @param {number} at
 * @returns {string|null} the agent whose totals changed
 */
function applyUsage(m, record, days, at) {
  const usage = readUsage(record);
  if (usage) {
    m.state.usage[usage.key] = usage.value;
    // The turn that ended last gets its cost as the transcript catches up.
    m.receipts.priced(usage.sessionId, m.state.usage);
    if (!m.sessions.get(usage.sessionId)?.member) {
      const t = usage.value.tokens;
      const step = { type: /** @type {const} */ ('usage'), sessionId: usage.sessionId, agentKey: usage.key, costUsd: usage.value.costUsd, tokens: t.input + t.output + t.cacheRead + t.cacheWrite, at };
      logWatch(m, m.watch.record(step), at);
    }
  }
  if (Array.isArray(days)) m.state.usageDays = readDays(days);
  return usage ? usage.key : null;
}

/**
 * New people for the model; a person who picked another colour or agents name takes their crews
 * with them. True when a crew changed colour or a name.
 * @param {Model} m @param {Model['people']} people
 */
function recolorPeople(m, people) {
  m.people = people;
  let changed = false;
  for (const s of m.state.sessions) {
    if (nameCrew(m, s, [])) changed = true;
    const color = personColor(m, s.member ?? null);
    if (!color || color === s.color) continue;
    s.color = color;
    for (const key of s.agentKeys) if (m.state.agents[key]) m.state.agents[key].color = color;
    changed = true;
  }
  return changed;
}

/**
 * A team town's people as the store keeps them: each name's colour and who hosts.
 * @param {unknown} list
 * @returns {{ host: string|null, colors: Map<string, string>, agents: Map<string, string> }}
 */
function readPeople(list) {
  const colors = new Map();
  const agents = new Map();
  let host = null;
  for (const person of Array.isArray(list) ? list : []) {
    const color = isObject(person) && Number.isInteger(person.color) ? CREW_COLORS[/** @type {number} */ (person.color)] : undefined;
    if (!isObject(person) || typeof person.name !== 'string' || !color) continue;
    colors.set(person.name, color);
    const profile = isObject(person.profile) ? person.profile : null;
    if (typeof profile?.agents === 'string' && profile.agents) agents.set(person.name, clip(oneLine(profile.agents), 20));
    if (person.host === true) host = person.name;
  }
  return { host, colors, agents };
}

/**
 * The store's setWatchSettings and setLeftovers, on its model of the moment. The thresholds are
 * kept across resets (restore): they are the viewer's, not the history's.
 * @param {() => Model} model @param {(change: StoreChange) => void} emit @param {() => number} now
 */
function watchApi(model, emit, now) {
  /** @type {unknown} */
  let settings = null;
  return {
    /** @param {Model} m */
    restore(m) {
      if (settings !== null) applyWatchSettings(m, settings, now());
    },
    methods: {
      /** @param {unknown} raw */
      setWatchSettings(raw) {
        settings = raw;
        applyWatchSettings(model(), raw, now());
        emit({ type: 'watch' });
      },
      /** @param {unknown} raw */
      setLeftovers(raw) {
        const found = readLeftovers(raw);
        if (found && leftoversChanged(model(), found, now())) emit({ type: 'leftovers', sessionId: found.sessionId });
      },
    },
  };
}

/**
 * The session end of the crew of events without a session id, once it has been quiet for
 * NO_SESSION_IDLE_MS; null while it is not.
 * @param {Model} m @param {number} ts
 * @returns {TownEvent|null}
 */
function idleEnd(m, ts) {
  const s = m.sessions.get(NO_SESSION);
  if (!s || s.status === 'ended' || ts - s.lastActivity < NO_SESSION_IDLE_MS) return null;
  return {
    id: `${NO_SESSION}-idle-${ts}`,
    ts,
    rx: ts,
    kind: 'session.end',
    sessionId: NO_SESSION,
    agentKey: agentKeyOf(NO_SESSION, null),
    agentId: null,
    agentType: null,
    cwd: s.cwd,
    member: s.member ?? null,
    source: s.source ?? 'claude',
    data: { reason: 'idle' },
  };
}

/** New thresholds for the cost and long-turn rules (watch.js). @param {Model} m @param {unknown} raw @param {number} now */
function applyWatchSettings(m, raw, now) {
  m.watch.setSettings(raw);
  logWatch(m, [], now);
}

/** Ended sessions whose leftovers are kept; the oldest give way. */
const MAX_LEFTOVERS = 20;

/**
 * Keeps what an ended session left running, with a line in its crew's log for each. False when
 * it is the same as before (a reconnect sends it again).
 * @param {Model} m @param {{ sessionId: string, at: number, items: import('./leftovers.js').Leftover[] }} found @param {number} now
 */
function leftoversChanged(m, found, now) {
  const list = m.state.leftovers;
  const before = list.find((l) => l.sessionId === found.sessionId);
  if (before && before.at === found.at) return false;
  m.state.leftovers = [...list.filter((l) => l !== before), found].slice(-MAX_LEFTOVERS);
  const s = m.sessions.get(found.sessionId);
  const key = agentKeyOf(found.sessionId, null);
  for (const item of found.items) {
    pushLog(m, { ts: found.at || now, sessionId: found.sessionId, agentKey: key, kind: 'leftover' }, s, m.state.agents[key], { icon: '🔌', text: `Left running: ${item.command} (port ${item.port})`, level: 'warn' });
  }
  return true;
}

/** Notes the store keeps; the oldest give way. */
const MAX_NOTES = 100;
const NOTE_STATUSES = new Set(['queued', 'delivered', 'expired']);

/**
 * Keeps a note's latest state, with a line in the activity log for each new state (queued, handed
 * to the agent with the hook that carried it, expired). False when nothing changed.
 * @param {Model} m @param {Note} note @param {number} ts
 */
function noteChanged(m, note, ts) {
  const list = m.state.notes;
  const index = list.findIndex((n) => n.id === note.id);
  if (index >= 0 && list[index].status === note.status) return false;
  if (index >= 0) list[index] = note;
  else boundedPush(list, note, MAX_NOTES);
  const key = agentKeyOf(note.sessionId, note.agentId);
  const level = /** @type {LogDraft['level']} */ (note.status === 'expired' ? 'warn' : 'info');
  const draft = { icon: '✉️', text: `${noteStateText(note)} — “${clip(oneLine(note.text), 60)}”`, level };
  pushLog(m, { ts, sessionId: note.sessionId, agentKey: key, kind: 'note' }, m.sessions.get(note.sessionId), m.state.agents[key], draft);
  return true;
}

/**
 * A note from the server, read defensively (it crosses the network).
 * @param {unknown} raw
 * @returns {Note|null}
 */
function readNote(raw) {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.sessionId !== 'string' || !NOTE_STATUSES.has(raw.status)) return null;
  return {
    id: raw.id,
    status: raw.status,
    sessionId: raw.sessionId,
    agentId: normalizeAgentId(typeof raw.agentId === 'string' ? raw.agentId : null),
    text: str(raw.text),
    createdAt: amount(raw.createdAt),
    expiresAt: amount(raw.expiresAt),
    ...(amount(raw.deliveredAt) ? { deliveredAt: amount(raw.deliveredAt) } : {}),
    ...(typeof raw.hook === 'string' && /^\w{1,40}$/.test(raw.hook) ? { hook: raw.hook } : {}),
    ...(typeof raw.reason === 'string' ? { reason: clip(oneLine(raw.reason), 200) } : {}),
  };
}

/** @param {unknown} n */
function amount(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * A usage record from the server or the demo, read defensively (it crosses the network).
 * @param {unknown} raw
 * @returns {{ key: string, sessionId: string, value: AgentUsage }|null}
 */
function readUsage(raw) {
  if (!isObject(raw) || typeof raw.sessionId !== 'string' || !raw.sessionId) return null;
  const tokens = isObject(raw.tokens) ? raw.tokens : {};
  return {
    key: agentKeyOf(raw.sessionId, normalizeAgentId(typeof raw.agentId === 'string' ? raw.agentId : null)),
    sessionId: raw.sessionId,
    value: {
      tokens: { input: amount(tokens.input), output: amount(tokens.output), cacheRead: amount(tokens.cacheRead), cacheWrite: amount(tokens.cacheWrite) },
      costUsd: amount(raw.costUsd),
      unpriced: raw.unpriced === true,
      model: typeof raw.model === 'string' ? raw.model : null,
      context: readContext(raw.context),
      compactedAt: amount(raw.compactedAt) || null,
    },
  };
}

/**
 * A context reading, or null for anything that is not a token count with a time.
 * @param {unknown} raw
 * @returns {AgentUsage['context']}
 */
function readContext(raw) {
  if (!isObject(raw)) return null;
  const tokens = Math.round(amount(raw.tokens));
  const at = amount(raw.at);
  return tokens > 0 && at > 0 ? { tokens, at } : null;
}

/** @param {unknown[]} days @returns {UsageDay[]} */
function readDays(days) {
  return days
    .filter((day) => isObject(day) && typeof day.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.date))
    .map((day) => ({ date: /** @type {any} */ (day).date, tokens: amount(/** @type {any} */ (day).tokens), costUsd: amount(/** @type {any} */ (day).costUsd) }))
    .slice(-30);
}

