// Civic buildings: Town Hall (golden dome, portico, glowing portal), Library (arched windows,
// giant open book), Skill Academy (clock tower, mortarboard) and Permit Office (stern facade,
// queue barriers). Local frame: origin at the lot centre on the courtyard, +z = front (south).
import * as THREE from 'three';
import { C, S } from '../palette.js';
import { createFlag } from '../flag.js';
import { back, cornice, cupola, door, east, flowerBed, front, onFace, parapet, roofClutter, west, windows } from './details.js';

/**
 * @param {import('../kit.js').Kit} kit
 * @param {import('./types.js').Lot} lot
 * @param {import('./types.js').BuildContext} ctx
 * @returns {import('./types.js').BuildingSpec}
 */
export function buildHall(kit, lot, ctx) {
  const rng = ctx.rng;
  kit.rbox([0, 0, 0], [7.6, 0.28, 7.0], C.stoneTrim, { surface: S.stone, radius: 0.04, segments: 1 });
  kit.box([0, 0, 3.62], [3.6, 0.19, 0.3], C.stoneTrim, { surface: S.stone });
  kit.box([0, 0, 3.86], [3.8, 0.1, 0.24], C.stoneTrim, { surface: S.stone });
  // Main block and side wings.
  kit.rbox([0, 0.28, -0.8], [4.8, 3.0, 4.8], C.stone, { surface: S.stone, radius: 0.05 });
  cornice(kit, [0, 3.2, -0.8], [4.8, 4.8]);
  for (const side of [-1, 1]) {
    kit.rbox([side * 3.1, 0.28, -0.8], [1.35, 2.2, 4.0], C.stoneWarm, { surface: S.stone, radius: 0.05 });
    parapet(kit, [side * 3.1, 2.48, -0.8], [1.35, 4.0]);
    windows(kit, front(1.2), { from: side * 3.1 - 0.4, to: side * 3.1 + 0.4, count: 1, y: 0.75, w: 0.5, h: 0.95, arched: true, rng });
    windows(kit, side > 0 ? east(3.775) : west(-3.775), { from: -2.4, to: 0.8, count: 2, y: 0.75, w: 0.5, h: 0.95, arched: true, rng });
  }
  windows(kit, back(-3.2), { from: -2.0, to: 2.0, count: 4, y: 0.8, w: 0.45, h: 1.0, arched: true, rng });
  windows(kit, back(-3.2), { from: -2.0, to: 2.0, count: 4, y: 2.25, w: 0.4, h: 0.55, rng });
  hallPortico(kit);
  hallPortal(kit);
  hallDome(kit);
  flowerBed(kit, [-2.7, 3.68], [1.5, 0.45], rng);
  flowerBed(kit, [2.7, 3.68], [1.5, 0.45], rng);
  ctx.tree('palm', -3.55, 3.3, 0.95);
  ctx.tree('palm', 3.55, 3.3, 0.95);
  // Flag pole on the west wing.
  kit.cyl([-3.25, 2.48, -2.4], 0.035, 2.5, C.steel, { seg: 8, surface: S.steel });
  kit.sphere([-3.25, 5.0, -2.4], 0.06, C.gold, { surface: S.gold });
  const flag = createFlag(ctx.town, 0.95);
  flag.position.set(-3.22, 4.62, -2.4);
  ctx.root.add(flag);
  return { height: 6.7, sign: [0, 7.15, -0.8], anchors: { portal: [0, 0.95, 2.35], dome: [0, 6.2, -0.8] } };
}

/** Columns, entablature and pediment in front of the main block. */
function hallPortico(kit) {
  for (const x of [-2.15, -1.4, 1.4, 2.15]) {
    kit.box([x, 0.28, 2.9], [0.42, 0.12, 0.42], C.stoneTrim, { surface: S.stone });
    kit.cyl([x, 0.4, 2.9], 0.16, 2.36, C.stonePale, { seg: 12, top: 0.14, surface: S.stone });
    kit.box([x, 2.76, 2.9], [0.44, 0.14, 0.44], C.stoneTrim, { surface: S.stone });
  }
  kit.box([0, 2.9, 2.25], [5.0, 0.42, 1.55], C.stonePale, { surface: S.stone });
  kit.box([0, 3.32, 2.25], [5.2, 0.08, 1.65], C.stoneTrim, { surface: S.stone });
  kit.prism([0, 3.4, 2.25], [1.55, 0.72, 5.0], C.stonePale, { rotY: Math.PI / 2, surface: S.stone });
  // A golden medallion in the pediment.
  kit.cyl([0, 3.68, 3.04], 0.2, 0.04, C.gold, { rotX: Math.PI / 2, seg: 16, surface: S.gold });
}

/** The glowing arch where new agents appear. */
function hallPortal(kit) {
  const glow = { surface: S.glow, glow: 0.75 };
  for (const side of [-1, 1]) kit.box([side * 0.98, 0.28, 1.7], [0.26, 1.38, 0.22], C.goldDeep, { surface: S.gold });
  kit.torus([0, 1.66, 1.72], 0.98, 0.13, C.gold, { arc: Math.PI, surface: S.gold, tubeSeg: 20 });
  kit.box([0, 0.28, 1.63], [1.7, 1.38, 0.04], C.portal, glow);
  kit.cyl([0, 1.63, 1.63], 0.85, 0.04, C.portal, { ...glow, rotZ: Math.PI / 2, rotY: Math.PI / 2, arc: Math.PI, seg: 16 });
}

/** Drum with windows, golden dome and lantern. */
function hallDome(kit) {
  const z = -0.8;
  kit.cyl([0, 3.4, z], 1.75, 0.75, C.stone, { seg: 28, surface: S.stone });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    kit.box([Math.cos(a) * 1.76, 3.55, z + Math.sin(a) * 1.76], [0.24, 0.42, 0.05], C.glass, {
      surface: S.glass,
      glow: 0.45,
      seed: (i * 0.37) % 1,
      rotY: Math.PI / 2 - a,
    });
  }
  kit.cyl([0, 4.15, z], 1.86, 0.12, C.stoneTrim, { seg: 28, surface: S.stone });
  // The dome is floodlit after dark (a faint golden glow that switches on with the lamps).
  kit.dome([0, 4.27, z], 1.72, C.gold, { surface: S.gold, sy: 1.1, seg: 32, glow: 0.1, seed: 0.02 });
  kit.cyl([0, 6.1, z], 0.28, 0.42, C.stonePale, { seg: 12, surface: S.stone });
  kit.dome([0, 6.52, z], 0.31, C.gold, { surface: S.gold, seg: 14, glow: 0.1, seed: 0.02 });
  kit.cyl([0, 6.8, z], 0.025, 0.35, C.gold, { seg: 6, surface: S.gold });
  kit.sphere([0, 7.17, z], 0.07, C.gold, { surface: S.gold });
}

/**
 * @param {import('../kit.js').Kit} kit
 * @param {import('./types.js').Lot} lot
 * @param {import('./types.js').BuildContext} ctx
 * @returns {import('./types.js').BuildingSpec}
 */
export function buildLibrary(kit, lot, ctx) {
  const rng = ctx.rng;
  const z0 = -0.6;
  kit.rbox([0, 0, z0], [5.3, 3.5, 5.6], C.stoneWarm, { surface: S.stone, radius: 0.05 });
  cornice(kit, [0, 3.5, z0], [5.3, 5.6]);
  parapet(kit, [0, 3.7, z0], [5.5, 5.8]);
  // String course between the floors.
  kit.box([0, 1.72, z0], [5.42, 0.1, 5.72], C.stoneTrim, { surface: S.stone });
  const zf = z0 + 2.8;
  door(kit, front(zf), [0, 0.9, 1.35], { color: C.woodDark, arched: true, rng });
  windows(kit, front(zf), { from: -2.5, to: -0.8, count: 2, y: 0.5, w: 0.42, h: 0.85, arched: true, rng, shutters: C.terracottaDark });
  windows(kit, front(zf), { from: 0.8, to: 2.5, count: 2, y: 0.5, w: 0.42, h: 0.85, arched: true, rng, shutters: C.terracottaDark });
  windows(kit, front(zf), { from: -2.5, to: 2.5, count: 5, y: 2.1, w: 0.4, h: 0.85, arched: true, rng });
  for (const f of [east(2.65), west(-2.65)]) {
    windows(kit, f, { from: z0 - 2.4, to: z0 + 2.4, count: 4, y: 0.5, w: 0.38, h: 0.85, arched: true, rng });
    windows(kit, f, { from: z0 - 2.4, to: z0 + 2.4, count: 4, y: 2.1, w: 0.38, h: 0.85, arched: true, rng });
  }
  openBook(kit, 0, 3.72, z0 - 0.4);
  cupola(kit, [-1.75, 3.72, z0 - 1.9], 0.55);
  roofClutter(kit, [1.0, z0 - 2.5, 2.4, z0 + 2.3], 3.72, rng, 2);
  bookStack(kit, -2.3, 2.95, rng);
  flowerBed(kit, [1.9, 3.2], [1.6, 0.5], rng);
  ctx.tree('round', 2.4, -3.5, 0.75);
  return { height: 5.4, sign: [0, 6.0, z0] };
}

/** Giant open book on the roof: two tilted pages with text lines over a red cover. */
function openBook(kit, x, y, z) {
  kit.push(x, y, z, 0);
  kit.box([0, 0.3, 0], [0.5, 0.7, 0.5], C.stoneTrim, { surface: S.stone });
  for (const side of [-1, 1]) {
    kit.box([side * 0.82, 1.08, 0], [1.75, 0.08, 1.35], C.red, { rotZ: side * 0.28, surface: S.gloss });
    kit.box([side * 0.8, 1.14, 0], [1.6, 0.06, 1.24], C.cream, { rotZ: side * 0.28, surface: S.matte });
    for (let i = 0; i < 6; i++) {
      const lz = -0.45 + i * 0.18;
      kit.box([side * 0.82, 1.18 + 0.02, lz], [1.1, 0.012, 0.05], 0x9c8f7a, { rotZ: side * 0.28 });
    }
  }
  kit.pop();
}

/** A monument of four giant books by the entrance. */
function bookStack(kit, x, z, rng) {
  const colors = [C.teal, C.terracotta, C.navy, C.gold];
  let y = 0;
  for (let i = 0; i < 4; i++) {
    const h = 0.28 + rng() * 0.08;
    const rot = (rng() - 0.5) * 0.5;
    kit.rbox([x, y, z], [1.0 - i * 0.06, h, 0.7], colors[i], { rotY: rot, surface: S.gloss, radius: 0.04, segments: 1 });
    kit.box([x + 0.02, y + 0.03, z], [0.96 - i * 0.06, h - 0.06, 0.66], C.cream, { rotY: rot });
    y += h;
  }
}

/**
 * @param {import('../kit.js').Kit} kit
 * @param {import('./types.js').Lot} lot
 * @param {import('./types.js').BuildContext} ctx
 * @returns {import('./types.js').BuildingSpec}
 */
export function buildAcademy(kit, lot, ctx) {
  const rng = ctx.rng;
  const z0 = -0.7;
  kit.rbox([-0.6, 0, z0], [4.6, 3.1, 5.4], C.stone, { surface: S.stone, radius: 0.05 });
  cornice(kit, [-0.6, 3.1, z0], [4.6, 5.4]);
  parapet(kit, [-0.6, 3.3, z0], [4.8, 5.6]);
  const zf = z0 + 2.7;
  door(kit, front(zf), [-0.9, 0.85, 1.3], { color: C.navy, arched: true, rng });
  windows(kit, front(zf), { from: -2.8, to: -1.6, count: 1, y: 0.5, w: 0.5, h: 0.8, rng, shutters: C.teal });
  windows(kit, front(zf), { from: -2.8, to: 1.0, count: 3, y: 1.9, w: 0.5, h: 0.8, rng, shutters: C.teal });
  windows(kit, west(-2.9), { from: z0 - 2.3, to: z0 + 2.3, count: 3, y: 0.5, w: 0.45, h: 0.8, rng });
  windows(kit, west(-2.9), { from: z0 - 2.3, to: z0 + 2.3, count: 3, y: 1.9, w: 0.45, h: 0.8, rng });
  mortarboard(kit, -0.9, 2.1, zf + 0.1);
  roofClutter(kit, [-2.6, -3.2, 0.6, 0.6], 3.3, rng, 3);
  clockTower(kit, 1.95, 1.0, rng);
  flowerBed(kit, [-2.3, 3.4], [1.0, 0.45], rng);
  ctx.tree('cypress', 2.75, -3.3, 0.9);
  ctx.tree('cypress', -2.75, -3.6, 0.8);
  return { height: 7.7, sign: [-0.6, 4.2, z0], anchors: { clock: [1.95, 5.4, 1.85] } };
}

/** Square clock tower with clock faces, a belfry and a terracotta spire. */
function clockTower(kit, x, z, rng) {
  kit.rbox([x, 0, z], [1.6, 5.2, 1.6], C.stoneWarm, { surface: S.stone, radius: 0.05 });
  for (const y of [1.7, 3.4]) kit.box([x, y, z], [1.7, 0.1, 1.7], C.stoneTrim, { surface: S.stone });
  windows(kit, front(z + 0.8), { from: x - 0.3, to: x + 0.3, count: 1, y: 0.45, w: 0.4, h: 0.9, arched: true, rng });
  windows(kit, east(x + 0.8), { from: z - 0.3, to: z + 0.3, count: 1, y: 2.2, w: 0.35, h: 0.8, arched: true, rng });
  // Clock faces on all four sides (hands are animated separately).
  for (const [dx, dz, rotY] of [[0, 0.81, 0], [0.81, 0, Math.PI / 2], [0, -0.81, Math.PI], [-0.81, 0, -Math.PI / 2]]) {
    kit.push(x + dx, 4.45, z + dz, rotY);
    kit.cyl([0, 0, 0.02], 0.56, 0.05, C.gold, { rotX: Math.PI / 2, seg: 24, surface: S.gold });
    kit.cyl([0, 0, 0.05], 0.48, 0.04, C.cream, { rotX: Math.PI / 2, seg: 24, surface: S.bulb, glow: 0.35, seed: 0.05 });
    kit.pop();
  }
  // Belfry with arches, then the spire.
  kit.box([x, 5.2, z], [1.75, 0.12, 1.75], C.stoneTrim, { surface: S.stone });
  for (const [dx, dz] of [[-0.62, -0.62], [0.62, -0.62], [-0.62, 0.62], [0.62, 0.62]]) {
    kit.box([x + dx, 5.32, z + dz], [0.3, 0.9, 0.3], C.stoneWarm, { surface: S.stone });
  }
  kit.cyl([x, 5.4, z], 0.22, 0.4, C.goldDeep, { seg: 10, top: 0.12, surface: S.gold });
  kit.box([x, 6.22, z], [1.75, 0.14, 1.75], C.stoneTrim, { surface: S.stone });
  kit.cyl([x, 6.36, z], 1.2, 1.3, C.roofTile, { seg: 4, top: 0.0001, rotY: Math.PI / 4, surface: S.matte });
  kit.sphere([x, 7.7, z], 0.08, C.gold, { surface: S.gold });
}

/** A giant graduation cap over the entrance. */
function mortarboard(kit, x, y, z) {
  kit.box([x, y, z], [0.5, 0.18, 0.4], 0x23262b, { surface: S.gloss });
  kit.box([x, y + 0.18, z], [0.95, 0.05, 0.95], 0x23262b, { rotY: Math.PI / 4, surface: S.gloss });
  kit.cyl([x + 0.3, y - 0.12, z + 0.3], 0.02, 0.3, C.gold, { seg: 6, surface: S.gold });
  kit.sphere([x + 0.3, y - 0.14, z + 0.3], 0.05, C.gold, { surface: S.gold });
}

/**
 * The 8 clock hands as one instanced mesh, set from the time of day.
 * @param {import('./types.js').Lot} lot
 * @param {THREE.Material} material
 */
export function createClockHands(lot, material) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0);
  const info = new Uint8Array(geometry.getAttribute('position').count * 4);
  for (let i = 0; i < info.length; i += 4) info[i + 1] = S.gloss;
  geometry.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
  const colors = new Float32Array(geometry.getAttribute('position').count * 3).fill(0.02);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.InstancedMesh(geometry, material, 8);
  mesh.name = 'clock-hands';
  const tower = new THREE.Vector3(lot.cx + 1.95, 4.45 + 0.08, lot.cz + 1.0);
  const faces = [[0, 0.9, 0], [0.9, 0, Math.PI / 2], [0, -0.9, Math.PI], [-0.9, 0, -Math.PI / 2]];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  return {
    mesh,
    /** @param {number} hour 0–24 */
    set(hour) {
      const minuteAngle = ((hour % 1) * Math.PI * 2);
      const hourAngle = (((hour % 12) / 12) * Math.PI * 2);
      faces.forEach(([dx, dz, rotY], i) => {
        for (const [k, angle, len] of [[0, hourAngle, 0.26], [1, minuteAngle, 0.38]]) {
          e.set(0, rotY, -angle, 'YXZ');
          q.setFromEuler(e);
          p.set(tower.x + dx, tower.y, tower.z + dz);
          s.set(0.05, len, 0.03);
          m.compose(p, q, s);
          mesh.setMatrixAt(i * 2 + k, m);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/**
 * @param {import('../kit.js').Kit} kit
 * @param {import('./types.js').Lot} lot
 * @param {import('./types.js').BuildContext} ctx
 * @returns {import('./types.js').BuildingSpec}
 */
export function buildPermits(kit, lot, ctx) {
  const rng = ctx.rng;
  const z0 = -2.4;
  kit.rbox([0, 0, z0], [5.4, 0.3, 6.2], C.stoneGrey, { surface: S.stone, radius: 0.03, segments: 1 });
  kit.rbox([0, 0.3, z0], [5.2, 3.9, 5.8], C.stoneGrey, { surface: S.stone, radius: 0.04 });
  cornice(kit, [0, 4.2, z0], [5.2, 5.8], 0xbdb5a6);
  parapet(kit, [0, 4.4, z0], [5.5, 6.1], 0xbdb5a6);
  const zf = z0 + 2.9;
  // Heavy pilasters frame a recessed entrance.
  for (const x of [-2.2, -0.75, 0.75, 2.2]) onFace(kit, front(zf), [x, 0.3, 0.28, 3.9, 0.14], 0xc7bfb1, { surface: S.stone });
  door(kit, front(zf), [0, 1.0, 1.55], { color: 0x3b4148, frame: 0xa9a092, rng, y: 0.3 });
  onFace(kit, front(zf), [0, 2.15, 0.9, 0.12, 0.16], 0xa9a092, { surface: S.stone });
  // The red "stamp" emblem.
  kit.cyl([0, 2.95, zf + 0.12], 0.42, 0.06, C.red, { rotX: Math.PI / 2, seg: 24, surface: S.gloss });
  kit.cyl([0, 2.95, zf + 0.15], 0.3, 0.05, 0xf3e9e0, { rotX: Math.PI / 2, seg: 24 });
  kit.box([0, 2.82, zf + 0.18], [0.32, 0.26, 0.03], C.red);
  windows(kit, front(zf), { from: -2.2, to: -0.75, count: 1, y: 0.75, w: 0.36, h: 1.15, rng, frame: 0xa9a092 });
  windows(kit, front(zf), { from: 0.75, to: 2.2, count: 1, y: 0.75, w: 0.36, h: 1.15, rng, frame: 0xa9a092 });
  windows(kit, front(zf), { from: -2.6, to: 2.6, count: 4, y: 2.5, w: 0.32, h: 0.95, rng, frame: 0xa9a092 });
  for (const f of [east(2.6), west(-2.6)]) {
    windows(kit, f, { from: z0 - 2.4, to: z0 + 2.4, count: 4, y: 0.8, w: 0.32, h: 1.1, rng, frame: 0xa9a092 });
    windows(kit, f, { from: z0 - 2.4, to: z0 + 2.4, count: 4, y: 2.5, w: 0.32, h: 0.95, rng, frame: 0xa9a092 });
  }
  cupola(kit, [0, 4.4, z0], 0.7);
  roofClutter(kit, [-2.3, z0 - 2.4, -1.0, z0 + 1.6], 4.4, rng, 2);
  queueBarriers(kit, 0.9, 4.9);
  for (const x of [-2.55, 2.55]) {
    kit.cyl([x, 0, 1.0], 0.04, 3.4, C.steel, { seg: 8, surface: S.steel });
    kit.box([x + 0.3, 2.75, 1.0], [0.56, 0.38, 0.02], x < 0 ? C.teal : C.navy, { surface: S.fabric });
  }
  kit.box([2.0, 0, 4.6], [0.45, 1.05, 0.35], 0xd9d4ca, { surface: S.gloss });
  kit.box([2.0, 0.7, 4.79], [0.32, 0.18, 0.02], C.red, { surface: S.glow, glow: 0.6 });
  return { height: 6.1, sign: [0, 6.5, z0], anchors: { queue: [0, 0.92, 3.4] } };
}

/** Zig-zag queue lanes of posts and ropes in front of the Permit Office. */
function queueBarriers(kit, z0, z1) {
  const xs = [-1.8, -0.6, 0.6, 1.8];
  const rows = [z0 + 0.4, (z0 + z1) / 2, z1 - 0.4];
  rows.forEach((z, r) => {
    xs.forEach((x) => {
      kit.cyl([x, 0, z], 0.06, 0.04, C.iron, { seg: 10, surface: S.steel });
      kit.cyl([x, 0.04, z], 0.025, 0.62, C.steel, { seg: 6, surface: S.steel });
      kit.sphere([x, 0.68, z], 0.045, C.gold, { surface: S.gold });
    });
    const skip = r % 2 === 0 ? 3 : 0;
    for (let i = 0; i < xs.length - 1; i++) {
      if (i === skip || (skip === 3 && i === 2 && r === 2)) continue;
      const mid = (xs[i] + xs[i + 1]) / 2;
      kit.box([mid, 0.55, z], [xs[i + 1] - xs[i] - 0.06, 0.035, 0.035], C.red, { surface: S.fabric });
    }
  });
}
