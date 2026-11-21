// File paths as the town compares them (core/conflicts.js, core/git-commands.js): absolute, with
// forward slashes, without `.` and `..`, and a relative path joined to the folder it was given in.
// Only the text is compared. The browser cannot resolve a symbolic link or ask whether a disk
// ignores case, so two spellings of one file stay two paths (docs/ASSUMPTIONS.md); nor can it ask
// git where a work tree starts, so that is guessed from the folders it knows. Pure.
import { str } from './text.js';

/** Where an absolute path starts: a drive (C:/), a network share (//server) or the root (/). */
const ROOT = /^(?:[A-Za-z]:\/|\/\/(?=[^/])|\/)/;
/** A path under the home folder or a variable: the browser cannot tell where that is. */
const UNPLACEABLE = /^[~$%]/;

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
  if (ROOT.test(text)) return resolveDots(text);
  const base = normalizePath(folder);
  return base ? resolveDots(`${base}/${text}`) : '';
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
 * The top of the work tree a folder is in, as well as the browser can tell without asking git: a
 * worktree Claude Code made, else the crew's session folder (where it started) when that holds
 * the folder, else the folder itself. A command such as `git stash` acts on all of it.
 * @param {string} folder  normalised
 * @param {string} [sessionFolder]  normalised
 */
export function workTreeRoot(folder, sessionFolder = '') {
  return nestedWorkTree(folder) || (isInside(folder, sessionFolder) ? sessionFolder : folder);
}
