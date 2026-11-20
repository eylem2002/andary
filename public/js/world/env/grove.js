// Worktree Grove: each git worktree grows a labelled tree in one of the grove's planting spots;
// removing the worktree lets its tree shrink away and frees the spot.
import * as THREE from 'three';
import { GROVE_SLOTS, nextFreeSlot, worktreeLabel } from './grove-slots.js';
import { hashString } from './rand.js';
import { LOT_Y } from './terrain.js';
import { roundTree, treeGeometry } from './trees.js';

const GROW_SECONDS = 2.6;
const SHRINK_SECONDS = 0.7;

/**
 * @typedef {object} Planted
 * @property {string} id
 * @property {number} slot
 * @property {number} grow     0..1 current size
 * @property {number} target   1 growing / grown, 0 being removed
 * @property {number} turn     yaw so neighbouring trees look different
 * @property {number} size
 * @property {THREE.Vector3} labelAt
 */

/**
 * @param {{scene: THREE.Scene, material: THREE.Material, record: import('./buildings/index.js').BuildingRecord,
 *          signs: ReturnType<typeof import('./signs.js').createSigns>, reducedMotion: boolean}} deps
 */
export function createGrove({ scene, material, record, signs, reducedMotion }) {
  let reduced = reducedMotion;
  const mesh = new THREE.InstancedMesh(treeGeometry(roundTree), material, GROVE_SLOTS.length);
  mesh.name = 'worktree-trees';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.count = 0;
  mesh.frustumCulled = false;
  const tint = new THREE.Color(0xd9ffd2);
  for (let i = 0; i < GROVE_SLOTS.length; i++) mesh.setColorAt(i, tint);
  scene.add(mesh);
  /** @type {Map<string, Planted>} */
  const trees = new Map();
  /** @type {boolean[]} */
  const occupied = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  let dirty = false;

  /** @param {Planted} t */
  function world(t) {
    const slot = GROVE_SLOTS[t.slot];
    return { x: record.lot.cx + slot.x, z: record.lot.cz + slot.z };
  }

  function write() {
    let count = 0;
    for (let i = 0; i < GROVE_SLOTS.length; i++) mesh.setMatrixAt(i, m.makeScale(0, 0, 0));
    for (const t of trees.values()) {
      const { x, z } = world(t);
      const k = t.target > 0 ? easeOutBack(t.grow) : t.grow;
      const size = t.size * (0.2 + 0.8 * k) * (t.grow > 0 ? 1 : 0);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t.turn);
      mesh.setMatrixAt(t.slot, m.compose(p.set(x, LOT_Y, z), q, s.set(size, size, size)));
      t.labelAt.set(x, LOT_Y + 0.4 + 2.25 * size, z);
      count = Math.max(count, t.slot + 1);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  }

  return {
    /** @param {string} id @param {string} label */
    add(id, label) {
      const key = String(id);
      const existing = trees.get(key);
      const text = worktreeLabel(label);
      if (existing) {
        existing.target = 1;
        signs.addLabel({ id: `wt:${key}`, text, icon: '🌱', position: existing.labelAt, kind: 'tree' });
        dirty = true;
        return;
      }
      const slot = nextFreeSlot(occupied);
      if (slot < 0) return;
      occupied[slot] = true;
      const h = hashString(key);
      /** @type {Planted} */
      const t = { id: key, slot, grow: reduced ? 1 : 0.001, target: 1, turn: (h % 628) / 100, size: 0.72 + ((h >> 8) % 20) / 100, labelAt: new THREE.Vector3() };
      trees.set(key, t);
      signs.addLabel({ id: `wt:${key}`, text, icon: '🌱', position: t.labelAt, kind: 'tree' });
      dirty = true;
    },
    /** @param {string} id */
    remove(id) {
      const t = trees.get(String(id));
      if (!t) return;
      t.target = 0;
      if (reduced) t.grow = 0;
      dirty = true;
    },
    /** @param {number} dt */
    update(dt) {
      // Nothing to do (and nothing allocated) unless a tree is growing or shrinking.
      if (!dirty) return;
      let animating = false;
      for (const t of trees.values()) {
        if (t.grow === t.target) continue;
        animating = true;
        t.grow = t.target > 0 ? Math.min(1, t.grow + dt / GROW_SECONDS) : Math.max(0, t.grow - dt / SHRINK_SECONDS);
        if (t.target === 0 && t.grow === 0) {
          trees.delete(t.id);
          occupied[t.slot] = false;
          signs.removeLabel(`wt:${t.id}`);
        }
      }
      write();
      dirty = animating;
    },
    /** @param {boolean} on */
    setReducedMotion(on) {
      reduced = on;
    },
    dispose() {
      for (const t of trees.values()) signs.removeLabel(`wt:${t.id}`);
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose();
    },
  };
}

/** Overshoots a little at the end, like a sapling springing up. @param {number} t */
function easeOutBack(t) {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
