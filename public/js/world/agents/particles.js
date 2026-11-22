// Pooled particles: each ParticleField is one InstancedMesh with a fixed capacity and
// structure-of-arrays state, so spawning and simulating never allocates and a field costs one
// draw call (none while empty). Particles fade by shrinking — instanced meshes have no
// per-instance opacity, and shrinking reads well at toy scale.

import * as THREE from 'three';
import { easeOutBack, easeOutCubic } from './easing.js';

/** Scale-over-life curves. */
export const CURVE = Object.freeze({ POP: 0, SHRINK: 1, PUFF: 2, FLASH: 3, GROW: 4, CONST: 5 });

/**
 * Size multiplier at life fraction u (0..1).
 * @param {number} curve @param {number} u
 */
export function curveScale(curve, u) {
  // Clamped so a particle a frame past its life never yields NaN (FLASH takes a fractional power).
  u = Number.isFinite(u) ? Math.min(1, Math.max(0, u)) : 1;
  switch (curve) {
    case CURVE.POP:
      if (u < 0.18) return easeOutBack(u / 0.18);
      return u > 0.75 ? 1 - easeOutCubic((u - 0.75) / 0.25) : 1;
    case CURVE.PUFF:
      if (u < 0.3) return 0.35 + 0.65 * easeOutCubic(u / 0.3);
      return u > 0.5 ? 1 - (u - 0.5) / 0.5 : 1;
    case CURVE.FLASH:
      return u < 0.1 ? u / 0.1 : Math.pow(1 - (u - 0.1) / 0.9, 1.5);
    case CURVE.GROW:
      return u < 0.8 ? 0.4 + 0.75 * u : 1 - (u - 0.8) / 0.2;
    case CURVE.CONST:
      return 1;
    default:
      return 1 - u;
  }
}

/**
 * @typedef {object} SpawnSpec
 * @property {number} x @property {number} y @property {number} z
 * @property {number} vx @property {number} vy @property {number} vz
 * @property {number} life     seconds
 * @property {number} delay    seconds before the particle appears
 * @property {number} size     world units
 * @property {number} gravity  vertical acceleration (negative falls)
 * @property {number} drag     velocity decay per second
 * @property {number} spin     max random spin (rad/s)
 * @property {number} curve    one of CURVE
 * @property {number} r @property {number} g @property {number} b  linear colour
 * @property {number} floor    ground height for bounces
 * @property {number} orbit    rad/s around (x, z) at `radius`; 0 = straight flight
 * @property {number} radius
 * @property {number} radiusRate
 */

/**
 * Reusable spawn description: fill the fields, call field.spawn(SPAWN). A single shared object
 * keeps spawning allocation-free (rain spawns every frame).
 * @type {SpawnSpec}
 */
const SPAWN = {
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  life: 1,
  delay: 0,
  size: 0.1,
  gravity: 0,
  drag: 0,
  spin: 0,
  curve: CURVE.SHRINK,
  r: 1,
  g: 1,
  b: 1,
  floor: -Infinity,
  orbit: 0,
  radius: 0,
  radiusRate: 0,
};

/** Resets SPAWN to defaults and returns it (field by field: no object literal, no garbage). */
export function spawnSpec() {
  const s = SPAWN;
  s.x = s.y = s.z = s.vx = s.vy = s.vz = 0;
  s.delay = s.gravity = s.drag = s.spin = s.orbit = s.radius = s.radiusRate = 0;
  s.life = 1;
  s.size = 0.1;
  s.curve = CURVE.SHRINK;
  s.r = s.g = s.b = 1;
  s.floor = -Infinity;
  return s;
}

const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _mat = new THREE.Matrix4();
const FIELDS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'rx', 'ry', 'rz', 'wx', 'wy', 'wz', 'age', 'life', 'size', 'grav', 'drag',
  'curve', 'cr', 'cg', 'cb', 'floor', 'cx', 'cz', 'ang', 'orbit', 'rad', 'radRate'];

export class ParticleField {
  /**
   * @param {object} opts
   * @param {THREE.BufferGeometry} opts.geometry
   * @param {THREE.Material} opts.material
   * @param {number} opts.capacity
   * @param {'tumble'|'billboard'|'upright'} [opts.orient] tumble with random spin; billboard turns
   *   to the camera (icons); upright keeps the geometry's own orientation (rings, raindrops)
   */
  constructor({ geometry, material, capacity, orient = 'tumble' }) {
    this.capacity = capacity;
    this.orient = orient;
    this.alive = 0;
    /** @type {Record<string, Float32Array>} */
    this.a = {};
    for (const f of FIELDS) this.a[f] = new Float32Array(capacity);
    /** The same arrays in a list, for moving a particle between slots. */
    this.arrays = FIELDS.map((f) => this.a[f]);
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false; // particles span the whole map; bounds would be stale
  }

  /**
   * Adds one particle from a spec (see SPAWN). Silently drops it when the pool is full.
   * @param {SpawnSpec} s
   */
  spawn(s) {
    if (this.alive >= this.capacity) return;
    const i = this.alive++;
    const a = this.a;
    a.px[i] = s.x;
    a.py[i] = s.y;
    a.pz[i] = s.z;
    a.vx[i] = s.vx;
    a.vy[i] = s.vy;
    a.vz[i] = s.vz;
    a.rx[i] = Math.random() * 6.28;
    a.ry[i] = Math.random() * 6.28;
    a.rz[i] = Math.random() * 6.28;
    a.wx[i] = (Math.random() - 0.5) * 2 * s.spin;
    a.wy[i] = (Math.random() - 0.5) * 2 * s.spin;
    a.wz[i] = (Math.random() - 0.5) * 2 * s.spin;
    a.age[i] = -s.delay;
    a.life[i] = s.life;
    a.size[i] = s.size;
    a.grav[i] = s.gravity;
    a.drag[i] = s.drag;
    a.curve[i] = s.curve;
    a.cr[i] = s.r;
    a.cg[i] = s.g;
    a.cb[i] = s.b;
    a.floor[i] = s.floor;
    a.cx[i] = s.x;
    a.cz[i] = s.z;
    a.ang[i] = Math.random() * 6.28;
    a.orbit[i] = s.orbit;
    a.rad[i] = s.radius;
    a.radRate[i] = s.radiusRate;
  }

  /** Moves the last live particle into slot i (removal without holes). @param {number} i */
  kill(i) {
    const last = --this.alive;
    if (i === last) return;
    const arrays = this.arrays;
    for (let k = 0; k < arrays.length; k++) arrays[k][i] = arrays[k][last];
  }

  /** @param {number} i @param {number} dt */
  step(i, dt) {
    const a = this.a;
    a.vy[i] += a.grav[i] * dt;
    const k = Math.exp(-a.drag[i] * dt);
    a.vx[i] *= k;
    a.vy[i] *= k;
    a.vz[i] *= k;
    if (a.orbit[i] !== 0) {
      a.ang[i] += a.orbit[i] * dt;
      a.rad[i] = Math.max(0, a.rad[i] + a.radRate[i] * dt);
      a.cx[i] += a.vx[i] * dt;
      a.cz[i] += a.vz[i] * dt;
      a.px[i] = a.cx[i] + Math.cos(a.ang[i]) * a.rad[i];
      a.pz[i] = a.cz[i] + Math.sin(a.ang[i]) * a.rad[i];
    } else {
      a.px[i] += a.vx[i] * dt;
      a.pz[i] += a.vz[i] * dt;
    }
    a.py[i] += a.vy[i] * dt;
    const half = a.size[i] * 0.5;
    if (a.py[i] < a.floor[i] + half) {
      // Bounce off the ground and lose energy (tumbling boxes).
      a.py[i] = a.floor[i] + half;
      a.vy[i] = Math.abs(a.vy[i]) * 0.4;
      a.vx[i] *= 0.7;
      a.vz[i] *= 0.7;
    }
    a.rx[i] += a.wx[i] * dt;
    a.ry[i] += a.wy[i] * dt;
    a.rz[i] += a.wz[i] * dt;
  }

  /**
   * @param {number} dt seconds
   * @param {number} faceYaw camera yaw, for billboard fields
   */
  update(dt, faceYaw) {
    const a = this.a;
    let drawn = 0;
    for (let i = 0; i < this.alive; ) {
      a.age[i] += dt;
      if (a.age[i] >= a.life[i]) {
        this.kill(i);
        continue;
      }
      if (a.age[i] >= 0) {
        this.step(i, dt);
        this.write(drawn++, i, faceYaw);
      }
      i++;
    }
    this.mesh.count = drawn;
    this.mesh.visible = drawn > 0;
    if (drawn > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** @param {number} slot draw slot @param {number} i particle @param {number} faceYaw */
  write(slot, i, faceYaw) {
    const a = this.a;
    const s = Math.max(1e-4, a.size[i] * curveScale(a.curve[i], a.age[i] / a.life[i]));
    _pos.set(a.px[i], a.py[i], a.pz[i]);
    if (this.orient === 'billboard') {
      // Faces the camera, with a little wobble scaled by the particle's spin.
      _euler.set(0, faceYaw + a.wy[i] * 0.05 * Math.sin(a.age[i] * 3), a.wz[i] * 0.03 * Math.sin(a.age[i] * 5));
    } else if (this.orient === 'upright') _euler.set(0, 0, 0);
    else _euler.set(a.rx[i], a.ry[i], a.rz[i]);
    _quat.setFromEuler(_euler);
    _mat.compose(_pos, _quat, _scale.set(s, s, s));
    this.mesh.setMatrixAt(slot, _mat);
    const c = this.mesh.instanceColor.array;
    c[slot * 3] = a.cr[i];
    c[slot * 3 + 1] = a.cg[i];
    c[slot * 3 + 2] = a.cb[i];
  }

  clear() {
    this.alive = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose();
  }
}
