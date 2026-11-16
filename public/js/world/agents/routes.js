// Turns "go to building X" into a list of world-space waypoints on the road network, and slots
// (spot or queue place) into standing positions. Pure: only layout.js, no three.js.

import {
  COLS,
  LOTS,
  ROWS,
  TILE,
  cornersOnly,
  findTilePath,
  isWalkable,
  nearestWalkable,
  queueSpot,
  tileToWorld,
  workSpots,
  worldToTile,
} from '../layout.js';

/** @typedef {{x: number, z: number}} Point */
/** @typedef {{x: number, z: number, facing: number}} Standing */

const MAX_QUEUE_PLACES = 16;
const QUEUE_ROW_GAP = 0.6;

/**
 * Sideways offset (world units) an agent keeps to the right of the road's centre line. Everyone
 * keeps right, so people walking in opposite directions pass each other, and the five lanes
 * spread a crowd walking the same way side by side. Deterministic per agent.
 * @param {number} seedInt
 */
export function laneOffset(seedInt) {
  return 0.12 + ((seedInt >>> 8) % 5) * 0.12;
}

/** @param {number} x @param {number} z */
function walkableAt(x, z) {
  // worldToTile clamps to the map edge, so reject points beyond the map first.
  const inside = Math.abs(x) < (COLS * TILE) / 2 && Math.abs(z) < (ROWS * TILE) / 2;
  const [c, r] = worldToTile(x, z);
  return inside && isWalkable(c, r);
}

/**
 * Offsets a polyline sideways by `lane` (positive = right of travel). Corners use the miter
 * (sum of both perpendiculars), which is exact for the grid's right-angle turns.
 * @param {Point[]} points
 * @param {number} lane
 * @returns {Point[]}
 */
export function offsetPolyline(points, lane) {
  if (points.length < 2 || lane === 0) return points.map((p) => ({ x: p.x, z: p.z }));
  return points.map((p, i) => {
    let ox = 0;
    let oz = 0;
    if (i > 0) {
      const [px, pz] = rightOf(points[i - 1], p);
      ox += px;
      oz += pz;
    }
    if (i < points.length - 1) {
      const [px, pz] = rightOf(p, points[i + 1]);
      ox += px;
      oz += pz;
    }
    if (i > 0 && i < points.length - 1 && ox === 0 && oz === 0) return { x: p.x, z: p.z };
    return { x: p.x + ox * lane, z: p.z + oz * lane };
  });
}

/** Unit vector to the right of travelling from a to b (x east, z south). @param {Point} a @param {Point} b */
function rightOf(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return [-dz / len, dx / len];
}

/**
 * Waypoints from a position to a standing point via the roads: from the nearest walkable tile
 * along the shortest tile path to `via` (a building's door tile) or the tile nearest the
 * standing point, turning only at corners, offset into the agent's lane, and finally onto the
 * standing point itself.
 * @param {Point} from
 * @param {Point} to
 * @param {number} [lane]
 * @param {[number, number]|null} [via] tile to arrive through, e.g. LOTS[key].door
 * @returns {Point[]}
 */
export function planRoute(from, to, lane = 0, via = null) {
  const startTile = nearestWalkable(from.x, from.z);
  const goalTile = via ?? nearestWalkable(to.x, to.z);
  const tiles = findTilePath(startTile, goalTile);
  /** @type {Point[]} */
  let points = [];
  if (tiles.length > 1) {
    points = offsetPolyline(
      cornersOnly(tiles).map(([c, r]) => tileToWorld(c, r)),
      lane,
    );
    // Already on the road: skip back-stepping to the middle of the tile we stand in.
    if (walkableAt(from.x, from.z)) points.shift();
  }
  points.push({ x: to.x, z: to.z });
  return dropNearDuplicates(from, points);
}

/** @param {Point} from @param {Point[]} points */
function dropNearDuplicates(from, points) {
  /** @type {Point[]} */
  const out = [];
  let prev = from;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const last = i === points.length - 1;
    if (!last && Math.hypot(p.x - prev.x, p.z - prev.z) < 0.05) continue;
    out.push(p);
    prev = p;
  }
  return out;
}

/**
 * Total length of a route starting at `from`.
 * @param {Point} from @param {Point[]} points
 */
export function routeLength(from, points) {
  let total = 0;
  let prev = from;
  for (const p of points) {
    total += Math.hypot(p.x - prev.x, p.z - prev.z);
    prev = p;
  }
  return total;
}

/** @type {Map<string, Standing[]>} */
const queueCache = new Map();
/** @type {Map<string, Standing[]>} */
const spotCache = new Map();

/**
 * layout.workSpots that are on walkable ground (a few next to the Goal Board would put an agent
 * inside the Town Hall), nearest first.
 * @param {import('../../core/catalog.js').BuildingKey} key
 */
export function standingSpots(key) {
  let spots = spotCache.get(key);
  if (!spots) {
    const all = workSpots(key);
    spots = all.filter((s) => walkableAt(s.x, s.z));
    if (spots.length === 0) spots = all.slice(0, 1);
    spotCache.set(key, spots);
  }
  return spots;
}

/**
 * Queue places for a building: layout.queueSpot along the street for as long as it stays on
 * walkable ground, then further rows behind the first.
 * @param {import('../../core/catalog.js').BuildingKey} key
 */
function queuePlaces(key) {
  let places = queueCache.get(key);
  if (places) return places;
  places = [];
  for (let n = 0; n < MAX_QUEUE_PLACES; n++) {
    const s = queueSpot(key, n);
    if (!walkableAt(s.x, s.z)) break;
    places.push(s);
  }
  if (places.length === 0) places.push(queueSpot(key, 0));
  queueCache.set(key, places);
  return places;
}

/**
 * The tile a route to a slot should arrive through: the door for work spots (so agents walk up
 * to the entrance first), the nearest road tile for queue places.
 * @param {import('../../core/catalog.js').BuildingKey} key
 * @param {{kind: 'spot'|'queue', index: number}} slot
 * @returns {[number, number]|null}
 */
export function slotEntry(key, slot) {
  return slot.kind === 'spot' ? LOTS[key].door : null;
}

/**
 * The standing point for a slot.
 * @param {import('../../core/catalog.js').BuildingKey} key
 * @param {{kind: 'spot'|'queue', index: number}} slot
 * @returns {Standing}
 */
export function slotPosition(key, slot) {
  if (slot.kind === 'spot') {
    const spots = standingSpots(key);
    return spots[Math.min(slot.index, spots.length - 1)];
  }
  const places = queuePlaces(key);
  const row = Math.floor(slot.index / places.length);
  const base = places[slot.index % places.length];
  if (row === 0) return base;
  // Overflow rows stand behind the first one, on whichever side is walkable.
  const south = { x: base.x, z: base.z + QUEUE_ROW_GAP * row, facing: base.facing };
  if (walkableAt(south.x, south.z)) return south;
  return { x: base.x, z: base.z - QUEUE_ROW_GAP * row, facing: base.facing };
}
