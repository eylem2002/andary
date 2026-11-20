// Paper planes for SendMessage: a folded dart arcs from the sender to the recipient (who may
// keep walking — the plane homes in on where they are now), banks a little, then pops.

import * as THREE from 'three';
import { clamp, easeInOutCubic } from './easing.js';

/** A folded paper dart, nose toward +z. */
function planeGeometry() {
  const nose = [0, 0, 0.26];
  const left = [0.17, 0.03, -0.12];
  const right = [-0.17, 0.03, -0.12];
  const tail = [0, 0, -0.12];
  const keel = [0, -0.07, -0.1];
  const tris = [nose, left, tail, nose, tail, right, nose, tail, keel, nose, keel, tail];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  const shade = [1, 1, 1, 1, 1, 1, 0.82, 0.82, 0.82, 0.82, 0.82, 0.82];
  geo.setAttribute('color', new THREE.Float32BufferAttribute(shade.flatMap((v) => [v, v, v]), 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * @typedef {object} Flight
 * @property {THREE.Mesh} mesh
 * @property {THREE.Vector3} from
 * @property {THREE.Vector3} to       updated while the target moves
 * @property {() => ({x: number, y: number, z: number}|null)} target
 * @property {number} t
 * @property {number} duration
 * @property {number} arc
 * @property {() => void} resolve
 */

/**
 * @param {THREE.Scene} scene
 * @param {(p: THREE.Vector3) => void} onLand  plays the "pop" where a plane lands
 */
export function createPlanes(scene, onLand) {
  const geometry = planeGeometry();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
  /** @type {Flight[]} */
  const flights = [];
  /** @type {THREE.Mesh[]} */
  const spare = [];
  const _p = new THREE.Vector3();
  const _ahead = new THREE.Vector3();
  let reducedMotion = false;

  /** Quadratic Bézier with the control point lifted above the midpoint. */
  function along(f, u, out) {
    const mx = (f.from.x + f.to.x) / 2;
    const my = Math.max(f.from.y, f.to.y) + f.arc;
    const mz = (f.from.z + f.to.z) / 2;
    const a = (1 - u) * (1 - u);
    const b = 2 * u * (1 - u);
    const c = u * u;
    return out.set(a * f.from.x + b * mx + c * f.to.x, a * f.from.y + b * my + c * f.to.y, a * f.from.z + b * mz + c * f.to.z);
  }

  /** @param {Flight} f @param {number} dt */
  function fly(f, dt) {
    f.t += dt;
    const target = f.target();
    if (target) f.to.set(target.x, target.y, target.z);
    const u = Math.min(1, f.t / f.duration);
    const e = easeInOutCubic(u) * 0.3 + u * 0.7;
    along(f, e, f.mesh.position);
    along(f, Math.min(1, e + 0.02), _ahead);
    if (_ahead.distanceToSquared(f.mesh.position) > 1e-8) f.mesh.lookAt(_ahead);
    if (!reducedMotion) f.mesh.rotateZ(Math.sin(f.t * 7) * 0.3);
    return u >= 1;
  }

  return {
    /**
     * @param {{x: number, y: number, z: number}} from
     * @param {() => ({x: number, y: number, z: number}|null)} target  live target position
     * @returns {Promise<void>} resolves when the plane lands
     */
    launch(from, target) {
      const to = target();
      if (!to) return Promise.resolve();
      const mesh = spare.pop() ?? new THREE.Mesh(geometry, material);
      mesh.name = 'paper-plane';
      scene.add(mesh);
      const dist = Math.hypot(to.x - from.x, to.z - from.z);
      return new Promise((resolve) => {
        flights.push({
          mesh,
          from: new THREE.Vector3(from.x, from.y, from.z),
          to: new THREE.Vector3(to.x, to.y, to.z),
          target,
          t: 0,
          duration: clamp(0.8 + dist / 8, 0.9, 3.2),
          arc: 1.1 + dist * 0.16,
          resolve,
        });
      });
    },
    /** @param {number} dt */
    update(dt) {
      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i];
        if (!fly(f, dt)) continue;
        flights.splice(i, 1);
        f.mesh.removeFromParent();
        spare.push(f.mesh);
        onLand(_p.copy(f.to));
        f.resolve();
      }
    },
    /** @param {boolean} on */
    setReducedMotion(on) {
      reducedMotion = on;
    },
    dispose() {
      for (const f of flights.splice(0)) {
        f.mesh.removeFromParent();
        f.resolve();
      }
      geometry.dispose();
      material.dispose();
    },
  };
}
