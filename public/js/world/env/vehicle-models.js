// Toy vehicle models built from primitives, all facing +x with their origin on the ground at the
// centre: cars, the town bus, the mail van and boats. Each becomes one mesh (one draw call).
import * as THREE from 'three';
import { GeometryBatch } from './batch.js';
import { Kit } from './kit.js';
import { C, S } from './palette.js';

/**
 * @param {(kit: Kit) => void} draw
 * @param {THREE.Material} material
 * @param {string} name
 */
function build(draw, material, name) {
  const batch = new GeometryBatch(1024);
  const kit = new Kit(batch);
  draw(kit);
  kit.dispose();
  const mesh = new THREE.Mesh(batch.build(), material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Four wheels at ±x, ±z.
 * @param {Kit} kit
 * @param {number} x @param {number} z @param {number} r
 */
function wheels(kit, x, z, r) {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      kit.cyl([sx * x, r, sz * z], r, 0.12, 0x24262a, { rotX: Math.PI / 2, seg: 12, center: true, surface: S.matte });
      kit.cyl([sx * x, r, sz * (z + 0.005)], r * 0.55, 0.125, 0xc9ccd1, { rotX: Math.PI / 2, seg: 10, center: true, surface: S.steel });
    }
  }
}

/**
 * Head and tail lights on the front (+x) and back faces.
 * @param {Kit} kit
 * @param {number} front @param {number} back @param {number} y @param {number} z
 */
function lights(kit, front, back, y, z) {
  for (const sz of [-1, 1]) {
    kit.box([front, y, sz * z], [0.04, 0.08, 0.12], 0xfff1c9, { surface: S.bulb, glow: 1, seed: 0.02 });
    kit.box([back, y, sz * z], [0.04, 0.07, 0.11], 0xff3b2f, { surface: S.bulb, glow: 0.7, seed: 0.02 });
  }
}

/**
 * A rounded little car.
 * @param {number} color body colour
 * @param {THREE.Material} material
 */
export function createCar(color, material) {
  return build((kit) => {
    kit.rbox([0, 0.12, 0], [1.3, 0.3, 0.64], color, { surface: S.gloss, radius: 0.1, segments: 2 });
    kit.rbox([-0.1, 0.4, 0], [0.74, 0.28, 0.58], color, { surface: S.gloss, radius: 0.1, segments: 2 });
    kit.box([-0.1, 0.43, 0], [0.7, 0.2, 0.6], C.glass, { surface: S.glass });
    kit.box([0.28, 0.43, 0], [0.04, 0.2, 0.5], C.glass, { surface: S.glass, rotZ: -0.5 });
    kit.box([0.62, 0.15, 0], [0.06, 0.06, 0.5], 0xd5d8dc, { surface: S.steel });
    lights(kit, 0.66, -0.66, 0.28, 0.2);
    wheels(kit, 0.4, 0.27, 0.13);
  }, material, 'car');
}

/** @param {THREE.Material} material */
export function createBus(material) {
  return build((kit) => {
    kit.rbox([0, 0.16, 0], [2.7, 0.95, 0.9], C.tealLight, { surface: S.gloss, radius: 0.12, segments: 2 });
    kit.box([0, 0.16, 0], [2.72, 0.24, 0.92], 0xf5f1e6, { surface: S.gloss });
    kit.box([-0.15, 0.62, 0], [2.3, 0.36, 0.92], C.glass, { surface: S.glass, glow: 0.6, seed: 0.1 });
    kit.box([1.36, 0.45, 0], [0.04, 0.55, 0.76], C.glass, { surface: S.glass, glow: 0.4, seed: 0.1 });
    kit.box([0.95, 0.2, -0.465], [0.42, 0.8, 0.02], 0x2a3a40, { surface: S.gloss });
    kit.box([0, 1.1, 0], [2.0, 0.08, 0.7], 0xf5f1e6, { surface: S.gloss });
    kit.box([1.38, 0.95, 0], [0.03, 0.14, 0.5], 0x111111, { surface: S.glow, glow: 0.5 });
    lights(kit, 1.36, -1.36, 0.36, 0.33);
    wheels(kit, 0.85, 0.4, 0.17);
  }, material, 'bus');
}

/** @param {THREE.Material} material */
export function createMailTruck(material) {
  return build((kit) => {
    kit.rbox([-0.18, 0.14, 0], [1.05, 0.78, 0.7], C.red, { surface: S.gloss, radius: 0.06, segments: 1 });
    kit.box([-0.18, 0.5, 0], [1.07, 0.1, 0.72], 0xf5f1e6, { surface: S.gloss });
    kit.rbox([0.5, 0.14, 0], [0.4, 0.55, 0.66], C.red, { surface: S.gloss, radius: 0.06, segments: 1 });
    kit.box([0.55, 0.45, 0], [0.32, 0.2, 0.68], C.glass, { surface: S.glass });
    kit.torus([-0.18, 0.66, 0.36], 0.12, 0.03, C.gold, { surface: S.gold });
    kit.torus([-0.18, 0.66, -0.36], 0.12, 0.03, C.gold, { surface: S.gold });
    lights(kit, 0.71, -0.71, 0.3, 0.24);
    wheels(kit, 0.42, 0.3, 0.13);
  }, material, 'mail-truck');
}

/**
 * Small cargo boat bringing MCP crates: hull, wheelhouse and containers.
 * @param {THREE.Material} material
 */
export function createCargoBoat(material) {
  return build((kit) => {
    hull(kit, 2.6, 1.0, C.navy);
    kit.box([-0.75, 0.36, 0], [0.62, 0.62, 0.7], 0xf6f3ec, { surface: S.gloss });
    kit.box([-0.75, 0.75, 0], [0.64, 0.2, 0.72], C.glass, { surface: S.glass, glow: 0.6, seed: 0.1 });
    kit.box([-0.75, 0.98, 0], [0.72, 0.06, 0.8], C.red, { surface: S.gloss });
    kit.box([0.2, 0.36, 0], [0.62, 0.36, 0.62], C.flowerYellow, { surface: S.gloss });
    kit.box([0.7, 0.36, 0], [0.32, 0.36, 0.62], C.teal, { surface: S.gloss });
    kit.box([0.45, 0.72, 0], [0.62, 0.3, 0.55], C.terracotta, { surface: S.gloss });
    kit.cyl([-0.75, 1.04, 0.15], 0.02, 0.4, C.steel, { seg: 6, surface: S.steel });
    kit.sphere([-0.75, 1.46, 0.15], 0.05, C.beacon, { surface: S.beacon, glow: 1, seed: 0.3 });
  }, material, 'cargo-boat');
}

/**
 * Moored boats: a fishing boat and a little sailboat.
 * @param {THREE.Material} material
 */
export function createMooredBoats(material) {
  const fishing = build((kit) => {
    hull(kit, 1.8, 0.75, 0xf3f0e8);
    kit.box([-0.2, 0.32, 0], [0.5, 0.42, 0.5], C.tealLight, { surface: S.gloss });
    kit.box([-0.2, 0.62, 0], [0.56, 0.05, 0.56], C.red, { surface: S.gloss });
    kit.cyl([0.4, 0.32, 0], 0.02, 0.8, C.wood, { seg: 6 });
  }, material, 'fishing-boat');
  const sail = build((kit) => {
    hull(kit, 1.5, 0.6, C.terracotta);
    kit.cyl([0.05, 0.3, 0], 0.025, 1.7, C.woodLight, { seg: 6 });
    kit.box([-0.25, 0.55, 0], [0.55, 1.3, 0.02], 0xfbf8f0, { surface: S.fabric, rotZ: 0.12 });
  }, material, 'sail-boat');
  return [fishing, sail];
}

/**
 * Boat hull: a box with a pointed bow, sitting on the waterline (y = 0).
 * @param {Kit} kit
 * @param {number} length @param {number} beam
 * @param {number} color
 */
function hull(kit, length, beam, color) {
  kit.box([-0.1, -0.12, 0], [length * 0.78, 0.48, beam], color, { surface: S.gloss });
  kit.cyl([length * 0.29, -0.12, 0], beam / 2, 0.48, color, { seg: 3, arc: Math.PI, surface: S.gloss, sx: 1.2 });
  kit.box([-0.1, 0.3, 0], [length * 0.8, 0.06, beam + 0.04], 0x8a5a36, { surface: S.gloss });
  kit.box([-0.1, -0.13, 0], [length * 0.79, 0.08, beam + 0.02], C.red, { surface: S.gloss });
}
