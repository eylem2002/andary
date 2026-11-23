// The ground: a floating diorama plinth (coral rock and sandy soil strata on its sides), one tile box per
// map cell (asphalt roads, paved plaza, lawns, courtyards), sidewalks, road markings, zebra
// crossings, the seawall and promenade, the sea floor and the resin-look sea sides, and the
// tunnel portals where buses leave the island.
import { COLS, MAP_BOUNDS, ROWS, TILE, tileAt, tileToWorld } from '../layout.js';
import { C, S, STYLE } from './palette.js';
import { createRng, range } from './rand.js';

/**
 * Plinth extents (world units): the map plus a lawn rim. The sea continues north of the map to the
 * plinth's far edge.
 */
export const PLINTH = Object.freeze({ minX: MAP_BOUNDS.minX - 0.6, maxX: MAP_BOUNDS.maxX + 0.6, minZ: -36.5, maxZ: MAP_BOUNDS.maxZ + 0.6, bottom: -4.6 });
/** Sea geometry: shoreline (seawall) z, water level and sea floor. */
export const SEA = Object.freeze({ shoreZ: -22, level: -0.5, floor: -1.9 });
/** Ground heights of tile kinds. Roads and plaza are at 0, where agents walk. */
const TOP = Object.freeze({ road: 0, plaza: 0, lot: 0.08, lawn: 0.1, open: 0.07, promenade: 0.04 });
const BASE = -0.06;
/** Internal intersections that get zebra crossings on every approach. */
const CROSSINGS = Object.freeze([
  [9, 9],
  [16, 9],
  [9, 16],
  [16, 16],
]);

/** Lot letter → courtyard colour. */
const LOT_GROUND = Object.freeze({ G: C.lawn, M: 0xcfcbc2, T: 0xd6cfc2, x: C.lawn, n: C.gravel, h: C.lawn });

/** @param {number} col @param {number} row */
const isRoad = (col, row) => tileAt(col, row) === '#';
/** @param {number} col @param {number} row */
const isWalk = (col, row) => tileAt(col, row) === '#' || tileAt(col, row) === 'P';

/**
 * @param {import('./kit.js').Kit} kit
 */
export function buildTerrain(kit) {
  const rng = createRng(11);
  kit.building = 0;
  buildPlinth(kit);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) buildTile(kit, col, row, rng);
  }
  buildRim(kit, rng);
  buildCrossings(kit);
  buildExitRoads(kit);
  buildSeaBed(kit, rng);
  buildSeawall(kit);
}

/** @param {import('./kit.js').Kit} kit */
function buildPlinth(kit) {
  const { minX, maxX, minZ, maxZ, bottom } = PLINTH;
  const w = maxX - minX;
  const cx = (minX + maxX) / 2;
  kit.box([cx, bottom, (minZ + maxZ) / 2], [w, SEA.floor - bottom, maxZ - minZ], C.soil, { surface: S.strata });
  kit.box([cx, SEA.floor, (SEA.shoreZ + maxZ) / 2], [w, BASE - SEA.floor, maxZ - SEA.shoreZ], C.soil, { surface: S.strata });
  // A darker underside lip makes the plinth read as a solid block floating in the sky.
  kit.box([cx, bottom - 0.35, (minZ + maxZ) / 2], [w - 1.2, 0.35, maxZ - minZ - 1.2], 0x6b5a48, { surface: S.strata });
}

/**
 * @param {import('./kit.js').Kit} kit
 * @param {number} col @param {number} row
 * @param {() => number} rng
 */
function buildTile(kit, col, row, rng) {
  const ch = tileAt(col, row);
  const { x, z } = tileToWorld(col, row);
  const jitter = range(rng, -0.025, 0.025);
  if (ch === '~') return;
  if (ch === '#') return buildRoadTile(kit, col, row, x, z);
  if (ch === 'P' || ch === 'F' || ch === 'f') return buildPlazaTile(kit, col, row, x, z);
  if (ch === '=') return slab(kit, [x, z], TOP.promenade, shadeHex(C.paving, jitter), S.stone);
  if (ch === 't' || ch === 'g' || ch === 'k') return slab(kit, [x, z], TOP.lawn, shadeHex(C.lawn, jitter * 2), S.ground);
  if (ch === '.') return slab(kit, [x, z], TOP.open, shadeHex(0xbfc98a, jitter * 2), S.ground);
  const ground = /** @type {Record<string, number>} */ (LOT_GROUND)[ch] ?? C.paving;
  slab(kit, [x, z], TOP.lot, shadeHex(ground, jitter * 0.6), ground === C.lawn ? S.ground : S.matte);
}

/**
 * @param {import('./kit.js').Kit} kit
 * @param {[number, number]} at  tile centre [x, z]
 * @param {number} top @param {number} color @param {number} surface
 */
function slab(kit, [x, z], top, color, surface) {
  kit.box([x, BASE, z], [TILE, top - BASE, TILE], color, { surface });
}

/**
 * Asphalt with sidewalk bands along every edge that borders something you cannot walk on, and a
 * dashed centre line on straight stretches.
 * @param {import('./kit.js').Kit} kit
 */
function buildRoadTile(kit, col, row, x, z) {
  kit.box([x, BASE, z], [TILE, TOP.road - BASE, TILE], C.asphalt, { surface: S.matte });
  const band = 0.36;
  const edges = [
    [0, -1, x, z - TILE / 2 + band / 2, TILE, band],
    [0, 1, x, z + TILE / 2 - band / 2, TILE, band],
    [-1, 0, x - TILE / 2 + band / 2, z, band, TILE],
    [1, 0, x + TILE / 2 - band / 2, z, band, TILE],
  ];
  for (const [dc, dr, bx, bz, bw, bd] of edges) {
    if (isWalk(col + dc, row + dr)) continue;
    kit.box([bx, TOP.road, bz], [bw, 0.025, bd], C.sidewalk, { surface: S.stone });
  }
  const horizontal = isRoad(col - 1, row) && isRoad(col + 1, row) && !isRoad(col, row - 1) && !isRoad(col, row + 1);
  const vertical = isRoad(col, row - 1) && isRoad(col, row + 1) && !isRoad(col - 1, row) && !isRoad(col + 1, row);
  if (horizontal) kit.box([x, TOP.road, z], [0.8, 0.012, 0.07], C.marking);
  if (vertical) kit.box([x, TOP.road, z], [0.07, 0.012, 0.8], C.marking);
}

/**
 * Plaza paving: four slabs per tile in two alternating stone tones.
 * @param {import('./kit.js').Kit} kit
 */
function buildPlazaTile(kit, col, row, x, z) {
  for (let i = 0; i < 4; i++) {
    const sx = i % 2;
    const sz = Math.floor(i / 2);
    const alt = (col * 2 + sx + row * 2 + sz) % 2 === 0;
    kit.box([x - 0.5 + sx, BASE, z - 0.5 + sz], [0.98, TOP.plaza - BASE, 0.98], alt ? C.paving : C.pavingAlt, { surface: S.stone });
  }
}

/**
 * Lawn border between the map and the plinth edge.
 * @param {import('./kit.js').Kit} kit
 * @param {() => number} rng
 */
function buildRim(kit, rng) {
  const { minX, maxX, maxZ } = PLINTH;
  const half = (COLS * TILE) / 2;
  const south = MAP_BOUNDS.maxZ;
  const depth = maxZ - south;
  const color = () => shadeHex(C.lawn, range(rng, -0.03, 0.03));
  kit.box([0, BASE, south + depth / 2], [maxX - minX, TOP.lawn - BASE, depth], color(), { surface: S.ground });
  const sideW = maxX - half;
  const z0 = SEA.shoreZ;
  kit.box([-half - sideW / 2, BASE, (z0 + south) / 2], [sideW, TOP.lawn - BASE, south - z0], color(), { surface: S.ground });
  kit.box([half + sideW / 2, BASE, (z0 + south) / 2], [sideW, TOP.lawn - BASE, south - z0], color(), { surface: S.ground });
}

/**
 * Zebra stripes on the approaches to the main intersections, parallel to the traffic.
 * @param {import('./kit.js').Kit} kit
 */
function buildCrossings(kit) {
  for (const [col, row] of CROSSINGS) {
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const { x, z } = tileToWorld(col + dc, row + dr);
      const along = dc !== 0;
      const offset = 0.45;
      const cx = x - dc * offset;
      const cz = z - dr * offset;
      for (let i = -2; i <= 2; i++) {
        const across = i * 0.3;
        if (along) kit.box([cx, TOP.road, cz + across], [0.62, 0.014, 0.16], C.marking);
        else kit.box([cx + across, TOP.road, cz], [0.16, 0.014, 0.62], C.marking);
      }
    }
  }
}

/**
 * The south ring road continues to both plinth edges, where it disappears into tunnels.
 * @param {import('./kit.js').Kit} kit
 */
function buildExitRoads(kit) {
  const z = tileToWorld(0, 23).z;
  for (const side of [-1, 1]) {
    const inner = side * 22;
    const outer = side * PLINTH.maxX;
    const cx = (inner + outer) / 2;
    const w = Math.abs(outer - inner);
    kit.box([cx, TOP.road, z], [w, 0.02, TILE], C.asphalt, { surface: S.matte });
    kit.box([cx, TOP.road + 0.02, z], [w * 0.8, 0.012, 0.07], C.marking);
    buildTunnel(kit, side * 25.1, z, side);
  }
}

/**
 * Stone tunnel portal set into a grassy mound at the plinth edge.
 * @param {import('./kit.js').Kit} kit
 * @param {number} x @param {number} z
 * @param {number} side -1 west, 1 east (the portal faces the town)
 */
function buildTunnel(kit, x, z, side) {
  const face = x - side * 0.05;
  const back = side * PLINTH.maxX;
  const depth = Math.abs(back - x) + 0.1;
  const cx = (x + back) / 2;
  kit.rbox([cx, 0, z], [depth, 2.1, 4.6], C.lawn, { surface: S.ground, radius: 0.5, segments: 3 });
  kit.dome([cx, 1.6, z], 2.0, C.lawnDark, { surface: S.ground, sy: 0.45 });
  kit.box([face, 0, z], [0.5, 2.2, 3.4], C.stoneWarm, { surface: S.stone });
  kit.box([face, 2.2, z], [0.62, 0.22, 3.6], C.stoneTrim, { surface: S.stone });
  // The dark opening: a box and a half-cylinder arch top, just proud of the portal face.
  const front = face - side * 0.26;
  kit.box([front, 0, z], [0.04, 1.05, 1.9], 0x1d1a17);
  kit.cyl([front, 1.03, z], 0.95, 0.04, 0x1d1a17, { rotZ: Math.PI / 2, arc: Math.PI, seg: 16 });
  kit.torus([front - side * 0.02, 1.05, z], 1.02, 0.09, C.stoneTrim, { arc: Math.PI, rotY: Math.PI / 2, surface: S.stone });
}

/**
 * Sandy sea floor with a few rocks, and resin-look water on the plinth's sea sides.
 * @param {import('./kit.js').Kit} kit
 * @param {() => number} rng
 */
function buildSeaBed(kit, rng) {
  const { minX, maxX, minZ } = PLINTH;
  const w = maxX - minX;
  const d = SEA.shoreZ - minZ;
  kit.box([0, SEA.floor, (minZ + SEA.shoreZ) / 2], [w, 0.06, d], C.seaFloor, { surface: S.ground });
  for (let i = 0; i < 26; i++) {
    const rx = range(rng, minX + 1, maxX - 1);
    const rz = range(rng, minZ + 1, SEA.shoreZ - 1);
    kit.ball([rx, SEA.floor + 0.05, rz], range(rng, 0.15, 0.45), i % 3 ? 0xb9a98a : 0x7e8f6a, { sy: 0.6, surface: S.matte });
  }
  const top = SEA.level - 0.02;
  const h = top - SEA.floor;
  const water = { surface: S.water, shade: /** @type {[number, number]} */ ([0.45, 1]) };
  kit.box([minX + 0.03, SEA.floor, (minZ + SEA.shoreZ) / 2], [0.06, h, d], STYLE.seaSide, water);
  kit.box([maxX - 0.03, SEA.floor, (minZ + SEA.shoreZ) / 2], [0.06, h, d], STYLE.seaSide, water);
  kit.box([0, SEA.floor, minZ + 0.03], [w, h, 0.06], STYLE.seaSide, water);
}

/**
 * Limestone seawall under the promenade with a coping stone, and a railing.
 * @param {import('./kit.js').Kit} kit
 */
function buildSeawall(kit) {
  const { minX, maxX } = PLINTH;
  const w = maxX - minX;
  kit.box([0, SEA.floor, SEA.shoreZ - 0.08], [w, TOP.promenade - SEA.floor, 0.18], C.stoneWarm, { surface: S.stone });
  kit.box([0, TOP.promenade, SEA.shoreZ - 0.02], [w, 0.1, 0.34], C.stoneTrim, { surface: S.stone });
  for (let x = minX + 0.6; x < maxX - 0.3; x += 1.25) {
    kit.cyl([x, TOP.promenade + 0.1, SEA.shoreZ + 0.05], 0.035, 0.5, C.tealDark, { seg: 6, surface: S.gloss });
  }
  kit.box([0, TOP.promenade + 0.56, SEA.shoreZ + 0.05], [w - 0.6, 0.05, 0.06], C.tealDark, { surface: S.gloss });
  kit.box([0, TOP.promenade + 0.33, SEA.shoreZ + 0.05], [w - 0.6, 0.025, 0.03], C.tealDark, { surface: S.gloss });
}

/**
 * Lightens or darkens an sRGB hex colour by a fraction.
 * @param {number} hex
 * @param {number} amount -1..1
 */
export function shadeHex(hex, amount) {
  const f = 1 + amount;
  const r = Math.min(255, Math.max(0, Math.round(((hex >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((hex >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((hex & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

/** Height of lot courtyards (buildings stand on this). */
export const LOT_Y = TOP.lot;
