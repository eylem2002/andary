// Applies the time of day to everything that depends on it: key and fill lights, sky gradient,
// fog, reflections, window and lamp glow, bloom and exposure. 'auto' follows the local clock,
// checked once a second and applied when the minute changes.
import * as THREE from 'three';
import { hourFromDate, normalizeHour, skyState } from './daynight.js';
import { CAMERA_DISTANCE } from './camera-rig.js';
import { weatherSky } from './weather-sky.js';

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
  const FOG_NEAR = CAMERA_DISTANCE + 25;
  const FOG_FAR = CAMERA_DISTANCE + 230;
  const fog = new THREE.Fog(0xffffff, FOG_NEAR, FOG_FAR);
  /** Town weather, eased towards `target` so the sky never jumps. */
  const weather = { overcast: 0, fog: 0 };
  const target = { overcast: 0, fog: 0 };
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
    const state = weatherSky(skyState(hour), weather);
    fog.near = FOG_NEAR * Math.max(0.15, state.fogScale);
    fog.far = FOG_NEAR + (FOG_FAR - FOG_NEAR) * Math.max(0.12, state.fogScale);
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

  /** Moves the weather a little towards its target each frame; re-applies the sky when it moved. @param {number} dt */
  function easeWeather(dt) {
    const step = Math.min(1, dt * 0.6);
    let moved = false;
    for (const k of /** @type {const} */ (['overcast', 'fog'])) {
      const next = Math.abs(target[k] - weather[k]) < 0.004 ? target[k] : weather[k] + (target[k] - weather[k]) * step;
      if (next !== weather[k]) {
        weather[k] = next;
        moved = true;
      }
    }
    if (moved) apply(hour);
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
    /** @param {{ overcast: number, fog: number }} w */
    setWeather(w) {
      target.overcast = w.overcast;
      target.fog = w.fog;
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
      easeWeather(dt);
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
