// Each crew's branch and working tree (CONTRACTS §4.16), as the server read it with git status
// (server/git-status.mjs) or the demo made it up: which repository belongs to which crew, and the
// words for it. Pure.
//
// A crew's repository is the work tree its hooks were last stamped with (`andary_root`,
// Session.root); before the first tool hook, the deepest repository holding its folder.
import { isInside, normalizePath } from './paths.js';
import { isObject, str } from './text.js';

/**
 * @typedef {object} GitStatus  one repository (server/git-status.mjs GitStatus)
 * @property {string} root
 * @property {string|null} branch    null when detached
 * @property {string|null} oid       the commit checked out, short
 * @property {string|null} upstream
 * @property {number} ahead
 * @property {number} behind
 * @property {number} changed        tracked files changed, staged or not
 * @property {number|null} untracked  null when not counted (a huge tree)
 * @property {string|null} worktree  a linked worktree's folder name
 * @property {number} at
 */

const NAME_CHARS = 200;

/** @param {unknown} n */
const count = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
/** @param {unknown} value @returns {string|null} */
const name = (value) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, NAME_CHARS) : null);

/**
 * One repository from the network or the demo, read defensively; null when it is not one.
 * @param {unknown} raw
 * @returns {GitStatus|null}
 */
export function readGitStatus(raw) {
  if (!isObject(raw)) return null;
  const root = normalizePath(str(raw.root));
  if (!root) return null;
  return {
    root,
    branch: name(raw.branch),
    oid: typeof raw.oid === 'string' && /^[0-9a-f]{4,64}$/.test(raw.oid) ? raw.oid.slice(0, 7) : null,
    upstream: name(raw.upstream),
    ahead: count(raw.ahead),
    behind: count(raw.behind),
    changed: count(raw.changed),
    untracked: raw.untracked === null ? null : count(raw.untracked),
    worktree: name(raw.worktree),
    at: count(raw.at),
  };
}

/**
 * The repository a crew works in: the one its hooks were stamped with, else the deepest one that
 * holds its folder; null when the town knows none.
 * @param {Record<string, GitStatus>} repos  by root
 * @param {{ cwd: string, root?: string|null }} session
 * @returns {GitStatus|null}
 */
export function gitOf(repos, session) {
  if (!repos) return null;
  if (session.root && repos[session.root]) return repos[session.root];
  const folder = normalizePath(session.cwd);
  let best = null;
  for (const status of Object.values(repos)) {
    if (isInside(folder, status.root) && (!best || status.root.length > best.root.length)) best = status;
  }
  return best;
}

/** How many files are changed, new files included when they were counted. @param {GitStatus} g */
export function dirtyCount(g) {
  return g.changed + (g.untracked ?? 0);
}

/** "feat/login", or "detached at 1a2b3c4". @param {GitStatus} g */
export function branchWords(g) {
  if (g.branch) return g.branch;
  return g.oid ? `detached at ${g.oid}` : 'detached';
}

/**
 * The crew row's line: "feat/login ↑2 ↓1 · 5 changed", "main · clean", with the worktree's name
 * first when it is one ("b-git: feat/login …").
 * @param {GitStatus} g
 */
export function gitShort(g) {
  const ab = [g.ahead ? `↑${g.ahead}` : '', g.behind ? `↓${g.behind}` : ''].filter(Boolean).join(' ');
  const dirty = dirtyCount(g);
  const tree = dirty ? `${dirty} changed` : g.untracked === null ? 'no changes to tracked files' : 'clean';
  const where = g.worktree && g.worktree !== g.branch ? `${g.worktree}: ` : '';
  return `${where}${branchWords(g)}${ab ? ` ${ab}` : ''} · ${tree}`;
}

/** @param {number} n @param {string} one @param {string} [many] */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The same in words, for the agent's details and screen readers: "On feat/login, a worktree
 * (b-git). 2 commits ahead of origin/feat/login, 1 behind. 4 changed files, 1 new file."
 * @param {GitStatus} g
 */
export function gitSentence(g) {
  const on = g.branch ? `On ${g.branch}` : `Detached${g.oid ? ` at ${g.oid}` : ''}`;
  const tree = g.worktree ? `, a worktree (${g.worktree})` : '';
  let upstream = '';
  if (g.upstream && g.ahead && g.behind) upstream = ` ${plural(g.ahead, 'commit')} ahead of ${g.upstream}, ${g.behind} behind.`;
  else if (g.upstream && g.ahead) upstream = ` ${plural(g.ahead, 'commit')} ahead of ${g.upstream}.`;
  else if (g.upstream && g.behind) upstream = ` ${plural(g.behind, 'commit')} behind ${g.upstream}.`;
  else if (g.upstream) upstream = ` Up to date with ${g.upstream}.`;
  else if (g.branch) upstream = ' No upstream branch.';
  const files = [g.changed ? plural(g.changed, 'changed file') : '', g.untracked ? plural(g.untracked, 'new file') : ''].filter(Boolean).join(', ');
  const counted = g.untracked === null ? ' (new files not counted: a large working tree)' : '';
  return `${on}${tree}.${upstream} ${files ? `${files}${counted}.` : `No uncommitted changes${counted}.`}`;
}
