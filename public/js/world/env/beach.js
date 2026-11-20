// The beach: a strip of sand sloping from the seawall into the sea west of the harbour, with
// striped umbrellas, loungers, towels, a lifeguard tower and palms, ended at the harbour side by a
// rock groyne. The sea's foam line follows its waterline (water.js reads WATERLINE_Z).
import { C, NEON, S, STYLE } from './palette.js';
import { range } from './rand.js';
import { PLINTH, SEA } from './terrain.js';

/** Where the sand runs: from the seawall (top) down under the water (toe), x from the island's west edge to the groyne. */
export const BEACH = Object.freeze({
  minX: PLINTH.minX + 0.08,
  maxX: 9.6,
  top: Object.freeze({ z: SEA.shoreZ - 0.1, y: -0.12 }),
  toe: Object.freeze({ z: SEA.shoreZ - 4, y: -0.72 }),
});

/** How much the sand drops per unit towards the sea. */
const SLOPE = (BEACH.top.y - BEACH.toe.y) / (BEACH.top.z - BEACH.toe.z);

/**
 * Height of the sand surface at a z on the beach.
 * @param {number} z
 */
export function sandHeight(z) {
  return BEACH.top.y + (z - BEACH.top.z) * SLOPE;
}

/** Where the sand meets the water: the sea draws its foam here. */
export const WATERLINE_Z = BEACH.top.z + (SEA.level - BEACH.top.y) / SLOPE;

const UMBRELLAS = Object.freeze([NEON.pink, C.teal, C.flowerYellow, 0xff7a59, NEON.violet, C.tealLight]);
const TOWELS = Object.freeze([NEON.pink, NEON.cyan, C.flowerYellow, 0xff7a59, 0xffffff, NEON.violet]);

/**
 * @param {import('./kit.js').Kit} kit
 * @param {import('./trees.js').TreePlacement[]} trees
 * @param {() => number} rng
 */
export function buildBeach(kit, trees, rng) {
  kit.building = 0;
  sand(kit);
  groyne(kit, rng);
  const spots = beachSpots(rng);
  const snowy = STYLE.beach === 'snowmen';
  for (const { x, z } of spots.umbrellas) {
    if (snowy) {
      snowman(kit, x, z, rng);
      continue;
    }
    umbrella(kit, x, z, UMBRELLAS[Math.floor(rng() * UMBRELLAS.length)]);
    lounger(kit, x + 0.75, z - 0.15, rng() < 0.5 ? 0xffffff : C.tealLight);
    if (rng() < 0.7) towel(kit, x - 0.85, z - 0.55, TOWELS[Math.floor(rng() * TOWELS.length)], range(rng, -0.4, 0.4));
  }
  if (!snowy) lifeguardTower(kit, LIFEGUARD_X, -23.1);
  const tree = snowy ? 'cypress' : 'palm';
  for (const { x, z } of spots.palms) trees.push({ kind: tree, x, z, y: sandHeight(z), scale: range(rng, 0.8, 0.95) });
}

/**
 * A snowman with a carrot nose and a red scarf, for the snowy look's shore.
 * @param {import('./kit.js').Kit} kit
 * @param {number} x @param {number} z @param {() => number} rng
 */
function snowman(kit, x, z, rng) {
  const y = sandHeight(z);
  const turn = range(rng, -0.6, 0.6);
  kit.sphere([x, y + 0.32, z], 0.36, 0xffffff, { surface: S.matte });
  kit.sphere([x, y + 0.82, z], 0.26, 0xffffff, { surface: S.matte });
  kit.sphere([x, y + 1.18, z], 0.18, 0xffffff, { surface: S.matte });
  kit.box([x, y + 0.98, z], [0.5, 0.08, 0.5], 0xc9302c, { surface: S.fabric, rotY: turn });
  kit.cone([x + Math.sin(turn) * 0.17, y + 1.19, z + Math.cos(turn) * 0.17], 0.035, 0.16, 0xff8a1f, { surface: S.matte, rotX: Math.PI / 2, rotY: turn, center: true });
  kit.cyl([x, y + 1.32, z], 0.13, 0.05, 0x2b2b33, { seg: 12, surface: S.matte });
  kit.cyl([x, y + 1.37, z], 0.09, 0.16, 0x2b2b33, { seg: 12, surface: S.matte });
}

/** Spacing of the umbrellas along the beach. */
const UMBRELLA_STEP = 3.1;

/**
 * Where the umbrellas and the beach palms stand: an umbrella every 3.1 units (none by the
 * lifeguard tower), and a palm halfway between every third pair, near the seawall, so no trunk
 * runs through a canopy.
 * @param {() => number} rng
 * @returns {{ umbrellas: { x: number, z: number }[], palms: { x: number, z: number }[] }}
 */
export function beachSpots(rng) {
  const umbrellas = [];
  const palms = [];
  for (let x = BEACH.minX + 2.2, i = 0; x < BEACH.maxX - 1.5; x += UMBRELLA_STEP, i += 1) {
    if (i % 3 === 1 && Math.abs(x + UMBRELLA_STEP / 2 - LIFEGUARD_X) > 2.4 && Math.abs(x + UMBRELLA_STEP / 2 - WHEEL_SPOT.x) > 3) palms.push({ x: x + UMBRELLA_STEP / 2, z: -22.35 });
    if (Math.abs(x - LIFEGUARD_X) < 2.2 || Math.abs(x - WHEEL_SPOT.x) < 3) continue;
    umbrellas.push({ x, z: range(rng, -23.25, -22.85) });
  }
  return { umbrellas, palms };
}

const LIFEGUARD_X = -8.2;
/** Where the Ferris wheel stands once the town earns it (landmarks.js); no umbrellas there. */
export const WHEEL_SPOT = Object.freeze({ x: -20.5, z: -24.2 });

/**
 * @typedef {object} Slope  a slab across the beach whose top runs from `high` down to `low`
 * @property {[number, number]} high  [z, y] of the landward end
 * @property {[number, number]} low   [z, y] of the seaward end
 * @property {number} thick
 * @property {number} color
 */

/**
 * @param {import('./kit.js').Kit} kit
 * @param {Slope} slab
 */
function slope(kit, { high: [za, ya], low: [zb, yb], thick, color }) {
  const length = Math.hypot(za - zb, ya - yb);
  const angle = Math.atan2(ya - yb, za - zb);
  // The top surface's normal leans towards the sea (-z); the slab hangs below it.
  const cz = (za + zb) / 2 + Math.sin(angle) * (thick / 2);
  const cy = (ya + yb) / 2 - Math.cos(angle) * (thick / 2);
  kit.box([(BEACH.minX + BEACH.maxX) / 2, cy - thick / 2, cz], [BEACH.maxX - BEACH.minX, thick, length], color, { surface: S.ground, rotX: -angle });
}

/** @param {import('./kit.js').Kit} kit */
function sand(kit) {
  slope(kit, { high: [BEACH.top.z, BEACH.top.y], low: [BEACH.toe.z, BEACH.toe.y], thick: 1.2, color: C.sand });
  // Darker wet sand along the water's edge.
  const from = WATERLINE_Z + 0.75;
  const to = WATERLINE_Z - 0.2;
  slope(kit, { high: [from, sandHeight(from) + 0.006], low: [to, sandHeight(to) + 0.006], thick: 0.02, color: 0xd9bc86 });
}

/**
 * A breakwater of rounded rocks between the beach and the harbour.
 * @param {import('./kit.js').Kit} kit @param {() => number} rng
 */
function groyne(kit, rng) {
  const x = BEACH.maxX + 0.35;
  for (let z = BEACH.top.z + 0.2; z > BEACH.toe.z - 0.6; z -= 0.45) {
    for (const dx of [-0.32, 0.3]) {
      const r = range(rng, 0.32, 0.48);
      kit.ball([x + dx + range(rng, -0.08, 0.08), Math.max(sandHeight(z), SEA.level - 0.25) - 0.1, z], r, rng() < 0.5 ? 0xb8a99a : 0x9c8f84, { sy: 0.75, surface: S.matte });
    }
  }
}

/**
 * Beach umbrella: pole, a two-tone striped canopy and a finial.
 * @param {import('./kit.js').Kit} kit @param {number} x @param {number} z @param {number} color
 */
function umbrella(kit, x, z, color) {
  const y = sandHeight(z);
  kit.cyl([x, y - 0.1, z], 0.03, 1.55, 0xf4f1ea, { seg: 6, surface: S.gloss });
  kit.cone([x, y + 1.25, z], 0.85, 0.3, color, { seg: 8, surface: S.fabric });
  kit.cone([x, y + 1.23, z], 0.84, 0.28, 0xfffaf2, { seg: 8, surface: S.fabric, rotY: Math.PI / 8 });
  kit.sphere([x, y + 1.56, z], 0.05, color, { surface: S.gloss });
}

/**
 * Sun lounger with a raised back, facing the sea.
 * @param {import('./kit.js').Kit} kit @param {number} x @param {number} z @param {number} color
 */
function lounger(kit, x, z, color) {
  const y = sandHeight(z);
  for (const dz of [-0.45, 0.45]) kit.box([x, y - 0.05, z + dz], [0.46, 0.2, 0.05], C.steel, { surface: S.steel });
  kit.box([x, y + 0.15, z - 0.12], [0.5, 0.06, 0.95], color, { surface: S.fabric });
  kit.box([x, y + 0.24, z + 0.42], [0.5, 0.05, 0.42], color, { surface: S.fabric, rotX: -0.75 });
}

/**
 * A towel spread on the sand.
 * @param {import('./kit.js').Kit} kit @param {number} x @param {number} z @param {number} color @param {number} turn
 */
function towel(kit, x, z, color, turn) {
  const y = sandHeight(z);
  kit.box([x, y + 0.004, z], [0.55, 0.012, 1.0], color, { surface: S.fabric, rotY: turn, rotX: -Math.atan(SLOPE) });
  kit.box([x, y + 0.012, z], [0.55, 0.012, 0.12], 0xffffff, { surface: S.fabric, rotY: turn, rotX: -Math.atan(SLOPE) });
}

/**
 * Lifeguard tower on stilts: a pastel hut with a striped roof, a ramp and a flag.
 * @param {import('./kit.js').Kit} kit @param {number} x @param {number} z
 */
function lifeguardTower(kit, x, z) {
  const y = sandHeight(z);
  for (const [dx, dz] of [[-0.5, -0.45], [0.5, -0.45], [-0.5, 0.45], [0.5, 0.45]]) kit.box([x + dx, y - 0.2, z + dz], [0.09, 1.25, 0.09], 0xf4f1ea, { surface: S.gloss });
  kit.box([x, y + 1.0, z], [1.5, 0.08, 1.35], 0xf4f1ea, { surface: S.gloss });
  kit.rbox([x, y + 1.08, z + 0.05], [1.1, 0.75, 0.95], 0xffb3c7, { surface: S.gloss, radius: 0.08 });
  kit.box([x, y + 1.4, z - 0.43], [0.8, 0.28, 0.04], C.glass, { surface: S.glass, glow: 0.4, seed: 0.3 });
  kit.box([x, y + 1.25, z - 0.5], [1.0, 0.07, 0.03], NEON.cyan, { surface: S.bulb, glow: 1, seed: 0.06 });
  kit.box([x, y + 1.83, z + 0.05], [1.3, 0.08, 1.15], C.teal, { surface: S.gloss });
  kit.box([x + 1.05, y + 0.2, z + 0.2], [0.42, 0.04, 1.6], 0xf4f1ea, { surface: S.gloss, rotX: 0.62 });
  kit.cyl([x - 0.62, y + 1.83, z + 0.5], 0.025, 0.9, C.steel, { seg: 6, surface: S.steel });
  kit.box([x - 0.47, y + 2.42, z + 0.5], [0.3, 0.2, 0.02], C.red, { surface: S.fabric });
}
