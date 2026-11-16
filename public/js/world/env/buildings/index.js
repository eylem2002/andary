// Builds every building on its lot and keeps a record per building: id for the shader, world
// centre and height, a root group for moving parts, the sign anchor, named effect anchors and a
// pick box. Static parts go into the shared town batch; moving parts become small meshes.
import * as THREE from 'three';
import { BUILDING_KEYS } from '../../../core/catalog.js';
import { LOTS, lotBounds, tileToWorld } from '../../layout.js';
import { GeometryBatch } from '../batch.js';
import { Kit } from '../kit.js';
import { createRng } from '../rand.js';
import { LOT_Y } from '../terrain.js';
import { buildAcademy, buildHall, buildLibrary, buildPermits } from './civic.js';
import { buildDetective, buildHarbor, buildTerminal, buildWorkshop } from './industry.js';
import { buildCafe, buildPost, buildSpa, buildStation, buildWeb } from './services.js';
import { buildBoard, buildGrove } from './grounds.js';

/** @typedef {import('../../../core/catalog.js').BuildingKey} BuildingKey */

/**
 * @typedef {object} BuildingRecord
 * @property {BuildingKey} key
 * @property {number} id
 * @property {THREE.Vector3} center      world centre of the building volume
 * @property {number} height
 * @property {THREE.Group} root          moving parts; bounces with the building
 * @property {THREE.Vector3} signAnchor
 * @property {Record<string, THREE.Vector3>} anchors  world positions, 'door' always present
 * @property {THREE.Box3} pickBox
 * @property {import('./types.js').Lot} lot
 */

/** @type {Record<BuildingKey, (kit: Kit, lot: import('./types.js').Lot, ctx: import('./types.js').BuildContext) => import('./types.js').BuildingSpec>} */
const BUILDERS = {
  hall: buildHall,
  library: buildLibrary,
  academy: buildAcademy,
  permits: buildPermits,
  workshop: buildWorkshop,
  terminal: buildTerminal,
  harbor: buildHarbor,
  detective: buildDetective,
  post: buildPost,
  web: buildWeb,
  spa: buildSpa,
  cafe: buildCafe,
  station: buildStation,
  board: buildBoard,
  grove: buildGrove,
};

/**
 * @param {BuildingKey} key
 * @param {number} id
 * @returns {import('./types.js').Lot}
 */
function lotOf(key, id) {
  const bounds = lotBounds(key);
  const door = tileToWorld(...LOTS[key].door);
  return {
    key,
    id,
    w: bounds.width,
    d: bounds.depth,
    cx: bounds.center.x,
    cz: bounds.center.z,
    doorX: door.x - bounds.center.x,
    doorZ: door.z - bounds.center.z,
  };
}

/**
 * @param {Kit} kit  the static town kit
 * @param {{scene: THREE.Object3D, materials: Record<string, THREE.Material>, town: import('../town-material.js').TownUniforms,
 *          trees: import('../trees.js').TreePlacement[], animators: Array<(dt: number, t: number) => void>}} env
 * @returns {Record<BuildingKey, BuildingRecord>}
 */
export function buildBuildings(kit, env) {
  /** @type {Record<string, BuildingRecord>} */
  const records = {};
  BUILDING_KEYS.forEach((key, index) => {
    const lot = lotOf(key, index + 1);
    const root = new THREE.Group();
    root.name = `building-${key}`;
    root.position.set(lot.cx, LOT_Y, lot.cz);
    env.scene.add(root);
    const ctx = makeContext(lot, root, env);
    kit.building = lot.id;
    kit.push(lot.cx, LOT_Y, lot.cz);
    const spec = BUILDERS[key](kit, lot, ctx);
    kit.pop();
    kit.building = 0;
    records[key] = makeRecord(lot, root, spec);
  });
  return /** @type {Record<BuildingKey, BuildingRecord>} */ (records);
}

/**
 * @param {import('./types.js').Lot} lot
 * @param {THREE.Group} root
 * @param {any} env
 * @returns {import('./types.js').BuildContext}
 */
function makeContext(lot, root, env) {
  return {
    rng: createRng(1000 + lot.id * 17),
    root,
    town: env.town,
    materials: env.materials,
    part(build) {
      const batch = new GeometryBatch(512);
      const partKit = new Kit(batch);
      partKit.building = lot.id;
      build(partKit);
      partKit.dispose();
      const mesh = new THREE.Mesh(batch.build(), env.materials.dynamic);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    },
    tree(kind, x, z, scale = 1) {
      env.trees.push({ kind, x: lot.cx + x, z: lot.cz + z, y: LOT_Y, scale });
    },
    animate(fn) {
      env.animators.push(fn);
    },
  };
}

/**
 * @param {import('./types.js').Lot} lot
 * @param {THREE.Group} root
 * @param {import('./types.js').BuildingSpec} spec
 * @returns {BuildingRecord}
 */
function makeRecord(lot, root, spec) {
  const toWorld = (/** @type {[number, number, number]} */ p) => new THREE.Vector3(lot.cx + p[0], LOT_Y + p[1], lot.cz + p[2]);
  /** @type {Record<string, THREE.Vector3>} */
  const anchors = {};
  for (const [name, p] of Object.entries(spec.anchors ?? {})) anchors[name] = toWorld(p);
  // Default anchor: just in front of the entrance, at about chest height of an agent.
  anchors.door = new THREE.Vector3(lot.cx + lot.doorX, 1, lot.cz + lot.d / 2 + 0.35);
  anchors.top = toWorld([0, spec.height + 0.3, 0]);
  const half = new THREE.Vector3(lot.w / 2 - 0.2, 0, lot.d / 2 - 0.2);
  const pickBox = new THREE.Box3(
    new THREE.Vector3(lot.cx - half.x, 0, lot.cz - half.z),
    new THREE.Vector3(lot.cx + half.x, LOT_Y + spec.height, lot.cz + half.z),
  );
  return {
    key: lot.key,
    id: lot.id,
    center: new THREE.Vector3(lot.cx, (LOT_Y + spec.height) / 2, lot.cz),
    height: spec.height,
    root,
    signAnchor: toWorld(spec.sign ?? [0, spec.height + 0.6, 0]),
    anchors,
    pickBox,
    lot,
  };
}
