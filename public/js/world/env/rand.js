// Deterministic randomness for the town's props, so the town looks the same on every load and
// screenshots are comparable between runs. Pure: no three.js, no DOM.

/**
 * Seeded pseudo-random generator (mulberry32).
 * @param {number} seed
 * @returns {() => number} returns floats in [0, 1)
 */
export function createRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {() => number} rng
 * @param {number} min
 * @param {number} max
 */
export function range(rng, min, max) {
  return min + (max - min) * rng();
}

/**
 * Stable 32-bit hash of a string (FNV-1a), for per-id variation such as a worktree's tree shape.
 * @param {string} text
 */
export function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
