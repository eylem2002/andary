// Small, allocation-free math helpers shared by the character code. Pure functions only, so the
// animation curves can be unit-tested in Node without three.js.

export const TAU = Math.PI * 2;

/** @param {number} v */
export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** @param {number} v @param {number} lo @param {number} hi */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** @param {number} a @param {number} b @param {number} t */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Hermite smoothstep between edges a and b. @param {number} a @param {number} b @param {number} v */
export function smoothstep(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** @param {number} t 0..1 */
export function easeInOutCubic(t) {
  const u = clamp01(t);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

/** @param {number} t 0..1 */
export function easeOutCubic(t) {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

/** @param {number} t 0..1 */
export function easeInCubic(t) {
  const u = clamp01(t);
  return u * u * u;
}

/**
 * Overshoots past 1 and settles back: the "pop" used when things appear.
 * @param {number} t 0..1
 */
export function easeOutBack(t) {
  const u = clamp01(t) - 1;
  const s = 1.70158;
  return 1 + (s + 1) * u * u * u + s * u * u;
}

/**
 * 0 outside [a, b], 1 inside, with soft shoulders of width `soft` (a "window" over a cycle).
 * @param {number} v @param {number} a @param {number} b @param {number} [soft]
 */
export function windowed(v, a, b, soft = 0.06) {
  return smoothstep(a, a + soft, v) * (1 - smoothstep(b - soft, b, v));
}

/**
 * Frame-rate independent exponential smoothing factor: lerp(current, target, damp(k, dt)).
 * @param {number} lambda  higher is snappier
 * @param {number} dt seconds
 */
export function damp(lambda, dt) {
  return 1 - Math.exp(-lambda * dt);
}

/** Wraps an angle to (-PI, PI]. @param {number} a */
export function wrapAngle(a) {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  else if (r <= -Math.PI) r += TAU;
  return r;
}

/**
 * Turns `from` toward `to` along the shorter arc by at most `maxStep` radians.
 * @param {number} from @param {number} to @param {number} maxStep
 */
export function turnToward(from, to, maxStep) {
  const diff = wrapAngle(to - from);
  if (Math.abs(diff) <= maxStep) return to;
  return from + Math.sign(diff) * maxStep;
}

/**
 * True when a periodic tick at `offset + k * period` falls in (t0, t1]. Used for one-shot
 * moments inside looping animations (hammer impacts, zzz puffs) without per-frame state.
 * @param {number} t0 @param {number} t1 @param {number} period @param {number} [offset]
 */
export function crossedTick(t0, t1, period, offset = 0) {
  if (!(t1 > t0) || !(period > 0)) return false;
  return Math.floor((t1 - offset) / period) > Math.floor((t0 - offset) / period);
}

/**
 * Stable 32-bit FNV-1a hash of a string, so an agent looks and walks the same on every reload.
 * @param {string} text
 */
export function hashString(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic pseudo-random number in [0, 1) from an integer seed and a salt.
 * @param {number} seed @param {number} [salt]
 */
export function rand01(seed, salt = 0) {
  let x = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
