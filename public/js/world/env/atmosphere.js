// Applies the time of day to everything that depends on it: key and fill lights, sky gradient,
// fog, reflections, window and lamp glow, bloom and exposure. 'auto' follows the local clock,
// checked once a second and applied when the minute changes.
import * as THREE from 'three';
import { hourFromDate, normalizeHour, skyState } from './daynight.js';
import { CAMERA_DISTANCE } from './camera-rig.js';

/** Re-render the reflection environment at most this often, and only after real sky changes. */
const ENV_MIN_INTERVAL_MS = 400;
const ENV_HOUR_STEP = 0.2;

/**
 * @param {number[]} rgb sRGB triplet
 * @param {THREE.Color} out
 */
function toColor(rgb, out) {
  return out.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
}

/**
 * @param {object} deps
 * @param {THREE.WebGLRenderer} deps.renderer
 * @param {THREE.Scene} deps.scene
 * @param {ReturnType<typeof import('./lighting.js').createLighting>} deps.lighting
 * @param {THREE.Mesh & {material: THREE.ShaderMaterial}} deps.backdrop
 * @param {ReturnType<typeof import('./sky.js').createSkyEnvironment>} deps.skyEnv
 * @param {import('./town-material.js').TownUniforms} deps.town
 * @param {ReturnType<typeof import('./post.js').createPost>} deps.post
 * @param {(state: import('./daynight.js').SkyState) => void} [deps.onChange]
 * @param {number|'auto'} [initial]
 */
export function createAtmosphere(deps, initial = 'auto') {
  const { scene, lighting, backdrop, skyEnv, town, post } = deps;
  const fog = new THREE.Fog(0xffffff, CAMERA_DISTANCE + 25, CAMERA_DISTANCE + 230);
  scene.fog = fog;
  /** @type {number|'auto'} */
  let mode = initial;
  let hour = 12;
  let envHour = Number.NaN;
  let envDue = true;
  let envStamp = -Infinity;
  let clockCheck = 0;
  const uniforms = backdrop.material.uniforms;
  const envUniforms = skyEnv.material.uniforms;

  /** @param {number} h */
  function apply(h) {
    hour = normalizeHour(h);
    const state = skyState(hour);
    lighting.apply(state, toColor);
    toColor(state.zenith, uniforms.uZenith.value);
    toColor(state.horizon, uniforms.uHorizon.value);
    toColor(state.bottom, uniforms.uBottom.value);
    uniforms.uStars.value = state.stars;
    toColor(state.fog, fog.color);
    town.uTtNight.value = state.night;
    town.uTtLate.value = state.late;
    post.setBloom(state.bloom, state.bloomThreshold);
    post.setGrade(state.night);
    scene.environmentIntensity = state.envIntensity;
    toColor(state.zenith, envUniforms.uZenith.value);
    toColor(state.horizon, envUniforms.uHorizon.value);
    toColor(state.hemiGround, envUniforms.uGround.value);
    toColor(state.light, envUniforms.uSun.value).multiplyScalar(state.sunUp ? state.lightIntensity * 0.35 : 0.08);
    envUniforms.uSunDir.value.set(...state.lightDir);
    if (!(Math.abs(hourDelta(envHour, hour)) < ENV_HOUR_STEP)) envDue = true;
    deps.onChange?.(state);
  }

  function refreshEnvironment() {
    const now = performance.now();
    if (!envDue || now - envStamp < ENV_MIN_INTERVAL_MS) return;
    envDue = false;
    envStamp = now;
    envHour = hour;
    scene.environment = skyEnv.update();
  }

  apply(mode === 'auto' ? hourFromDate(new Date()) : mode);

  return {
    /** @param {number|'auto'} h */
    set(h) {
      mode = h === 'auto' ? 'auto' : normalizeHour(Number(h));
      apply(mode === 'auto' ? hourFromDate(new Date()) : mode);
    },
    get hour() {
      return hour;
    },
    get mode() {
      return mode;
    },
    /** @param {number} dt */
    update(dt) {
      if (mode === 'auto') {
        clockCheck += dt;
        if (clockCheck >= 1) {
          clockCheck = 0;
          const now = hourFromDate(new Date());
          if (Math.abs(hourDelta(hour, now)) >= 1 / 60) apply(now);
        }
      }
      refreshEnvironment();
    },
    dispose() {
      scene.fog = null;
      scene.environment = null;
      skyEnv.dispose();
    },
  };
}

/** Signed shortest difference between two hours on a 24 h clock. */
function hourDelta(a, b) {
  let d = (b - a) % 24;
  if (d > 12) d -= 24;
  if (d < -12) d += 24;
  return d;
}
