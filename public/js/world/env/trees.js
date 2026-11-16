// Trees as instanced meshes (one draw call per kind): round teal "foam ball" trees like a model
// railway's, Mediterranean cypresses and date palms. They sway gently in the shader (town material
// TT_SWAY); reduced motion lowers the sway uniform.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GeometryBatch } from './batch.js';
import { Kit } from './kit.js';
import { C, S } from './palette.js';
import { createRng, range } from './rand.js';

/**
 * @typedef {object} TreePlacement
 * @property {'round'|'palm'|'cypress'} kind
 * @property {number} x
 * @property {number} z
 * @property {number} [y]
 * @property {number} [scale]
 */

/** Instance tints (multiplied with the vertex colours) for variety. */
const TINTS = Object.freeze({
  round: [0xffffff, 0xe9fff0, 0xfff3d6, 0xdff5ff, 0xf3ffe0],
  palm: [0xffffff, 0xf4ffe6, 0xfff8e8],
  cypress: [0xffffff, 0xe8f5ea, 0xf0f8e6],
});

/**
 * A lumpy ball with smooth normals: an icosahedron pushed in and out by a seeded wobble.
 * @param {number} seed
 */
function lumpyBall(seed) {
  const rng = createRng(seed);
  const base = mergeVertices(new THREE.IcosahedronGeometry(1, 1).deleteAttribute('normal').deleteAttribute('uv'));
  const pos = base.getAttribute('position');
  const v = new THREE.Vector3();
  const phase = [range(rng, 0, 6), range(rng, 0, 6), range(rng, 0, 6)];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 + 0.09 * Math.sin(v.x * 3.1 + phase[0]) + 0.08 * Math.sin(v.y * 3.7 + phase[1]) + 0.07 * Math.sin(v.z * 2.9 + phase[2]);
    v.multiplyScalar(k);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  base.computeVertexNormals();
  return base;
}

/** @param {Kit} kit */
function roundTree(kit) {
  kit.cyl([0, 0, 0], 0.1, 1.0, C.trunk, { seg: 7, top: 0.07, surface: S.matte });
  kit.cyl([0.08, 0.7, 0], 0.04, 0.4, C.trunk, { seg: 5, rotZ: -0.7, surface: S.matte });
  const blobs = [
    [0, 1.45, 0, 0.72, 1],
    [0.42, 1.18, 0.15, 0.48, 2],
    [-0.38, 1.22, -0.12, 0.5, 3],
    [0.05, 1.12, -0.42, 0.42, 4],
    [-0.1, 1.85, 0.12, 0.42, 5],
  ];
  for (const [x, y, z, r, seed] of blobs) {
    const g = kit.cached(`lump${seed}`, () => lumpyBall(seed * 31));
    kit.geometry(g, [x, y, z], seed % 2 ? C.leafTeal : 0x58ae9c, { sx: r, sy: r * 0.92, sz: r, surface: S.foliage });
  }
}

/** @param {Kit} kit */
function cypressTree(kit) {
  kit.cyl([0, 0, 0], 0.07, 0.3, C.trunk, { seg: 6, surface: S.matte });
  const g = kit.cached('cypress', () => {
    const profile = [[0, 0.2], [0.24, 0.32], [0.34, 0.8], [0.33, 1.5], [0.24, 2.15], [0.1, 2.6], [0, 2.8]];
    const lathe = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 9);
    const merged = mergeVertices(lathe.deleteAttribute('normal').deleteAttribute('uv'));
    const pos = merged.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const wobble = 1 + 0.12 * Math.sin(y * 9.0 + pos.getX(i) * 4.0);
      pos.setXYZ(i, pos.getX(i) * wobble, y, pos.getZ(i) * wobble);
    }
    merged.computeVertexNormals();
    return merged;
  });
  kit.geometry(g, [0, 0, 0], C.cypress, { surface: S.foliage });
}

/** One palm frond: a tapered, folded leaf that arches and droops, base at the origin. */
function frondGeometry() {
  const g = new THREE.BoxGeometry(1, 0.025, 0.26, 7, 1, 2).translate(0.5, 0, 0);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getX(i);
    const width = Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.9 + 0.1;
    const z = pos.getZ(i) * width;
    const fold = Math.abs(z) * 0.5;
    pos.setXYZ(i, t * 1.15, pos.getY(i) + 0.35 * t - 0.75 * t * t + fold, z);
  }
  g.computeVertexNormals();
  return g;
}

/** @param {Kit} kit */
function palmTree(kit) {
  let x = 0;
  let y = 0;
  for (let i = 0; i < 8; i++) {
    const r = 0.11 - i * 0.006;
    kit.cyl([x, y, 0], r, 0.36, i % 2 ? C.palmTrunk : 0x8f7353, { seg: 7, top: r * 0.92, surface: S.matte });
    x += 0.03 + i * 0.006;
    y += 0.34;
  }
  const frond = kit.cached('frond', frondGeometry);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + (i % 2) * 0.2;
    const lift = i % 2 ? 0.35 : 0.05;
    kit.geometry(frond, [x, y + 0.02, 0], i % 3 ? C.palm : 0x5a9440, { rotY: a, rotZ: lift, surface: S.foliage });
  }
  kit.ball([x, y - 0.05, 0], 0.16, 0x7a5a2e, { surface: S.matte });
}

/**
 * @param {(kit: Kit) => void} draw
 */
function treeGeometry(draw) {
  const batch = new GeometryBatch(1024);
  const kit = new Kit(batch);
  draw(kit);
  kit.dispose();
  return batch.build();
}

/**
 * @param {TreePlacement[]} placements
 * @param {THREE.Material} material  foliage variant of the town material
 */
export function createTrees(placements, material) {
  const group = new THREE.Group();
  group.name = 'trees';
  const kinds = { round: roundTree, palm: palmTree, cypress: cypressTree };
  const rng = createRng(77);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const color = new THREE.Color();
  for (const [kind, draw] of Object.entries(kinds)) {
    const list = placements.filter((p) => p.kind === kind);
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(treeGeometry(draw), material, list.length);
    mesh.name = `trees-${kind}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    list.forEach((p, i) => {
      const s = (p.scale ?? 1) * range(rng, 0.9, 1.1);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, range(rng, 0, Math.PI * 2));
      m.compose(new THREE.Vector3(p.x, p.y ?? 0.08, p.z), q, new THREE.Vector3(s, s * range(rng, 0.92, 1.08), s));
      mesh.setMatrixAt(i, m);
      const tints = /** @type {Record<string, number[]>} */ (TINTS)[kind];
      mesh.setColorAt(i, color.setHex(tints[Math.floor(rng() * tints.length)]));
    });
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

export { treeGeometry, roundTree };
