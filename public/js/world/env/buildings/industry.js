// Working buildings: Workshop (sawtooth roof, forge glow, giant hammer), Terminal Works (brick
// factory, striped smokestacks, live terminal screen), MCP Harbor (warehouse, containers, slewing
// crane, pier with a beacon) and Search Bureau (observatory dome, telescope, giant magnifier).
import * as THREE from 'three';
import { C, S } from '../palette.js';
import { shadeHex } from '../terrain.js';
import { createTerminalScreen } from '../screen.js';
import { back, cornice, door, east, flowerBed, front, onFace, parapet, roofClutter, west, windows } from './details.js';

/** The harbour pier (world units): centre x, width, shore end z0 and sea end z1. */
export const PIER = Object.freeze({ x: 15, w: 1.8, z0: -22, z1: -31.5 });
const BRICK = 0xb9694a;
const BRICK_DARK = 0x9c5439;

/**
 * @param {import('../kit.js').Kit} kit
 * @param {import('./types.js').Lot} lot
 * @param {import('./types.js').BuildContext} ctx
 * @returns {import('./types.js').BuildingSpec}
 */
export function buildWorkshop(kit, lot, ctx) {
  const rng = ctx.rng;
  const z0 = -0.9;
  kit.rbox([0, 0, z0], [5.2, 2.5, 6.8], C.stoneWarm, { surface: S.stone, radius: 0.05 });
  kit.box([0, 0, z0], [5.3, 0.45, 6.9], BRICK, { surface: S.stone });
  // Sawtooth roof: three teeth with north-facing glazing.
  for (let i = 0; i < 3; i++) {
    const tz = z0 - 3.4 + 1.133 * (i + 0.5);
    kit.wedge([0, 2.5, tz], [5.3, 1.05, 1.13], 0x8a8f96, { surface: S.steel });
    kit.box([0, 2.55, tz - 0.55], [5.0, 0.9, 0.05], C.glass, { surface: S.glass, glow: 0.45, seed: 0.3 + i * 0.1 });
  }
  const zf = z0 + 3.4;
  // Big open door with the forge glowing inside.
  onFace(kit, front(zf), [-0.3, 0, 2.1, 1.9, 0.02], 0x1d1714);
  kit.box([-0.3, 0.05, zf - 0.6], [1.4, 0.7, 0.5], C.forge, { surface: S.glow, glow: 0.9 });
  kit.box([-0.3, 1.45, zf + 0.04], [2.25, 0.5, 0.1], 0xcf9f3f, { surface: S.gloss });
  for (let i = 0; i < 5; i++) onFace(kit, front(zf), [-1.2 + i * 0.45, 1.5, 0.4, 0.04, 0.12], 0x9b7a33);
  windows(kit, front(zf), { from: 1.0, to: 2.4, count: 1, y: 0.7, w: 0.7, h: 0.9, rng, frame: BRICK_DARK });
  for (const f of [east(2.6), west(-2.6)]) windows(kit, f, { from: z0 - 2.8, to: z0 + 2.8, count: 3, y: 0.8, w: 0.6, h: 0.9, rng, frame: BRICK_DARK });
  giantHammer(kit, -0.3, 2.15, zf + 0.25);
  kit.box([1.9, 2.5, z0 - 2.4], [0.5, 1.6, 0.5], BRICK_DARK, { surface: S.stone });
  kit.box([1.9, 4.1, z0 - 2.4], [0.6, 0.12, 0.6], 0x6b6f75, { surface: S.steel });
  workYard(kit, rng);
  ctx.tree('round', 2.4, 4.2, 0.7);
  return { height: 4.4, sign: [0, 4.6, z0], anchors: { forge: [-0.3, 0.9, 3.2], chimney: [1.9, 4.4, z0 - 2.4] } };
}

/** A giant hammer sign over the workshop door. */
function giantHammer(kit, x, y, z) {
  kit.box([x, y + 0.15, z], [1.5, 0.14, 0.12], C.woodLight, { rotZ: 0.35, surface: S.gloss });
  kit.rbox([x + 0.72, y + 0.25, z], [0.32, 0.5, 0.26], C.steelDark, { rotZ: 0.35, surface: S.steel, radius: 0.05, segments: 1 });
}

/** Lumber stack, workbench, anvil on a stump and barrels in front of the workshop. */
function workYard(kit, rng) {
  for (let i = 0; i < 4; i++) {
    kit.box([-2.1, i * 0.09, 3.9], [1.6, 0.08, 0.14 + (i % 2) * 0.02], i % 2 ? C.woodLight : C.wood, { rotY: 0.08 * i, surface: S.matte });
    kit.box([-2.1, i * 0.09, 4.15], [1.5, 0.08, 0.14], C.woodLight, { rotY: -0.05 * i });
  }
  kit.box([1.6, 0.55, 3.9], [1.1, 0.08, 0.5], C.wood, { surface: S.matte });
  for (const [dx, dz] of [[-0.45, -0.18], [0.45, -0.18], [-0.45, 0.18], [0.45, 0.18]]) kit.box([1.6 + dx, 0, 3.9 + dz], [0.06, 0.55, 0.06], C.woodDark);
  kit.box([1.4, 0.63, 3.85], [0.3, 0.06, 0.1], C.steel, { surface: S.steel, rotY: 0.4 });
  kit.cyl([0.5, 0, 4.35], 0.2, 0.35, C.woodDark, { seg: 10 });
  kit.box([0.5, 0.35, 4.35], [0.4, 0.16, 0.18], C.iron, { surface: S.steel });
  for (const [x, z] of [[2.5, 2.9], [2.15, 3.1]]) kit.cyl([x, 0, z], 0.2, 0.5, rng() < 0.5 ? C.teal : C.terracotta, { seg: 12, surface: S.gloss });
}

/**
 * @param {import('../kit.js').Kit} kit
 * @param {import('./types.js').Lot} lot
 * @param {import('./types.js').BuildContext} ctx
 * @returns {import('./types.js').BuildingSpec}
 */
export function buildTerminal(kit, lot, ctx) {
  const rng = ctx.rng;
  const hx = -1.1;
  const hz = -1.2;
  kit.rbox([hx, 0, hz], [6.8, 3.6, 8.4], BRICK, { surface: S.stone, radius: 0.05 });
  kit.box([hx, 0, hz], [6.9, 0.5, 8.5], BRICK_DARK, { surface: S.stone });
  cornice(kit, [hx, 3.6, hz], [6.8, 8.4], C.stoneTrim);
  // Barrel-vault roof lights along the hall.
  for (let i = 0; i < 3; i++) {
    kit.cyl([hx - 2.2 + i * 2.2, 3.82, hz], 0.75, 7.6, 0x8d969f, { rotZ: Math.PI / 2, rotY: Math.PI / 2, arc: Math.PI, seg: 14, surface: S.steel, sx: 0.6, center: true });
  }
  const zf = hz + 4.2;
  door(kit, front(zf), [hx + 2.2, 1.3, 1.6], { color: 0x6d747c, rng, frame: C.stoneTrim });
  windows(kit, west(hx - 3.4), { from: hz - 3.6, to: hz + 3.6, count: 5, y: 0.9, w: 0.7, h: 1.6, rng, frame: C.stoneTrim, dark: 0.1 });
  windows(kit, back(hz - 4.2), { from: hx - 3, to: hx + 3, count: 4, y: 0.9, w: 0.7, h: 1.6, rng, frame: C.stoneTrim });
  windows(kit, east(hx + 3.4), { from: hz - 3.6, to: hz + 1.0, count: 3, y: 0.9, w: 0.7, h: 1.6, rng, frame: C.stoneTrim });
  screenFrame(kit, hx - 0.7, zf);
  smokestacks(kit);
  terminalYard(kit, rng);
  const screen = createTerminalScreen();
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 1.65), new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false }));
  panel.name = 'terminal-screen';
  panel.position.set(hx - 0.7, 2.0, zf + 0.09);
  ctx.root.add(panel);
  ctx.animate((dt) => screen.update(dt));
  return { height: 8.6, sign: [hx, 5.0, hz], anchors: { chimney: [3.4, 8.7, -3.6], screen: [hx - 0.7, 2.0, zf + 0.3] } };
}

/** Steel frame around the big screen. */
function screenFrame(kit, x, zf) {
  onFace(kit, front(zf), [x, 1.08, 3.55, 1.85, 0.08], 0x2a2f36, { surface: S.steel });
  onFace(kit, front(zf), [x, 0.95, 0.12, 0.13, 0.15], 0x2a2f36, { surface: S.steel });
}

/** Two tall striped smokestacks behind the hall. */
function smokestacks(kit) {
  for (const [x, z, h] of [[3.4, -3.6, 8.6], [3.4, -1.4, 7.4]]) {
    kit.cyl([x, 0, z], 0.62, 0.6, BRICK_DARK, { seg: 16, surface: S.stone });
    const bands = 6;
    for (let i = 0; i < bands; i++) {
      const y0 = 0.6 + ((h - 0.6) / bands) * i;
      const r = 0.48 - i * 0.03;
      kit.cyl([x, y0, z], r, (h - 0.6) / bands, i % 2 ? 0xf3efe6 : C.red, { seg: 16, top: r - 0.03, surface: S.gloss });
    }
    kit.cyl([x, h, z], 0.34, 0.14, C.iron, { seg: 16, surface: S.steel });
    kit.cyl([x, h - 0.4, z], 0.03, 0.06, C.beacon, { seg: 6, surface: S.beacon, glow: 1, seed: x * 0.1 + z * 0.05 });
  }
}

/** Pipes, a silver tank and crates beside the factory. */
function terminalYard(kit, rng) {
  kit.cyl([3.4, 0, 2.2], 0.85, 2.2, 0xc9cdd2, { seg: 20, surface: S.steel });
  kit.dome([3.4, 2.2, 2.2], 0.85, 0xc9cdd2, { sy: 0.35, surface: S.steel });
  kit.box([2.3, 1.7, 1.5], [1.3, 0.14, 0.14], 0x6b737b, { surface: S.steel });
  kit.box([2.3, 0, 4.4], [0.7, 0.6, 0.7], C.cardboard, { rotY: 0.2, surface: S.matte });
  kit.box([3.1, 0, 4.6], [0.6, 0.5, 0.6], C.woodLight, { rotY: -0.3, surface: S.matte });
  kit.box([2.6, 0.6, 4.45], [0.5, 0.4, 0.5], C.cardboard, { rotY: 0.5, surface: S.matte });
  flowerBed(kit, [-3.4, 4.6], [2.2, 0.5], rng);
}

/**
 * @param {import('../kit.js').Kit} kit
 * @param {import('./types.js').Lot} lot
 * @param {import('./types.js').BuildContext} ctx
 * @returns {import('./types.js').BuildingSpec}
 */
export function buildHarbor(kit, lot, ctx) {
  const rng = ctx.rng;
  warehouse(kit, -1.7, 1.5, rng);
  containers(kit, rng);
  buildPier(kit, lot);
  const crane = ctx.part((k) => craneTop(k));
  crane.name = 'harbor-crane';
  crane.position.set(3.6, 6.0, -3.8);
  ctx.root.add(crane);
  kit.box([3.6, 0, -3.8], [1.3, 0.3, 1.3], C.steelDark, { surface: S.steel });
  for (const [dx, dz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) {
    kit.box([3.6 + dx, 0.3, -3.8 + dz], [0.12, 5.7, 0.12], C.flowerYellow, { surface: S.gloss });
  }
  for (let y = 1.0; y < 6; y += 1.1) kit.box([3.6, 0.3 + y, -3.8], [1.0, 0.08, 1.0], C.flowerYellow, { surface: S.gloss });
  ctx.animate((dt, t) => {
    crane.rotation.y = Math.sin(t * 0.12) * 1.1 - 0.4;
  });
  const pierEnd = PIER.z1 - lot.cz;
  return {
    height: 6.6,
    sign: [-1.7, 5.0, 1.5],
    anchors: { pier: [PIER.x - lot.cx, 0.9, pierEnd + 0.8], crane: [3.6, 6.2, -3.8] },
  };
}

/** Teal corrugated warehouse with a barrel roof and a big sliding door. */
function warehouse(kit, x, z, rng) {
  const w = 6.6;
  const d = 5.0;
  kit.box([x, 0, z], [w, 2.6, d], C.teal, { surface: S.gloss });
  for (let i = 0; i <= 22; i++) onFace(kit, front(z + d / 2), [x - w / 2 + 0.15 + i * 0.3, 0, 0.06, 2.6, 0.04], C.tealDark, { surface: S.gloss });
  kit.cyl([x, 2.6, z], d / 2 + 0.1, w + 0.2, 0xcfd3d6, { rotZ: Math.PI / 2, arc: Math.PI, seg: 18, surface: S.steel, sx: 0.45, center: true });
  onFace(kit, front(z + d / 2), [x + 0.6, 0, 2.4, 2.1, 0.06], 0xe8e2d0, { surface: S.gloss });
  onFace(kit, front(z + d / 2), [x + 0.6, 0, 2.2, 1.95, 0.08], 0x3a3f44, { surface: S.matte });
  onFace(kit, front(z + d / 2), [x - 2.3, 1.95, 1.5, 0.45, 0.06], 0xf5f0e4, { surface: S.gloss });
  onFace(kit, front(z + d / 2), [x - 2.3, 2.02, 1.2, 0.3, 0.08], C.navy, { surface: S.glow, glow: 0.35 });
  windows(kit, west(x - w / 2), { from: z - 1.8, to: z + 1.8, count: 2, y: 1.2, w: 0.6, h: 0.6, rng, frame: C.tealDark });
  kit.box([x - 2.4, 0, z + 3.0], [0.5, 0.5, 0.5], C.woodLight, { surface: S.matte });
  kit.cyl([x - 1.6, 0, z + 3.1], 0.24, 0.6, C.red, { seg: 12, surface: S.gloss });
}

/** Stacked shipping containers in MCP colours. */
function containers(kit, rng) {
  const colors = [C.red, C.teal, C.navy, C.flowerYellow, C.terracotta, 0x5a8f3e];
  const spots = [[3.2, -0.2, 0], [3.2, 1.3, 0], [3.2, -0.2, 1], [5.0, 3.5, 0], [3.2, 1.3, 1], [5.0, 3.5, 1], [1.5, -3.6, 0]];
  spots.forEach(([x, z, level], i) => {
    const color = colors[(i + Math.floor(rng() * 3)) % colors.length];
    kit.box([x, level * 1.25, z], [2.4, 1.2, 1.2], color, { surface: S.gloss });
    for (let r = -1; r <= 1; r++) kit.box([x + r * 0.7, level * 1.25 + 0.1, z], [0.08, 1.0, 1.24], shadeHex(color, -0.15), { surface: S.gloss });
  });
}

/**
 * Wooden pier on piles from the promenade into the sea, with bollards and a beacon at the end.
 * @param {import('../kit.js').Kit} kit
 * @param {import('./types.js').Lot} lot
 */
function buildPier(kit, lot) {
  const x = PIER.x - lot.cx;
  const z0 = PIER.z0 - lot.cz;
  const z1 = PIER.z1 - lot.cz;
  const len = z0 - z1;
  const y = -0.08 - 0.08;
  kit.box([x, y, (z0 + z1) / 2], [PIER.w, 0.12, len], C.wood, { surface: S.matte });
  for (let i = 0; i < Math.floor(len / 0.32); i++) kit.box([x, y + 0.12, z0 - 0.16 - i * 0.32], [PIER.w - 0.04, 0.02, 0.26], i % 2 ? C.woodLight : 0xb48a5c);
  for (let zz = z0 - 0.8; zz > z1; zz -= 1.6) {
    for (const side of [-1, 1]) {
      kit.cyl([x + side * (PIER.w / 2 - 0.08), -2.0, zz], 0.09, 1.95, C.woodDark, { seg: 8 });
      kit.cyl([x + side * (PIER.w / 2 - 0.1), y + 0.14, zz], 0.08, 0.2, C.iron, { seg: 8, surface: S.steel });
    }
  }
  kit.cyl([x, y + 0.12, z1 + 0.5], 0.32, 1.2, 0xf4f0e8, { seg: 12, top: 0.24, surface: S.gloss });
  kit.cyl([x, y + 1.32, z1 + 0.5], 0.2, 0.32, C.beacon, { seg: 10, surface: S.beacon, glow: 0.9, seed: 0.5 });
  kit.cone([x, y + 1.64, z1 + 0.5], 0.3, 0.3, C.red, { seg: 10, surface: S.gloss });
}

/** The slewing part of the crane: cab, jib, counterweight and hook (pivot at the mast top). */
function craneTop(k) {
  k.box([0, 0, 0], [1.0, 0.7, 1.0], C.flowerYellow, { surface: S.gloss });
  k.box([0.2, 0.15, 0.51], [0.5, 0.35, 0.04], C.glass, { surface: S.glass, glow: 0.4, seed: 0.2 });
  k.box([0, 0.7, -3.0], [0.32, 0.32, 7.0], C.flowerYellow, { surface: S.gloss });
  k.box([0, 0.62, 1.4], [0.9, 0.5, 0.8], C.steelDark, { surface: S.steel });
  k.box([0, 1.02, -0.1], [0.1, 1.0, 0.1], C.flowerYellow, { surface: S.gloss });
  k.box([0, -2.4, -5.8], [0.03, 3.1, 0.03], C.iron);
  k.box([0, -2.62, -5.8], [0.3, 0.22, 0.2], C.red, { surface: S.gloss });
}

/**
 * @param {import('../kit.js').Kit} kit
 * @param {import('./types.js').Lot} lot
 * @param {import('./types.js').BuildContext} ctx
 * @returns {import('./types.js').BuildingSpec}
 */
export function buildDetective(kit, lot, ctx) {
  const rng = ctx.rng;
  const z0 = -0.2;
  kit.rbox([0, 0, z0], [5.2, 3.1, 5.6], C.plaster, { surface: S.stone, radius: 0.05 });
  cornice(kit, [0, 3.1, z0], [5.2, 5.6]);
  parapet(kit, [0, 3.3, z0], [5.4, 5.8]);
  const zf = z0 + 2.8;
  door(kit, front(zf), [-0.6, 0.85, 1.35], { color: 0x2c4a3e, rng });
  windows(kit, front(zf), { from: 0.2, to: 2.4, count: 2, y: 0.55, w: 0.5, h: 0.8, rng, shutters: 0x2c4a3e });
  windows(kit, front(zf), { from: -2.4, to: 2.4, count: 4, y: 1.95, w: 0.45, h: 0.75, rng, shutters: 0x2c4a3e });
  windows(kit, east(2.6), { from: z0 - 2.3, to: z0 + 2.3, count: 3, y: 0.55, w: 0.45, h: 0.8, rng });
  windows(kit, east(2.6), { from: z0 - 2.3, to: z0 + 2.3, count: 3, y: 1.95, w: 0.45, h: 0.75, rng });
  observatory(kit, 0.9, -3.7, rng);
  magnifier(kit, -2.0, 2.15, zf + 0.2);
  roofClutter(kit, [-2.4, z0 - 2.0, 0.0, z0 + 2.2], 3.3, rng, 2);
  flowerBed(kit, [1.5, 3.65], [1.8, 0.45], rng);
  ctx.tree('cypress', -2.5, -4.2, 0.85);
  return { height: 6.3, sign: [0, 4.4, z0], anchors: { telescope: [1.6, 6.1, -3.2] } };
}

/** Round observatory tower with a silver dome, a slit and a telescope. */
function observatory(kit, x, z, rng) {
  kit.cyl([x, 0, z], 1.3, 4.3, C.stonePale, { seg: 24, surface: S.stone });
  kit.cyl([x, 4.3, z], 1.4, 0.14, C.stoneTrim, { seg: 24, surface: S.stone });
  kit.dome([x, 4.44, z], 1.3, 0xd5dadf, { seg: 24, surface: S.steel });
  kit.box([x, 4.5, z + 0.15], [0.32, 1.3, 1.25], 0x1f262d, { rotX: -0.35 });
  kit.cyl([x, 5.55, z + 0.75], 0.15, 1.6, 0x2c3e5c, { seg: 10, rotX: 0.9, top: 0.12, surface: S.gloss, center: true });
  windows(kit, front(z + 1.3), { from: x - 0.3, to: x + 0.3, count: 1, y: 2.4, w: 0.36, h: 0.6, rng, arched: true });
}

/** Giant magnifying glass mounted by the door, handle down to the left. */
function magnifier(kit, x, y, z) {
  kit.push(x, y, z, 0.25);
  kit.torus([0, 0.3, 0], 0.5, 0.08, C.gold, { surface: S.gold, tubeSeg: 28 });
  kit.cyl([0, 0.3, -0.01], 0.46, 0.04, 0xbfe6f2, { rotX: Math.PI / 2, seg: 24, surface: S.glass, glow: 0.25, seed: 0.05 });
  kit.cyl([-0.45, -0.55, 0], 0.07, 0.7, C.woodDark, { rotZ: -0.6, seg: 8, surface: S.gloss });
  kit.pop();
}
