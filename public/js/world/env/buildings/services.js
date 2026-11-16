// Service buildings: Post Office (pillar box, post horn, garage), Web Tower (red-and-white
// lattice, scanning dish, blinking beacon), Memory Spa (domed hammam, pool, loungers), Café
// (striped awning, terrace with parasols, giant cup) and the Bus Stop (glass shelter).
import * as THREE from 'three';
import { C, S } from '../palette.js';
import { createPoolMaterial } from '../water.js';
import { back, bench, cafeTable, cornice, cupola, door, east, flowerBed, front, hedge, onFace, parapet, roofClutter, west, windows } from './details.js';

/**
 * @param {import('../kit.js').Kit} kit
 * @param {import('./types.js').Lot} lot
 * @param {import('./types.js').BuildContext} ctx
 * @returns {import('./types.js').BuildingSpec}
 */
export function buildPost(kit, lot, ctx) {
  const rng = ctx.rng;
  const z0 = -0.6;
  kit.rbox([-0.8, 0, z0], [4.0, 3.1, 5.6], C.stone, { surface: S.stone, radius: 0.05 });
  cornice(kit, [-0.8, 3.1, z0], [4.0, 5.6]);
  parapet(kit, [-0.8, 3.3, z0], [4.2, 5.8]);
  const zf = z0 + 2.8;
  // Postal stripe and post horn over the door.
  onFace(kit, front(zf), [-0.8, 1.6, 4.0, 0.22, 0.04], C.red, { surface: S.gloss });
  onFace(kit, front(zf), [-0.8, 1.82, 4.0, 0.08, 0.04], C.tealDark, { surface: S.gloss });
  door(kit, front(zf), [-0.5, 0.85, 1.3], { color: C.red, rng });
  kit.torus([-0.5, 2.35, zf + 0.08], 0.26, 0.06, C.gold, { surface: S.gold, tubeSeg: 20 });
  kit.cone([-0.12, 2.25, zf + 0.08], 0.13, 0.32, C.gold, { rotZ: -Math.PI / 2, seg: 10, surface: S.gold });
  windows(kit, front(zf), { from: -2.8, to: -1.3, count: 1, y: 0.5, w: 0.6, h: 0.8, rng, shutters: C.tealDark });
  windows(kit, front(zf), { from: -2.8, to: 1.2, count: 3, y: 2.15, w: 0.45, h: 0.6, rng });
  windows(kit, west(-2.8), { from: z0 - 2.3, to: z0 + 2.3, count: 3, y: 0.55, w: 0.45, h: 0.8, rng });
  windows(kit, west(-2.8), { from: z0 - 2.3, to: z0 + 2.3, count: 3, y: 2.0, w: 0.45, h: 0.7, rng });
  // Garage annex with a roll-up door; the mail truck lives here.
  kit.rbox([2.05, 0, z0 + 0.4], [1.9, 2.3, 4.8], C.stoneWarm, { surface: S.stone, radius: 0.05 });
  parapet(kit, [2.05, 2.3, z0 + 0.4], [2.0, 4.9]);
  const gz = z0 + 2.8;
  onFace(kit, front(gz), [2.05, 0, 1.7, 1.62, 0.04], 0xd9d2c3, { surface: S.stone });
  onFace(kit, front(gz), [2.05, 0, 1.46, 1.5, 0.05], 0x26221f);
  // Roll-up door (a moving part): the mail truck's trips roll it up and down.
  const garageDoor = ctx.part((k) => {
    for (let i = 0; i < 7; i++) k.box([0, -0.21 * (i + 1), 0], [1.42, 0.19, 0.06], 0xe9e4d8, { surface: S.gloss });
  });
  garageDoor.name = 'garage-door';
  garageDoor.position.set(2.05, 1.52, gz + 0.06);
  ctx.root.add(garageDoor);
  pillarBox(kit, -2.35, 3.15);
  kit.box([1.1, 0, 3.35], [0.45, 0.35, 0.4], C.cardboard, { rotY: 0.3 });
  kit.box([1.15, 0.35, 3.35], [0.35, 0.25, 0.3], C.cardboard, { rotY: -0.2 });
  // Corner turret with a golden cupola.
  kit.cyl([-2.25, 3.3, z0 + 2.15], 0.5, 0.6, C.stone, { seg: 16, surface: S.stone });
  cupola(kit, [-2.25, 3.9, z0 + 2.15], 0.42);
  roofClutter(kit, [-1.6, z0 - 2.4, 1.0, z0 + 1.2], 3.3, rng, 3);
  ctx.tree('round', -2.4, -3.4, 0.8);
  return { height: 4.9, sign: [-0.8, 4.6, z0], anchors: { garage: [2.05, 0.9, 3.0], mailbox: [-2.35, 1.0, 3.15] } };
}

/** Classic red pillar box with a domed cap. */
function pillarBox(kit, x, z) {
  kit.cyl([x, 0, z], 0.26, 0.12, C.iron, { seg: 16, surface: S.steel });
  kit.cyl([x, 0.12, z], 0.22, 0.95, C.red, { seg: 16, surface: S.gloss });
  kit.cyl([x, 1.07, z], 0.25, 0.08, C.red, { seg: 16, surface: S.gloss });
  kit.dome([x, 1.15, z], 0.24, C.red, { seg: 16, sy: 0.6, surface: S.gloss });
  kit.box([x, 0.85, z + 0.2], [0.22, 0.04, 0.05], 0x1a1a1a);
  kit.box([x, 0.55, z + 0.21], [0.16, 0.1, 0.02], C.gold, { surface: S.gold });
}

/**
 * @param {import('../kit.js').Kit} kit
 * @param {import('./types.js').Lot} lot
 * @param {import('./types.js').BuildContext} ctx
 * @returns {import('./types.js').BuildingSpec}
 */
export function buildWeb(kit, lot, ctx) {
  const rng = ctx.rng;
  kit.rbox([0, 0, 1.75], [5.0, 2.3, 2.9], C.plaster, { surface: S.stone, radius: 0.05 });
  parapet(kit, [0, 2.3, 1.75], [5.1, 3.0]);
  const zf = 3.2;
  onFace(kit, front(zf), [0, 0.4, 4.2, 1.45, 0.04], C.glass, { surface: S.glass, glow: 0.4, seed: 0.35 });
  for (let i = 0; i < 6; i++) onFace(kit, front(zf), [-2.1 + i * 0.84, 0.35, 0.07, 1.55, 0.07], 0xd9dde2, { surface: S.steel });
  door(kit, front(zf), [0, 0.9, 1.35], { color: C.navy, rng });
  windows(kit, east(2.5), { from: 0.6, to: 2.9, count: 2, y: 0.8, w: 0.5, h: 0.7, rng });
  lattice(kit, 0, -1.6);
  const dish = ctx.part((k) => {
    k.box([0, -0.05, -0.65], [0.14, 0.14, 1.3], C.steelDark, { surface: S.steel });
    // The dish looks south and up at the sky; its feed tripod is built in the dish's own frame.
    const tilt = Math.PI / 2 - 0.7;
    /** @returns {[number, number, number]} */
    const turn = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => [x, y * Math.cos(tilt) - z * Math.sin(tilt), y * Math.sin(tilt) + z * Math.cos(tilt) + 0.1];
    k.dish([0, 0, 0.1], 0.95, 0xf4f4f0, { rotX: tilt, surface: S.gloss });
    const feed = turn(0, 0.72, 0);
    for (const a of [Math.PI / 2, Math.PI / 2 + 2.09, Math.PI / 2 + 4.19]) {
      k.beam(turn(Math.cos(a) * 0.8, 0.16, Math.sin(a) * 0.8), feed, 0.03, C.steel, { surface: S.steel });
    }
    k.sphere(feed, 0.08, C.steelDark, { surface: S.steel });
  });
  dish.name = 'web-dish';
  dish.position.set(0, 6.2, -0.35);
  ctx.root.add(dish);
  ctx.animate((dt, t) => {
    dish.rotation.y = Math.sin(t * 0.25) * 0.9;
  });
  flowerBed(kit, [-2.0, 3.7], [1.5, 0.45], rng);
  return { height: 12.2, sign: [0, 3.2, 1.75], anchors: { dish: [0, 6.3, 0.1], beacon: [0, 12.2, -1.6] } };
}

/**
 * Red-and-white lattice radio tower with platforms, a mast and a blinking beacon.
 * @param {import('../kit.js').Kit} kit
 */
function lattice(kit, cx, cz) {
  const top = 10.2;
  const base = 1.25;
  const tip = 0.3;
  const levels = 7;
  const corner = (/** @type {number} */ y, /** @type {number} */ sx, /** @type {number} */ sz) => {
    const r = base + (tip - base) * (y / top);
    return /** @type {[number, number, number]} */ ([cx + sx * r, y, cz + sz * r]);
  };
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let l = 0; l < levels; l++) {
    const y0 = (top / levels) * l;
    const y1 = (top / levels) * (l + 1);
    const color = l % 2 ? 0xf3f0ea : C.red;
    for (let c = 0; c < 4; c++) {
      const [ax, az] = corners[c];
      const [bx, bz] = corners[(c + 1) % 4];
      kit.beam(corner(y0, ax, az), corner(y1, ax, az), 0.13, color, { surface: S.gloss });
      kit.beam(corner(y0, ax, az), corner(y1, bx, bz), 0.05, color, { surface: S.gloss });
      kit.beam(corner(y0, bx, bz), corner(y1, ax, az), 0.05, color, { surface: S.gloss });
      kit.beam(corner(y1, ax, az), corner(y1, bx, bz), 0.06, color, { surface: S.gloss });
    }
  }
  for (const y of [4.4, 8.0]) {
    const r = base + (tip - base) * (y / top) + 0.35;
    kit.box([cx, y, cz], [r * 2, 0.08, r * 2], C.steelDark, { surface: S.steel });
  }
  kit.cyl([cx, top, cz], 0.08, 1.8, 0xf3f0ea, { seg: 8, top: 0.04, surface: S.gloss });
  kit.sphere([cx, top + 1.85, cz], 0.12, C.beacon, { surface: S.beacon, glow: 1, seed: 0 });
  kit.sphere([cx + 0.45, 7.1, cz + 0.45], 0.07, C.beacon, { surface: S.beacon, glow: 0.8, seed: 0.5 });
  for (const [x, z, s] of [[0.55, 0.3, 0.18], [-0.5, 0.4, 0.15]]) kit.cyl([cx + x, 9.0, cz + z], s, 0.5, 0xeef0f2, { seg: 10, surface: S.gloss });
}

/**
 * @param {import('../kit.js').Kit} kit
 * @param {import('./types.js').Lot} lot
 * @param {import('./types.js').BuildContext} ctx
 * @returns {import('./types.js').BuildingSpec}
 */
export function buildSpa(kit, lot, ctx) {
  const rng = ctx.rng;
  const z0 = -3.1;
  kit.rbox([0, 0, z0], [5.3, 2.4, 5.2], C.plaster, { surface: S.stone, radius: 0.06 });
  cornice(kit, [0, 2.4, z0], [5.3, 5.2], C.stoneTrim);
  // Three hammam domes studded with glowing star skylights.
  for (const [x, z, r] of [[-1.4, z0 - 0.4, 1.0], [1.4, z0 - 0.4, 1.0], [0, z0 + 0.6, 1.25]]) {
    kit.cyl([x, 2.6, z], r + 0.05, 0.25, C.stonePale, { seg: 20, surface: S.stone });
    kit.dome([x, 2.85, z], r, C.plaster, { seg: 22, surface: S.stone });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const lift = 0.45 + (i % 2) * 0.25;
      kit.sphere([x + Math.cos(a) * r * 0.62, 2.85 + r * lift, z + Math.sin(a) * r * 0.62], 0.07, 0xbff3ff, { surface: S.glass, glow: 0.8, seed: 0.1 });
    }
  }
  // Arcade of arches along the front.
  const zf = z0 + 2.6;
  for (let i = 0; i < 4; i++) {
    const x = -1.95 + i * 1.3;
    windows(kit, front(zf), { from: x - 0.4, to: x + 0.4, count: 1, y: 0.0, w: 0.75, h: 1.25, arched: true, rng, frame: C.tealLight, dark: 0 });
  }
  pool(kit, rng);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(4.45, 3.05).rotateX(-Math.PI / 2), createPoolMaterial(ctx.town, lot.cx, lot.cz + 2.2));
  water.name = 'spa-pool';
  water.position.set(0, 0.25, 2.2);
  water.receiveShadow = true;
  ctx.root.add(water);
  for (const x of [-2.6, 2.6]) {
    kit.cyl([x, 0, -0.1], 0.22, 0.45, C.stoneTrim, { seg: 10, surface: S.stone });
    kit.cyl([x, 0.45, -0.1], 0.14, 0.06, 0x7d8a8f, { seg: 10, surface: S.steel });
  }
  lowWall(kit, lot);
  ctx.tree('palm', -2.6, 4.5, 0.8);
  ctx.tree('palm', 2.6, -0.6, 0.75);
  return { height: 4.4, sign: [0, 4.7, z0], anchors: { pool: [0, 0.5, 2.2], steam: [-2.6, 0.6, -0.1] } };
}

/** Pool with teal tiles, a stone rim and white loungers. */
function pool(kit, rng) {
  kit.box([0, 0, 2.2], [4.6, 0.24, 3.2], C.tealLight, { surface: S.water });
  for (const [x, z, w, d] of [[0, 0.6, 4.7, 0.16], [0, 3.8, 4.7, 0.16], [-2.3, 2.2, 0.16, 3.2], [2.3, 2.2, 0.16, 3.2]]) {
    kit.box([x, 0.24, z], [w, 0.07, d], C.stonePale, { surface: S.stone });
  }
  for (const x of [-1.6, -0.55, 0.55, 1.6]) {
    kit.box([x, 0, 4.55], [0.5, 0.18, 0.95], 0xf7f5ef, { surface: S.gloss });
    kit.box([x, 0.18, 4.25], [0.5, 0.06, 0.4], 0xf7f5ef, { surface: S.gloss, rotX: -0.6 });
    if (rng() < 0.6) kit.box([x, 0.19, 4.65], [0.42, 0.02, 0.6], rng() < 0.5 ? C.teal : C.terracotta, { surface: S.fabric });
  }
}

/** Low garden wall around the spa terrace with a gap for the gate. */
function lowWall(kit, lot) {
  const zf = lot.d / 2 - 0.25;
  for (const side of [-1, 1]) {
    kit.box([side * 1.85, 0, zf], [2.1, 0.45, 0.22], C.stonePale, { surface: S.stone });
    kit.box([side * 2.9, 0, 2.6], [0.22, 0.45, 5.0], C.stonePale, { surface: S.stone });
  }
}

/**
 * @param {import('../kit.js').Kit} kit
 * @param {import('./types.js').Lot} lot
 * @param {import('./types.js').BuildContext} ctx
 * @returns {import('./types.js').BuildingSpec}
 */
export function buildCafe(kit, lot, ctx) {
  const rng = ctx.rng;
  const z0 = -2.6;
  kit.rbox([0, 0, z0], [5.2, 2.8, 5.6], C.stoneWarm, { surface: S.stone, radius: 0.05 });
  cornice(kit, [0, 2.8, z0], [5.2, 5.6]);
  parapet(kit, [0, 3.0, z0], [5.4, 5.8]);
  const zf = z0 + 2.8;
  // Shop front: big warm windows either side of a wooden door.
  for (const x of [-1.6, 1.6]) onFace(kit, front(zf), [x, 0.35, 1.7, 1.45, 0.05], C.glass, { surface: S.glass, glow: 0.55, seed: 0.05 });
  for (const x of [-2.45, -0.75, 0.75, 2.45]) onFace(kit, front(zf), [x, 0, 0.14, 2.0, 0.08], C.woodDark, { surface: S.gloss });
  door(kit, front(zf), [0, 0.9, 1.45], { color: C.woodDark, rng });
  awning(kit, zf);
  windows(kit, back(z0 - 2.8), { from: -2.2, to: 2.2, count: 3, y: 0.8, w: 0.5, h: 0.75, rng });
  windows(kit, west(-2.6), { from: z0 - 2.2, to: z0 + 2.2, count: 3, y: 0.8, w: 0.5, h: 0.75, rng, shutters: C.teal });
  coffeeCup(kit, 1.2, 3.0, z0 - 0.6);
  roofClutter(kit, [-2.4, z0 - 2.4, -0.2, z0 + 1.6], 3.0, rng, 2);
  const parasols = [C.terracotta, C.teal, C.terracotta, C.teal];
  [[-1.55, 1.5], [1.55, 1.5], [-1.55, 3.75], [1.55, 3.75]].forEach(([x, z], i) => cafeTable(kit, x, z, { parasol: parasols[i], rng }));
  for (const side of [-1, 1]) {
    flowerBed(kit, [side * 2.05, lot.d / 2 - 0.35], [1.6, 0.4], rng);
    hedge(kit, [side * 2.75, 2.5], [0.35, 4.2], 0.4);
  }
  return { height: 4.0, sign: [0, 4.3, z0], anchors: { terrace: [0, 0.9, 2.6], cup: [1.2, 4.1, z0 - 0.6] } };
}

/** Teal-and-cream striped awning with a scalloped edge over the shop front. */
function awning(kit, zf) {
  const stripes = 13;
  const w = 5.2 / stripes;
  for (let i = 0; i < stripes; i++) {
    const x = -2.6 + w * (i + 0.5);
    const color = i % 2 ? C.cream : C.teal;
    kit.box([x, 2.05, zf + 0.55], [w, 0.05, 1.15], color, { rotX: 0.38, surface: S.fabric });
    kit.cyl([x, 1.83, zf + 1.07], w / 2, 0.05, color, { rotZ: -Math.PI / 2, rotY: Math.PI / 2, arc: Math.PI, seg: 8, surface: S.fabric, center: true });
  }
}

/** Giant coffee cup on the roof. */
function coffeeCup(kit, x, y, z) {
  kit.cyl([x, y, z], 0.62, 0.06, C.stonePale, { seg: 24, surface: S.gloss });
  kit.cyl([x, y + 0.06, z], 0.42, 0.75, 0xfbf8f2, { seg: 24, top: 0.52, surface: S.gloss });
  kit.cyl([x, y + 0.78, z], 0.48, 0.03, 0x5a3a22, { seg: 24, surface: S.gloss });
  kit.torus([x + 0.55, y + 0.42, z], 0.2, 0.06, 0xfbf8f2, { surface: S.gloss, tubeSeg: 16 });
  kit.cyl([x, y + 0.35, z], 0.47, 0.12, C.teal, { seg: 24, top: 0.49, surface: S.gloss });
}

/**
 * @param {import('../kit.js').Kit} kit
 * @param {import('./types.js').Lot} lot
 * @param {import('./types.js').BuildContext} ctx
 * @returns {import('./types.js').BuildingSpec}
 */
export function buildStation(kit, lot, ctx) {
  const rng = ctx.rng;
  const zf = lot.d / 2;
  // Glass shelter at the kerb.
  const sz = zf - 0.75;
  kit.box([0, 0, sz], [3.4, 0.08, 1.2], C.stoneTrim, { surface: S.stone });
  for (const x of [-1.6, 1.6]) kit.box([x, 0.08, sz - 0.5], [0.08, 1.9, 0.08], C.steelDark, { surface: S.steel });
  for (const x of [-1.6, 1.6]) kit.box([x, 0.08, sz + 0.45], [0.08, 1.9, 0.08], C.steelDark, { surface: S.steel });
  kit.box([0, 0.25, sz - 0.5], [3.1, 1.6, 0.04], 0x9fd3db, { surface: S.glass, glow: 0.12, seed: 0.9 });
  kit.box([-1.6, 0.25, sz], [0.04, 1.6, 0.85], 0x9fd3db, { surface: S.glass });
  kit.rbox([0, 1.98, sz], [3.6, 0.12, 1.4], C.teal, { surface: S.gloss, radius: 0.04, segments: 1 });
  kit.box([0, 1.84, sz - 0.48], [3.2, 0.14, 0.06], C.cream, { surface: S.glow, glow: 0.3 });
  bench(kit, 0, sz - 0.15, 0);
  // Stop sign pole and timetable.
  kit.cyl([2.3, 0, zf - 0.4], 0.04, 2.3, C.steel, { seg: 8, surface: S.steel });
  kit.cyl([2.3, 2.3, zf - 0.38], 0.28, 0.04, 0x2a8a4a, { rotX: Math.PI / 2, seg: 20, surface: S.gloss });
  kit.cyl([2.3, 2.3, zf - 0.35], 0.2, 0.03, 0xf4f1e6, { rotX: Math.PI / 2, seg: 20, surface: S.bulb, glow: 0.3 });
  kit.box([2.3, 1.2, zf - 0.37], [0.4, 0.55, 0.04], 0xf4f1e6, { surface: S.gloss });
  // Little waiting garden behind the shelter.
  flowerBed(kit, [-1.6, -0.6], [2.0, 0.6], rng);
  flowerBed(kit, [1.6, -0.6], [2.0, 0.6], rng);
  kit.box([0, 0, -1.7], [1.2, 0.95, 0.9], C.terracotta, { surface: S.gloss });
  kit.box([0, 0.95, -1.7], [1.35, 0.1, 1.05], C.cream, { surface: S.gloss });
  onFace(kit, front(-1.25), [0, 0.55, 0.8, 0.3, 0.03], C.glass, { surface: S.glass, glow: 0.5, seed: 0.2 });
  ctx.tree('round', -2.3, -2.3, 0.8);
  ctx.tree('round', 2.3, -2.4, 0.75);
  return { height: 2.4, sign: [0, 3.0, sz], anchors: { bus: [0, 0.9, zf + 0.45], shelter: [0, 0.9, sz] } };
}
