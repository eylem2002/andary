// Where each folder's git work tree starts, for the town's same-file and git rules
// (public/js/core/conflicts.js, CONTRACTS §4.6): the browser cannot look at the disk, so without
// this it guesses from the folders it knows. Ingest stamps the top of a local tool hook's folder
// on it as `andary_root`; a stamp that came from anywhere else is dropped first. The top is the
// nearest folder, from the hook's folder up, that holds `.git` (a folder, or the file of a linked
// worktree or a submodule). Each folder's answer is kept for a few minutes, for a bounded number
// of folders, so a hook costs a few file lookups at most.
import { statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
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
      if (typeof folder !== 'string' || !folder || folder.length > MAX_FOLDER_CHARS || !isAbsolute(folder)) return null;
      const hit = known.get(folder);
      if (hit && now() - hit.at < REFRESH_MS) return hit.root;
      const root = topOf(folder, exists);
      known.delete(folder);
      known.set(folder, { root, at: now() });
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

/** @param {string} folder @param {(path: string) => boolean} exists @returns {string|null} */
function topOf(folder, exists) {
  let dir = folder;
  for (let i = 0; i < MAX_DEPTH; i += 1) {
    if (exists(join(dir, '.git'))) return dir;
    const up = dirname(dir);
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
