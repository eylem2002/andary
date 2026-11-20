// The colour grade of the sunset-coast look, blended between day and night. Kept free of three.js
// so it can be tested; post.js folds it into the tilt-shift pass.

/** The grade by day and by night; colours are multipliers on linear light. */
export const GRADE = Object.freeze({
  day: { saturation: 1.16, contrast: 1.06, shadow: [0.95, 0.99, 1.07], highlight: [1.06, 1.0, 0.93], vignette: 0.2 },
  night: { saturation: 1.24, contrast: 1.04, shadow: [1.02, 0.9, 1.14], highlight: [1.05, 0.97, 1.02], vignette: 0.28 },
});

/**
 * The grade blended between day and night.
 * @param {number} night 0..1
 */
export function gradeAt(night) {
  const t = Math.min(1, Math.max(0, night));
  const mix = (/** @type {number} */ a, /** @type {number} */ b) => a + (b - a) * t;
  const mix3 = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a.map((v, i) => mix(v, b[i]));
  const { day, night: n } = GRADE;
  return {
    saturation: mix(day.saturation, n.saturation),
    contrast: mix(day.contrast, n.contrast),
    shadow: mix3(day.shadow, n.shadow),
    highlight: mix3(day.highlight, n.highlight),
    vignette: mix(day.vignette, n.vignette),
  };
}
