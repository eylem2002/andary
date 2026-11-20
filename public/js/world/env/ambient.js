// Ambient life: cotton-ball clouds drifting around and below the floating plinth, an occasional flock of
// gulls, smoke from the chimneys and steam from the spa and the café's giant cup. All allocation-
// free per frame; reduced motion slows everything and keeps the birds away.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GeometryBatch } from './batch.js';
import { Kit } from './kit.js';
import { createRng, range } from './rand.js';

const MAX_PUFFS = 180;

/**
 * @param {{scene: THREE.Scene, town: import('./town-material.js').TownUniforms, material: THREE.Material,
 *          records: Record<string, import('./buildings/index.js').BuildingRecord>, reducedMotion: boolean}} deps
 */
export function createAmbient({ scene, town, material, records, reducedMotion }) {
  let reduced = reducedMotion;
  const clouds = createClouds(scene);
  const birds = createBirds(scene, material);
  const puffs = createPuffs(scene, town, emittersFrom(records));
  return {
    /** @param {number} dt @param {number} elapsed */
    update(dt, elapsed) {
      clouds.update(dt * (reduced ? 0.4 : 1), town.uTtNight.value);
      birds.update(dt, reduced);
      puffs.update(dt, elapsed, reduced);
    },
    /** @param {boolean} on */
    setReducedMotion(on) {
      reduced = on;
    },
    dispose() {
      clouds.dispose();
      birds.dispose();
      puffs.dispose();
    },
  };
}

/**
 * Puffy clouds made of merged spheres, floating beside and below the plinth (never over the town,
 * so they don't hide the agents).
 * @param {THREE.Scene} scene
 */
function createClouds(scene) {
  const rng = createRng(21);
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const r = range(rng, 0.55, 1.0);
    const g = new THREE.IcosahedronGeometry(r, 2);
    g.translate(range(rng, -1.3, 1.3), range(rng, -0.1, 0.35) * r, range(rng, -0.5, 0.5));
    parts.push(g.deleteAttribute('uv'));
  }
  const geometry = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xc8d4e6, emissiveIntensity: 0.35, fog: false });
  material.name = 'clouds';
  // Every cloud floats below the town's ground level, so from any camera angle it can sit
  // in front of the plinth's sides or the sky, but never in front of the streets.
  const spots = [
    [-34, -5.5, 6, 3.2], [33, -7, -10, 3.6], [-30, -8.5, -26, 2.6], [32, -3.2, 18, 2.4],
    [-36, -3.5, -14, 2.8], [6, -12, 38, 3.4], [-12, -7.5, -46, 3.0], [26, -10, 34, 2.2],
  ];
  const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
  mesh.name = 'clouds';
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const offsets = spots.map((_, i) => i * 7.3);
  scene.add(mesh);
  let t = 0;
  return {
    /** @param {number} dt @param {number} night */
    update(dt, night) {
      t += dt;
      material.emissiveIntensity = 0.35 * (1 - night) + 0.06;
      // Moonlit clouds stay soft and dim instead of glowing white.
      material.color.setScalar(1 - 0.55 * night);
      for (let i = 0; i < spots.length; i++) {
        const [x, y, z, scale] = spots[i];
        // Drift slowly east and wrap around the plinth.
        const drift = ((x + 46 + (t + offsets[i]) * 0.35) % 92) - 46;
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, i * 1.7);
        mesh.setMatrixAt(i, m.compose(p.set(drift, y, z), q, s.set(scale, scale * 0.6, scale)));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * A small V of gulls that crosses the town every minute or so.
 * @param {THREE.Scene} scene
 * @param {THREE.Material} material
 */
function createBirds(scene, material) {
  const batch = new GeometryBatch(64);
  const kit = new Kit(batch);
  kit.box([0, -0.03, 0], [0.22, 0.06, 0.07], 0xf4f4f0);
  kit.beam([0, 0, 0], [0.02, 0.12, 0.3], 0.03, 0xe8eaec);
  kit.beam([0, 0, 0], [0.02, 0.12, -0.3], 0.03, 0xe8eaec);
  kit.box([0.12, -0.02, 0], [0.06, 0.03, 0.03], 0xf2b544);
  kit.dispose();
  const count = 6;
  const mesh = new THREE.InstancedMesh(batch.build(), material, count);
  mesh.name = 'birds';
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  const rng = createRng(3);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const flight = { t: 0, wait: 12, from: new THREE.Vector3(), dir: new THREE.Vector3(), yaw: 0 };

  function launch() {
    const angle = range(rng, -0.6, 0.6) + (rng() < 0.5 ? 0 : Math.PI);
    flight.dir.set(Math.cos(angle), 0, Math.sin(angle) * 0.6).normalize();
    flight.from.set(-flight.dir.x * 42, range(rng, 8.5, 11), range(rng, -16, 10) - flight.dir.z * 30);
    flight.yaw = Math.atan2(-flight.dir.z, flight.dir.x);
    flight.t = 0;
    mesh.visible = true;
  }

  return {
    /** @param {number} dt @param {boolean} calm */
    update(dt, calm) {
      if (!mesh.visible) {
        flight.wait -= dt;
        if (flight.wait <= 0 && !calm) launch();
        return;
      }
      flight.t += dt;
      const travel = flight.t * 5.5;
      for (let i = 0; i < count; i++) {
        const row = Math.ceil(i / 2);
        const side = i % 2 ? 1 : -1;
        const back = row * 0.7;
        const lateral = side * row * 0.55;
        p.copy(flight.from).addScaledVector(flight.dir, travel - back);
        p.x += -flight.dir.z * lateral;
        p.z += flight.dir.x * lateral;
        p.y += Math.sin(flight.t * 0.9 + i) * 0.25;
        const flap = Math.sin(flight.t * 11 + i * 0.7);
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, flight.yaw);
        mesh.setMatrixAt(i, m.compose(p, q, s.set(1.4, 1.4 * flap, 1.4)));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (travel > 90) {
        mesh.visible = false;
        flight.wait = range(rng, 35, 80);
      }
    },
    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
    },
  };
}

/**
 * @typedef {object} Emitter
 * @property {THREE.Vector3} at
 * @property {number} rate     puffs per second
 * @property {number} size
 * @property {number} rise     upward speed
 * @property {number} life     seconds
 * @property {number} steam    0 = grey smoke, 1 = white steam
 * @property {number} carry    fractional puffs owed
 */

/**
 * @param {Record<string, import('./buildings/index.js').BuildingRecord>} records
 * @returns {Emitter[]}
 */
function emittersFrom(records) {
  const at = (/** @type {string} */ key, /** @type {string} */ name, dx = 0, dy = 0, dz = 0) => records[key].anchors[name].clone().add(new THREE.Vector3(dx, dy, dz));
  return [
    { at: at('terminal', 'chimney', 0, 0.1), rate: 5, size: 0.9, rise: 1.3, life: 4.2, steam: 0.15, carry: 0 },
    { at: at('terminal', 'chimney', 0, -1.15, 2.2), rate: 4, size: 0.8, rise: 1.2, life: 3.8, steam: 0.15, carry: 0 },
    { at: at('workshop', 'chimney', 0, 0.05), rate: 2.2, size: 0.55, rise: 0.9, life: 3, steam: 0.3, carry: 0 },
    { at: at('spa', 'steam', 0, 0.1), rate: 3, size: 0.55, rise: 0.7, life: 2.8, steam: 1, carry: 0 },
    { at: at('spa', 'steam', 5.2, 0.1), rate: 3, size: 0.55, rise: 0.7, life: 2.8, steam: 1, carry: 0 },
    { at: at('spa', 'pool', 0, -0.2), rate: 2, size: 0.9, rise: 0.25, life: 3.5, steam: 1, carry: 0 },
    { at: at('cafe', 'cup', 0, 0.05), rate: 1.6, size: 0.45, rise: 0.6, life: 2.6, steam: 1, carry: 0 },
  ];
}

const PUFF_VERTEX = /* glsl */ `
attribute vec3 iOffset;
attribute vec3 iData;
varying vec2 vUv;
varying float vAlpha;
varying float vSteam;
void main() {
  vUv = uv;
  vAlpha = iData.y;
  vSteam = iData.z;
  vec4 mv = modelViewMatrix * vec4( iOffset, 1.0 );
  mv.xy += position.xy * iData.x;
  gl_Position = projectionMatrix * mv;
}`;

const PUFF_FRAGMENT = /* glsl */ `
uniform float uTtNight;
varying vec2 vUv;
varying float vAlpha;
varying float vSteam;
void main() {
  vec2 d = vUv - 0.5;
  float r = length( d );
  float a = smoothstep( 0.5, 0.1, r ) * vAlpha;
  if ( a < 0.01 ) discard;
  vec3 smoke = vec3( 0.62, 0.62, 0.64 );
  vec3 steam = vec3( 0.97, 0.98, 1.0 );
  vec3 col = mix( smoke, steam, vSteam ) * mix( 1.0, 0.32, uTtNight );
  gl_FragColor = vec4( col * ( 0.85 + 0.3 * ( 0.5 - d.y ) ), a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Camera-facing soft puffs, one draw call for all smoke and steam.
 * @param {THREE.Scene} scene
 * @param {import('./town-material.js').TownUniforms} town
 * @param {Emitter[]} emitters
 */
function createPuffs(scene, town, emitters) {
  const geometry = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  geometry.setAttribute('uv', quad.getAttribute('uv'));
  const offsets = new Float32Array(MAX_PUFFS * 3);
  const data = new Float32Array(MAX_PUFFS * 3);
  const offsetAttr = new THREE.InstancedBufferAttribute(offsets, 3).setUsage(THREE.DynamicDrawUsage);
  const dataAttr = new THREE.InstancedBufferAttribute(data, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('iOffset', offsetAttr);
  geometry.setAttribute('iData', dataAttr);
  geometry.instanceCount = MAX_PUFFS;
  const material = new THREE.ShaderMaterial({
    name: 'puffs',
    uniforms: { uTtNight: town.uTtNight },
    vertexShader: PUFF_VERTEX,
    fragmentShader: PUFF_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'puffs';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  scene.add(mesh);
  const age = new Float32Array(MAX_PUFFS).fill(1e9);
  const life = new Float32Array(MAX_PUFFS).fill(1);
  const size = new Float32Array(MAX_PUFFS);
  const rise = new Float32Array(MAX_PUFFS);
  const steam = new Float32Array(MAX_PUFFS);
  const seed = new Float32Array(MAX_PUFFS);
  let next = 0;

  /** @param {Emitter} e */
  function spawn(e) {
    const i = next;
    next = (next + 1) % MAX_PUFFS;
    age[i] = 0;
    life[i] = e.life * (0.8 + Math.random() * 0.4);
    size[i] = e.size * (0.8 + Math.random() * 0.4);
    rise[i] = e.rise;
    steam[i] = e.steam;
    seed[i] = Math.random() * 10;
    offsets[i * 3] = e.at.x + (Math.random() - 0.5) * 0.2;
    offsets[i * 3 + 1] = e.at.y;
    offsets[i * 3 + 2] = e.at.z + (Math.random() - 0.5) * 0.2;
  }

  return {
    /** @param {number} dt @param {number} elapsed @param {boolean} calm */
    update(dt, elapsed, calm) {
      const rateScale = calm ? 0.35 : 1;
      for (const e of emitters) {
        e.carry += e.rate * rateScale * dt;
        while (e.carry >= 1) {
          e.carry -= 1;
          spawn(e);
        }
      }
      const speed = calm ? 0.5 : 1;
      for (let i = 0; i < MAX_PUFFS; i++) {
        if (age[i] >= life[i]) {
          data[i * 3 + 1] = 0;
          continue;
        }
        age[i] += dt;
        const k = age[i] / life[i];
        offsets[i * 3] += (0.35 + Math.sin(elapsed * 0.7 + seed[i]) * 0.15) * dt * speed;
        offsets[i * 3 + 1] += rise[i] * (1 - k * 0.5) * dt * speed;
        offsets[i * 3 + 2] += 0.12 * dt * speed;
        data[i * 3] = size[i] * (0.45 + k * 1.4);
        data[i * 3 + 1] = Math.min(1, k * 5) * (1 - k) * 0.75;
        data[i * 3 + 2] = steam[i];
      }
      offsetAttr.needsUpdate = true;
      dataAttr.needsUpdate = true;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      quad.dispose();
      material.dispose();
    },
  };
}
