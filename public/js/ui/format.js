// Pure text helpers for the HUD: durations, relative times, countdowns, paths, labels.
// No DOM here, so everything is unit-tested in Node.
import { CARD_FIELDS, cardLines, cardNote } from '../core/card-fields.js';
import { blankLines, looksBlank, revealHidden, shellWords } from '../core/text.js';

// Live in core, where the store's log reveals saved rules the same way; the HUD imports them here.
export { blankLines, looksBlank, revealHidden };

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
 * A time of day on this computer's clock, as "09:05".
 * @param {number} ts
 */
export function formatClock(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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
 * Tools with a view of their own on the approval card: the same tools, and fields, as
 * core/card-fields.js lists, which also decides whether the town may hold a request.
 * @type {Record<string, (input: any, path: (p: unknown) => string, text: (t: unknown) => string) => { action: string, detail: string }>}
 */
const APPROVAL_WORDING = {
  // A command may be an argument list (Codex): each argument is quoted, so none can hide another.
  Bash: (input, _path, text) => ({ action: 'run a command', detail: `$ ${text(shellWords(input.command))}` }),
  PowerShell: (input, _path, text) => ({ action: 'run a command', detail: `PS> ${text(shellWords(input.command))}` }),
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
 * (never shortened in the middle), the tool's other known fields as "name: value" lines
 * (core/card-fields.js), every input field for tools without special wording, hidden characters
 * revealed (see revealHidden), and `note`, what the request cannot say that allowing it grants
 * (core/card-fields.js), when there is something to say.
 * @param {{ toolName?: string, toolInput?: any, cwd?: string, source?: string }} approval
 * @param {{ exact?: boolean }} [options]
 * @returns {{ action: string, detail: string, note?: string }}
 */
export function describeApproval({ toolName = '', toolInput, cwd, source = 'claude' }, { exact = false } = {}) {
  const words = approvalWords(toolName, toolInput && typeof toolInput === 'object' ? toolInput : {}, cwd, exact);
  const note = exact ? cardNote(source, toolName) : '';
  return note ? { ...words, note } : words;
}

/**
 * @param {string} toolName @param {Record<string, any>} input @param {string|undefined} cwd @param {boolean} exact
 * @returns {{ action: string, detail: string }}
 */
function approvalWords(toolName, input, cwd, exact) {
  const text = exact ? revealHidden : (/** @type {unknown} */ t) => String(t ?? '');
  const path = exact ? revealHidden : (/** @type {unknown} */ p) => shortenPath(p, { cwd, max: 80 });
  // Only the tools core/card-fields.js lists get a view of their own: any other is shown field by field.
  const wording = Object.hasOwn(CARD_FIELDS, toolName) ? APPROVAL_WORDING[toolName] : null;
  if (wording) {
    const words = wording(input, path, text);
    const lines = exact ? cardLines(toolName).filter((key) => Object.hasOwn(input, key)) : [];
    return lines.length ? { ...words, detail: [words.detail, ...lines.map((key) => fieldLine(key, input[key]))].join('\n') } : words;
  }
  const detail = exact ? allFields(input) : firstText(input);
  if (toolName.startsWith('mcp__')) {
    const [, server = '', tool = ''] = toolName.split('__');
    return { action: `use ${tool || 'a tool'} from ${server || 'an MCP server'}`, detail };
  }
  return { action: `use ${toolName || 'a tool'}`, detail };
}

/**
 * @typedef {object} ApprovalChange
 * @property {{ before: string, after: string }[]} hunks  what the file tool would write
 * @property {string} note  what kind of change it is, in a few words
 */

/**
 * What a file tool's permission request would write, for the approval card: a Write's whole new
 * content, an Edit's replacement, each of a MultiEdit's edits, a notebook cell's new source. Null
 * for other tools (their card shows every input field instead).
 * @param {string} toolName
 * @param {unknown} toolInput
 * @returns {ApprovalChange|null}
 */
export function approvalChange(toolName, toolInput) {
  const input = toolInput && typeof toolInput === 'object' ? /** @type {Record<string, any>} */ (toolInput) : {};
  const isText = (/** @type {unknown} */ value) => typeof value === 'string';
  switch (toolName) {
    case 'Write':
      return isText(input.content) ? { hunks: [{ before: '', after: input.content }], note: input.content ? 'The whole new file' : 'An empty file' } : null;
    case 'Edit':
      if (!isText(input.old_string) || !isText(input.new_string)) return null;
      return { hunks: [{ before: input.old_string, after: input.new_string }], note: input.replace_all === true ? 'Replaces every occurrence' : 'Replaces one occurrence' };
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? input.edits.filter((edit) => isText(edit?.old_string) && isText(edit?.new_string)) : [];
      if (edits.length === 0) return null;
      // Numbered as the card titles them ("Edit 2 of 3"), so each edit's replace_all is on the card.
      const everywhere = edits.flatMap((edit, index) => (edit.replace_all === true ? [String(index + 1)] : []));
      const which = everywhere.length === 1 ? `edit ${everywhere[0]} replaces` : `edits ${listJoin(everywhere)} replace`;
      return { hunks: edits.map((edit) => ({ before: edit.old_string, after: edit.new_string })), note: `${edits.length} edits, in order${everywhere.length ? `; ${which} every occurrence` : ''}` };
    }
    case 'NotebookEdit':
      if (!isText(input.new_source)) return null;
      return { hunks: [{ before: '', after: input.new_source }], note: `${input.edit_mode === 'insert' ? 'A new cell' : input.edit_mode === 'delete' ? 'Deletes a cell' : 'The cell\'s new source'}${isText(input.cell_id) ? ` (cell ${input.cell_id})` : ''}` };
    default:
      return null;
  }
}

/**
 * Every field of a tool input as "name: value" lines (values that are not text as JSON), with
 * hidden characters revealed: nothing the tool will receive is left out.
 * @param {Record<string, unknown>} input
 * @returns {string}
 */
function allFields(input) {
  return Object.entries(input)
    .map(([key, value]) => fieldLine(key, value))
    .join('\n');
}

/**
 * One field as a "name: value" line (a value that is not text as JSON), hidden characters revealed.
 * @param {string} key
 * @param {unknown} value
 * @returns {string}
 */
function fieldLine(key, value) {
  return `${revealHidden(key)}: ${revealHidden(typeof value === 'string' ? value : JSON.stringify(value))}`;
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
