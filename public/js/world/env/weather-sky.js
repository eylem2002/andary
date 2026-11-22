// How town weather changes the sky (pure, so it is unit-tested): an overcast sky turns the
// gradient and the fog towards grey and dims the sun and the fill light; fog pulls the fog in.

/** @typedef {import('./daynight.js').SkyState} SkyState */

/** Storm grey by day; at night it is scaled down with the sky's own brightness. */
const GREY = [0.5, 0.53, 0.58];

/**
 * @param {number[]} a @param {number[]} b @param {number} t
 * @returns {[number, number, number]}
 */
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** @param {number[]} rgb */
function brightness(rgb) {
  return (rgb[0] + rgb[1] + rgb[2]) / 3;
}

/**
 * The sky state under some weather. Returns the same object when the weather is clear.
 * @param {SkyState} state
 * @param {{ overcast: number, fog: number }} weather
 * @returns {SkyState & { fogScale: number }}
 */
export function weatherSky(state, { overcast, fog }) {
  const o = Math.min(1, Math.max(0, overcast || 0));
  const f = Math.min(1, Math.max(0, fog || 0));
  if (o === 0 && f === 0) return { ...state, fogScale: 1 };
  /** @param {number[]} rgb */
  const grey = (rgb) => {
    const level = Math.min(1, brightness(rgb) / 0.7);
    return mix(rgb, GREY.map((c) => c * (0.35 + 0.65 * level)), o * 0.9);
  };
  const fogColor = mix(grey(state.fog), grey(state.horizon), 0.3);
  return {
    ...state,
    zenith: grey(state.zenith),
    horizon: grey(state.horizon),
    bottom: grey(state.bottom),
    // Night fog is a moonlit haze, not a black wall: its grey keeps at least half its day level.
    fog: f > 0 ? mix(fogColor, [0.82, 0.84, 0.86].map((c) => c * (0.5 + 0.5 * (1 - state.night))), f * 0.6) : fogColor,
    lightIntensity: state.lightIntensity * (1 - 0.6 * o),
    hemiIntensity: state.hemiIntensity * (1 - 0.2 * o),
    envIntensity: state.envIntensity * (1 - 0.3 * o),
    stars: state.stars * (1 - o),
    // Fog distances are multiplied by this: 1 is the usual haze, smaller is thicker. At night the
    // fog thins (by up to 40%) so the town is not swallowed in the dark.
    fogScale: 1 - (0.75 * f + 0.2 * o) * (1 - 0.4 * state.night),
  };
}
