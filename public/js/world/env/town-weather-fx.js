// The town's weather on screen: rain falling over the island (moved by the GPU, one draw call),
// now and then a lightning flash in a storm, and a rainbow behind the town when tests pass
// again. The sky and the fog are greyed by atmosphere.js. With reduced motion the rain is drawn
// still and there is no lightning (no flashes).
import * as THREE from 'three';
import { PLINTH } from './terrain.js';
import { STYLE } from './palette.js';

/** In the snowy look the town's rain falls as snow: short, slow, drifting flakes. */
const SNOW = STYLE.snow;

const RAIN_TOP = 16;
const RAIN_BOTTOM = -0.4;
const DROP_LENGTH = SNOW ? 0.09 : 1.3;

const RAIN_VERTEX = /* glsl */ `
attribute vec4 aDrop; // x, z, phase 0-1, rank 0-1 (drops below the intensity are shown)
attribute float aEnd;  // 0 head, 1 tail
uniform float uTime;
uniform float uIntensity;
uniform float uSpeed;
varying float vAlpha;
void main() {
  float span = ${(RAIN_TOP - RAIN_BOTTOM).toFixed(2)};
  float fall = mod(aDrop.z * span + uTime * uSpeed, span);
  float y = ${RAIN_TOP.toFixed(2)} - fall + aEnd * ${DROP_LENGTH.toFixed(2)};
  float drift = ${SNOW ? '1.0' : '0.0'} * sin(uTime * 0.8 + aDrop.z * 40.0) * 0.5;
  vec3 p = vec3(aDrop.x + aEnd * 0.25 + drift, y, aDrop.y + aEnd * 0.1 + drift * 0.6);
  vAlpha = step(aDrop.w, uIntensity) * (1.0 - aEnd * 0.85);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const RAIN_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  if (vAlpha <= 0.0) discard;
  gl_FragColor = vec4(uColor, vAlpha * uOpacity);
}`;

const RAINBOW_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const RAINBOW_FRAGMENT = /* glsl */ `
uniform float uOpacity;
varying vec2 vUv;
vec3 spectrum(float t) {
  return clamp(vec3(abs(t * 6.0 - 3.0) - 1.0, 2.0 - abs(t * 6.0 - 2.0), 2.0 - abs(t * 6.0 - 4.0)), 0.0, 1.0);
}
void main() {
  vec2 p = vec2(vUv.x - 0.5, vUv.y) * vec2(2.0, 1.0);
  float r = length(p);
  float band = (r - 0.72) / 0.2; // 0 at the inner edge, 1 at the outer
  if (band < 0.0 || band > 1.0) discard;
  float edge = smoothstep(0.0, 0.12, band) * smoothstep(1.0, 0.88, band);
  float feet = smoothstep(0.0, 0.25, vUv.y);
  gl_FragColor = vec4(spectrum(1.0 - band) * 1.15, uOpacity * edge * feet * 0.55);
}`;

/**
 * @param {object} deps
 * @param {THREE.Scene} deps.scene
 * @param {THREE.Camera} deps.camera
 * @param {(strength: number) => void} deps.flash   brightens the town for a moment
 * @param {boolean} [deps.reducedMotion]
 */
export function createTownWeatherFx({ scene, camera, flash, reducedMotion = false }) {
  const rain = createRain();
  const rainbow = createRainbow();
  const bolt = createBolt();
  scene.add(rain.mesh, rainbow.mesh, bolt);
  let reduced = reducedMotion;
  let quality = /** @type {'high'|'low'} */ ('high');
  let time = 0;
  const target = { rain: 0, rainbow: 0, storm: false, night: 0 };
  const now = { rain: 0, rainbow: 0 };
  let nextBolt = 4;
  let boltLeft = 0;

  return {
    /** @param {{ rain: number, rainbow: number, storm: boolean }} w */
    set(w) {
      target.rain = w.rain;
      target.rainbow = w.rainbow;
      target.storm = w.storm;
    },
    /** @param {number} night 0..1 */
    setNight(night) {
      target.night = night;
      if (SNOW) rain.material.uniforms.uColor.value.setRGB(1 - 0.35 * night, 1 - 0.33 * night, 1 - 0.25 * night);
      else rain.material.uniforms.uColor.value.setRGB(0.72 - 0.42 * night, 0.78 - 0.4 * night, 0.86 - 0.32 * night);
    },
    /** @param {'high'|'low'} q */
    setQuality(q) {
      quality = q;
    },
    /** @param {boolean} on */
    setReducedMotion(on) {
      reduced = on;
    },
    /** @param {number} dt */
    update(dt) {
      const ease = Math.min(1, dt * 0.8);
      now.rain += (target.rain - now.rain) * ease;
      now.rainbow += (target.rainbow - now.rainbow) * ease;
      if (!reduced) time += dt;
      const u = rain.material.uniforms;
      u.uTime.value = time;
      u.uIntensity.value = now.rain * (quality === 'low' ? 0.45 : 1);
      u.uOpacity.value = SNOW ? 0.95 - 0.3 * target.night : 0.7 - 0.3 * target.night;
      rain.mesh.visible = now.rain > 0.02;
      rainbow.material.uniforms.uOpacity.value = now.rainbow * (1 - target.night * 0.6);
      rainbow.mesh.visible = now.rainbow > 0.02;
      if (rainbow.mesh.visible) placeRainbow(rainbow.mesh, camera);
      storm(dt);
    },
    dispose() {
      scene.remove(rain.mesh, rainbow.mesh, bolt);
      rain.mesh.geometry.dispose();
      rain.material.dispose();
      rainbow.mesh.geometry.dispose();
      rainbow.material.dispose();
      bolt.geometry.dispose();
      /** @type {THREE.Material} */ (bolt.material).dispose();
    },
  };

  /** Lightning now and then in a storm: a bolt over the island edge and a flash. @param {number} dt */
  function storm(dt) {
    if (boltLeft > 0) {
      boltLeft -= dt;
      if (boltLeft <= 0) bolt.visible = false;
    }
    if (!target.storm || reduced) {
      bolt.visible = false;
      return;
    }
    nextBolt -= dt;
    if (nextBolt > 0) return;
    nextBolt = 5 + Math.random() * 8;
    const side = Math.random() < 0.5 ? PLINTH.minX + 4 + Math.random() * 10 : PLINTH.maxX - 4 - Math.random() * 10;
    bolt.position.set(side, 10, PLINTH.minZ + 6 + Math.random() * 40);
    bolt.rotation.y = Math.random() * Math.PI;
    bolt.visible = true;
    boltLeft = 0.16;
    flash(1);
  }
}

function createRain() {
  const count = 2600;
  const drops = new Float32Array(count * 2 * 4);
  const ends = new Float32Array(count * 2);
  const positions = new Float32Array(count * 2 * 3);
  for (let i = 0; i < count; i++) {
    const x = PLINTH.minX + Math.random() * (PLINTH.maxX - PLINTH.minX);
    const z = PLINTH.minZ + Math.random() * (PLINTH.maxZ - PLINTH.minZ);
    const phase = Math.random();
    const rank = Math.random();
    for (let end = 0; end < 2; end++) {
      drops.set([x, z, phase, rank], (i * 2 + end) * 4);
      ends[i * 2 + end] = end;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aDrop', new THREE.BufferAttribute(drops, 4));
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 8, -5), 50);
  const material = new THREE.ShaderMaterial({
    vertexShader: RAIN_VERTEX,
    fragmentShader: RAIN_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uSpeed: { value: SNOW ? 2.2 : 14 },
      uOpacity: { value: 0.55 },
      uColor: { value: new THREE.Color(0.72, 0.78, 0.86) },
    },
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.LineSegments(geometry, material);
  mesh.name = 'town-rain';
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 5;
  return { mesh, material };
}

function createRainbow() {
  const material = new THREE.ShaderMaterial({
    vertexShader: RAINBOW_VERTEX,
    fragmentShader: RAINBOW_FRAGMENT,
    uniforms: { uOpacity: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5).translate(0, 0.25, 0), material);
  mesh.name = 'town-rainbow';
  mesh.scale.set(110, 110, 1);
  mesh.visible = false;
  mesh.renderOrder = -1;
  return { mesh, material };
}

/** Behind the town as seen from the camera, standing on the sea's horizon, facing the viewer. */
function placeRainbow(/** @type {THREE.Mesh} */ mesh, /** @type {THREE.Camera} */ camera) {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();
  mesh.position.set(forward.x * 60, -34, -5 + forward.z * 60);
  mesh.lookAt(mesh.position.x - forward.x, mesh.position.y, mesh.position.z - forward.z);
}

function createBolt() {
  const shape = [
    [0, 0, 0.6, -2.4],
    [0.6, -2.4, -0.5, -4.6],
    [-0.5, -4.6, 0.4, -7.2],
    [0.4, -7.2, -0.3, -9.6],
  ];
  const points = shape.flatMap(([x0, y0, x1, y1]) => [new THREE.Vector3(x0, y0, 0), new THREE.Vector3(x1, y1, 0)]);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const bolt = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: new THREE.Color(3, 3, 4), toneMapped: false, fog: false }));
  bolt.name = 'town-lightning';
  bolt.visible = false;
  return bolt;
}
