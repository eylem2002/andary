// Pure text helpers for the HUD: durations, relative times, countdowns, paths, labels.
// No DOM here, so everything is unit-tested in Node.

/**
 * Compact duration: "45s", "4m 05s" (under 10 minutes), "34m", "2h 05m", "3d 4h".
 * @param {number} ms
 */
export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 10) return `${minutes}m ${pad2(totalSeconds % 60)}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${pad2(minutes % 60)}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * Relative time. The short form ("now", "20s", "5m", "2h", "3d") suits dense log rows; seconds are
 * rounded down to tens because the log refreshes them every few seconds, not every second.
 * @param {number} ts
 * @param {number} now
 * @param {{ short?: boolean }} [options]
 */
export function formatAgo(ts, now, { short = false } = {}) {
  const seconds = Math.max(0, Math.floor((now - ts) / 1000));
  const suffix = short ? '' : ' ago';
  if (seconds < 10) return short ? 'now' : 'just now';
  if (seconds < 60) return `${Math.floor(seconds / 10) * 10}s${suffix}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${suffix}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${suffix}`;
  return `${Math.floor(hours / 24)}d${suffix}`;
}

/**
 * Countdown as m:ss, rounded up so "0:00" only shows once time is really up.
 * @param {number} msLeft
 */
export function formatCountdown(msLeft) {
  const seconds = Math.max(0, Math.ceil((Number(msLeft) || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${pad2(seconds % 60)}`;
}

/** @param {number} n */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Collapses whitespace and cuts text to `max` characters with an ellipsis.
 * @param {unknown} text
 * @param {number} max
 */
export function truncate(text, max) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…` : clean;
}

const HOME = /^(?:\/home\/[^/]+|\/Users\/[^/]+|[A-Za-z]:[\\/]Users[\\/][^\\/]+)(?=[\\/]|$)/;

/**
 * Shortens a file path for display: relative to the crew's folder when inside it, `~` for the home
 * folder, then middle segments collapsed ("src/…/auth/login.ts") until it fits in `max` characters.
 * @param {unknown} path
 * @param {{ cwd?: string, max?: number }} [options]
 */
export function shortenPath(path, { cwd, max = 44 } = {}) {
  const text = crewRelativePath(String(path ?? ''), cwd);
  if (text.length <= max) return text;
  return collapseMiddle(text, max);
}

/**
 * A path relative to the crew's folder when inside it, otherwise with the home folder as `~`.
 * @param {string} text
 * @param {string} [cwd]
 */
function crewRelativePath(text, cwd) {
  const base = cwd ? cwd.replace(/[\\/]+$/, '') : '';
  if (base && (text.startsWith(`${base}/`) || text.startsWith(`${base}\\`))) return text.slice(base.length + 1);
  return text.replace(HOME, '~');
}

/**
 * Collapses middle segments ("src/…/auth/login.ts") until the path fits in `max` characters.
 * @param {string} text
 * @param {number} max
 */
function collapseMiddle(text, max) {
  const sep = text.includes('/') ? '/' : '\\';
  const parts = text.split(sep);
  const name = parts[parts.length - 1];
  // Keep the first segment and as many trailing segments as fit, dropping at least one in between.
  for (let keep = parts.length - 2; keep >= 1; keep--) {
    const candidate = [parts[0], '…', ...parts.slice(parts.length - keep)].join(sep);
    if (candidate.length <= max) return candidate;
  }
  const tail = `…${sep}${name}`;
  if (tail.length <= max) return tail;
  return `…${name.slice(name.length - (max - 1))}`;
}

/**
 * "1 crew", "2 crews".
 * @param {number} count
 * @param {string} one
 * @param {string} [many]
 */
export function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Joins phrases as a sentence list: "a", "a and b", "a, b and c".
 * @param {string[]} items
 */
export function listJoin(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * @param {{ status: string }[]} items
 * @returns {{ done: number, total: number, ratio: number }}
 */
export function progressOf(items) {
  const total = items?.length ?? 0;
  const done = total ? items.filter((item) => item.status === 'completed').length : 0;
  return { done, total, ratio: total ? done / total : 0 };
}

const STATUS_LABELS = Object.freeze({
  working: 'Working',
  waiting: 'Waiting for approval',
  idle: 'Idle',
  error: 'Error',
  done: 'Done',
  ended: 'Ended',
});

/** @param {string} status */
export function statusLabel(status) {
  return STATUS_LABELS[status] ?? 'Idle';
}

/**
 * "Lead agent", "Explore subagent", "Teammate".
 * @param {{ role?: string, type?: string }} agent
 */
export function roleLabel(agent) {
  if (agent.role === 'lead') return 'Lead agent';
  if (agent.role === 'teammate') return agent.type && agent.type !== 'teammate' ? `Teammate (${agent.type})` : 'Teammate';
  const type = agent.type && agent.type !== 'main' ? agent.type : '';
  return type ? `${type.charAt(0).toUpperCase()}${type.slice(1)} subagent` : 'Subagent';
}

/** True for text that is a shell command ("$ npm test", "PS> dir"), shown in the mono face. */
export function isCommandText(text) {
  return typeof text === 'string' && (text.startsWith('$ ') || text.startsWith('PS> '));
}

/**
 * Characters that change how text looks without being seen: C0/C1 controls (tab and newline
 * excepted), bidirectional overrides and isolates ("Trojan Source"), zero-width and other
 * invisible characters, line/paragraph separators and Unicode tag characters.
 */
const HIDDEN_CHARS =
  // eslint-disable-next-line no-control-regex -- finding control characters is the point
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u061C\u115F\u1160\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u206F\u3164\uFEFF\uFFA0\uFFF9-\uFFFB]|\uDB40[\uDC00-\uDC7F]/g;
/** Three or more line breaks in a row (blank or whitespace-only lines between them). */
const BLANK_RUN = /\n(?:[ \t]*\n){2,}/g;

/**
 * Makes text safe to judge by eye: hidden characters become visible markers such as ⟨U+202E⟩, and
 * runs of blank lines (which can push the end of a command out of view) are collapsed into one
 * marker line. Used where the viewer approves exactly what they read.
 * @param {unknown} text
 * @returns {string}
 */
export function revealHidden(text) {
  return String(text ?? '')
    .replace(HIDDEN_CHARS, (ch) => `⟨U+${ch.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}⟩`)
    .replace(BLANK_RUN, (run) => `\n⟨${run.split('\n').length - 2} blank lines⟩\n`);
}

/** @type {Record<string, (input: any, path: (p: unknown) => string, text: (t: unknown) => string) => { action: string, detail: string }>} */
const APPROVAL_WORDING = {
  Bash: (input, _path, text) => ({ action: 'run a command', detail: `$ ${text(input.command)}` }),
  PowerShell: (input, _path, text) => ({ action: 'run a command', detail: `PS> ${text(input.command)}` }),
  Write: (input, path) => ({ action: 'write a file', detail: path(input.file_path) }),
  Edit: (input, path) => ({ action: 'edit a file', detail: path(input.file_path) }),
  MultiEdit: (input, path) => ({ action: 'edit a file', detail: path(input.file_path) }),
  NotebookEdit: (input, path) => ({ action: 'edit a notebook', detail: path(input.notebook_path) }),
  Read: (input, path) => ({ action: 'read a file', detail: path(input.file_path) }),
  WebFetch: (input, _path, text) => ({ action: 'fetch a web page', detail: text(input.url) }),
  WebSearch: (input, _path, text) => ({ action: 'search the web', detail: text(input.query) }),
};

/**
 * What a permission request asks for, in words plus the detail to show in mono. The default is a
 * short form for summaries. `exact` is for the approval card, where the viewer decides: full paths
 * (never shortened in the middle), every input field for tools without special wording, and
 * hidden characters revealed (see revealHidden).
 * @param {{ toolName?: string, toolInput?: any, cwd?: string }} approval
 * @param {{ exact?: boolean }} [options]
 * @returns {{ action: string, detail: string }}
 */
export function describeApproval({ toolName = '', toolInput, cwd }, { exact = false } = {}) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const text = exact ? revealHidden : (/** @type {unknown} */ t) => String(t ?? '');
  const path = exact ? revealHidden : (/** @type {unknown} */ p) => shortenPath(p, { cwd, max: 80 });
  const wording = Object.hasOwn(APPROVAL_WORDING, toolName) ? APPROVAL_WORDING[toolName] : null;
  if (wording) return wording(input, path, text);
  const detail = exact ? allFields(input) : firstText(input);
  if (toolName.startsWith('mcp__')) {
    const [, server = '', tool = ''] = toolName.split('__');
    return { action: `use ${tool || 'a tool'} from ${server || 'an MCP server'}`, detail };
  }
  return { action: `use ${toolName || 'a tool'}`, detail };
}

/**
 * Every field of a tool input as "name: value" lines (values that are not text as JSON), with
 * hidden characters revealed: nothing the tool will receive is left out.
 * @param {Record<string, unknown>} input
 * @returns {string}
 */
function allFields(input) {
  return Object.entries(input)
    .map(([key, value]) => `${revealHidden(key)}: ${revealHidden(typeof value === 'string' ? value : JSON.stringify(value))}`)
    .join('\n');
}

/**
 * What an agent is doing, in a few words: the current tool call while working, what it waits for,
 * or why it stopped.
 * @param {{ status: string, role?: string, summary?: string, description?: string }} agent
 * @param {{ toolName?: string, toolInput?: any, cwd?: string }} [approval]  what it waits on, if anything
 */
export function doingText(agent, approval) {
  switch (agent.status) {
    case 'waiting':
      return approval ? `Needs approval: ${truncate(describeApproval(approval).detail || approval.toolName, 70)}` : 'Waiting for your answer';
    case 'idle':
      return agent.role === 'lead' ? 'Waiting for your next prompt' : 'Idle';
    case 'done':
      return 'Finished';
    case 'error':
      return agent.summary ? `Failed: ${truncate(agent.summary, 70)}` : 'Hit an error';
    default:
      return truncate(agent.summary || agent.description || 'Getting started', 80);
  }
}

/** First string field of a tool input, for tools the HUD has no special wording for. */
function firstText(input) {
  const value = Object.values(input).find((v) => typeof v === 'string' && v.trim());
  return value ? truncate(value, 400) : '';
}
