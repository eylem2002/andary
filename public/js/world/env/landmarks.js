// Landmarks the town earns as work gets done (core/growth.js): bunting over the north avenue, an
// ice-cream cart, a curly-brace statue, a Ferris wheel on the beach, a hot-air balloon and a
// golden dome on the Town Hall. Each is built the first time it is unlocked and grows into place
// (it simply appears with reduced motion); the wheel turns and the balloon drifts.
import * as THREE from 'three';
import { GeometryBatch } from './batch.js';
import { Kit } from './kit.js';
import { C, NEON, S } from './palette.js';
import { WHEEL_SPOT, sandHeight } from './beach.js';
import { tileToWorld } from '../layout.js';

/**
 * @param {(kit: Kit) => void} draw
 * @param {THREE.Material} material
 * @param {string} name
 */
function build(draw, material, name) {
  const batch = new GeometryBatch(2048);
  const kit = new Kit(batch);
  draw(kit);
  kit.dispose();
  const mesh = new THREE.Mesh(batch.build(), material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const FLAGS = [NEON.pink, NEON.cyan, C.flowerYellow, NEON.violet, NEON.orange, NEON.mint];

/** Strings of flags across the north avenue, between poles. */
function bunting(/** @type {Kit} */ kit) {
  const { z } = tileToWorld(12, 9);
  const xs = [-22, -11, 0, 11, 22];
  for (const x of xs) kit.cyl([x, 0, z + 1.1], 0.06, 3.4, C.steel, { seg: 6, surface: S.steel });
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i];
    const b = xs[i + 1];
    for (let f = 0; f < 12; f++) {
      const t = (f + 0.5) / 12;
      const sag = Math.sin(t * Math.PI) * 0.45;
      kit.prism([a + (b - a) * t, 3.15 - sag, z + 1.1], [0.42, 0.42, 0.04], FLAGS[(i * 12 + f) % FLAGS.length], { surface: S.fabric, rotZ: Math.PI });
    }
  }
}

/** A pastel ice-cream cart with a striped umbrella, on the promenade. */
function iceCream(/** @type {Kit} */ kit) {
  kit.rbox([0, 0.55, 0], [1.3, 0.7, 0.7], 0xffd1e8, { surface: S.gloss, radius: 0.08 });
  kit.box([0, 0.92, 0], [1.36, 0.06, 0.76], 0xffffff, { surface: S.matte });
  for (const x of [-0.4, 0.4]) kit.cyl([x, 0.18, 0.36], 0.18, 0.06, 0x2b2b33, { rotX: Math.PI / 2, center: true, seg: 12, surface: S.matte });
  for (const [x, c] of [[-0.35, 0xff8fb8], [0, 0xfff1c9], [0.35, 0x9ff0d9]]) {
    kit.cone([x, 0.95, 0], 0.08, 0.22, 0xd99a55, { surface: S.matte, rotX: Math.PI });
    kit.sphere([x, 1.2, 0], 0.11, c, { surface: S.matte });
  }
  kit.cyl([0.55, 0.9, 0], 0.03, 1.5, C.steel, { seg: 6, surface: S.steel });
  for (let i = 0; i < 8; i++) {
    kit.cyl([0.55, 2.4, 0], 0.95, 0.45, i % 2 ? 0xffffff : NEON.pink, { surface: S.fabric, top: 0.0001, seg: 8, arc: Math.PI / 4, rotY: (i / 8) * Math.PI * 2 });
  }
}

/** A curly-brace statue on a plinth: `{ }` in gold. */
function statue(/** @type {Kit} */ kit) {
  kit.box([0, 0.35, 0], [2.2, 0.7, 1.2], C.stoneTrim, { surface: S.stone });
  kit.box([0, 0.78, 0], [2.0, 0.16, 1.0], C.stone, { surface: S.stone });
  const brace = [[0.5, 3.6], [0.22, 3.42], [0.2, 2.75], [-0.1, 2.45], [0.2, 2.15], [0.22, 1.45], [0.5, 1.0]];
  for (const side of [-1, 1]) {
    for (let i = 0; i < brace.length - 1; i++) {
      const [x0, y0] = brace[i];
      const [x1, y1] = brace[i + 1];
      kit.beam([side * (x0 - 0.85) * -1, y0, 0], [side * (x1 - 0.85) * -1, y1, 0], 0.16, 0xf2b134, { surface: S.gold });
    }
  }
}

/** The Ferris wheel's frame (it stands still). */
function wheelFrame(/** @type {Kit} */ kit) {
  for (const z of [-0.7, 0.7]) {
    kit.beam([-1.8, 0, z], [0, 4.4, z * 0.4], 0.14, 0xffffff, { surface: S.steel });
    kit.beam([1.8, 0, z], [0, 4.4, z * 0.4], 0.14, 0xffffff, { surface: S.steel });
  }
  kit.cyl([0, 4.4, 0], 0.16, 0.9, C.steel, { rotX: Math.PI / 2, center: true, seg: 10, surface: S.steel });
  kit.box([0, 0.06, 0], [4.4, 0.12, 2], C.stoneTrim, { surface: S.stone });
}

const WHEEL_RADIUS = 3.4;
const GONDOLAS = 10;

/** The turning part: two rims, spokes and neon. */
function wheelRim(/** @type {Kit} */ kit) {
  for (const z of [-0.28, 0.28]) {
    kit.torus([0, 0, z], WHEEL_RADIUS, 0.06, NEON.pink, { surface: S.bulb, glow: 1, seed: 0.04, tubeSeg: 48 });
    for (let i = 0; i < GONDOLAS; i++) {
      const a = (i / GONDOLAS) * Math.PI * 2;
      kit.beam([0, 0, z], [Math.cos(a) * WHEEL_RADIUS, Math.sin(a) * WHEEL_RADIUS, z], 0.05, 0xffffff, { surface: S.steel });
    }
  }
}

/** One gondola, hanging below its pivot. @param {number} color */
function gondola(kit, color) {
  kit.rbox([0, -0.42, 0], [0.5, 0.42, 0.42], color, { surface: S.gloss, radius: 0.06 });
  kit.box([0, -0.14, 0], [0.56, 0.05, 0.48], 0xffffff, { surface: S.matte });
  kit.cyl([0, -0.12, 0], 0.025, 0.14, C.steel, { seg: 6, surface: S.steel });
}

/** A striped hot-air balloon with its basket; origin at the bottom of the basket. */
function balloon(/** @type {Kit} */ kit) {
  const stripes = [NEON.pink, 0xffffff, NEON.cyan, C.flowerYellow];
  for (let i = 0; i < 12; i++) {
    const gore = new THREE.SphereGeometry(1, 3, 16, (i / 12) * Math.PI * 2, (Math.PI * 2) / 12);
    kit.geometry(gore, [0, 3.1, 0], stripes[i % stripes.length], { surface: S.fabric, sx: 1.6, sy: 1.84, sz: 1.6 });
    gore.dispose();
  }
  kit.cone([0, 1.35, 0], 0.75, 0.9, stripes[0], { surface: S.fabric, rotX: Math.PI, seg: 16 });
  for (const [x, z] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) kit.beam([x, 0.4, z], [x * 2.2, 1.2, z * 2.2], 0.02, 0x5b4636, { surface: S.matte });
  kit.box([0, 0.2, 0], [0.6, 0.4, 0.6], 0xa0703f, { surface: S.matte });
}

/** A golden dome over the Town Hall's own. */
function goldenDome(/** @type {Kit} */ kit) {
  kit.dome([0, 0, 0], 1.76, 0xffc23a, { surface: S.gold, sy: 1.1, seg: 32, glow: 0.25, seed: 0.02 });
  kit.dome([0, 2.27, 0], 0.33, 0xffc23a, { surface: S.gold, seg: 14, glow: 0.25, seed: 0.02 });
}

/**
 * @param {object} deps
 * @param {THREE.Scene} deps.scene
 * @param {THREE.Material} deps.material
 * @param {Record<string, { anchors: Record<string, THREE.Vector3> }>} deps.records
 * @param {boolean} [deps.reducedMotion]
 */
export function createLandmarks({ scene, material, records, reducedMotion = false }) {
  /** @type {Map<string, { root: THREE.Object3D, grow: number }>} */
  const built = new Map();
  let reduced = reducedMotion;
  let time = 0;
  /** @type {{ rim: THREE.Object3D, gondolas: THREE.Object3D[] }|null} */
  let wheel = null;
  /** @type {THREE.Object3D|null} */
  let floating = null;

  /** @type {Record<string, () => THREE.Object3D>} */
  const makers = {
    bunting: () => build(bunting, material, 'landmark-bunting'),
    icecream: () => {
      const mesh = build(iceCream, material, 'landmark-icecream');
      const { x, z } = tileToWorld(12, 2);
      mesh.position.set(x + 1, 0.04, z + 0.2);
      return mesh;
    },
    statue: () => {
      const mesh = build(statue, material, 'landmark-statue');
      const { x, z } = tileToWorld(5, 10);
      mesh.position.set(x + 1, 0.07, z);
      return mesh;
    },
    wheel: () => {
      const root = new THREE.Group();
      root.name = 'landmark-wheel';
      root.add(build(wheelFrame, material, 'wheel-frame'));
      const rim = build(wheelRim, material, 'wheel-rim');
      rim.position.y = 4.4;
      root.add(rim);
      const colors = [NEON.pink, NEON.cyan, C.flowerYellow, NEON.violet, NEON.mint];
      const gondolas = [];
      for (let i = 0; i < GONDOLAS; i++) {
        const g = build((kit) => gondola(kit, colors[i % colors.length]), material, 'wheel-gondola');
        root.add(g);
        gondolas.push(g);
      }
      root.position.set(WHEEL_SPOT.x, sandHeight(WHEEL_SPOT.z), WHEEL_SPOT.z);
      root.rotation.y = 0.35;
      wheel = { rim, gondolas };
      return root;
    },
    balloon: () => {
      const mesh = build(balloon, material, 'landmark-balloon');
      mesh.castShadow = false;
      floating = mesh;
      return mesh;
    },
    golden: () => {
      const mesh = build(goldenDome, material, 'landmark-golden');
      const at = records.hall?.anchors.dome;
      if (at) mesh.position.set(at.x, at.y - 1.93, at.z);
      return mesh;
    },
  };

  function place() {
    if (wheel) {
      const angle = time * 0.12;
      wheel.rim.rotation.z = angle;
      wheel.gondolas.forEach((g, i) => {
        const a = angle + (i / GONDOLAS) * Math.PI * 2;
        g.position.set(Math.cos(a) * WHEEL_RADIUS, 4.4 + Math.sin(a) * WHEEL_RADIUS, 0);
      });
    }
    if (floating) {
      const a = time * 0.03;
      floating.position.set(Math.cos(a) * 9, 15 + Math.sin(time * 0.4) * 0.4, -6 + Math.sin(a) * 7);
    }
  }

  return {
    /**
     * Builds whatever is unlocked and not built yet. `grow` makes new ones rise into place.
     * @param {string[]} ids
     * @param {{ grow?: boolean }} [options]
     */
    set(ids, { grow = false } = {}) {
      for (const id of ids) {
        if (built.has(id) || !Object.hasOwn(makers, id)) continue;
        const root = makers[id]();
        const growing = grow && !reduced;
        if (growing) root.scale.setScalar(0.01);
        scene.add(root);
        built.set(id, { root, grow: growing ? 0 : 1 });
      }
      place();
    },
    /** @param {boolean} on */
    setReducedMotion(on) {
      reduced = on;
    },
    /** @param {number} dt */
    update(dt) {
      if (!reduced) time += dt;
      for (const entry of built.values()) {
        if (entry.grow >= 1) continue;
        entry.grow = Math.min(1, entry.grow + dt / 1.6);
        const t = 1 - (1 - entry.grow) ** 3;
        entry.root.scale.setScalar(Math.max(0.01, t * (1 + 0.08 * Math.sin(entry.grow * Math.PI))));
      }
      place();
    },
    /** @returns {string[]} */
    get built() {
      return [...built.keys()];
    },
    dispose() {
      for (const { root } of built.values()) {
        scene.remove(root);
        root.traverse((o) => /** @type {any} */ (o).geometry?.dispose());
      }
      built.clear();
    },
  };
}
