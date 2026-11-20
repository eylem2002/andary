// Where the node_modules cardboard boxes go for each pile level. Pure and deterministic, so adding
// a level only puts new boxes on top and never reshuffles the ones already there.

import { createRng, range } from './rand.js';

/** Boxes visible at each level 0–5. */
export const PILE_COUNTS = Object.freeze([0, 3, 7, 12, 18, 26]);
export const MAX_BOXES = PILE_COUNTS[PILE_COUNTS.length - 1];

/**
 * @typedef {object} PileBox
 * @property {number} x       relative to the pile centre
 * @property {number} y       bottom of the box
 * @property {number} z
 * @property {number} size    edge length
 * @property {number} rotY
 * @property {number} tilt    lean (radians) that grows with height, for the teetering look
 * @property {number} level   the pile level that introduces this box
 */

/**
 * Clamps a requested level to 0–5 (non-numbers → 0).
 * @param {unknown} level
 */
export function clampLevel(level) {
  const n = Math.round(Number(level));
  return Number.isFinite(n) ? Math.min(5, Math.max(0, n)) : 0;
}

/**
 * The full pile, bottom-up. The first PILE_COUNTS[level] boxes are shown at a level.
 * Boxes stack in a 3 x 3 grid of columns; higher boxes prefer the middle so the pile becomes a
 * wobbly tower rather than a flat heap.
 * @param {number} [seed]
 * @returns {PileBox[]}
 */
export function pileLayout(seed = 7) {
  const rng = createRng(seed);
  const cell = 0.56;
  const heights = new Array(9).fill(0);
  /** @type {PileBox[]} */
  const boxes = [];
  for (let i = 0; i < MAX_BOXES; i++) {
    const level = PILE_COUNTS.findIndex((count) => count > i);
    const column = chooseColumn(heights, rng, i);
    const size = range(rng, 0.42, 0.66);
    const cx = (column % 3) - 1;
    const cz = Math.floor(column / 3) - 1;
    const y = heights[column];
    boxes.push({
      x: cx * cell + range(rng, -0.08, 0.08) + y * 0.05 * Math.sin(i * 1.7),
      y,
      z: cz * cell + range(rng, -0.08, 0.08),
      size,
      rotY: range(rng, -0.45, 0.45),
      tilt: Math.min(0.2, y * 0.035) * (rng() < 0.5 ? -1 : 1),
      level,
    });
    heights[column] = y + size * 0.97;
  }
  return boxes;
}

/** The first boxes form a cross-shaped base around the middle column. */
const FIRST_COLUMNS = [4, 1, 3, 5, 7];

/**
 * @param {number[]} heights
 * @param {() => number} rng
 * @param {number} index
 */
function chooseColumn(heights, rng, index) {
  if (index < FIRST_COLUMNS.length) return FIRST_COLUMNS[index];
  const preferMiddle = index > 10 && rng() < 0.55;
  if (preferMiddle) return 4;
  let best = 0;
  let bestScore = Infinity;
  for (let c = 0; c < 9; c++) {
    const score = heights[c] + rng() * 0.9 + (c === 4 ? -0.3 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}
