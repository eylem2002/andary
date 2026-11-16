// Building feedback: a highlight (warm emissive lift and rim, in the town shader) and a pulse
// (squash-and-stretch bounce plus a coloured ring expanding on the ground). The static buildings
// bounce in the vertex shader; their moving parts bounce with their root group.
import * as THREE from 'three';
import { damp } from './camera-math.js';
import { LOT_Y } from './terrain.js';

const RING_SECONDS = 1.2;
const BOUNCE_SECONDS = 1.1;
const DEFAULT_COLOR = '#ffc94a';
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * @param {object} deps
 * @param {THREE.Scene} deps.scene
 * @param {import('./town-material.js').TownUniforms} deps.town
 * @param {Record<string, import('./buildings/index.js').BuildingRecord>} deps.records
 * @param {boolean} deps.reducedMotion
 */
export function createBuildingFx({ scene, town, records, reducedMotion }) {
  let reduced = reducedMotion;
  const states = town.uTtBState.value;
  for (const r of Object.values(records)) town.uTtBCenter.value[r.id].set(r.lot.cx, LOT_Y, r.lot.cz);
  const list = Object.values(records);
  /** highlight target per record (same order as list) */
  const highlightTarget = new Float32Array(list.length);
  /** seconds since each record's bounce started; < 0 = not bouncing */
  const bounceT = new Float32Array(list.length).fill(-1);
  const rings = createRings(scene);

  return {
    /** @param {string|null} key */
    highlight(key) {
      list.forEach((r, i) => {
        highlightTarget[i] = r.key === key ? 1 : 0;
      });
    },
    /** @param {string} key @param {string} [color] */
    pulse(key, color) {
      const i = list.findIndex((r) => r.key === key);
      if (i < 0) return;
      if (!reduced) bounceT[i] = 0;
      rings.start(list[i], HEX.test(color ?? '') ? color : DEFAULT_COLOR, reduced);
    },
    /** @param {number} dt */
    update(dt) {
      for (let i = 0; i < list.length; i++) {
        const s = states[list[i].id];
        const target = highlightTarget[i];
        if (s.y !== target) s.y = Math.abs(s.y - target) < 0.002 ? target : damp(s.y, target, 12, dt);
        if (bounceT[i] < 0) continue;
        bounceT[i] += dt;
        const done = bounceT[i] >= BOUNCE_SECONDS;
        const b = done ? 0 : bounceAt(bounceT[i]);
        s.x = b;
        list[i].root.scale.set(1 - 0.5 * b, 1 + b, 1 - 0.5 * b);
        if (done) bounceT[i] = -1;
      }
      rings.update(dt);
    },
    /** @param {boolean} on */
    setReducedMotion(on) {
      reduced = on;
    },
    dispose() {
      rings.dispose();
    },
  };
}

/**
 * Damped spring: stretch up first, then a smaller squash, settling within a second.
 * @param {number} t seconds
 */
export function bounceAt(t) {
  return 0.11 * Math.sin(t * Math.PI * 3.6) * Math.exp(-t * 3.8);
}

/**
 * A small pool of ground rings, reused round-robin.
 * @param {THREE.Scene} scene
 */
function createRings(scene) {
  const geometry = new THREE.RingGeometry(0.86, 1, 64).rotateX(-Math.PI / 2);
  const pool = Array.from({ length: 4 }, () => {
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false, fog: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'pulse-ring';
    mesh.visible = false;
    mesh.renderOrder = 3;
    scene.add(mesh);
    return { mesh, material, t: RING_SECONDS, radius: 1, still: false };
  });
  let next = 0;
  return {
    /**
     * @param {import('./buildings/index.js').BuildingRecord} record
     * @param {string} color
     * @param {boolean} still  reduced motion: fade without expanding
     */
    start(record, color, still) {
      const ring = pool[next];
      next = (next + 1) % pool.length;
      ring.material.color.set(color);
      ring.radius = Math.max(record.lot.w, record.lot.d) * 0.5;
      ring.mesh.position.set(record.lot.cx, 0.05, record.lot.cz);
      ring.t = 0;
      ring.still = still;
      ring.mesh.visible = true;
    },
    /** @param {number} dt */
    update(dt) {
      for (const ring of pool) {
        if (ring.t >= RING_SECONDS) continue;
        ring.t = Math.min(RING_SECONDS, ring.t + dt);
        const k = ring.t / RING_SECONDS;
        const s = ring.radius * (ring.still ? 1.05 : 0.75 + 0.55 * (1 - (1 - k) * (1 - k)));
        ring.mesh.scale.set(s, 1, s);
        ring.material.opacity = 0.9 * (1 - k);
        if (ring.t >= RING_SECONDS) ring.mesh.visible = false;
      }
    },
    dispose() {
      for (const ring of pool) {
        scene.remove(ring.mesh);
        ring.material.dispose();
      }
      geometry.dispose();
    },
  };
}
