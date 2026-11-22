// The town plan as the 3D world uses it: the pure map (core/town-map.js, re-exported here so the
// world's modules keep one import) plus where agents stand at a door, queue, and where vehicles
// drive. No three.js, so it is unit-testable in Node.

/** @typedef {import('../core/catalog.js').BuildingKey} BuildingKey */

import { LOTS, TILE, tileAt, tileToWorld } from '../core/town-map.js';

export { COLS, DECOR, HOMES, HOME_COUNT, LOTS, MAP, MAP_BOUNDS, ROWS, TILE, cornersOnly, findTilePath, isWalkable, lotBounds, nearestWalkable, tileAt, tileToWorld, worldToTile } from '../core/town-map.js';

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

/**
 * The ring road as a clockwise loop of corner points in world space, for vehicles.
 * Vehicles drive on the right: offset each point towards the inside of the loop by lane width.
 */
export function ringRoadCorners() {
  return [tileToWorld(2, 3), tileToWorld(23, 3), tileToWorld(23, 23), tileToWorld(2, 23)];
}
