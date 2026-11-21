// File paths as the town compares them (core/conflicts.js, core/git-commands.js): absolute, with
// forward slashes, without `.` and `..`, and a relative path joined to the folder it was given in.
// Only the text is compared. The browser cannot resolve a symbolic link or ask whether a disk
// ignores case, so two spellings of one file stay two paths (docs/ASSUMPTIONS.md). Where a work
// tree starts is the server's to find on disk; without it, it is guessed from the folders known.
// Pure.
import { str } from './text.js';

/** Where an absolute path starts: a drive (C:/), a network share (//server) or the root (/). */
const ROOT = /^(?:[A-Za-z]:\/|\/\/(?=[^/])|\/)/;
/** A path under the home folder or a variable: the browser cannot tell where that is. */
const UNPLACEABLE = /^[~$%]/;
/** Git Bash writes a drive as a folder: /c/Users is C:/Users. */
const GIT_BASH_DRIVE = /^\/([A-Za-z])(?=\/|$)/;
/** A normalised path on a drive. */
const ON_DRIVE = /^[A-Za-z]:\//;

/**
 * A path as compared: absolute and normalised, or '' when it cannot be placed (empty, under `~`
 * or a variable, or relative to no known folder). The case is kept, but for a drive letter.
 * @param {unknown} path
 * @param {unknown} [folder]  what a relative path is relative to (the hook's cwd)
 * @returns {string}
 */
export function normalizePath(path, folder = '') {
  const text = str(path).trim().replace(/\\/g, '/');
  if (!text || UNPLACEABLE.test(text)) return '';
  const base = normalizePath(folder);
  if (ROOT.test(text)) return resolveDots(onDrive(text, base));
  return base ? resolveDots(`${base}/${text}`) : '';
}

/**
 * A Git Bash path (/c/Users/…) as Windows writes it (C:/Users/…), when the folder it was given in
 * is on a drive; any other path as it is.
 * @param {string} path  with forward slashes
 * @param {string} like  a normalised folder of the same computer, or ''
 */
export function onDrive(path, like) {
  return ON_DRIVE.test(like) ? path.replace(GIT_BASH_DRIVE, (_, drive) => `${drive.toUpperCase()}:/`) : path;
}

/**
 * An absolute path without empty, `.` and `..` parts; `..` stops at the root.
 * @param {string} text  starts with a root
 */
function resolveDots(text) {
  const root = ROOT.exec(text)?.[0] ?? '';
  /** @type {string[]} */
  const parts = [];
  for (const part of text.slice(root.length).split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  // Windows never tells drive letters apart by case.
  return `${root.length === 3 ? root.toUpperCase() : root}${parts.join('/')}`;
}

/**
 * Whether a normalised path is a folder or lies inside it.
 * @param {string} path
 * @param {string} folder
 */
export function isInside(path, folder) {
  if (!path || !folder) return false;
  return path === folder || path.startsWith(folder.endsWith('/') ? folder : `${folder}/`);
}

/**
 * Whether a normalised path lies in one of a set of normalised folders (or is one), by its own
 * folders: as cheap for a hundred folders as for one.
 * @param {string} path
 * @param {ReadonlySet<string>} folders
 */
export function insideAny(path, folders) {
  let at = path;
  for (;;) {
    if (folders.has(at)) return true;
    const cut = at.lastIndexOf('/');
    if (cut < 0) return false;
    const parent = at.slice(0, cut);
    // A root keeps its slash: /a → /, C:/a → C:/, //server → //.
    const up = parent === '' || parent === '/' || parent.endsWith(':') ? at.slice(0, cut + 1) : parent;
    if (up === at) return false;
    at = up;
  }
}

/**
 * The last part of a normalised path ("api-server"), or the path itself for a root.
 * @param {string} path
 */
export function baseName(path) {
  return path.split('/').filter(Boolean).pop() ?? path;
}

/**
 * Claude Code puts the worktrees it makes (`claude --worktree`, a helper's `isolation: worktree`,
 * the desktop app's parallel sessions) inside the repository: <repo>/.claude/worktrees/<name>.
 */
const NESTED_WORKTREE = /^(.*\/\.claude\/worktrees\/[^/]+)(?=\/|$)/;

/**
 * The worktree Claude Code made that a normalised path lies in, or '' for none. It is a work tree
 * of its own, although its folder is inside the repository's.
 * @param {string} path
 */
export function nestedWorkTree(path) {
  return NESTED_WORKTREE.exec(path)?.[1] ?? '';
}

/**
 * Whether two normalised paths may be in one work tree: both in the same worktree Claude Code
 * made, or both outside any.
 * @param {string} a @param {string} b
 */
export function sameWorkTree(a, b) {
  return nestedWorkTree(a) === nestedWorkTree(b);
}

/**
 * The top of the work tree a folder is in. The server finds it on disk for this computer's hooks
 * (`known`: the top of the hook's own folder's work tree), which holds for any folder inside it
 * but a worktree Claude Code made there. Without it, as well as the browser can tell: a worktree
 * Claude Code made, else the crew's session folder (where it started) when that holds the folder,
 * else the folder itself. A command such as `git stash` acts on all of it.
 * @param {string} folder  normalised
 * @param {string} [sessionFolder]  normalised
 * @param {string} [known]  normalised
 * @returns {{ root: string, exact: boolean }}  exact: found on disk, not guessed
 */
export function workTreeOf(folder, sessionFolder = '', known = '') {
  const nested = nestedWorkTree(folder);
  if (known && isInside(folder, known) && (!nested || isInside(known, nested))) return { root: known, exact: true };
  return { root: nested || (isInside(folder, sessionFolder) ? sessionFolder : folder), exact: false };
}
