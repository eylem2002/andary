// A small modelling kit: places primitives (boxes, rounded boxes, cylinders, spheres, domes,
// prisms, lathes) into a GeometryBatch in a local frame, so building code reads like a sketch:
// kit.box(x, y, z, w, h, d, color). Positions are the bottom-centre of each primitive; `y` is
// the height of its base. Shared unit geometries are cached and freed by dispose().
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { S } from './palette.js';

/** @typedef {[number, number, number]} Vec3 */

/**
 * @typedef {object} PartOptions
 * @property {number} [surface]
 * @property {number} [glow]
 * @property {number} [seed]
 * @property {[number, number]} [shade]
 * @property {number} [rotX]
 * @property {number} [rotY]
 * @property {number} [rotZ]
 * @property {number} [building]  overrides the kit's current building id
 */

const _m = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _t = new THREE.Vector3();
const _s = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** @param {number} v */
const key = (v) => Math.round(v * 1000) / 1000;

export class Kit {
  /** @param {import('./batch.js').GeometryBatch} batch */
  constructor(batch) {
    this.batch = batch;
    this.building = 0;
    /** Repaints colours while a building is being built (see palette.js paintMap). @type {Map<number, number>|null} */
    this.paint = null;
    /** The current building's neon colour, for rooflines that light up at dusk. @type {number|null} */
    this.neon = null;
    /** @type {THREE.Matrix4[]} */
    this.stack = [new THREE.Matrix4()];
    /** @type {Map<string, THREE.BufferGeometry>} */
    this.cache = new Map();
  }

  get frame() {
    return this.stack[this.stack.length - 1];
  }

  /**
   * Enters a local frame (translation + rotation about y + uniform scale).
   * @param {number} x @param {number} y @param {number} z @param {number} [rotY] @param {number} [scale]
   */
  push(x, y, z, rotY = 0, scale = 1) {
    _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rotY);
    _local.compose(_t.set(x, y, z), _q, _s.set(scale, scale, scale));
    this.stack.push(this.frame.clone().multiply(_local));
  }

  pop() {
    if (this.stack.length > 1) this.stack.pop();
  }

  /**
   * Places a cached geometry with a local transform.
   * @param {THREE.BufferGeometry} geometry centred unit-ish geometry
   * @param {Vec3} at     centre position
   * @param {Vec3} scale
   * @param {number} color
   * @param {PartOptions} [opts]
   */
  place(geometry, [x, y, z], [sx, sy, sz], color, opts = {}) {
    _e.set(opts.rotX ?? 0, opts.rotY ?? 0, opts.rotZ ?? 0, 'YXZ');
    _q.setFromEuler(_e);
    _local.compose(_t.set(x, y, z), _q, _s.set(sx, sy, sz));
    _m.multiplyMatrices(this.frame, _local);
    this.batch.add(geometry, _m, {
      color: this.paint?.get(color) ?? color,
      surface: opts.surface ?? S.matte,
      building: opts.building ?? this.building,
      glow: opts.glow,
      seed: opts.seed,
      shade: opts.shade,
    });
  }

  /**
   * @param {string} id
   * @param {() => THREE.BufferGeometry} make
   */
  cached(id, make) {
    let geometry = this.cache.get(id);
    if (!geometry) {
      geometry = make();
      this.cache.set(id, geometry);
    }
    return geometry;
  }

  /**
   * Axis-aligned box standing on its bottom centre.
   * @param {Vec3} at  bottom centre
   * @param {Vec3} size  [w, h, d]
   * @param {number} color
   * @param {PartOptions} [opts]
   */
  box([x, y, z], [w, h, d], color, opts) {
    const g = this.cached('box', () => new THREE.BoxGeometry(1, 1, 1));
    this.place(g, [x, y + h / 2, z], [w, h, d], color, opts);
  }

  /**
   * Box with rounded edges (radius in world units, so the geometry is cached per size).
   * @param {Vec3} at  bottom centre
   * @param {Vec3} size  [w, h, d]
   * @param {number} color
   * @param {PartOptions & {radius?: number, segments?: number}} [opts]
   */
  rbox([x, y, z], [w, h, d], color, opts = {}) {
    const radius = opts.radius ?? 0.06;
    const segments = opts.segments ?? 2;
    const id = `rbox|${key(w)}|${key(h)}|${key(d)}|${key(radius)}|${segments}`;
    const g = this.cached(id, () => new RoundedBoxGeometry(w, h, d, segments, radius));
    this.place(g, [x, y + h / 2, z], [1, 1, 1], color, opts);
  }

  /**
   * Cylinder or frustum standing on `at`.
   * @param {Vec3} at  base centre (or centre with opts.center)
   * @param {number} r bottom radius
   * @param {number} h height
   * @param {number} color
   * @param {PartOptions & {top?: number, seg?: number, open?: boolean, arc?: number, sx?: number, sz?: number, center?: boolean}} [opts]
   *   center: `at` is the cylinder's centre instead of its base (use for rotated cylinders)
   */
  cyl([x, y, z], r, h, color, opts = {}) {
    const ratio = (opts.top ?? r) / r;
    const seg = opts.seg ?? 16;
    const arc = opts.arc ?? Math.PI * 2;
    const id = `cyl|${key(ratio)}|${seg}|${opts.open ? 1 : 0}|${key(arc)}`;
    const g = this.cached(id, () => new THREE.CylinderGeometry(ratio, 1, 1, seg, 1, !!opts.open, 0, arc));
    this.place(g, [x, opts.center ? y : y + h / 2, z], [r * (opts.sx ?? 1), h, r * (opts.sz ?? 1)], color, opts);
  }

  /**
   * Cone standing on `at`.
   * @param {Vec3} at @param {number} r @param {number} h @param {number} color
   * @param {PartOptions & {seg?: number, center?: boolean}} [opts]
   */
  cone(at, r, h, color, opts = {}) {
    this.cyl(at, r, h, color, { ...opts, top: 0.0001 });
  }

  /**
   * Sphere centred at `at`; sy squashes or stretches it.
   * @param {Vec3} at @param {number} r @param {number} color
   * @param {PartOptions & {seg?: number, sy?: number}} [opts]
   */
  sphere(at, r, color, opts = {}) {
    const seg = opts.seg ?? 14;
    const g = this.cached(`sphere|${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.6))));
    this.place(g, at, [r, r * (opts.sy ?? 1), r], color, opts);
  }

  /**
   * Low-poly faceted ball (icosahedron), for bushes and flowers.
   * @param {Vec3} at @param {number} r @param {number} color
   * @param {PartOptions & {detail?: number, sy?: number}} [opts]
   */
  ball(at, r, color, opts = {}) {
    const detail = opts.detail ?? 0;
    const g = this.cached(`ico|${detail}`, () => new THREE.IcosahedronGeometry(1, detail));
    this.place(g, at, [r, r * (opts.sy ?? 1), r], color, opts);
  }

  /**
   * Hemisphere dome resting on `at`; sy makes onion or flat domes.
   * @param {Vec3} at @param {number} r @param {number} color
   * @param {PartOptions & {seg?: number, sy?: number}} [opts]
   */
  dome(at, r, color, opts = {}) {
    const seg = opts.seg ?? 20;
    const g = this.cached(`dome|${seg}`, () => new THREE.SphereGeometry(1, seg, Math.round(seg / 2), 0, Math.PI * 2, 0, Math.PI / 2));
    this.place(g, at, [r, r * (opts.sy ?? 1), r], color, opts);
  }

  /**
   * Solid parabolic dish (satellite or radar dish) with a convex back and a concave face that
   * opens towards +y before rotation. A closed shape, so it shows from both sides.
   * @param {Vec3} at  centre of the dish
   * @param {number} r @param {number} color
   * @param {PartOptions} [opts]
   */
  dish(at, r, color, opts = {}) {
    const g = this.cached('dish', () => {
      const profile = [[0.001, -0.07], [0.5, -0.02], [0.9, 0.12], [1, 0.2], [0.97, 0.25], [0.88, 0.2], [0.5, 0.07], [0.001, 0.03]];
      return new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 18);
    });
    this.place(g, at, [r, r, r], color, opts);
  }

  /**
   * Gable prism: base w (x) by d (z), ridge along x at height h.
   * @param {Vec3} at  bottom centre @param {Vec3} size [w, h, d] @param {number} color
   * @param {PartOptions} [opts]
   */
  prism([x, y, z], [w, h, d], color, opts) {
    const g = this.cached('prism', makePrism);
    this.place(g, [x, y + h / 2, z], [w, h, d], color, opts);
  }

  /**
   * Square beam from point a to point b (for lattice towers, cranes, wires).
   * @param {[number, number, number]} a
   * @param {[number, number, number]} b
   * @param {number} t thickness
   * @param {number} color
   * @param {PartOptions} [opts]
   */
  beam(a, b, t, color, opts = {}) {
    _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _dir.length();
    if (len < 1e-6) return;
    _q.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, _dir.divideScalar(len));
    _local.compose(_t.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(t, len, t));
    _m.multiplyMatrices(this.frame, _local);
    const g = this.cached('box', () => new THREE.BoxGeometry(1, 1, 1));
    this.batch.add(g, _m, {
      color: this.paint?.get(color) ?? color,
      surface: opts.surface ?? S.matte,
      building: opts.building ?? this.building,
      glow: opts.glow,
      seed: opts.seed,
    });
  }

  /**
   * Right-angled wedge (a sawtooth roof tooth): vertical face at the back (-z), sloping down to
   * the front (+z). Base w (x) by d (z), height h.
   * @param {Vec3} at  bottom centre @param {Vec3} size [w, h, d] @param {number} color
   * @param {PartOptions} [opts]
   */
  wedge([x, y, z], [w, h, d], color, opts) {
    const g = this.cached('wedge', makeWedge);
    this.place(g, [x, y + h / 2, z], [w, h, d], color, opts);
  }

  /**
   * Torus (optionally partial) centred at `at`, lying in the xy plane unless rotated.
   * @param {Vec3} at @param {number} r @param {number} tube @param {number} color
   * @param {PartOptions & {arc?: number, tubeSeg?: number}} [opts]
   */
  torus(at, r, tube, color, opts = {}) {
    const arc = opts.arc ?? Math.PI * 2;
    const seg = opts.tubeSeg ?? 24;
    const g = this.cached(`torus|${key(tube / r)}|${key(arc)}|${seg}`, () => new THREE.TorusGeometry(1, tube / r, 6, seg, arc));
    this.place(g, at, [r, r, r], color, opts);
  }

  /**
   * Surface of revolution from a profile [[radius, y], ...]; cached when opts.cacheId is set.
   * @param {Vec3} at
   * @param {Array<[number, number]>} profile
   * @param {number} color
   * @param {PartOptions & {seg?: number, cacheId?: string}} [opts]
   */
  lathe(at, profile, color, opts = {}) {
    const make = () => new THREE.LatheGeometry(profile.map(([r, py]) => new THREE.Vector2(r, py)), opts.seg ?? 20);
    const g = opts.cacheId ? this.cached(`lathe|${opts.cacheId}`, make) : make();
    this.place(g, at, [1, 1, 1], color, opts);
    if (!opts.cacheId) g.dispose();
  }

  /**
   * Any geometry, placed as-is at `at`.
   * @param {THREE.BufferGeometry} geometry
   * @param {Vec3} at
   * @param {number} color
   * @param {PartOptions & {sx?: number, sy?: number, sz?: number}} [opts]
   */
  geometry(geometry, at, color, opts = {}) {
    this.place(geometry, at, [opts.sx ?? 1, opts.sy ?? 1, opts.sz ?? 1], color, opts);
  }

  dispose() {
    for (const g of this.cache.values()) g.dispose();
    this.cache.clear();
  }
}

/** Unit wedge: right triangle in the yz plane (vertical side at z = -0.5), extruded along x. */
function makeWedge() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.5);
  shape.lineTo(0.5, -0.5);
  shape.lineTo(-0.5, 0.5);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  g.rotateY(-Math.PI / 2);
  return g;
}

/** Unit gable prism centred on the origin (base y = -0.5, ridge y = 0.5 along x). */
function makePrism() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.5);
  shape.lineTo(0.5, -0.5);
  shape.lineTo(0, 0.5);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  // Extruded along +z with the triangle in xy: turn it so the ridge runs along x.
  g.translate(0, 0, -0.5);
  g.rotateY(Math.PI / 2);
  return g;
}
