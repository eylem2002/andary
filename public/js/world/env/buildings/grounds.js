// Open-air "buildings": the Goal Board (a billboard angled towards the default camera so the task
// list reads face-on) and the Worktree Grove (a park whose saplings are added by grove.js).
import { C, S } from '../palette.js';
import { bench, flowerBed, hedge } from './details.js';

/** Board panel placement in the board lot's local frame. Faces south-east (towards the camera). */
export const BOARD_PANEL = Object.freeze({ x: 0, y: 2.45, z: 0.75, rotY: Math.PI / 4, w: 3.3, h: 2.3 });

/**
 * @param {import('../kit.js').Kit} kit
 * @param {import('./types.js').Lot} lot
 * @param {import('./types.js').BuildContext} ctx
 * @returns {import('./types.js').BuildingSpec}
 */
export function buildBoard(kit, lot, ctx) {
  const p = BOARD_PANEL;
  kit.push(p.x, 0, p.z, p.rotY);
  kit.box([0, 0, 0], [p.w + 0.6, 0.12, 0.7], C.stoneTrim, { surface: S.stone });
  for (const x of [-p.w / 2 + 0.15, p.w / 2 - 0.15]) kit.box([x, 0.12, -0.12], [0.16, p.y + p.h / 2 + 0.1, 0.16], C.woodDark, { surface: S.gloss });
  // Frame, back board and a little roof.
  kit.box([0, p.y - p.h / 2 - 0.14, -0.1], [p.w + 0.28, p.h + 0.28, 0.12], C.woodDark, { surface: S.gloss });
  kit.box([0, p.y - p.h / 2 - 0.04, -0.03], [p.w + 0.08, p.h + 0.08, 0.04], 0xc9a26c, { surface: S.matte });
  kit.prism([0, p.y + p.h / 2 + 0.14, -0.1], [p.w + 0.5, 0.35, 0.55], C.terracottaDark, { surface: S.matte });
  // Two small lamps on the top corners light the board at night without covering the title.
  for (const x of [-p.w / 2 + 0.12, p.w / 2 - 0.12]) {
    kit.box([x, p.y + p.h / 2 + 0.16, 0.12], [0.05, 0.05, 0.34], C.iron, { surface: S.steel });
    kit.cyl([x, p.y + p.h / 2 + 0.1, 0.3], 0.07, 0.08, C.bulb, { seg: 10, surface: S.bulb, glow: 0.9, seed: 0.05 });
  }
  // A crate of chalk and a stool for the agents who write on it.
  kit.box([0.9, 0.12, 0.45], [0.35, 0.3, 0.3], C.wood, { surface: S.matte });
  kit.pop();
  flowerBed(kit, [0, 2.55], [1.6, 0.5], ctx.rng);
  return {
    height: p.y + p.h / 2 + 0.6,
    sign: [0, p.y + p.h / 2 + 1.05, p.z - 0.4],
    anchors: { board: [p.x, p.y, p.z] },
  };
}

/**
 * @param {import('../kit.js').Kit} kit
 * @param {import('./types.js').Lot} lot
 * @param {import('./types.js').BuildContext} ctx
 * @returns {import('./types.js').BuildingSpec}
 */
export function buildGrove(kit, lot, ctx) {
  const rng = ctx.rng;
  const gateX = lot.doorX;
  const half = lot.w / 2;
  // Gravel paths: from the gate to a ring round the old main tree.
  kit.box([gateX * 0.5, 0, 4.4], [1.0, 0.03, 3.2], 0xe2d6bd, { surface: S.ground, rotY: -0.18 });
  kit.cyl([0, 0, -0.4], 2.75, 0.03, 0xe2d6bd, { seg: 40, surface: S.ground });
  kit.cyl([0, 0, -0.4], 2.0, 0.045, C.lawn, { seg: 40, surface: S.ground });
  kit.cyl([0, 0.045, -0.4], 1.0, 0.3, C.stoneTrim, { seg: 24, surface: S.stone });
  kit.cyl([0, 0.33, -0.4], 0.92, 0.04, C.soil, { seg: 24, surface: S.ground });
  kit.box([0, 0.06, 0.65], [0.5, 0.3, 0.06], C.goldDeep, { surface: S.gold, rotX: -0.4 });
  ctx.tree('round', 0, -0.4, 1.65);
  // Gate with an arch and hedges along the lot edges.
  for (const side of [-1, 1]) kit.box([gateX + side * 0.85, 0, half - 0.2], [0.3, 1.9, 0.3], C.stonePale, { surface: S.stone });
  kit.torus([gateX, 1.9, half - 0.2], 0.85, 0.09, C.woodDark, { arc: Math.PI, surface: S.gloss });
  hedge(kit, [(gateX - 1.0 - half) / 2, half - 0.25], [gateX - 1.0 + half, 0.4]);
  hedge(kit, [(gateX + 1.0 + half) / 2, half - 0.25], [half - gateX - 1.0, 0.4]);
  hedge(kit, [-half + 0.25, 0], [0.4, lot.d - 1.0]);
  hedge(kit, [half - 0.25, 0], [0.4, lot.d - 1.0]);
  for (const [x, z, r] of [[-2.2, -2.9, 0.6], [2.4, -2.6, -0.6], [-3.0, 1.0, 1.6]]) bench(kit, x, z, r);
  // A lily pond in the back corner.
  kit.cyl([-4.2, 0, -4.3], 1.1, 0.12, C.stoneTrim, { seg: 20, surface: S.stone });
  kit.cyl([-4.2, 0.12, -4.3], 0.95, 0.02, 0x2f8f9a, { seg: 20, surface: S.water });
  for (const [dx, dz] of [[0.3, 0.2], [-0.35, -0.1], [0.1, -0.45]]) kit.cyl([-4.2 + dx, 0.15, -4.3 + dz], 0.16, 0.01, C.leafOlive, { seg: 10 });
  flowerBed(kit, [3.6, 4.2], [1.6, 0.5], rng);
  return { height: 3.6, sign: [0, 4.0, -0.4], anchors: { center: [0, 0.9, -0.4], gate: [gateX, 0.9, half] } };
}
