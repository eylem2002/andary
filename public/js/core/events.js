// Turns what the server streams (an Envelope wrapping one raw hook payload, CONTRACTS.md §4.2)
// into TownEvents (§5): one primary event per hook, plus derived events for tools whose input
// means something on its own (todo lists, shared tasks, spawns, messages between agents).
// Hook data comes from sessions working in untrusted repositories and may be malformed, so every
// reader here is defensive and normalize() never throws.

import { BUILDINGS, activityForTool, buildingForTool } from './catalog.js';
import { agentKeyOf, isDoctorSession, normalizeAgentId } from './ids.js';
import { classifyCommand, classifyError, mcpServerOf, recipientOf, summarizeTool } from './summaries.js';
import { clip, finite, isObject, listOf, oneLine, own, str, textOf } from './text.js';

/** @typedef {import('./summaries.js').CommandKind} CommandKind */
/** @typedef {import('./summaries.js').ErrorKind} ErrorKind */

/** @typedef {import('./catalog.js').BuildingKey} BuildingKey */
/** @typedef {import('./catalog.js').Activity} Activity */

/** @typedef {'session.start'|'session.end'|'prompt'|'tool.start'|'tool.end'|'tool.fail'|'permission.request'|'permission.denied'|'notify'|'subagent.start'|'subagent.stop'|'turn.stop'|'turn.fail'|'task.created'|'task.completed'|'teammate.idle'|'compact.start'|'compact.end'|'model.switch'|'todos.set'|'task.upsert'|'spawn.request'|'spawn.result'|'message.send'|'unknown'} TownEventKind */

/**
 * What the server sends for every hook (CONTRACTS.md §4.5). A bare hook payload is accepted too,
 * so demo mode and tests can feed simulation output straight in.
 * @typedef {object} Envelope
 * @property {number|string} [id]  server sequence
 * @property {number} [ts]          hook start, ms
 * @property {number} [rx]          server receive, ms
 * @property {Record<string, any>} [event]  sanitized hook payload
 */

/**
 * @typedef {object} TownEvent
 * @property {string} id            envelope id; derived events append ".1", ".2", …
 * @property {number} ts            when the hook fired (ms)
 * @property {number} rx            when the server received it (ms); equals ts when unknown
 * @property {TownEventKind} kind
 * @property {string} sessionId
 * @property {string} agentKey      sessionId + ':' + (agentId ?? 'main')
 * @property {string|null} agentId  subagent/teammate id with any "agent-" prefix removed
 * @property {string|null} agentType
 * @property {string} cwd
 * @property {string|null} member    the teammate whose session this is, in a team town (§4.11)
 * @property {'claude'|'codex'} source  the agent that sent it (§4.12)
 * @property {Record<string, any>} data  kind-specific fields, see the *Data typedefs below
 */

/**
 * Data of tool.start / tool.end / tool.fail / permission.request / permission.denied.
 * @typedef {object} ToolData
 * @property {string|null} toolUseId  null for permission.request (the hook carries none)
 * @property {string} tool
 * @property {string|null} sourceTool  the agent's own name for a tool its adapter renamed (§4.12)
 * @property {Record<string, any>} input
 * @property {BuildingKey} building
 * @property {Activity} activity
 * @property {string} summary          short human text, e.g. "Read src/auth/login.ts"
 * @property {CommandKind|null} commandKind  what a shell command does, for reactions/achievements
 * @property {string|null} mcpServer
 * @property {string|null} file        raw file path the tool touches, if any
 */

/** @type {Readonly<Record<string, TownEventKind>>} */
const KIND_BY_HOOK = Object.freeze({
  SessionStart: 'session.start',
  SessionEnd: 'session.end',
  UserPromptSubmit: 'prompt',
  PreToolUse: 'tool.start',
  PostToolUse: 'tool.end',
  PostToolUseFailure: 'tool.fail',
  PermissionRequest: 'permission.request',
  PermissionDenied: 'permission.denied',
  Notification: 'notify',
  SubagentStart: 'subagent.start',
  SubagentStop: 'subagent.stop',
  Stop: 'turn.stop',
  StopFailure: 'turn.fail',
  TaskCreated: 'task.created',
  TaskCompleted: 'task.completed',
  TeammateIdle: 'teammate.idle',
  PreCompact: 'compact.start',
  PostCompact: 'compact.end',
  PostModelSwitch: 'model.switch',
});

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

// ---------------------------------------------------------------------------------------------
// Per-kind data.

/**
 * @param {Record<string, any>} p
 * @param {string} cwd
 * @returns {ToolData}
 */
function toolData(p, cwd) {
  const tool = oneLine(p.tool_name) || 'Unknown';
  const input = isObject(p.tool_input) ? p.tool_input : {};
  const building = safeBuilding(buildingForTool(tool, input));
  const command = SHELL_TOOLS.has(tool) ? str(input.command) : '';
  return {
    toolUseId: str(p.tool_use_id) || null,
    tool,
    sourceTool: oneLine(p.andary_tool) || null,
    input,
    building,
    activity: activityForTool(tool, building),
    summary: summarizeTool(tool, input, cwd),
    commandKind: command ? classifyCommand(command) : null,
    mcpServer: str(p.mcp_server) || mcpServerOf(tool),
    file: str(input.file_path ?? input.notebook_path) || null,
  };
}

/** @param {unknown} key @returns {BuildingKey} */
function safeBuilding(key) {
  return typeof key === 'string' && Object.hasOwn(BUILDINGS, key) ? /** @type {BuildingKey} */ (key) : 'workshop';
}

/** @param {Record<string, any>} p @param {string} cwd */
function failData(p, cwd) {
  const data = toolData(p, cwd);
  const error = clip(oneLine(textOf(p.error).split('\n')[0]), 200) || 'Error';
  const isInterrupt = p.is_interrupt === true;
  return {
    ...data,
    error,
    isInterrupt,
    errorKind: classifyError(error, isInterrupt, data.commandKind),
    durationMs: finite(p.duration_ms),
  };
}

/** @param {Record<string, any>} p */
function taskHookData(p) {
  return {
    taskId: str(p.task_id) || null,
    subject: oneLine(p.task_subject),
    description: oneLine(p.task_description) || null,
    teammateName: oneLine(p.teammate_name) || null,
    teamName: oneLine(p.team_name) || null,
  };
}

/** @param {Record<string, any>} p */
function lastMessageOf(p) {
  return textOf(p.last_assistant_message).trim();
}

/** @type {Readonly<Record<string, (p: Record<string, any>, cwd: string) => Record<string, any>>>} */
const DATA = Object.freeze({
  'session.start': (p) => ({
    source: str(p.source) || 'startup',
    model: str(p.model) || null,
    title: oneLine(p.session_title) || null,
    agentType: str(p.agent_type) || null,
    permissionMode: str(p.permission_mode) || null,
  }),
  'session.end': (p) => ({ reason: str(p.reason) || 'other' }),
  prompt: (p) => ({ prompt: str(p.prompt).trim(), title: oneLine(p.session_title) || null }),
  'tool.start': (p, cwd) => toolData(p, cwd),
  'tool.end': (p, cwd) => ({ ...toolData(p, cwd), response: p.tool_response ?? null, durationMs: finite(p.duration_ms) }),
  'tool.fail': (p, cwd) => failData(p, cwd),
  'permission.request': (p, cwd) => ({
    ...toolData(p, cwd),
    toolUseId: null,
    suggestions: listOf(p.permission_suggestions),
  }),
  'permission.denied': (p, cwd) => ({ ...toolData(p, cwd), reason: oneLine(p.reason) }),
  notify: (p) => ({
    message: oneLine(p.message),
    title: oneLine(p.title) || null,
    notificationType: str(p.notification_type) || 'other',
  }),
  'subagent.start': (p) => ({ agentType: str(p.agent_type) || null }),
  'subagent.stop': (p) => ({
    agentType: str(p.agent_type) || null,
    lastMessage: lastMessageOf(p),
    transcriptPath: str(p.agent_transcript_path) || null,
    stopHookActive: p.stop_hook_active === true,
  }),
  'turn.stop': (p) => ({
    lastMessage: lastMessageOf(p),
    stopHookActive: p.stop_hook_active === true,
    backgroundTasks: listOf(p.background_tasks),
    sessionCrons: listOf(p.session_crons),
  }),
  'turn.fail': (p) => ({
    error: str(p.error) || 'unknown',
    errorDetails: clip(oneLine(textOf(p.error_details)), 300),
    lastMessage: lastMessageOf(p),
  }),
  'task.created': taskHookData,
  'task.completed': taskHookData,
  'teammate.idle': (p) => ({ teammateName: oneLine(p.teammate_name) || null, teamName: oneLine(p.team_name) || null }),
  'compact.start': (p) => ({ trigger: str(p.trigger) || 'auto', customInstructions: textOf(p.custom_instructions).trim() }),
  'compact.end': (p) => ({ trigger: str(p.trigger) || 'auto', summary: textOf(p.compact_summary).trim() }),
  'model.switch': (p) => ({
    from: str(p.from_model) || null,
    to: str(p.to_model) || null,
    requested: str(p.requested_model) || null,
    source: str(p.source) || null,
  }),
});

// ---------------------------------------------------------------------------------------------
// Derived events. Intent (spawning, messaging) is read at PreToolUse so it precedes the
// SubagentStart it explains; state (todos, tasks, spawn results) at PostToolUse, once it happened.

/** @typedef {{kind: TownEventKind, data: Record<string, any>}} Derived */

/** @param {Record<string, any>} d tool data @returns {Derived[]} */
function spawnRequest(d) {
  const i = d.input;
  return [
    {
      kind: 'spawn.request',
      data: {
        toolUseId: d.toolUseId,
        subagentType: oneLine(i.subagent_type) || 'general-purpose',
        description: clip(oneLine(i.description), 160),
        prompt: clip(oneLine(i.prompt), 400),
        name: oneLine(i.name) || null,
        teamName: oneLine(i.team_name) || null,
        model: oneLine(i.model) || null,
        background: i.run_in_background === true,
        isolation: oneLine(i.isolation) || null,
      },
    },
  ];
}

/** @param {Record<string, any>} d @returns {Derived[]} */
function spawnResult(d) {
  const r = isObject(d.response) ? d.response : {};
  return [
    {
      kind: 'spawn.result',
      data: {
        toolUseId: d.toolUseId,
        subagentType: oneLine(d.input.subagent_type) || 'general-purpose',
        name: oneLine(d.input.name) || null,
        status: str(r.status) || null,
        agentId: normalizeAgentId(r.agentId ?? r.agent_id),
        content: clip(textOf(r.content).trim(), 2000),
        totalTokens: finite(r.totalTokens),
        totalDurationMs: finite(r.totalDurationMs),
        totalToolUseCount: finite(r.totalToolUseCount),
      },
    },
  ];
}

/** @param {Record<string, any>} d @returns {Derived[]} */
function messageSend(d) {
  const i = d.input;
  return [
    {
      kind: 'message.send',
      data: {
        toolUseId: d.toolUseId,
        to: recipientOf(i) || null,
        message: clip(textOf(i.message ?? i.content ?? i.text).trim(), 1000),
        summary: oneLine(i.summary) || null,
      },
    },
  ];
}

/** @param {unknown} status @returns {'pending'|'in_progress'|'completed'} */
function itemStatus(status) {
  return status === 'completed' || status === 'in_progress' ? status : 'pending';
}

/** @param {Record<string, any>} d @returns {Derived[]} */
function todosSet(d) {
  const todos = listOf(d.input.todos)
    .filter(isObject)
    .slice(0, 50)
    .map((t) => ({ text: clip(oneLine(t.content || t.activeForm || t.subject), 160) || 'Todo', status: itemStatus(t.status) }));
  return [{ kind: 'todos.set', data: { todos } }];
}

/** TaskCreate returns the new id in its response; the exact shape varies, so look around. */
/** @param {unknown} response */
function createdTaskId(response) {
  if (!isObject(response)) return null;
  const nested = isObject(response.task) ? response.task : {};
  return str(nested.id ?? response.taskId ?? response.task_id ?? response.id) || null;
}

/** @param {Record<string, any>} d @returns {Derived[]} */
function taskUpsert(d) {
  const i = d.input;
  const created = d.tool === 'TaskCreate';
  const status = str(i.status);
  return [
    {
      kind: 'task.upsert',
      data: {
        taskId: created ? createdTaskId(d.response) : str(i.taskId ?? i.task_id ?? i.id) || null,
        subject: clip(oneLine(i.subject), 160) || null,
        description: clip(oneLine(i.description), 300) || null,
        status: created ? 'pending' : status === 'deleted' ? 'deleted' : status ? itemStatus(status) : null,
        owner: oneLine(i.owner) || null,
        source: d.tool,
      },
    },
  ];
}

/** @type {Readonly<Record<string, (d: Record<string, any>) => Derived[]>>} */
const DERIVE_ON_START = Object.freeze({ Agent: spawnRequest, Task: spawnRequest, SendMessage: messageSend });

/** @type {Readonly<Record<string, (d: Record<string, any>) => Derived[]>>} */
const DERIVE_ON_END = Object.freeze({
  Agent: spawnResult,
  Task: spawnResult,
  TodoWrite: todosSet,
  TaskCreate: taskUpsert,
  TaskUpdate: taskUpsert,
});

// ---------------------------------------------------------------------------------------------

let localSeq = 0;

/** @param {Record<string, any>} envelope */
function envelopeId(envelope) {
  const id = envelope.id;
  if ((typeof id === 'number' && Number.isFinite(id)) || (typeof id === 'string' && id)) return String(id);
  localSeq += 1;
  return `local-${localSeq}`;
}

/**
 * @param {Record<string, any>} envelope
 * @param {Record<string, any>} payload
 * @param {() => number} now
 */
function baseOf(envelope, payload, now) {
  const ts = finite(envelope.ts) ?? finite(envelope.rx) ?? now();
  const sessionId = oneLine(payload.session_id) || 'unknown';
  const agentId = normalizeAgentId(payload.agent_id);
  return {
    id: envelopeId(envelope),
    ts,
    rx: finite(envelope.rx) ?? ts,
    sessionId,
    agentKey: agentKeyOf(sessionId, agentId),
    agentId,
    agentType: str(payload.agent_type) || null,
    cwd: str(payload.cwd),
    member: clip(oneLine(payload.andary_member), 24) || null,
    source: /** @type {'claude'|'codex'} */ (payload.andary_source === 'codex' ? 'codex' : 'claude'),
  };
}

/** @param {Record<string, any>} envelope */
function payloadOf(envelope) {
  if (isObject(envelope.event)) return envelope.event;
  return typeof envelope.hook_event_name === 'string' ? envelope : null;
}

/**
 * @param {unknown} envelope
 * @param {() => number} now
 * @returns {TownEvent[]}
 */
function normalizeEnvelope(envelope, now) {
  if (!isObject(envelope)) return [];
  const payload = payloadOf(envelope);
  // The doctor's probe proves delivery: no crew, no log entry, no achievement.
  if (!payload || isDoctorSession(payload.session_id)) return [];
  const base = baseOf(envelope, payload, now);
  const kind = own(KIND_BY_HOOK, payload.hook_event_name) ?? 'unknown';
  const build = own(DATA, kind);
  const data = build ? build(payload, base.cwd) : { hookEventName: oneLine(payload.hook_event_name) || 'Unknown' };
  /** @type {TownEvent} */
  const primary = { ...base, kind, data };
  const table = kind === 'tool.start' ? DERIVE_ON_START : kind === 'tool.end' ? DERIVE_ON_END : null;
  const derive = table ? own(table, data.tool) : undefined;
  const derived = derive ? derive(data) : [];
  return [primary, ...derived.map((d, i) => ({ ...base, id: `${base.id}.${i + 1}`, kind: d.kind, data: d.data }))];
}

/**
 * Turns one Envelope (or a bare hook payload) into TownEvents. Never throws: unusable input
 * yields [] and unrecognised hooks yield one 'unknown' event.
 * @param {unknown} envelope
 * @param {{now?: () => number}} [options]  clock for envelopes that carry no timestamp
 * @returns {TownEvent[]}
 */
export function normalize(envelope, options = {}) {
  try {
    return normalizeEnvelope(envelope, options.now ?? Date.now);
  } catch {
    return [];
  }
}
