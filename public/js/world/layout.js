// The town plan, shared by the environment (which builds meshes on it) and the characters
// (which walk on it). Pure data + pure functions: no three.js, so it is unit-testable in Node.
//
// One character per tile. The map is 26 x 26 tiles of TILE world units, centred on the origin,
// with +x to the east and +z to the south. Every building's door faces south (+z) so the default
// camera, which looks from the south-east, sees all entrances.

/** @typedef {import('../core/catalog.js').BuildingKey} BuildingKey */

export const TILE = 2;

// Legend
//   ~ water     = shore promenade   # road      P plaza (walkable)
//   t trees     . open ground       F fountain  x sandbox      n node_modules lot
//   Building lots (non-walkable):
//   H hall  B board  L library  A academy  W web  O post  M harbor  K workshop  S detective
//   T terminal  C cafe  Y spa  R permits  U station  G grove
export const MAP = Object.freeze([
  '~~~~~~~~~~~~~~~~~~~~~~~~~~', // 0
  '~~~~~~~~~~~~~~~~~~~~~~~~~~', // 1
  '==========================', // 2
  't.######################.t', // 3  north ring road
  't.#tttttt#tttttt#MMMMMM#.t', // 4
  't.#LLLAAA#WWWOOO#MMMMMM#.t', // 5
  't.#LLLAAA#WWWOOO#MMMMMM#.t', // 6
  't.#LLLAAA#WWWOOO#MMMMMM#.t', // 7
  't.#LLLAAA#WWWOOO#MMMMMM#.t', // 8
  't.######################.t', // 9  north avenue
  't.#......#PHHHHB#TTTTTx#.t', // 10
  't.#KKKSSS#PHHHHB#TTTTTx#.t', // 11
  't.#KKKSSS#PHHHHB#TTTTTx#.t', // 12
  't.#KKKSSS#PHHHHP#TTTTTn#.t', // 13
  't.#KKKSSS#PPPPPP#TTTTTn#.t', // 14
  't.#KKKSSS#PPFFPP#TTTTTn#.t', // 15
  't.######################.t', // 16 south avenue
  't.#CCCYYY#RRRttt#GGGGGG#.t', // 17
  't.#CCCYYY#RRRttt#GGGGGG#.t', // 18
  't.#CCCYYY#RRRttt#GGGGGG#.t', // 19
  't.#CCCYYY#RRRUUU#GGGGGG#.t', // 20
  't.#CCCYYY#RRRUUU#GGGGGG#.t', // 21
  't.#CCCYYY#RRRUUU#GGGGGG#.t', // 22
  't.######################.t', // 23 south ring road
  'tttttttttttttttttttttttttt', // 24
  'tttttttttttttttttttttttttt', // 25
]);

export const COLS = MAP[0].length;
export const ROWS = MAP.length;
const HALF_W = (COLS * TILE) / 2;
const HALF_D = (ROWS * TILE) / 2;

const WALKABLE = new Set(['#', 'P']);

/**
 * @typedef {object} Lot
 * @property {BuildingKey} key
 * @property {string} letter            map letter of the lot
 * @property {[number, number, number, number]} rect  [col0,row0,col1,row1] inclusive
 * @property {[number, number]} door    walkable tile in front of the entrance
 */

/** @type {Readonly<Record<BuildingKey, {letter: string, door: [number, number]}>>} */
const LOT_DEFS = Object.freeze({
  library: { letter: 'L', door: [4, 9] },
  academy: { letter: 'A', door: [7, 9] },
  web: { letter: 'W', door: [11, 9] },
  post: { letter: 'O', door: [14, 9] },
  harbor: { letter: 'M', door: [20, 9] },
  workshop: { letter: 'K', door: [4, 16] },
  detective: { letter: 'S', door: [7, 16] },
  hall: { letter: 'H', door: [12, 14] },
  board: { letter: 'B', door: [15, 13] },
  terminal: { letter: 'T', door: [19, 16] },
  cafe: { letter: 'C', door: [4, 23] },
  spa: { letter: 'Y', door: [7, 23] },
  permits: { letter: 'R', door: [11, 23] },
  station: { letter: 'U', door: [14, 23] },
  grove: { letter: 'G', door: [20, 23] },
});

/** @param {string} letter */
function rectOf(letter) {
  let c0 = Infinity;
  let r0 = Infinity;
  let c1 = -Infinity;
  let r1 = -Infinity;
  MAP.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== letter) continue;
      c0 = Math.min(c0, c);
      r0 = Math.min(r0, r);
      c1 = Math.max(c1, c);
      r1 = Math.max(r1, r);
    }
  });
  return /** @type {[number, number, number, number]} */ ([c0, r0, c1, r1]);
}

/** @type {Readonly<Record<BuildingKey, Lot>>} */
export const LOTS = Object.freeze(
  /** @type {Record<BuildingKey, Lot>} */ (
    Object.fromEntries(
      Object.entries(LOT_DEFS).map(([key, def]) => [key, { key, letter: def.letter, rect: rectOf(def.letter), door: def.door }]),
    )
  ),
);

/** Decorative areas the environment fills with props. Rects are inclusive tile ranges. */
export const DECOR = Object.freeze({
  sandbox: rectOf('x'),
  nodeModules: rectOf('n'),
  fountain: rectOf('F'),
});

/**
 * Tile centre in world space.
 * @param {number} col
 * @param {number} row
 */
export function tileToWorld(col, row) {
  return { x: (col + 0.5) * TILE - HALF_W, z: (row + 0.5) * TILE - HALF_D };
}

/**
 * Tile containing a world position (clamped to the map).
 * @param {number} x
 * @param {number} z
 * @returns {[number, number]}
 */
export function worldToTile(x, z) {
  const col = Math.min(COLS - 1, Math.max(0, Math.floor((x + HALF_W) / TILE)));
  const row = Math.min(ROWS - 1, Math.max(0, Math.floor((z + HALF_D) / TILE)));
  return [col, row];
}

/** @param {number} col @param {number} row */
export function tileAt(col, row) {
  return MAP[row]?.[col] ?? ' ';
}

/** @param {number} col @param {number} row */
export function isWalkable(col, row) {
  return WALKABLE.has(tileAt(col, row));
}

/**
 * World-space centre and footprint of a building lot.
 * @param {BuildingKey} key
 */
export function lotBounds(key) {
  const [c0, r0, c1, r1] = LOTS[key].rect;
  const a = tileToWorld(c0, r0);
  const b = tileToWorld(c1, r1);
  return {
    center: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 },
    width: (c1 - c0 + 1) * TILE,
    depth: (r1 - r0 + 1) * TILE,
  };
}

/**
 * Rows of standing spots, as offsets from the door tile's centre in tiles (north is negative).
 * Vehicles drive half a tile-unit (0.5) either side of a road's centre line, so at a door on a
 * road agents stand on the kerb by the building and on the centre line, clear of both lanes.
 */
const SPOT_ROWS = Object.freeze({ road: [-0.475, 0], plaza: [-0.32, 0.22] });

/** @param {BuildingKey} key */
function doorOnRoad(key) {
  const [col, row] = LOTS[key].door;
  return tileAt(col, row) === '#';
}

/**
 * Standing spots in front of a building's entrance, nearest first. Agents beyond the last spot
 * queue eastwards along the street (see queueSpot).
 * @param {BuildingKey} key
 * @returns {{x: number, z: number, facing: number}[]}  facing is a yaw in radians (see WORK_FACING)
 */
export function workSpots(key) {
  const [col, row] = LOTS[key].door;
  const door = tileToWorld(col, row);
  const spots = [];
  const offsets = [-0.25, 0.25, -0.72, 0.72];
  for (const dz of doorOnRoad(key) ? SPOT_ROWS.road : SPOT_ROWS.plaza) {
    for (const dx of offsets) {
      spots.push({ x: door.x + dx * TILE * 0.5 * 1.6, z: door.z + dz * TILE, facing: WORK_FACING });
    }
  }
  return spots;
}

/**
 * The n-th queue position (0-based) for agents who find every work spot taken: on a road, along
 * its centre line, out of the lanes.
 * @param {BuildingKey} key
 * @param {number} n
 */
export function queueSpot(key, n) {
  const [col, row] = LOTS[key].door;
  const door = tileToWorld(col, row);
  const dz = doorOnRoad(key) ? 0 : TILE * 0.25;
  return { x: door.x + TILE * 0.9 + n * TILE * 0.45, z: door.z + dz, facing: -Math.PI / 2 };
}

// Agents at work turn three-quarters towards the default camera (which looks from the south-east)
// instead of showing it their backs; the building stays on their left, so they still read as
// working at it. Yaw 0 faces south (+z) and Math.PI faces the door (north).
export const WORK_FACING = Math.PI * 0.55;

const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Shortest walkable route between two tiles (breadth-first; the grid is small).
 * Returns the tile sequence including both ends, or [] when unreachable.
 * @param {[number, number]} from
 * @param {[number, number]} to
 * @returns {[number, number][]}
 */
export function findTilePath(from, to) {
  const key = (/** @type {number} */ c, /** @type {number} */ r) => r * COLS + c;
  const goal = key(to[0], to[1]);
  const start = key(from[0], from[1]);
  if (start === goal) return [from];
  /** @type {Map<number, number>} */
  const cameFrom = new Map([[start, -1]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const [c, r] = queue[i];
    for (const [dc, dr] of STEPS) {
      const nc = c + dc;
      const nr = r + dr;
      const k = key(nc, nr);
      if (cameFrom.has(k) || (!isWalkable(nc, nr) && k !== goal)) continue;
      cameFrom.set(k, key(c, r));
      if (k === goal) return unwind(cameFrom, goal);
      queue.push([nc, nr]);
    }
  }
  return [];
}

/** @param {Map<number, number>} cameFrom @param {number} goal */
function unwind(cameFrom, goal) {
  /** @type {[number, number][]} */
  const path = [];
  for (let k = goal; k !== -1; k = cameFrom.get(k)) {
    path.push([k % COLS, Math.floor(k / COLS)]);
  }
  return path.reverse();
}

/**
 * Collapses a tile path to the tiles where the direction changes, so walkers move in straight
 * segments instead of stopping on every tile.
 * @param {[number, number][]} tiles
 */
export function cornersOnly(tiles) {
  if (tiles.length <= 2) return tiles.slice();
  const out = [tiles[0]];
  for (let i = 1; i < tiles.length - 1; i++) {
    const [pc, pr] = tiles[i - 1];
    const [c, r] = tiles[i];
    const [nc, nr] = tiles[i + 1];
    if (c - pc !== nc - c || r - pr !== nr - r) out.push(tiles[i]);
  }
  out.push(tiles[tiles.length - 1]);
  return out;
}

/** Nearest walkable tile to a world position (agents standing at a spot are just off-road). */
export function nearestWalkable(x, z) {
  const [c, r] = worldToTile(x, z);
  if (isWalkable(c, r)) return /** @type {[number, number]} */ ([c, r]);
  for (let radius = 1; radius < Math.max(COLS, ROWS); radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
        if (isWalkable(c + dc, r + dr)) return /** @type {[number, number]} */ ([c + dc, r + dr]);
      }
    }
  }
  return /** @type {[number, number]} */ ([c, r]);
}

/**
 * The ring road as a clockwise loop of corner points in world space, for vehicles.
 * Vehicles drive on the right: offset each point towards the inside of the loop by lane width.
 */
export function ringRoadCorners() {
  return [tileToWorld(2, 3), tileToWorld(23, 3), tileToWorld(23, 23), tileToWorld(2, 23)];
}
