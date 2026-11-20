// Time-of-day maths: where the sun and moon are and what colour the sky, light and fog are at any
// hour: azure days, a long golden hour, a hot-pink dusk and violet nights. Pure (no three.js) so
// it is unit-tested in Node; lighting.js and sky.js turn these numbers into lights and uniforms.
// Colours are sRGB triplets in [0, 1].
//
// The day is stylised rather than astronomical: the sun rises at 06:00 and sets at 18:30 every day,
// so the town looks the same in winter and summer and evenings always get a golden hour.

import { LOOK } from '../../page.js';

const SUNRISE = 6;
const SUNSET = 18.5;
/** Highest sun elevation (radians). Lower than Amman's summer noon so shadows stay readable. */
const MAX_SUN_ELEVATION = (58 * Math.PI) / 180;
/** The key light never goes lower than this, so shadows stay on the plinth. */
const MIN_LIGHT_ELEVATION = (14 * Math.PI) / 180;
/** Hours when the key light switches between sun and moon (its intensity is ~0 there). */
const MOON_SETS = 5.6;
const MOON_RISES = 18.9;

/**
 * @typedef {[number, number, number]} RGB
 * @typedef {object} SkyKey
 * @property {number} h            hour of the keyframe
 * @property {string} zenith       top of the sky gradient
 * @property {string} horizon      middle of the sky gradient, also the fog colour
 * @property {string} bottom       below the floating plinth
 * @property {string} light        key light (sun or moon) colour
 * @property {number} lightI       key light intensity
 * @property {string} hemiSky
 * @property {string} hemiGround
 * @property {number} hemiI
 * @property {number} envI         image-based lighting intensity
 * @property {number} night        0 = full day, 1 = full night (windows, lamps, bloom)
 */

/** @type {readonly SkyKey[]} */
const COAST_KEYS = Object.freeze([
  { h: 0, zenith: '#140a35', horizon: '#3b1d5e', bottom: '#120b2b', light: '#b9b0ff', lightI: 0.85, hemiSky: '#5a4aa8', hemiGround: '#2c2030', hemiI: 0.8, envI: 0.35, night: 1 },
  { h: 4.6, zenith: '#150b37', horizon: '#3d1f60', bottom: '#130c2d', light: '#b9b0ff', lightI: 0.8, hemiSky: '#5a4aa8', hemiGround: '#2c2030', hemiI: 0.8, envI: 0.35, night: 1 },
  { h: 5.35, zenith: '#2a1f5e', horizon: '#8a5a9a', bottom: '#2a1f44', light: '#c4b0ff', lightI: 0.06, hemiSky: '#6a5cb0', hemiGround: '#3a2a34', hemiI: 0.75, envI: 0.32, night: 0.85 },
  { h: MOON_SETS, zenith: '#3a3f86', horizon: '#e08a9a', bottom: '#4a3a64', light: '#ffb09a', lightI: 0, hemiSky: '#7a78bc', hemiGround: '#4a3634', hemiI: 0.7, envI: 0.3, night: 0.75 },
  { h: 6.25, zenith: '#4f7fd0', horizon: '#ffb7a0', bottom: '#c4a2c0', light: '#ffb27c', lightI: 0.6, hemiSky: '#a4b8e8', hemiGround: '#9a7460', hemiI: 0.5, envI: 0.26, night: 0.35 },
  { h: 7.3, zenith: '#3d9be8', horizon: '#ffe7d2', bottom: '#d8e2ec', light: '#ffe4c8', lightI: 1.0, hemiSky: '#b6d8f6', hemiGround: '#b0946e', hemiI: 0.36, envI: 0.26, night: 0.03 },
  { h: 9, zenith: '#2f93ec', horizon: '#d9f4ff', bottom: '#d2e6f2', light: '#fff3e2', lightI: 1.15, hemiSky: '#b8e1ff', hemiGround: '#c0a684', hemiI: 0.38, envI: 0.3, night: 0 },
  { h: 12.5, zenith: '#2a8ff0', horizon: '#dff7ff', bottom: '#d4eaf5', light: '#fff7ec', lightI: 1.25, hemiSky: '#bce3ff', hemiGround: '#c4aa88', hemiI: 0.38, envI: 0.3, night: 0 },
  { h: 16, zenith: '#3392ea', horizon: '#eaf3ee', bottom: '#dbe6ea', light: '#ffefd6', lightI: 1.2, hemiSky: '#bcdcf8', hemiGround: '#c0a27e', hemiI: 0.37, envI: 0.3, night: 0 },
  { h: 17.4, zenith: '#4f7fd4', horizon: '#ffc79a', bottom: '#f0cbbd', light: '#ffbd6e', lightI: 1.35, hemiSky: '#aec4ee', hemiGround: '#b08a6a', hemiI: 0.42, envI: 0.28, night: 0.02 },
  { h: 18.2, zenith: '#5a4fb4', horizon: '#ff8f6a', bottom: '#d796a8', light: '#ff9a55', lightI: 1.1, hemiSky: '#98a8e4', hemiGround: '#86685a', hemiI: 0.46, envI: 0.25, night: 0.25 },
  { h: 18.7, zenith: '#3b2a86', horizon: '#ff5f8f', bottom: '#7a4a86', light: '#ff6a6a', lightI: 0.18, hemiSky: '#8a6cc8', hemiGround: '#5c3c44', hemiI: 0.55, envI: 0.25, night: 0.6 },
  { h: MOON_RISES, zenith: '#2e2370', horizon: '#c45a92', bottom: '#4f3a72', light: '#c8b8ff', lightI: 0, hemiSky: '#7462bc', hemiGround: '#40303a', hemiI: 0.65, envI: 0.3, night: 0.72 },
  { h: 19.6, zenith: '#1c1550', horizon: '#5a2f7e', bottom: '#24194a', light: '#b0a8ff', lightI: 0.45, hemiSky: '#5c4cb0', hemiGround: '#2e2232', hemiI: 0.75, envI: 0.32, night: 0.92 },
  { h: 20.6, zenith: '#160b38', horizon: '#3d1f60', bottom: '#140c2e', light: '#b9b0ff', lightI: 0.8, hemiSky: '#5a4aa8', hemiGround: '#2c2030', hemiI: 0.8, envI: 0.35, night: 1 },
]);

/** The limestone town's sky: softer days, a peach dusk and blue nights. @type {readonly SkyKey[]} */
const AMMAN_KEYS = Object.freeze([
  { h: 0, zenith: '#0a1430', horizon: '#22315c', bottom: '#121a33', light: '#a9bdff', lightI: 0.85, hemiSky: '#5268ab', hemiGround: '#2c2824', hemiI: 0.8, envI: 0.35, night: 1 },
  { h: 4.6, zenith: '#0b1532', horizon: '#24325e', bottom: '#131b35', light: '#a9bdff', lightI: 0.8, hemiSky: '#5268ab', hemiGround: '#2c2824', hemiI: 0.8, envI: 0.35, night: 1 },
  { h: 5.35, zenith: '#26315e', horizon: '#86708f', bottom: '#2a2a4a', light: '#b9b4ff', lightI: 0.06, hemiSky: '#6a72b0', hemiGround: '#3a2e2a', hemiI: 0.75, envI: 0.32, night: 0.85 },
  { h: MOON_SETS, zenith: '#33447a', horizon: '#c48a86', bottom: '#47405e', light: '#ffb184', lightI: 0, hemiSky: '#7a82b8', hemiGround: '#4a3a30', hemiI: 0.7, envI: 0.3, night: 0.75 },
  { h: 6.25, zenith: '#5577b8', horizon: '#ffc4a0', bottom: '#b9a6b6', light: '#ffb27c', lightI: 0.6, hemiSky: '#9cb4dd', hemiGround: '#8a6e55', hemiI: 0.5, envI: 0.26, night: 0.35 },
  { h: 7.3, zenith: '#6c9fd8', horizon: '#f3e2d0', bottom: '#d3d2d6', light: '#ffe2c2', lightI: 1.0, hemiSky: '#b9d3f0', hemiGround: '#a58e70', hemiI: 0.36, envI: 0.26, night: 0.03 },
  { h: 9, zenith: '#5f9ddd', horizon: '#e5eef2', bottom: '#d2dce4', light: '#fff3e2', lightI: 1.15, hemiSky: '#c2dbf5', hemiGround: '#b29c7c', hemiI: 0.38, envI: 0.3, night: 0 },
  { h: 12.5, zenith: '#5a9ce0', horizon: '#e9f2f5', bottom: '#d4dee6', light: '#fff9f0', lightI: 1.2, hemiSky: '#c5ddf6', hemiGround: '#b8a283', hemiI: 0.38, envI: 0.3, night: 0 },
  { h: 16, zenith: '#6098d8', horizon: '#ecebe2', bottom: '#d6dbe0', light: '#fff0da', lightI: 1.15, hemiSky: '#c2d7ef', hemiGround: '#b39a78', hemiI: 0.37, envI: 0.3, night: 0 },
  { h: 17.4, zenith: '#6b91c8', horizon: '#ffdcb2', bottom: '#e6d2c4', light: '#ffcd8c', lightI: 1.3, hemiSky: '#c0cde6', hemiGround: '#b08e68', hemiI: 0.42, envI: 0.28, night: 0.02 },
  { h: 18.2, zenith: '#5568a5', horizon: '#ffa178', bottom: '#c9a3a6', light: '#ff9a5c', lightI: 1.0, hemiSky: '#a6acd6', hemiGround: '#8e6a52', hemiI: 0.48, envI: 0.25, night: 0.25 },
  { h: 18.7, zenith: '#38457a', horizon: '#d07a7c', bottom: '#6e5a78', light: '#ff7c52', lightI: 0.18, hemiSky: '#7a7fb8', hemiGround: '#5c4436', hemiI: 0.55, envI: 0.25, night: 0.6 },
  { h: MOON_RISES, zenith: '#2c376a', horizon: '#9e6b82', bottom: '#4b4466', light: '#c4c2ff', lightI: 0, hemiSky: '#6670ad', hemiGround: '#40322c', hemiI: 0.65, envI: 0.3, night: 0.72 },
  { h: 19.6, zenith: '#18234d', horizon: '#45497a', bottom: '#202748', light: '#a9b8ff', lightI: 0.45, hemiSky: '#5568aa', hemiGround: '#2c2622', hemiI: 0.75, envI: 0.32, night: 0.92 },
  { h: 20.6, zenith: '#0c1736', horizon: '#24325e', bottom: '#141c38', light: '#a9bdff', lightI: 0.8, hemiSky: '#5268ab', hemiGround: '#2c2824', hemiI: 0.8, envI: 0.35, night: 1 },
]);

/**
 * A key with its colours pulled towards others: each entry is [field, target rgb, amount].
 * @param {SkyKey} key
 * @param {[keyof SkyKey, number[], number][]} pulls
 * @param {Partial<SkyKey>} [patch]
 * @returns {SkyKey}
 */
function tinted(key, pulls, patch = {}) {
  /** @type {any} */
  const out = { ...key };
  for (const [field, target, amount] of pulls) out[field] = rgbToHex(mixRgb(hexToRgb(/** @type {string} */ (key[field])), /** @type {RGB} */ (target), amount));
  return { ...out, ...patch };
}

/** @param {number[]} rgb @returns {string} */
function rgbToHex(rgb) {
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The sky keys of a town look (core/looks.js): the coast's, Amman's, or one of them tinted.
 * @param {import('../../core/looks.js').LookId} look
 * @returns {readonly SkyKey[]}
 */
export function skyKeysFor(look) {
  if (look === 'amman') return AMMAN_KEYS;
  if (look === 'snow') {
    // Pale winter light, snow bouncing light up from the ground.
    return Object.freeze(AMMAN_KEYS.map((k) => tinted(k, [['zenith', [0.82, 0.88, 0.95], 0.3 * (1 - k.night)], ['horizon', [0.9, 0.93, 0.97], 0.35 * (1 - k.night)], ['bottom', [0.86, 0.9, 0.95], 0.4], ['light', [1, 0.98, 0.95], 0.35], ['hemiGround', [0.8, 0.83, 0.88], 0.6]], { envI: k.envI * 1.1 })));
  }
  if (look === 'neon') {
    // A violet haze all day; the town's lights never quite switch off.
    return Object.freeze(COAST_KEYS.map((k) => tinted(k, [['zenith', [0.18, 0.07, 0.36], 0.6], ['horizon', [0.75, 0.25, 0.6], 0.45], ['bottom', [0.12, 0.06, 0.22], 0.6], ['light', [1, 0.55, 0.85], 0.4], ['hemiSky', [0.45, 0.3, 0.8], 0.4]], { lightI: k.lightI * 0.6, night: Math.max(k.night, 0.55) })));
  }
  if (look === 'desert') {
    return Object.freeze(COAST_KEYS.map((k) => tinted(k, [['horizon', [1, 0.82, 0.58], 0.3 * (1 - k.night)], ['zenith', [0.35, 0.6, 0.9], 0.2 * (1 - k.night)], ['hemiGround', [0.85, 0.65, 0.45], 0.5]])));
  }
  return COAST_KEYS;
}

/** The sky keys of the look this page was built with. */
export const SKY_KEYS = skyKeysFor(LOOK);

/**
 * Wraps any number of hours into [0, 24).
 * @param {number} hour
 */
export function normalizeHour(hour) {
  if (!Number.isFinite(hour)) return 12;
  if (hour >= 0 && hour < 24) return hour;
  return ((hour % 24) + 24) % 24;
}

/**
 * Local clock time as fractional hours.
 * @param {Date} date
 */
export function hourFromDate(date) {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

/**
 * @param {string} hex '#rrggbb'
 * @returns {RGB}
 */
export function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** @param {RGB} a @param {RGB} b @param {number} t @returns {RGB} */
function mixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * The two keyframes around an hour and the blend factor between them (wrapping at midnight).
 * @param {number} hour
 * @returns {{a: SkyKey, b: SkyKey, t: number}}
 */
export function keysAround(hour) {
  const h = normalizeHour(hour);
  for (let i = 0; i < SKY_KEYS.length; i++) {
    const a = SKY_KEYS[i];
    const next = SKY_KEYS[i + 1];
    const b = next ?? SKY_KEYS[0];
    const end = next ? next.h : 24 + SKY_KEYS[0].h;
    if (h >= a.h && h < end) return { a, b, t: (h - a.h) / (end - a.h) };
  }
  return { a: SKY_KEYS[0], b: SKY_KEYS[1], t: 0 };
}

/**
 * The sun's path is a winter arc in the southern sky (azimuth 45° → 135°, where 0° = east and
 * 90° = south), as in Amman in December, instead of east → south → west. Seen from the default
 * south-east camera the building fronts (south faces) are then lit all day and the evening sun
 * gilds them, instead of lighting the north sides the camera never sees.
 */
const SUN_AZIMUTH_START = (45 * Math.PI) / 180;
const SUN_AZIMUTH_SPAN = (90 * Math.PI) / 180;

/**
 * Sun elevation and direction for an hour. The sun rises in the south-east, stands in the south
 * at midday and sets in the south-west (see SUN_AZIMUTH_START).
 * @param {number} hour
 * @returns {{elevation: number, dir: [number, number, number]}} dir points from the town to the sun
 */
export function sunPosition(hour) {
  const h = normalizeHour(hour);
  const dayFrac = (h - SUNRISE) / (SUNSET - SUNRISE);
  const elevation = Math.sin(Math.PI * dayFrac) * MAX_SUN_ELEVATION;
  const azimuth = SUN_AZIMUTH_START + SUN_AZIMUTH_SPAN * Math.min(1, Math.max(0, dayFrac));
  return { elevation, dir: directionFrom(azimuth, elevation) };
}

/**
 * The moon crosses the southern sky towards the west during the night.
 * @param {number} hour
 * @returns {{elevation: number, dir: [number, number, number]}}
 */
export function moonPosition(hour) {
  const h = normalizeHour(hour);
  const nightLength = 24 - MOON_RISES + MOON_SETS;
  const t = (h >= MOON_RISES ? h - MOON_RISES : h + 24 - MOON_RISES) / nightLength;
  const frac = Math.min(1, Math.max(0, t));
  const elevation = (0.45 + 0.35 * Math.sin(Math.PI * frac)) * (Math.PI / 2) * 0.7;
  const azimuth = Math.PI * (0.6 + 0.45 * frac);
  return { elevation, dir: directionFrom(azimuth, elevation) };
}

/**
 * @param {number} azimuth 0 = east, π/2 = south, π = west
 * @param {number} elevation radians above the horizon
 * @returns {[number, number, number]}
 */
function directionFrom(azimuth, elevation) {
  const c = Math.cos(elevation);
  return [Math.cos(azimuth) * c, Math.sin(elevation), Math.sin(azimuth) * c];
}

/**
 * Whether the key light is the sun at this hour (otherwise the moon).
 * @param {number} hour
 */
export function isSunUp(hour) {
  const h = normalizeHour(hour);
  return h >= MOON_SETS && h < MOON_RISES;
}

/**
 * How late in the night it is: 0 until 22:00, 1 from 01:30 to 04:00, back to 0 by 05:30 as early
 * risers switch their lights on. Used to turn some windows dark in the small hours.
 * @param {number} hour
 */
export function lateness(hour) {
  const h = normalizeHour(hour);
  if (h >= 22) return smooth((h - 22) / 3.5);
  if (h < 1.5) return smooth((h + 2) / 3.5);
  if (h < 4) return 1;
  if (h < 5.5) return 1 - smooth((h - 4) / 1.5);
  return 0;
}

/** @param {number} t */
function smooth(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * @typedef {object} SkyState
 * @property {number} hour
 * @property {RGB} zenith
 * @property {RGB} horizon
 * @property {RGB} bottom
 * @property {RGB} fog
 * @property {RGB} light
 * @property {number} lightIntensity
 * @property {[number, number, number]} lightDir  unit vector from the town towards the light
 * @property {boolean} sunUp
 * @property {RGB} hemiSky
 * @property {RGB} hemiGround
 * @property {number} hemiIntensity
 * @property {number} envIntensity
 * @property {number} night       0..1
 * @property {number} late        0..1
 * @property {number} stars       0..1
 * @property {number} bloom       bloom strength
 * @property {number} bloomThreshold
 */

/**
 * Everything the renderer needs to know about the sky at an hour.
 * @param {number} hour
 * @returns {SkyState}
 */
export function skyState(hour) {
  const h = normalizeHour(hour);
  const { a, b, t } = keysAround(h);
  const lerp = (/** @type {number} */ x, /** @type {number} */ y) => x + (y - x) * t;
  const color = (/** @type {keyof SkyKey} */ k) => mixRgb(hexToRgb(/** @type {string} */ (a[k])), hexToRgb(/** @type {string} */ (b[k])), t);
  const sunUp = isSunUp(h);
  const body = sunUp ? sunPosition(h) : moonPosition(h);
  const night = lerp(a.night, b.night);
  return {
    hour: h,
    zenith: color('zenith'),
    horizon: color('horizon'),
    bottom: color('bottom'),
    fog: color('horizon'),
    light: color('light'),
    lightIntensity: lerp(a.lightI, b.lightI),
    lightDir: clampElevation(body.dir),
    sunUp,
    hemiSky: color('hemiSky'),
    hemiGround: color('hemiGround'),
    hemiIntensity: lerp(a.hemiI, b.hemiI),
    envIntensity: lerp(a.envI, b.envI),
    night,
    late: lateness(h),
    stars: smooth((night - 0.55) / 0.4),
    bloom: 0.16 + 0.5 * night,
    bloomThreshold: 0.92 - 0.2 * night,
  };
}

/**
 * Keeps the key light at least MIN_LIGHT_ELEVATION above the horizon so a low sun never throws
 * shadows across the whole plinth; the light is nearly off by then anyway.
 * @param {[number, number, number]} dir
 * @returns {[number, number, number]}
 */
export function clampElevation(dir) {
  const elevation = Math.asin(Math.min(1, Math.max(-1, dir[1])));
  if (elevation >= MIN_LIGHT_ELEVATION) return [dir[0], dir[1], dir[2]];
  const flat = Math.hypot(dir[0], dir[2]) || 1;
  const c = Math.cos(MIN_LIGHT_ELEVATION);
  return [(dir[0] / flat) * c, Math.sin(MIN_LIGHT_ELEVATION), (dir[2] / flat) * c];
}
