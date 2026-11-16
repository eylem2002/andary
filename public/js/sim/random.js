// Seeded randomness for the simulation: the same seed always tells the same story.

export const DEFAULT_SEED = 20261117;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const HEX = '0123456789abcdef';

/**
 * mulberry32: a tiny, fast 32-bit PRNG with good enough statistics for a story generator.
 * @param {number} seed
 * @returns {() => number} uniform numbers in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Numbers are used as they are; strings are hashed (FNV-1a); anything else is the default seed.
 * @param {unknown} seed
 */
export function seedFrom(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return Math.floor(Math.abs(seed)) >>> 0;
  if (typeof seed === 'string' && seed) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193) >>> 0;
    return hash;
  }
  return DEFAULT_SEED;
}

/**
 * @param {unknown} seed
 */
export function createRandom(seed) {
  const next = mulberry32(seedFrom(seed));

  /** @param {number} min @param {number} max  inclusive integers */
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));

  /**
   * @template T
   * @param {readonly T[]} list
   * @returns {T}
   */
  const pick = (list) => list[Math.floor(next() * list.length)];

  /**
   * @template T
   * @param {readonly T[]} list
   * @returns {T[]} a shuffled copy
   */
  const shuffle = (list) => {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  /** @param {string} alphabet @param {number} n */
  const chars = (alphabet, n) => Array.from({ length: n }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');

  return {
    next,
    int,
    pick,
    shuffle,
    /** @param {number} min @param {number} max */
    float: (min, max) => min + next() * (max - min),
    /** @param {number} p probability of true */
    chance: (p) => next() < p,
    /**
     * @template T
     * @param {readonly T[]} list
     * @param {number} n
     */
    sample: (list, n) => shuffle(list).slice(0, Math.max(0, n)),
    /** RFC 4122 v4 layout, like Claude Code session ids. */
    uuid: () => `${chars(HEX, 8)}-${chars(HEX, 4)}-4${chars(HEX, 3)}-${pick(['8', '9', 'a', 'b'])}${chars(HEX, 3)}-${chars(HEX, 12)}`,
    /** Shaped like the API's tool_use ids. */
    toolUseId: () => `toolu_01${chars(BASE62, 22)}`,
    /** Shaped like Claude Code subagent ids. */
    agentId: () => `a${chars(HEX, 16)}`,
  };
}

/** @typedef {ReturnType<typeof createRandom>} Random */
