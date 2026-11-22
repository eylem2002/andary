// Assembles toy figures. All figures share one vertex-coloured material; geometry is cached per
// look (crew colour, hat, kit, wearable, skin, hair, trousers; a person's whole chosen look), so a crew of look-alikes shares
// buffers. Each agent gets its own skeleton and a single SkinnedMesh: one draw call per agent.

import * as THREE from 'three';
import { PartList } from './figure-parts.js';
import { addBody, addWearable } from './figure-body.js';
import { addHat } from './figure-hats.js';
import { addExtra } from './figure-person.js';
import { addProps } from './figure-props.js';
import { createSkeleton } from './rig.js';

/** Shared by every figure: plastic toy look, colours come from the vertices. */
const FIGURE_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.55,
  metalness: 0,
});

/** @type {Map<string, {geometry: THREE.BufferGeometry, refs: number}>} */
const cache = new Map();
const IDENTITY = new THREE.Matrix4();
/** Generous bounds (raised arms, hats, props, hops) so culling never clips a figure. */
const BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 0.95);

/** @param {import('./looks.js').Look} look */
function buildGeometry(look) {
  const parts = new PartList();
  addBody(parts, look);
  addWearable(parts, look);
  addHat(parts, look);
  addExtra(parts, look);
  addProps(parts, look);
  return parts.merge();
}

/**
 * Geometry for a look, built once and shared while anyone uses it.
 * @param {import('./looks.js').Look} look
 */
function acquireGeometry(look) {
  let entry = cache.get(look.key);
  if (!entry) {
    entry = { geometry: buildGeometry(look), refs: 0 };
    cache.set(look.key, entry);
  }
  entry.refs++;
  return entry.geometry;
}

/** @param {string} key */
function releaseGeometry(key) {
  const entry = cache.get(key);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) {
    entry.geometry.dispose();
    cache.delete(key);
  }
}

/**
 * A figure mesh with its own skeleton.
 * @param {import('./looks.js').Look} look
 * @returns {{mesh: THREE.SkinnedMesh, bones: THREE.Bone[]}}
 */
export function createFigure(look) {
  const { bones, skeleton } = createSkeleton();
  const mesh = new THREE.SkinnedMesh(acquireGeometry(look), FIGURE_MATERIAL);
  mesh.add(bones[0]);
  // The geometry is authored in the mesh's own space, so the bind matrix is the identity.
  mesh.bind(skeleton, IDENTITY);
  mesh.boundingSphere = BOUNDS.clone();
  mesh.name = 'agent-figure';
  return { mesh, bones };
}

/**
 * Swaps a figure to another look (new hat after a model switch, new crew colour), keeping its
 * skeleton and pose.
 * @param {THREE.SkinnedMesh} mesh
 * @param {string} oldKey
 * @param {import('./looks.js').Look} look
 */
export function restyleFigure(mesh, oldKey, look) {
  if (oldKey === look.key) return;
  mesh.geometry = acquireGeometry(look);
  releaseGeometry(oldKey);
}

/**
 * @param {THREE.SkinnedMesh} mesh
 * @param {string} key
 */
export function disposeFigure(mesh, key) {
  mesh.removeFromParent();
  mesh.skeleton.dispose();
  releaseGeometry(key);
}
