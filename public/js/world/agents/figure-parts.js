// Building blocks for the toy figure: primitive shapes, and a PartList that bakes each part's
// colour and bone into vertex attributes so the whole figure merges into one skinned geometry.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Rounded box, welded: three's RoundedBoxGeometry is non-indexed (324 vertices at one corner
 * segment); without uvs the seams merge down to a fraction of that.
 * @param {number} w @param {number} h @param {number} d @param {number} [r] corner radius @param {number} [seg]
 */
export function rbox(w, h, d, r = Math.min(w, h, d) * 0.3, seg = 1) {
  const raw = new RoundedBoxGeometry(w, h, d, seg, r);
  raw.deleteAttribute('uv');
  const welded = mergeVertices(raw, 1e-5);
  raw.dispose();
  return welded;
}
/** @param {number} w @param {number} h @param {number} d */
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
/** @param {number} r @param {number} [ws] @param {number} [hs] */
export const ball = (r, ws = 10, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
/** Upper part of a sphere down to `theta` radians from the top. @param {number} r @param {number} theta @param {number} [ws] */
export const dome = (r, theta = Math.PI / 2, ws = 16) => new THREE.SphereGeometry(r, ws, 8, 0, Math.PI * 2, 0, theta);
/** @param {number} rt @param {number} rb @param {number} h @param {number} [seg] */
export const cyl = (rt, rb, h, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);
/** Front half of a disc (z ≥ 0), e.g. a cap's visor. @param {number} r @param {number} h @param {number} [seg] */
export const halfDisc = (r, h, seg = 12) => new THREE.CylinderGeometry(r, r, h, seg, 1, false, -Math.PI / 2, Math.PI);
/** @param {number} r @param {number} h @param {number} [seg] */
export const cone = (r, h, seg = 10) => new THREE.ConeGeometry(r, h, seg);
/** Torus in the xy-plane; `arc` < 2π gives the upper part first. @param {number} r @param {number} tube @param {number} [arc] @param {number} [seg] */
export const ring = (r, tube, arc = Math.PI * 2, seg = 14) => new THREE.TorusGeometry(r, tube, 5, seg, arc);
/** @param {number} r @param {number} len @param {number} [seg] */
export const capsule = (r, len, seg = 8) => new THREE.CapsuleGeometry(r, len, 3, seg);

const _color = new THREE.Color();

/**
 * Collects parts (geometry + colour + bone) and merges them into one skinned geometry.
 * Geometries are modelled directly in figure space at the rest pose.
 */
export class PartList {
  constructor() {
    /** @type {{geo: THREE.BufferGeometry, color: string, bone: number}[]} */
    this.parts = [];
  }

  /**
   * @param {number} bone
   * @param {THREE.BufferGeometry} geo  consumed (disposed after merging)
   * @param {string} color sRGB hex
   */
  add(bone, geo, color) {
    this.parts.push({ geo, color, bone });
    return this;
  }

  /**
   * Adds the same part twice, mirrored across x (left and right).
   * @param {number} boneLeft @param {number} boneRight
   * @param {() => THREE.BufferGeometry} make  geometry for the LEFT side (+x)
   * @param {string} color
   */
  addPair(boneLeft, boneRight, make, color) {
    this.add(boneLeft, make(), color);
    const right = make();
    right.scale(-1, 1, 1);
    flipWinding(right);
    this.add(boneRight, right, color);
    return this;
  }

  /** @returns {THREE.BufferGeometry} */
  merge() {
    const prepared = this.parts.map(({ geo, color, bone }) => bake(geo, color, bone));
    const merged = mergeGeometries(prepared, false);
    for (const g of prepared) g.dispose();
    this.parts = [];
    return merged;
  }
}

/**
 * Mirroring with a negative scale turns triangles inside out; swapping two indices per triangle
 * restores the winding so back-face culling still works.
 * @param {THREE.BufferGeometry} geo
 */
function flipWinding(geo) {
  if (!geo.index) ensureIndexed(geo);
  const idx = geo.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  geo.index.needsUpdate = true;
}

/** @param {THREE.BufferGeometry} geo */
function ensureIndexed(geo) {
  const n = geo.attributes.position.count;
  const index = new (n > 65535 ? Uint32Array : Uint16Array)(n);
  for (let i = 0; i < n; i++) index[i] = i;
  geo.setIndex(new THREE.BufferAttribute(index, 1));
}

/**
 * Strips uv, converts to indexed, and adds colour (linear) + rigid skin weights.
 * @param {THREE.BufferGeometry} geo @param {string} color @param {number} bone
 */
function bake(geo, color, bone) {
  if (!geo.index) ensureIndexed(geo);
  if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
  const n = geo.attributes.position.count;
  _color.set(color); // sRGB hex → linear working space
  const colors = new Float32Array(n * 3);
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = _color.r;
    colors[i * 3 + 1] = _color.g;
    colors[i * 3 + 2] = _color.b;
    skinIndex[i * 4] = bone;
    skinWeight[i * 4] = 1;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  return geo;
}

/**
 * Merges plain coloured parts (no skinning), for effect icons and props outside a figure.
 * @param {[THREE.BufferGeometry, string][]} list  geometries are consumed
 */
export function mergeColored(list) {
  const prepared = list.map(([geo, color]) => {
    if (!geo.index) ensureIndexed(geo);
    if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
    _color.set(color);
    const colors = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = _color.r;
      colors[i + 1] = _color.g;
      colors[i + 2] = _color.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  });
  const merged = mergeGeometries(prepared, false);
  for (const g of prepared) g.dispose();
  return merged;
}

/**
 * Narrows a shape toward its bottom (a toy torso is wider at the shoulders than the waist).
 * @param {THREE.BufferGeometry} geo  centred at the origin
 * @param {number} height
 * @param {number} bottomScale  x/z scale at the bottom (1 at the top)
 */
export function taper(geo, height, bottomScale) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getY(i) + height / 2) / height; // 0 bottom → 1 top
    const s = bottomScale + (1 - bottomScale) * Math.min(1, Math.max(0, u));
    pos.setX(i, pos.getX(i) * s);
    pos.setZ(i, pos.getZ(i) * (0.5 + 0.5 * s));
  }
  pos.needsUpdate = true;
  return geo;
}

/** Width factor `taper` applies at height fraction u (0 bottom, 1 top). @param {number} u @param {number} bottomScale */
export function taperAt(u, bottomScale) {
  return bottomScale + (1 - bottomScale) * Math.min(1, Math.max(0, u));
}
