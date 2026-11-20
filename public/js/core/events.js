// Turns what the server streams (an Envelope wrapping one raw hook payload, CONTRACTS.md §4.2)
// into TownEvents (§5): one primary event per hook, plus derived events for tools whose input
// means something on its own (todo lists, shared tasks, spawns, messages between agents).
// Hook data comes from sessions working in untrusted repositories and may be malformed, so every
// reader here is defensive and normalize() never throws.

import { BUILDINGS, activityForTool, buildingForTool } from './catalog.js';

/** @typedef {import('./catalog.js').BuildingKey} BuildingKey */
/** @typedef {import('./catalog.js').Activity} Activity */

/** @typedef {'session.start'|'session.end'|'prompt'|'tool.start'|'tool.end'|'tool.fail'|'permission.request'|'permission.denied'|'notify'|'subagent.start'|'subagent.stop'|'turn.stop'|'turn.fail'|'task.created'|'task.completed'|'teammate.idle'|'compact.start'|'compact.end'|'model.switch'|'todos.set'|'task.upsert'|'spawn.request'|'spawn.result'|'message.send'|'unknown'} TownEventKind */

/** @typedef {'test'|'install'|'deps'|'git-commit'|'git-push'|'rm-rf'|'docker'|'curl'|'build'|'lint'} CommandKind */

/** @typedef {'tests'|'notfound'|'permission'|'timeout'|'interrupted'|'generic'} ErrorKind */

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
// Small defensive readers. Tables below are plain objects, so lookups go through own() to keep a
// tool named "constructor" or "__proto__" from reaching Object.prototype.

/**
 * A table's own entry for a key from hook data. Inherited keys are ignored, so a tool or event
 * named "constructor" or "__proto__" cannot reach Object.prototype.
 * @template T
 * @param {Readonly<Record<string, T>>} table
 * @param {unknown} key
 * @returns {T|undefined}
 */
export function own(table, key) {
  return typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
export function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value  strings pass through, finite numbers are stringified, the rest is '' */
export function str(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** @param {unknown} value */
function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** @param {unknown} value  collapses whitespace so a value fits on one line of a bubble or log row */
export function oneLine(value) {
  return str(value).replace(/\s+/g, ' ').trim();
}

/**
 * Cuts text to `max` characters, ending in an ellipsis when cut.
 * @param {unknown} text
 * @param {number} max
 */
export function clip(text, max) {
  const s = str(text);
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…` : s;
}

/**
 * Text from a string, an array of content blocks ([{type: 'text', text}]) or a structured
 * message ({type: 'shutdown_request', …}); payload fields like these vary between versions.
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {string}
 */
function textOf(value, depth = 0) {
  if (typeof value === 'string') return value;
  if (value == null || depth > 3) return '';
  if (Array.isArray(value)) return value.map((item) => textOf(item, depth + 1)).filter(Boolean).join('\n');
  if (!isObject(value)) return str(value);
  for (const key of ['text', 'content', 'message', 'summary']) {
    const text = textOf(value[key], depth + 1);
    if (text) return text;
  }
  // A structured message such as {type: 'shutdown_request'} is best described by its type.
  return typeof value.type === 'string' && !('text' in value) ? value.type.replace(/_/g, ' ') : '';
}

/** @param {unknown} value */
function listOf(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Hook payloads name subagents "agent-abc123" in some places and "abc123" in others.
 * @param {unknown} id
 * @returns {string|null}
 */
export function normalizeAgentId(id) {
  const s = str(id).trim();
  if (!s) return null;
  return s.startsWith('agent-') && s.length > 6 ? s.slice(6) : s;
}

/**
 * @param {string} sessionId
 * @param {string|null} [agentId]
 */
export function agentKeyOf(sessionId, agentId) {
  return `${sessionId}:${agentId ?? 'main'}`;
}

// ---------------------------------------------------------------------------------------------
// Summaries: short human text for bubbles, the log and the inspector.

const HOME_PREFIX = /^(?:[A-Za-z]:)?\/(?:home|Users)\/[^/]+(?=\/|$)/;

/**
 * A path relative to the session's cwd (or "~/…" under a home folder), without clipping.
 * @param {unknown} path
 * @param {unknown} [cwd]
 */
export function relativePath(path, cwd = '') {
  const p = str(path).trim().replace(/\\/g, '/');
  if (!p) return '';
  const base = str(cwd).trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (base && p === base) return '.';
  if (base && p.startsWith(`${base}/`)) return p.slice(base.length + 1);
  return p.replace(HOME_PREFIX, '~');
}

/**
 * Like relativePath, then shortened to its last segments so it fits in a speech bubble.
 * @param {unknown} path
 * @param {unknown} [cwd]
 * @param {number} [max]
 */
export function shortPath(path, cwd = '', max = 44) {
  const rel = relativePath(path, cwd);
  if (rel.length <= max) return rel;
  const parts = rel.split('/').filter(Boolean);
  const tail = parts.slice(-2).join('/');
  if (tail.length + 2 <= max) return `…/${tail}`;
  const last = parts[parts.length - 1] ?? rel;
  return last.length + 2 <= max ? `…/${last}` : `…${last.slice(-(max - 1))}`;
}

/**
 * First line of a shell command, without a leading "cd somewhere &&", at most `max` chars.
 * @param {unknown} command
 * @param {number} [max]
 */
export function shortCommand(command, max = 60) {
  const lines = str(command).trim().split('\n');
  let first = oneLine(lines[0]).replace(/^cd\s+\S+\s*&&\s*/, '');
  if (lines.length > 1) first += ' …';
  return clip(first, max);
}

/**
 * "host/path" of a URL; anything unparsable is just clipped.
 * @param {unknown} url
 * @param {number} [max]
 */
export function hostPath(url, max = 50) {
  const raw = oneLine(url);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return clip(parsed.host + parsed.pathname.replace(/\/+$/, ''), max);
  } catch {
    return clip(raw, max);
  }
}

/** @param {unknown} url */
export function hostOf(url) {
  try {
    return new URL(oneLine(url)).host;
  } catch {
    return '';
  }
}

/** @param {unknown} text @param {number} [max] */
function quoted(text, max = 32) {
  return `"${clip(oneLine(text), max)}"`;
}

/** @param {Record<string, any>} input @param {string} cwd */
function grepScope(input, cwd) {
  if (input.path) return ` in ${shortPath(input.path, cwd, 32)}`;
  if (input.glob) return ` in ${clip(oneLine(input.glob), 24)}`;
  if (input.type) return ` in *.${clip(oneLine(input.type), 10)}`;
  return '';
}

/** @param {Record<string, any>} input */
function recipientOf(input) {
  const to = input.to ?? input.recipient ?? input.target ?? input.teammate_name;
  return Array.isArray(to) ? to.map(oneLine).filter(Boolean).join(', ') : oneLine(to);
}

/** @param {unknown} todos */
function todoSummary(todos) {
  const list = listOf(todos);
  if (!list.length) return 'Clear the todo list';
  const done = list.filter((t) => isObject(t) && t.status === 'completed').length;
  return `Todos: ${done}/${list.length} done`;
}

/** @param {Record<string, any>} input */
function taskUpdateSummary(input) {
  const id = str(input.taskId ?? input.task_id ?? input.id) || '?';
  if (input.status) return `Task #${id} → ${oneLine(input.status).replace(/_/g, ' ')}`;
  if (input.owner) return `Task #${id} → ${oneLine(input.owner)}`;
  return `Update task #${id}`;
}

/** @param {Record<string, any>} input */
function spawnSummary(input) {
  const who = oneLine(input.name) || oneLine(input.subagent_type) || 'agent';
  const what = clip(oneLine(input.description), 44);
  return what ? `Spawn ${who}: ${what}` : `Spawn ${who}`;
}

/** @param {string} tool  "mcp__github__create_issue" → "github" */
function mcpServerOf(tool) {
  if (!tool.startsWith('mcp__')) return null;
  return tool.split('__')[1] || null;
}

/** @type {Readonly<Record<string, (input: Record<string, any>, cwd: string) => string>>} */
const SUMMARIES = Object.freeze({
  Read: (i, cwd) => `Read ${shortPath(i.file_path, cwd) || 'a file'}`,
  NotebookRead: (i, cwd) => `Read ${shortPath(i.notebook_path, cwd) || 'a notebook'}`,
  Write: (i, cwd) => `Write ${shortPath(i.file_path, cwd) || 'a file'}`,
  Edit: (i, cwd) => `Edit ${shortPath(i.file_path, cwd) || 'a file'}`,
  MultiEdit: (i, cwd) => `Edit ${shortPath(i.file_path, cwd) || 'a file'}`,
  NotebookEdit: (i, cwd) => `Edit ${shortPath(i.notebook_path, cwd) || 'a notebook'}`,
  Bash: (i) => `$ ${shortCommand(i.command) || '…'}`,
  PowerShell: (i) => `PS> ${shortCommand(i.command) || '…'}`,
  BashOutput: () => 'Check a background shell',
  KillShell: () => 'Stop a background shell',
  KillBash: () => 'Stop a background shell',
  Monitor: (i) => (i.command ? `Watch $ ${shortCommand(i.command, 48)}` : 'Watch a background task'),
  Grep: (i, cwd) => `grep ${quoted(i.pattern)}${grepScope(i, cwd)}`,
  Glob: (i, cwd) => `glob ${clip(oneLine(i.pattern), 36) || '*'}${i.path ? ` in ${shortPath(i.path, cwd, 28)}` : ''}`,
  LS: (i, cwd) => `ls ${shortPath(i.path, cwd) || '.'}`,
  LSP: (i, cwd) => `LSP ${oneLine(i.operation) || 'lookup'}${i.filePath ? ` in ${shortPath(i.filePath, cwd, 32)}` : ''}`,
  ToolSearch: (i) => `Find a tool for ${quoted(i.query)}`,
  WebFetch: (i) => `Fetch ${hostPath(i.url) || 'a web page'}`,
  WebSearch: (i) => `Search the web for ${quoted(i.query, 40)}`,
  TodoWrite: (i) => todoSummary(i.todos),
  TaskCreate: (i) => `New task: ${clip(oneLine(i.subject), 48) || 'untitled'}`,
  TaskUpdate: (i) => taskUpdateSummary(i),
  TaskList: () => 'Check the task list',
  TaskGet: (i) => `Look at task #${str(i.taskId ?? i.task_id) || '?'}`,
  TaskStop: () => 'Stop a background task',
  TaskOutput: () => 'Read background task output',
  EnterPlanMode: () => 'Start planning',
  ExitPlanMode: () => 'Present the plan',
  SendMessage: (i) => `Message ${recipientOf(i) || 'the team'}`,
  AskUserQuestion: () => 'Ask you a question',
  Skill: (i) => `Use skill ${oneLine(i.skill ?? i.command) || '…'}`,
  SlashCommand: (i) => `Run ${clip(oneLine(i.command), 40) || 'a slash command'}`,
  EnterWorktree: (i) => `Enter worktree ${oneLine(i.name ?? i.path)}`.trim(),
  ExitWorktree: () => 'Leave the worktree',
  Agent: (i) => spawnSummary(i),
  Task: (i) => spawnSummary(i),
});

/**
 * Short human text for a tool call: "Read src/auth/login.ts", "$ npm test",
 * 'grep "TODO" in src', "Fetch docs.python.org/3/library".
 * @param {unknown} tool
 * @param {unknown} input
 * @param {unknown} [cwd]
 * @returns {string}
 */
export function summarizeTool(tool, input, cwd = '') {
  const name = str(tool) || 'Tool';
  const args = isObject(input) ? input : {};
  try {
    if (name.startsWith('mcp__')) {
      const [, server = 'mcp', ...rest] = name.split('__');
      return clip(`${server}: ${rest.join('__') || 'tool'}`, 80);
    }
    const summarize = own(SUMMARIES, name);
    return clip(summarize ? summarize(args, str(cwd)) : name, 80) || name;
  } catch {
    return name;
  }
}

// ---------------------------------------------------------------------------------------------
// Shell commands and errors: what kind of thing happened, so the town can react to it.

const TEST_COMMAND =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\b(?:jest|vitest|mocha|ava|pytest|rspec|phpunit)\b|\bplaywright\s+test\b|\bpython3?\s+-m\s+(?:pytest|unittest)\b|\b(?:go|cargo|deno|dotnet|mix)\s+test\b|\bnode\s+--test\b|\b(?:tox|nox)\b|\b(?:mvn|gradlew?)\s+test\b|\bmake\s+test\b/;

/**
 * First match wins, so the order encodes priority ("git add && git commit && git push" ships).
 * 'install' is JavaScript packages (they land in node_modules); 'deps' is every other ecosystem.
 * @type {ReadonlyArray<[CommandKind, RegExp]>}
 */
const COMMAND_KINDS = Object.freeze([
  ['git-push', /\bgit\s+push\b/],
  ['git-commit', /\bgit\s+commit\b/],
  ['rm-rf', /\brm\s+(?:-\w+\s+)*-\w*(?:r\w*f|f\w*r)\w*\b/i],
  ['test', TEST_COMMAND],
  ['install', /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|ci)\b|^\s*(?:pnpm|yarn|bun)\s*$/],
  ['deps', /\b(?:pip3?|uv\s+pip)\s+install\b|\buv\s+(?:sync|add)\b|\bpoetry\s+(?:install|add)\b|\bcargo\s+(?:add|install)\b|\bgo\s+get\b|\b(?:bundle|gem)\s+install\b|\bcomposer\s+(?:install|require)\b/],
  ['docker', /\b(?:docker|podman)(?:-compose)?\b/],
  ['curl', /\b(?:curl|wget)\b/],
  ['build', /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|\btsc\b|\b(?:cargo|go|uv)\s+build\b|\b(?:vite|next|mkdocs|astro)\s+build\b|\bmake\b|\bpython3?\s+-m\s+build\b/],
  ['lint', /\b(?:eslint|prettier|ruff|flake8|pylint|mypy|biome|stylelint)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:lint|format|typecheck)\b/],
]);

/**
 * @param {unknown} command
 * @returns {CommandKind|null}
 */
export function classifyCommand(command) {
  const c = str(command);
  if (!c.trim()) return null;
  for (const [kind, pattern] of COMMAND_KINDS) {
    if (pattern.test(c)) return kind;
  }
  return null;
}

const TIMED_OUT = /timed?\s*out|timeout|etimedout/i;
const NO_PERMISSION = /permission denied|eacces|eperm|not permitted|access denied|operation not allowed/i;
const NOT_FOUND = /not found|no such file|enoent|does not exist|cannot find|could not find|unknown file/i;

/**
 * Why a tool failed, as far as its first error line tells. A test command failing for any reason
 * other than a timeout means "tests are red", whatever the runner printed.
 * @param {string} error
 * @param {boolean} isInterrupt
 * @param {CommandKind|null} commandKind
 * @returns {ErrorKind}
 */
export function classifyError(error, isInterrupt, commandKind) {
  if (isInterrupt) return 'interrupted';
  if (TIMED_OUT.test(error)) return 'timeout';
  if (commandKind === 'test') return 'tests';
  if (NO_PERMISSION.test(error)) return 'permission';
  if (NOT_FOUND.test(error)) return 'notfound';
  return 'generic';
}

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
/**
 * `andary doctor` sends a probe through the real pipeline under this session-id prefix
 * (server/cli/doctor.mjs). It proves delivery, so the town shows nothing for it: no crew, no log
 * entry, no achievement.
 */
const DOCTOR_SESSION_PREFIX = 'andary-doctor-';

function normalizeEnvelope(envelope, now) {
  if (!isObject(envelope)) return [];
  const payload = payloadOf(envelope);
  if (!payload || str(payload.session_id).startsWith(DOCTOR_SESSION_PREFIX)) return [];
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
