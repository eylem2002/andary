// The node_modules lot: a teetering pile of cardboard boxes whose size follows setNodeModules(0–5).
// New boxes drop in from above; at the top levels the pile sways as if it might topple.
import * as THREE from 'three';
import { DECOR, tileToWorld } from '../layout.js';
import { GeometryBatch } from './batch.js';
import { Kit } from './kit.js';
import { C, S } from './palette.js';
import { MAX_BOXES, PILE_COUNTS, clampLevel, pileLayout } from './pile-layout.js';
import { LOT_Y } from './terrain.js';

const DROP_SECONDS = 0.45;
const STAGGER = 0.07;

/** One cardboard box, unit size, standing on y = 0: tape across the top and an npm label. */
function boxGeometry() {
  const batch = new GeometryBatch(512);
  const kit = new Kit(batch);
  kit.rbox([0, 0, 0], [1, 1, 1], C.cardboard, { surface: S.matte, radius: 0.04, segments: 1 });
  kit.box([0, 0.995, 0], [1.002, 0.012, 0.22], C.tape, { surface: S.gloss });
  kit.box([0, 0.55, 0.5], [0.22, 0.45, 0.012], C.tape, { surface: S.gloss });
  kit.box([-0.24, 0.25, 0.502], [0.32, 0.2, 0.01], 0xf7f3ea);
  kit.box([-0.33, 0.29, 0.508], [0.1, 0.1, 0.01], C.red, { surface: S.gloss });
  kit.dispose();
  return batch.build();
}

/**
 * @param {{scene: THREE.Scene, material: THREE.Material, reducedMotion: boolean,
 *          signs: ReturnType<typeof import('./signs.js').createSigns>}} deps
 */
export function createPile({ scene, material, reducedMotion, signs }) {
  let reduced = reducedMotion;
  const layout = pileLayout();
  const a = tileToWorld(DECOR.nodeModules[0], DECOR.nodeModules[1]);
  const b = tileToWorld(DECOR.nodeModules[2], DECOR.nodeModules[3]);
  const origin = new THREE.Vector3((a.x + b.x) / 2, LOT_Y + 0.03, (a.z + b.z) / 2 - 0.3);
  // The label floats just above the top of the pile, so it rises as the pile grows.
  const labelAt = new THREE.Vector3(origin.x, origin.y + 0.7, origin.z);
  signs.addLabel({ id: 'decor-node-modules', text: 'node_modules', icon: '📦', position: labelAt });
  const mesh = new THREE.InstancedMesh(boxGeometry(), material, MAX_BOXES);
  mesh.name = 'node-modules';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);
  /** per box: 0 = gone, 1 = in place */
  const shown = new Float32Array(MAX_BOXES);
  const target = new Float32Array(MAX_BOXES);
  const delay = new Float32Array(MAX_BOXES);
  let level = 0;
  let animating = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();

  /** @param {number} elapsed */
  function writeMatrices(elapsed) {
    let count = 0;
    let top = 0;
    for (let i = 0; i < MAX_BOXES; i++) {
      if (shown[i] <= 0) continue;
      count = i + 1;
      const box = layout[i];
      top = Math.max(top, (box.y + box.size) * Math.min(1, shown[i] * 1.5));
      const k = shown[i];
      const drop = target[i] > 0 ? (1 - easeOutBounce(k)) * 2.5 : 0;
      const sway = level >= 4 && !reduced ? Math.sin(elapsed * 1.3 + i * 0.4) * 0.025 * Math.min(1, box.y / 2.5) : 0;
      e.set(sway, box.rotY, box.tilt + sway * 0.6, 'YXZ');
      q.setFromEuler(e);
      const size = box.size * (target[i] > 0 ? 1 : k);
      p.set(origin.x + box.x + sway * box.y, origin.y + box.y + drop, origin.z + box.z);
      m.compose(p, q, s.set(size, size, size));
      mesh.setMatrixAt(i, m);
    }
    for (let i = 0; i < count; i++) {
      if (shown[i] <= 0) mesh.setMatrixAt(i, m.makeScale(0, 0, 0));
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    labelAt.y = origin.y + top + 0.45;
  }

  return {
    /** @param {number} next */
    setLevel(next) {
      const lvl = clampLevel(next);
      if (lvl === level) return;
      const count = PILE_COUNTS[lvl];
      let order = 0;
      for (let i = 0; i < MAX_BOXES; i++) {
        const want = i < count ? 1 : 0;
        if (want === target[i]) continue;
        target[i] = want;
        delay[i] = reduced ? 0 : (want ? order++ : 0) * STAGGER;
        if (reduced) shown[i] = want;
      }
      level = lvl;
      animating = true;
    },
    /** @param {number} dt @param {number} elapsed */
    update(dt, elapsed) {
      if (!animating && (level < 4 || reduced)) return;
      let busy = false;
      for (let i = 0; i < MAX_BOXES; i++) {
        if (shown[i] === target[i]) continue;
        if (delay[i] > 0) {
          delay[i] -= dt;
          busy = true;
          continue;
        }
        const step = dt / (target[i] ? DROP_SECONDS : 0.25);
        shown[i] = target[i] ? Math.min(1, shown[i] + step) : Math.max(0, shown[i] - step);
        busy = true;
      }
      animating = busy;
      writeMatrices(elapsed);
    },
    /** @param {boolean} on */
    setReducedMotion(on) {
      reduced = on;
    },
    dispose() {
      signs.removeLabel('decor-node-modules');
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose();
    },
  };
}

/** @param {number} t 0..1 */
function easeOutBounce(t) {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t - 1.5 / d) * (t - 1.5 / d) + 0.75;
  if (t < 2.5 / d) return n * (t - 2.25 / d) * (t - 2.25 / d) + 0.9375;
  return n * (t - 2.625 / d) * (t - 2.625 / d) + 0.984375;
}
