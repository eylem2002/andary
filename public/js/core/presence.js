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
 * A new walk from wherever a person is now. Standing (no walk, or a finished one), it starts on
 * their tile. Mid-step it first finishes the step to the tile being entered, and `at` is set back
 * by the part already walked, so the figure carries on from where it is on every screen and never
 * cuts a corner.
 * @param {{ tile: Tile, walk: Walk|null }} where  where they stand, and their last walk
 * @param {unknown} to @param {number} now (ms)
 * @returns {{ ok: boolean, path?: Tile[], at?: number, error?: string }}
 */
export function continueWalk({ tile, walk }, to, now) {
  const step = walk ? stepOf(walk, now) : null;
  if (!step || step.part === 0) {
    const plan = planWalk(step ? step.from : tile, to);
    return plan.ok ? { ...plan, at: now } : plan;
  }
  const plan = planWalk(/** @type {Tile} */ (step.into), to, MAX_ROUTE_TILES - 1);
  if (!plan.ok) return plan;
  return { ok: true, path: [step.from, .../** @type {Tile[]} */ (plan.path)], at: now - (step.part / WALK_TILES_PER_SECOND) * 1000 };
}

/**
 * The tile a person stands on, or is stepping onto: where their next step by key starts.
 * @param {{ tile: Tile, walk: Walk|null }} where @param {number} now
 * @returns {Tile}
 */
export function headingTile({ tile, walk }, now) {
  if (!walk) return tile;
  const step = stepOf(walk, now);
  return step.part > 0 && step.into ? step.into : step.from;
}

/**
 * Where a walk is at a time, by tile: the step under way (from → into, `part` of it walked), or
 * the last tile once it is over (part 0, into null).
 * @param {Walk} walk @param {number} now
 */
function stepOf({ path, at }, now) {
  const steps = Math.max(0, ((now - at) / 1000) * WALK_TILES_PER_SECOND);
  const last = path.length - 1;
  if (steps >= last) return { from: path[last] ?? [0, 0], into: null, part: 0 };
  const i = Math.floor(steps);
  return { from: path[i], into: path[i + 1], part: steps - i };
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
