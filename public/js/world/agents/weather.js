// Personal weather: a little rain cloud that follows an agent around (a failing streak), or a
// storm cloud with lightning. Clouds share geometry and materials; raindrops are particles in the
// shared 'drop' field, spawned without allocating.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CURVE, spawnSpec } from './particles.js';
import { damp } from './easing.js';

const CLOUD_HEIGHT = 0.35; // above the name pill
const DROP_SPEED = 4.5;

function cloudGeometry() {
  const puffs = [
    [0, 0, 0, 0.26],
    [0.24, -0.04, 0.02, 0.2],
    [-0.24, -0.05, -0.02, 0.2],
    [0.1, 0.12, -0.05, 0.19],
    [-0.1, 0.1, 0.06, 0.18],
  ].map(([x, y, z, r]) => {
    const g = new THREE.IcosahedronGeometry(r, 1).translate(x, y, z);
    g.deleteAttribute('uv');
    return g;
  });
  const merged = mergeGeometries(puffs, false);
  for (const g of puffs) g.dispose();
  merged.scale(1.3, 0.95, 1.1);
  return merged;
}

/** A zig-zag lightning bolt, top at y = 0, about 1 unit long. */
function boltGeometry() {
  const segments = [
    [0, 0, 0.05, -0.32, 0.3],
    [0.06, -0.3, -0.06, -0.62, -0.35],
    [-0.04, -0.6, 0.04, -0.95, 0.25],
  ].map(([x0, y0, x1, y1, tilt]) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    return new THREE.BoxGeometry(0.05, len, 0.02).rotateZ(tilt * 0.5).translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
  });
  const merged = mergeGeometries(segments, false);
  for (const g of segments) g.dispose();
  return merged;
}

/**
 * @param {THREE.Scene} scene
 * @param {import('./particles.js').ParticleField} drops
 */
export function createWeather(scene, drops) {
  const geometry = cloudGeometry();
  const bolt = boltGeometry();
  const rainMaterial = new THREE.MeshStandardMaterial({ color: '#C6CED8', roughness: 1 });
  const stormMaterial = new THREE.MeshStandardMaterial({ color: '#5F6773', roughness: 1 });
  const flashMaterial = new THREE.MeshBasicMaterial({ color: '#FFFBE6', toneMapped: false });
  const boltMaterial = new THREE.MeshBasicMaterial({ color: '#FFE45C', toneMapped: false });
  /** @type {Map<string, {cloud: THREE.Mesh, bolt: THREE.Mesh, kind: string, acc: number, nextFlash: number, flash: number}>} */
  const clouds = new Map();
  let reducedMotion = false;

  /** @param {string} id */
  function remove(id) {
    const c = clouds.get(id);
    if (!c) return;
    c.cloud.removeFromParent();
    c.bolt.removeFromParent();
    clouds.delete(id);
  }

  /** @param {string} id @param {'rain'|'storm'|null} kind @param {THREE.Vector3} top */
  function set(id, kind, top) {
    if (kind !== 'rain' && kind !== 'storm') {
      remove(id);
      return;
    }
    let c = clouds.get(id);
    if (!c) {
      const cloud = new THREE.Mesh(geometry, rainMaterial);
      cloud.position.set(top.x, top.y + CLOUD_HEIGHT + 0.6, top.z); // drifts down into place
      const boltMesh = new THREE.Mesh(bolt, boltMaterial);
      boltMesh.visible = false;
      scene.add(cloud, boltMesh);
      c = { cloud, bolt: boltMesh, kind, acc: 0, nextFlash: 1 + Math.random() * 2, flash: 0 };
      clouds.set(id, c);
    }
    c.kind = kind;
    c.cloud.material = kind === 'storm' ? stormMaterial : rainMaterial;
  }

  /** Spawns raindrops under a cloud. @param {THREE.Vector3} p cloud position @param {number} ground @param {number} n */
  function rain(p, ground, n) {
    for (let i = 0; i < n; i++) {
      const s = spawnSpec();
      s.x = p.x + (Math.random() - 0.5) * 0.75;
      s.z = p.z + (Math.random() - 0.5) * 0.55;
      s.y = p.y - 0.12;
      s.vy = -DROP_SPEED;
      s.life = Math.max(0.05, (s.y - ground) / DROP_SPEED);
      s.size = 1;
      s.curve = CURVE.CONST;
      drops.spawn(s);
    }
  }

  /** Lightning for storms: a bolt and a white flash of the cloud now and then. */
  function lightning(c, dt, ground) {
    c.nextFlash -= dt;
    if (c.nextFlash <= 0 && !reducedMotion) {
      c.flash = 0.16;
      c.nextFlash = 2.2 + Math.random() * 2.8;
      c.bolt.rotation.y = Math.random() * Math.PI;
    }
    c.flash = Math.max(0, c.flash - dt);
    const lit = c.flash > 0 && c.flash % 0.08 > 0.025; // flicker
    c.cloud.material = lit ? flashMaterial : stormMaterial;
    c.bolt.visible = lit;
    if (lit) {
      const h = Math.max(0.3, c.cloud.position.y - 0.15 - ground);
      c.bolt.position.set(c.cloud.position.x, c.cloud.position.y - 0.15, c.cloud.position.z);
      c.bolt.scale.set(1, h, 1);
    }
  }

  // Per-frame inputs for updateCloud, kept in closure variables so the Map.forEach callback is
  // created once rather than every frame.
  let frameDt = 0;
  let frameTime = 0;
  let frameLift = 0;
  /** @type {(id: string) => THREE.Vector3|null} */
  let frameTopOf = () => null;

  /** @param {{cloud: THREE.Mesh, bolt: THREE.Mesh, kind: string, acc: number, nextFlash: number, flash: number}} c @param {string} id */
  function updateCloud(c, id) {
    const top = frameTopOf(id);
    if (!top) return;
    const k = damp(6, frameDt); // trails behind a walking agent a little
    const p = c.cloud.position;
    p.x += (top.x - p.x) * k;
    p.z += (top.z - p.z) * k;
    p.y += (top.y + frameLift + CLOUD_HEIGHT + 0.05 * Math.sin(frameTime * 2 + top.x) - p.y) * k;
    c.cloud.rotation.y = 0.2 * Math.sin(frameTime * 0.7);
    c.acc += frameDt * (c.kind === 'storm' ? 40 : 26);
    const n = Math.floor(c.acc);
    c.acc -= n;
    rain(p, 0, n);
    if (c.kind === 'storm') lightning(c, frameDt, 0);
  }

  return {
    set,
    remove,
    /**
     * @param {number} dt
     * @param {number} time seconds
     * @param {(id: string) => THREE.Vector3|null} topOf head-top position of an agent
     * @param {number} lift world height of a name pill, which the cloud floats above
     */
    update(dt, time, topOf, lift) {
      frameDt = dt;
      frameTime = time;
      frameLift = lift;
      frameTopOf = topOf;
      clouds.forEach(updateCloud);
    },
    /** @param {boolean} on */
    setReducedMotion(on) {
      reducedMotion = on;
    },
    dispose() {
      for (const id of [...clouds.keys()]) remove(id);
      geometry.dispose();
      bolt.dispose();
      for (const m of [rainMaterial, stormMaterial, flashMaterial, boltMaterial]) m.dispose();
    },
  };
}
