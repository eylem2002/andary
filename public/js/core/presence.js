// Where the people of a team town are (CONTRACTS §4.11): walks on the town plan's walking grid,
// timed on the host's clock, so every browser animates the same walk at the same moment. Also the
// fixed emotes and phrases a person may show; there is no free text. Pure: the server plans and
// checks walks with it, and every browser places the figures with positionAt.
import { COLS, ROWS, findTilePath, isWalkable } from './town-map.js';

/** Tiles a walking person covers per second, on every screen. */
export const WALK_TILES_PER_SECOND = 2.2;
/** The longest walk, in steps from tile to tile. */
export const MAX_ROUTE_TILES = 60;

/** The eight emotes, by id. */
export const EMOTES = Object.freeze(['👋', '👍', '🎉', '☕', '🤔', '❤️', '😂', '👀']);

/** The set phrases, by id. Nothing else a person says ever reaches another screen. */
export const PHRASES = Object.freeze([
  'On it',
  'Review please?',
  'Nice!',
  'Need a hand?',
  'Coffee?',
  'Back in 5',
  'Shipping it',
  'Tests are green',
  'Thanks!',
  'Look at this',
]);

/** @typedef {[number, number]} Tile  [col, row] */
/** @typedef {{ path: Tile[], at: number }} Walk  path from the start tile; at: when it started (ms) */

/** @param {unknown} value @returns {value is Tile} */
export function isTile(value) {
  return Array.isArray(value) && value.length === 2 && value.every((n) => Number.isInteger(n)) && value[0] >= 0 && value[0] < COLS && value[1] >= 0 && value[1] < ROWS;
}

/**
 * Plans a walk on the walking grid: the target must be a walkable tile, reachable, and at most
 * MAX_ROUTE_TILES steps away.
 * @param {Tile} from @param {unknown} to
 * @param {number} [maxTiles]  the bound (the whole town is less than 60 steps across today)
 * @returns {{ ok: boolean, path?: Tile[], error?: string }}
 */
export function planWalk(from, to, maxTiles = MAX_ROUTE_TILES) {
  if (!isTile(to)) return { ok: false, error: 'walk.to is a tile [col, row] on the map' };
  if (!isWalkable(to[0], to[1])) return { ok: false, error: 'You can only walk on streets and squares' };
  const path = findTilePath(from, to);
  if (path.length === 0) return { ok: false, error: 'There is no way there' };
  if (path.length - 1 > maxTiles) return { ok: false, error: `That is more than ${maxTiles} tiles away: walk part of the way first` };
  return { ok: true, path };
}

/** How long a walk takes, in ms. @param {Tile[]} path */
export function walkDuration(path) {
  return (Math.max(0, path.length - 1) / WALK_TILES_PER_SECOND) * 1000;
}

/**
 * Where a walk is at a time, in tile coordinates (fractional between tiles): the start before it
 * began, the end once it is over.
 * @param {Tile[]} path @param {number} at when it started (ms) @param {number} now (ms)
 * @returns {{ col: number, row: number, done: boolean }}
 */
export function positionAt(path, at, now) {
  if (path.length === 0) return { col: 0, row: 0, done: true };
  const steps = Math.max(0, ((now - at) / 1000) * WALK_TILES_PER_SECOND);
  const last = path.length - 1;
  if (steps >= last) return { col: path[last][0], row: path[last][1], done: true };
  const i = Math.floor(steps);
  const t = steps - i;
  const [c0, r0] = path[i];
  const [c1, r1] = path[i + 1];
  return { col: c0 + (c1 - c0) * t, row: r0 + (r1 - r0) * t, done: false };
}

/**
 * The tile a walk stands on at a time: where the next walk starts. Mid-step it is the tile being
 * left, so a new route never skips a corner.
 * @param {Tile[]} path @param {number} at @param {number} now
 * @returns {Tile}
 */
export function tileAt(path, at, now) {
  const steps = Math.max(0, ((now - at) / 1000) * WALK_TILES_PER_SECOND);
  return path[Math.min(path.length - 1, Math.floor(steps))] ?? [0, 0];
}

/**
 * The tile one step from another in a direction, if it can be walked on.
 * @param {Tile} from @param {number} dc @param {number} dr
 * @returns {Tile|null}
 */
export function stepFrom(from, dc, dr) {
  const next = /** @type {Tile} */ ([from[0] + dc, from[1] + dr]);
  return isTile(next) && isWalkable(next[0], next[1]) ? next : null;
}
