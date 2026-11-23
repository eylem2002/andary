// Life in the quarter's park (quarter.js): a dog trotting round the square, pigeons pecking by the
// fountain, and two kites over the east lawn on good days (clear or rainbow weather, by day). Three
// small meshes, allocation-free per frame. Reduced motion: the dog sits, the pigeons and kites
// hold still.
import * as THREE from 'three';
import { GeometryBatch } from './batch.js';
import { Kit } from './kit.js';
import { S } from './palette.js';
import { PARK_FOUNTAIN, PARK_SQUARE } from './quarter.js';

const DOG_SPEED = 1.1;
const PIGEONS = 5;
/** The kites' ground stakes on the east lawn; each kite flies above and behind its stake. */
const KITE_STAKES = Object.freeze([[13.5, 33.5], [18, 31.8]]);
const KITE_COLORS = Object.freeze([0xff5f7e, 0x2fb8c8]);

/**
 * @param {{scene: THREE.Scene, town: import('./town-material.js').TownUniforms, material: THREE.Material, reducedMotion: boolean}} deps
 */
export function createParkLife({ scene, town, material, reducedMotion }) {
  let reduced = reducedMotion;
  let goodDay = true;
  const dog = createDog(scene, material);
  const pigeons = createPigeons(scene, material);
  const kites = createKites(scene, material);
  return {
    /** @param {number} dt @param {number} elapsed */
    update(dt, elapsed) {
      dog.update(dt, elapsed, reduced);
      pigeons.update(elapsed, reduced);
      kites.update(elapsed, reduced, goodDay && town.uTtNight.value < 0.5);
    },
    /** Kites fly only in clear or rainbow weather. @param {import('../../core/town-weather.js').TownWeather} w */
    setWeather(w) {
      goodDay = w?.kind === 'clear' || w?.kind === 'rainbow';
    },
    /** @param {boolean} on */
    setReducedMotion(on) {
      reduced = on;
    },
    dispose() {
      for (const part of [dog, pigeons, kites]) part.dispose();
    },
  };
}

/** @param {(kit: Kit) => void} draw */
function geometryOf(draw) {
  const batch = new GeometryBatch(512);
  const kit = new Kit(batch);
  draw(kit);
  kit.dispose();
  return batch.build();
}

/** @param {THREE.Scene} scene @param {THREE.Object3D} mesh @param {string} name */
function addMesh(scene, mesh, name) {
  mesh.name = name;
  scene.add(mesh);
  return () => {
    scene.remove(mesh);
    /** @type {any} */ (mesh).geometry.dispose();
  };
}

/**
 * A small brown dog, facing +x, walking a loop just inside the square's edge.
 * @param {THREE.Scene} scene @param {THREE.Material} material
 */
function createDog(scene, material) {
  const geometry = geometryOf((kit) => {
    const fur = 0xa86b3c;
    kit.rbox([0, 0.16, 0], [0.42, 0.18, 0.2], fur, { radius: 0.07, segments: 2 });
    kit.rbox([0.24, 0.28, 0], [0.18, 0.16, 0.16], fur, { radius: 0.06, segments: 2 });
    kit.box([0.35, 0.29, 0], [0.08, 0.06, 0.08], 0x7a4a26);
    kit.sphere([0.39, 0.32, 0], 0.022, 0x1a1a1a);
    for (const side of [-1, 1]) kit.box([0.21, 0.38, side * 0.07], [0.05, 0.1, 0.04], 0x7a4a26, { rotX: side * 0.3 });
    for (const [x, z] of [[-0.14, -0.06], [-0.14, 0.06], [0.14, -0.06], [0.14, 0.06]]) kit.box([x, 0, z], [0.05, 0.17, 0.05], fur);
    kit.beam([-0.2, 0.26, 0], [-0.32, 0.4, 0], 0.035, fur);
    kit.box([0.12, 0.25, 0], [0.04, 0.05, 0.2], 0xd64541);
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  const dispose = addMesh(scene, mesh, 'park-dog');
  const inset = 0.7;
  const corners = [
    [PARK_SQUARE.minX + inset, PARK_SQUARE.minZ + inset],
    [PARK_SQUARE.maxX - inset, PARK_SQUARE.minZ + inset],
    [PARK_SQUARE.maxX - inset, PARK_SQUARE.maxZ - inset],
    [PARK_SQUARE.minX + inset, PARK_SQUARE.maxZ - inset],
  ];
  const lengths = corners.map((a, i) => {
    const b = corners[(i + 1) % 4];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
  const loop = lengths.reduce((sum, n) => sum + n, 0);
  let travelled = 0;
  return {
    /** @param {number} dt @param {number} elapsed @param {boolean} calm */
    update(dt, elapsed, calm) {
      if (calm) {
        // Sitting by the south bench, looking at the fountain.
        mesh.position.set(0.8, 0.02, 34.6);
        mesh.rotation.set(0, Math.PI / 2, 0.25);
        return;
      }
      travelled = (travelled + dt * DOG_SPEED) % loop;
      let d = travelled;
      let i = 0;
      while (d > lengths[i]) d -= lengths[i++];
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      const t = d / lengths[i];
      mesh.position.set(ax + (bx - ax) * t, 0.02 + Math.abs(Math.sin(elapsed * 9)) * 0.03, az + (bz - az) * t);
      mesh.rotation.set(0, Math.atan2(-(bz - az), bx - ax), 0);
    },
    dispose,
  };
}

/**
 * Grey pigeons round the fountain, each pecking on its own beat.
 * @param {THREE.Scene} scene @param {THREE.Material} material
 */
function createPigeons(scene, material) {
  const geometry = geometryOf((kit) => {
    kit.ball([0, 0.07, 0], 0.07, 0x8a9099, { sy: 0.8 });
    kit.ball([0.07, 0.12, 0], 0.04, 0x6b7280);
    kit.box([0.11, 0.11, 0], [0.03, 0.012, 0.015], 0xe0a040);
    kit.box([-0.08, 0.07, 0], [0.06, 0.02, 0.06], 0x6b7280);
  });
  const mesh = new THREE.InstancedMesh(geometry, material, PIGEONS);
  mesh.frustumCulled = false;
  const dispose = addMesh(scene, mesh, 'park-pigeons');
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1.4, 1.4, 1.4);
  return {
    /** @param {number} elapsed @param {boolean} calm */
    update(elapsed, calm) {
      for (let i = 0; i < PIGEONS; i++) {
        const angle = (i / PIGEONS) * Math.PI * 2 + 0.4;
        const radius = 2.1 + (i % 2) * 0.35;
        const beat = calm ? 0 : Math.max(0, Math.sin(elapsed * 3 + i * 1.7));
        p.set(PARK_FOUNTAIN.x + Math.cos(angle) * radius, 0.02, PARK_FOUNTAIN.z + Math.sin(angle) * radius);
        e.set(0, -angle + (calm ? 0 : Math.sin(elapsed * 0.4 + i) * 0.6), -beat * 0.5);
        mesh.setMatrixAt(i, m.compose(p, q.setFromEuler(e), s));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose,
  };
}

/**
 * Two diamond kites with tails, each on a string from its stake; the whole kite sways about the
 * stake, so the string never needs rebuilding.
 * @param {THREE.Scene} scene @param {THREE.Material} material
 */
function createKites(scene, material) {
  const group = new THREE.Group();
  const kites = KITE_STAKES.map(([x, z], i) => {
    const mesh = new THREE.Mesh(geometryOf((kit) => {
      kit.beam([0, 0, 0], [0, 6.2, -2.4], 0.012, 0xf4f4f0);
      kit.box([0, 5.85, -2.4], [0.7, 0.7, 0.02], KITE_COLORS[i], { rotZ: Math.PI / 4, surface: S.fabric });
      for (let k = 1; k <= 4; k++) kit.box([0, 5.85 - 0.32 * k, -2.42 - 0.05 * k], [0.12, 0.08, 0.02], 0xffd36b, { rotZ: k % 2 ? 0.4 : -0.4, surface: S.fabric });
    }), material);
    mesh.position.set(x, 0.1, z);
    group.add(mesh);
    return mesh;
  });
  scene.add(group);
  group.name = 'park-kites';
  return {
    /** @param {number} elapsed @param {boolean} calm @param {boolean} flying */
    update(elapsed, calm, flying) {
      group.visible = flying;
      if (!flying) return;
      const t = calm ? 0 : elapsed;
      kites.forEach((mesh, i) => mesh.rotation.set(Math.sin(t * 0.7 + i) * 0.06, Math.sin(t * 0.23 + i * 2) * 0.25, Math.sin(t * 0.9 + i * 1.3) * 0.12));
    },
    dispose() {
      scene.remove(group);
      for (const mesh of kites) mesh.geometry.dispose();
    },
  };
}
