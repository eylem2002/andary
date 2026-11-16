// Merges many small primitives into one BufferGeometry per material, so the whole static town is
// a single draw call. Each vertex carries its colour (vertex colours replace dozens of materials)
// and an `aInfo` byte quad that the town shader reads: [building id, surface kind, glow, seed].
import * as THREE from 'three';

/**
 * @typedef {object} PartStyle
 * @property {number} color          sRGB hex
 * @property {number} [surface]      surface kind (palette.js S)
 * @property {number} [building]     building id (1-based; 0 = not part of a building)
 * @property {number} [glow]         0..1 night glow strength
 * @property {number} [seed]         0..1 per-part randomness (window switch-on order, tint)
 * @property {[number, number]} [shade]  colour multiplier at the part's local bottom and top
 */

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _normalMatrix = new THREE.Matrix3();
const _color = new THREE.Color();

/** Growable typed array. */
class Buffer {
  /** @param {Float32ArrayConstructor|Uint8ArrayConstructor|Uint32ArrayConstructor} Type @param {number} capacity */
  constructor(Type, capacity) {
    this.Type = Type;
    this.data = new Type(capacity);
    this.length = 0;
  }

  /** @param {number} extra */
  reserve(extra) {
    if (this.length + extra <= this.data.length) return;
    let size = this.data.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new this.Type(size);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }

  trimmed() {
    return this.data.slice(0, this.length);
  }
}

export class GeometryBatch {
  /** @param {number} [capacity] initial vertex capacity */
  constructor(capacity = 8192) {
    this.positions = new Buffer(Float32Array, capacity * 3);
    this.normals = new Buffer(Float32Array, capacity * 3);
    this.colors = new Buffer(Uint8Array, capacity * 3);
    this.info = new Buffer(Uint8Array, capacity * 4);
    this.indices = new Buffer(Uint32Array, capacity * 6);
  }

  get vertexCount() {
    return this.positions.length / 3;
  }

  /**
   * Appends a transformed copy of a geometry.
   * @param {THREE.BufferGeometry} geometry  indexed or not; needs position and normal
   * @param {THREE.Matrix4} matrix
   * @param {PartStyle} style
   */
  add(geometry, matrix, style) {
    const pos = geometry.getAttribute('position');
    const nor = geometry.getAttribute('normal');
    const count = pos.count;
    const base = this.vertexCount;
    this.reserveVertices(count);
    _normalMatrix.getNormalMatrix(matrix);
    _color.setHex(style.color);
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const minY = geometry.boundingBox.min.y;
    const spanY = geometry.boundingBox.max.y - minY || 1;
    const info = [style.building ?? 0, style.surface ?? 0, toByte(style.glow ?? 0), toByte(style.seed ?? 0)];
    for (let i = 0; i < count; i++) {
      _p.fromBufferAttribute(pos, i);
      const shade = style.shade ? style.shade[0] + (style.shade[1] - style.shade[0]) * ((_p.y - minY) / spanY) : 1;
      _p.applyMatrix4(matrix);
      _n.fromBufferAttribute(nor, i).applyMatrix3(_normalMatrix).normalize();
      this.pushVertex(_p, _n, shade, info);
    }
    this.addIndices(geometry, base, count);
  }

  /** @param {number} count */
  reserveVertices(count) {
    this.positions.reserve(count * 3);
    this.normals.reserve(count * 3);
    this.colors.reserve(count * 3);
    this.info.reserve(count * 4);
  }

  /**
   * @param {THREE.Vector3} p
   * @param {THREE.Vector3} n
   * @param {number} shade
   * @param {number[]} info
   */
  pushVertex(p, n, shade, info) {
    const v = this.positions.length;
    this.positions.data[v] = p.x;
    this.positions.data[v + 1] = p.y;
    this.positions.data[v + 2] = p.z;
    this.positions.length += 3;
    this.normals.data[v] = n.x;
    this.normals.data[v + 1] = n.y;
    this.normals.data[v + 2] = n.z;
    this.normals.length += 3;
    const c = this.colors.length;
    this.colors.data[c] = toByte(_color.r * shade);
    this.colors.data[c + 1] = toByte(_color.g * shade);
    this.colors.data[c + 2] = toByte(_color.b * shade);
    this.colors.length += 3;
    const k = this.info.length;
    this.info.data.set(info, k);
    this.info.length += 4;
  }

  /**
   * @param {THREE.BufferGeometry} geometry
   * @param {number} base
   * @param {number} count
   */
  addIndices(geometry, base, count) {
    const index = geometry.getIndex();
    const n = index ? index.count : count;
    this.indices.reserve(n);
    const out = this.indices.data;
    let k = this.indices.length;
    for (let i = 0; i < n; i++) out[k++] = base + (index ? index.getX(i) : i);
    this.indices.length = k;
  }

  /** @returns {THREE.BufferGeometry} */
  build() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions.trimmed(), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals.trimmed(), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors.trimmed(), 3, true));
    geometry.setAttribute('aInfo', new THREE.BufferAttribute(this.info.trimmed(), 4, false));
    const indices = this.indices.trimmed();
    const small = this.vertexCount < 65535;
    geometry.setIndex(new THREE.BufferAttribute(small ? Uint16Array.from(indices) : indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** @param {number} v 0..1 */
function toByte(v) {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}
