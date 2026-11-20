// What agents changed: the files each one touched, and the before/after text of each finished
// edit (Edit, MultiEdit, Write, NotebookEdit), kept so the inspector can show it as a diff.

import { relativePath } from './text.js';
import { MAX_RECENT, boundedPush } from './store-model.js';

/** @typedef {import('./store.js').TownEvent} TownEvent */
/** @typedef {import('./store.js').Session} Session */
/** @typedef {import('./store.js').AgentState} AgentState */

/** @param {AgentState} a @param {string} path */
export function rememberFile(a, path) {
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
 * @property {boolean} whole    the whole file (or notebook cell) was written: no "before" to compare with
 * @property {{ before: string, after: string }[]} hunks
 */

export const MAX_CHANGES = 20;
/** Longest text kept per side of a hunk (the server already cuts strings at 2,000 characters). */
export const MAX_HUNK_CHARS = 4000;

/**
 * Keeps what a finished edit changed, so the inspector can show it as a diff.
 * @param {AgentState} a
 * @param {TownEvent} e
 * @param {Session} s
 */
export function recordChange(a, e, s) {
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
 * @returns {{ whole: boolean, list: { before: string, after: string, cut?: boolean }[] }|null}
 */
export function changeHunks(tool, input) {
  const text = (/** @type {unknown} */ v) => (typeof v === 'string' ? v.slice(0, MAX_HUNK_CHARS) : '');
  const long = (/** @type {unknown} */ v) => typeof v === 'string' && v.length > MAX_HUNK_CHARS;
  const hunk = (/** @type {unknown} */ before, /** @type {unknown} */ after) => {
    const cut = long(before) || long(after);
    return { before: text(before), after: text(after), ...(cut ? { cut } : {}) };
  };
  if (tool === 'Edit') return { whole: false, list: [hunk(input.old_string, input.new_string)] };
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    return { whole: false, list: input.edits.slice(0, 20).filter((edit) => edit && typeof edit === 'object').map((edit) => hunk(edit.old_string, edit.new_string)) };
  }
  if (tool === 'Write') return { whole: true, list: [hunk('', input.content)] };
  // A notebook cell is replaced whole: its old source is not in the hook.
  if (tool === 'NotebookEdit') return { whole: true, list: [hunk('', input.new_source)] };
  return null;
}
