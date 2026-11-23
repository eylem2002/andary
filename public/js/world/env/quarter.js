// The residential quarter south of the ring road (core/town-map.js, rows 24 to 31): front gardens
// and a mailbox for each of the six homes, and the park across Home Street with its fountain,
// benches, a food cart with balloons, flower beds and a picnic. Static, so it all goes into the
// town batch; the houses are env/buildings/homes.js and the park's wanderers env/park-life.js.
import { DECOR, HOMES, tileToWorld } from '../layout.js';
import { bench, flowerBed, hedge } from './buildings/details.js';
import { C, S } from './palette.js';
import { range } from './rand.js';

/** @typedef {import('./trees.js').TreePlacement} TreePlacement */

/** Where the park's fountain stands (the centre of its `f` tiles), for the pool and the pigeons. */
export const PARK_FOUNTAIN = Object.freeze(rectCentre(DECOR.parkFountain));
/** The park's paved square (x and z extents), where the dog walks and the pigeons peck. */
export const PARK_SQUARE = Object.freeze({ minX: -7.6, maxX: 7.6, minZ: 28.4, maxZ: 35.6 });
/** Lamps along Home Street's park side and at the square's corners. */
export const QUARTER_LAMPS = Object.freeze([
  ...[-21, -15, -9, 9, 15, 21].map((x) => ({ x, z: 28.35 })),
  { x: -7.4, z: 35.6 },
  { x: 7.4, z: 35.6 },
]);

/** @param {[number, number, number, number]} rect */
function rectCentre(rect) {
  const a = tileToWorld(rect[0], rect[1]);
  const b = tileToWorld(rect[2], rect[3]);
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

/**
 * @param {import('./kit.js').Kit} kit
 * @param {TreePlacement[]} trees
 * @param {() => number} rng
 */
export function buildQuarter(kit, trees, rng) {
  for (const home of HOMES) frontGarden(kit, trees, home, rng);
  fountain(kit);
  for (const [x, z, yaw] of /** @type {[number, number, number][]} */ ([[-3.3, 32, Math.PI / 2], [3.3, 32, -Math.PI / 2], [0, 35.1, Math.PI], [-5, 29.3, 0]])) bench(kit, x, z, yaw);
  foodCart(kit, 5.2, 29.6);
  lawns(kit, trees, rng);
}

/**
 * The strip of garden west of a home: a flower bed, a little tree, and the mailbox by the street.
 * @param {import('./kit.js').Kit} kit
 * @param {TreePlacement[]} trees
 * @param {import('../../core/town-map.js').HomePlot} home
 * @param {() => number} rng
 */
function frontGarden(kit, trees, home, rng) {
  const [c0, r0] = home.rect;
  const garden = tileToWorld(c0 - 1, r0);
  flowerBed(kit, [garden.x, garden.z + 1.9], [1.2, 0.5], rng);
  trees.push({ kind: 'round', x: garden.x + range(rng, -0.2, 0.2), z: garden.z + 0.2, y: 0.1, scale: range(rng, 0.45, 0.6) });
  mailbox(kit, garden.x + 0.7, garden.z + 2.6);
}

/**
 * A post with a round-topped mailbox and its little flag.
 * @param {import('./kit.js').Kit} kit
 * @param {number} x @param {number} z
 */
function mailbox(kit, x, z) {
  kit.cyl([x, 0.1, z], 0.035, 0.62, C.wood, { seg: 6 });
  kit.rbox([x, 0.7, z], [0.2, 0.22, 0.32], C.red, { surface: S.gloss, radius: 0.07, segments: 2 });
  kit.box([x + 0.11, 0.8, z - 0.05], [0.02, 0.18, 0.04], C.flowerYellow, { surface: S.gloss });
}

/**
 * The park's round fountain: a stone basin, a column and a bowl. The water is the pool mesh.
 * @param {import('./kit.js').Kit} kit
 */
function fountain(kit) {
  const { x, z } = PARK_FOUNTAIN;
  kit.cyl([x, 0, z], 1.55, 0.3, C.stoneTrim, { seg: 32, surface: S.stone });
  kit.cyl([x, 0.3, z], 0.16, 0.6, C.stonePale, { seg: 12, surface: S.stone });
  kit.cyl([x, 0.9, z], 0.55, 0.1, C.stonePale, { seg: 18, top: 0.62, surface: S.stone });
  kit.sphere([x, 1.06, z], 0.09, C.gold, { surface: S.gold });
}

/**
 * A food cart with a striped awning and a bunch of balloons tied to it.
 * @param {import('./kit.js').Kit} kit
 * @param {number} x @param {number} z
 */
function foodCart(kit, x, z) {
  kit.rbox([x, 0.25, z], [1.3, 0.62, 0.7], C.cream, { surface: S.gloss, radius: 0.08, segments: 2 });
  kit.box([x, 0.55, z + 0.36], [1.1, 0.12, 0.02], C.teal, { surface: S.gloss });
  for (const dx of [-0.45, 0.45]) kit.cyl([x + dx, 0.14, z + 0.38], 0.14, 0.06, C.iron, { rotX: Math.PI / 2, center: true, seg: 12, surface: S.steel });
  for (const [dx, dz] of [[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]]) kit.cyl([x + dx, 0.87, z + dz], 0.025, 0.75, C.iron, { seg: 6, surface: S.steel });
  for (let i = 0; i < 5; i++) kit.box([x - 0.6 + 0.3 * i, 1.62, z], [0.3, 0.06, 0.9], i % 2 ? C.cream : C.red, { surface: S.fabric });
  const balloons = [C.flowerPink, C.teal, C.flowerYellow, C.red];
  balloons.forEach((color, i) => {
    const bx = x + 0.75 + (i % 2) * 0.22;
    const bz = z - 0.25 + Math.floor(i / 2) * 0.24;
    const by = 2.2 + (i % 3) * 0.15;
    kit.beam([x + 0.62, 0.9, z], [bx, by - 0.16, bz], 0.008, 0x30302e);
    kit.ball([bx, by, bz], 0.15, color, { sy: 1.2, surface: S.gloss });
  });
}

/**
 * The park's two lawns: a few shade trees, flower beds, a hedge along the street and a picnic.
 * @param {import('./kit.js').Kit} kit
 * @param {TreePlacement[]} trees
 * @param {() => number} rng
 */
function lawns(kit, trees, rng) {
  for (const side of [-1, 1]) {
    hedge(kit, [side * 15, 28.6], [12, 0.35], 0.32);
    flowerBed(kit, [side * 10, 33.5], [1.6, 0.6], rng);
    for (const [x, z] of [[12, 31], [18.5, 30.5], [20, 34.5], [15.5, 34.8]]) {
      trees.push({ kind: 'round', x: side * x + range(rng, -0.3, 0.3), z, y: 0.1, scale: range(rng, 0.75, 0.95) });
    }
  }
  // A picnic on the west lawn: a checked blanket and a basket.
  for (let i = 0; i < 4; i++) {
    kit.box([-15 + (i % 2) * 0.6, 0.1, 32 + Math.floor(i / 2) * 0.6], [0.6, 0.02, 0.6], i === 0 || i === 3 ? C.red : C.cream, { surface: S.fabric });
  }
  kit.rbox([-14.4, 0.12, 32.5], [0.36, 0.24, 0.26], C.woodLight, { radius: 0.04, segments: 1 });
}
