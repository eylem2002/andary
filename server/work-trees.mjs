// Where each folder's git work tree starts, for the town's same-file and git rules
// (public/js/core/conflicts.js, CONTRACTS §4.6): the browser cannot look at the disk, so without
// this it guesses from the folders it knows. Ingest stamps the top of a local tool hook's folder
// on it as `andary_root`; a stamp that came from anywhere else is dropped first. The top is the
// nearest folder, from the hook's folder up, that holds `.git` (a folder, or the file of a linked
// worktree or a submodule). Each folder's answer is kept for a few minutes, for a bounded number
// of folders, so a hook costs a few file lookups at most. Folders are read with forward slashes,
// as the town compares them, on every system (a Windows `C:\\w\\app` is `C:/w/app`).
import { statSync } from 'node:fs';
import { KEYED_HOOKS } from './hook-steps.mjs';

/** Folders whose answer is kept; the one asked about the longest ago goes first. */
export const MAX_FOLDERS = 256;
/** An answer is looked up again after this long: a repository may have been made or removed. */
export const REFRESH_MS = 5 * 60_000;
/** Folders walked up from one at most. */
const MAX_DEPTH = 64;
/** Longer folder names are not looked up. */
const MAX_FOLDER_CHARS = 4096;

/**
 * @typedef {object} WorkTrees
 * @property {(folder: unknown) => string|null} rootOf  the top of the work tree holding the folder, or null (none, or not an absolute path)
 */

/**
 * @param {{ exists?: (path: string) => boolean, now?: () => number }} [options]  exists: whether a path is there (tests)
 * @returns {WorkTrees}
 */
export function createWorkTrees({ exists = onDisk, now = Date.now } = {}) {
  /** @type {Map<string, { root: string|null, at: number }>} */
  const known = new Map();
  return {
    rootOf(folder) {
      if (typeof folder !== 'string' || !folder || folder.length > MAX_FOLDER_CHARS) return null;
      const dir = slashed(folder);
      if (!ABSOLUTE.test(dir)) return null;
      const hit = known.get(dir);
      if (hit && now() - hit.at < REFRESH_MS) return hit.root;
      const root = topOf(dir, exists);
      known.delete(dir);
      known.set(dir, { root, at: now() });
      if (known.size > MAX_FOLDERS) known.delete(/** @type {string} */ (known.keys().next().value));
      return root;
    },
  };
}

/**
 * A payload with the top of its folder's work tree, for a tool hook from this computer
 * (`workTrees`); without them (a teammate's hook) only without a stamp it did not get here.
 * @param {Record<string, any>} event
 * @param {WorkTrees|null|undefined} workTrees
 * @returns {Record<string, any>}
 */
export function withWorkTree(event, workTrees) {
  const { andary_root: _forged, ...rest } = event;
  const clean = 'andary_root' in event ? rest : event;
  if (!workTrees || !KEYED_HOOKS.has(clean.hook_event_name)) return clean;
  const root = workTrees.rootOf(clean.cwd);
  return root ? { ...clean, andary_root: root } : clean;
}

/** An absolute folder, with forward slashes: `/…`, a drive (`C:/…`) or a share (`//host/…`). */
const ABSOLUTE = /^(?:\/|[A-Za-z]:\/)/;
/** A folder that has no parent: `/`, a drive's top (`C:/`), a share's (`//host/share`). */
const TOP = /^(?:\/|[A-Za-z]:\/|\/\/[^/]+\/[^/]+)$/;

/** A folder with forward slashes and no trailing one (but a top's). @param {string} folder */
function slashed(folder) {
  const forward = folder.replace(/\\/g, '/');
  const trimmed = forward.replace(/\/+$/, '');
  return TOP.test(`${trimmed}/`) ? `${trimmed}/` : trimmed;
}

/** The folder above, or the folder itself at a top. @param {string} dir */
function parentOf(dir) {
  if (TOP.test(dir)) return dir;
  const cut = dir.lastIndexOf('/');
  const up = dir.slice(0, cut);
  return TOP.test(`${up}/`) ? `${up}/` : up;
}

/** @param {string} folder @param {(path: string) => boolean} exists @returns {string|null} */
function topOf(folder, exists) {
  let dir = folder;
  for (let i = 0; i < MAX_DEPTH; i += 1) {
    if (exists(dir.endsWith('/') ? `${dir}.git` : `${dir}/.git`)) return dir;
    const up = parentOf(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

/** @param {string} path */
function onDisk(path) {
  try {
    return statSync(path, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return false;
  }
}
