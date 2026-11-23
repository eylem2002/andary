// A cheap safety net against a town that comes out too dark: every few seconds it reads a few tiny
// patches of the finished frame (where the town sits on screen) and, if their average brightness
// is below a floor, lifts the exposure a little, up to a cap. It eases back once the picture is
// bright again. The night floor (daynight.js readable) should keep it idle; it is there for what
// nothing else foresees (a blank reflection map after a GPU reset, a very dark look, a driver).
// nextGain is pure and unit-tested; the reading is a handful of 8×8 readPixels, one stall per
// interval, so it stays inside the phone's frame budget.

/** Brightness is 0–255 sRGB luma (what the eye sees on screen). */
export const GUARD = Object.freeze({
  /** Below this mean the exposure is lifted. */
  min: 62,
  /** The level a lift aims for. */
  target: 72,
  /** The most the guard multiplies the exposure by. */
  maxGain: 1.8,
  /** Seconds between readings. */
  interval: 4,
});

/** Patch centres as fractions of the canvas: the middle of the shot, where the town is. */
const SPOTS = Object.freeze([
  [0.5, 0.5],
  [0.38, 0.42],
  [0.62, 0.42],
  [0.38, 0.6],
  [0.62, 0.6],
  [0.5, 0.33],
  [0.5, 0.68],
]);
const PATCH = 8;

/**
 * The guard's next exposure gain after a reading. Lifts in proportion to how far the picture is
 * below the floor (square root, so it never overshoots wildly), and eases back towards 1 when the
 * picture is comfortably bright. Garbage readings change nothing.
 * @param {number} gain       current gain (1 = no lift)
 * @param {number} measured   mean brightness 0–255 of the frame read with that gain
 * @param {Partial<typeof GUARD>} [options]
 */
export function nextGain(gain, measured, options = {}) {
  const { min, target, maxGain } = { ...GUARD, ...options };
  const g = Number.isFinite(gain) ? Math.min(maxGain, Math.max(1, gain)) : 1;
  if (!Number.isFinite(measured) || measured < 0) return g;
  if (measured < min) {
    // An all-black frame (nothing drawn yet) says nothing about the lighting.
    if (measured < 1) return g;
    return Math.min(maxGain, g * Math.sqrt(target / measured));
  }
  if (g > 1 && measured > target * 1.15) return Math.max(1, g * Math.sqrt((target * 1.1) / measured));
  return g;
}

/**
 * Mean sRGB luma of RGBA bytes.
 * @param {ArrayLike<number>} rgba
 */
export function meanLuma(rgba) {
  let sum = 0;
  const n = Math.floor(rgba.length / 4);
  for (let i = 0; i < n * 4; i += 4) sum += 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  return n ? sum / n : 0;
}

/**
 * @param {import('three').WebGLRenderer} renderer
 */
export function createBrightnessGuard(renderer) {
  let gain = 1;
  let shown = 1;
  // The first reading waits a moment, until the town is built and the reflections are drawn.
  let clock = GUARD.interval - 1.5;
  let due = false;
  const pixels = new Uint8Array(PATCH * PATCH * 4);
  const all = new Uint8Array(PATCH * PATCH * 4 * SPOTS.length);

  /** Reads the patches from the canvas just drawn; NaN when it cannot. */
  function read() {
    // The town needs WebGL 2 (world.js checks before it starts).
    const gl = /** @type {WebGL2RenderingContext} */ (renderer.getContext());
    if (gl.isContextLost() || renderer.getRenderTarget() !== null) return Number.NaN;
    // Only the canvas itself: never a render target that happens to be bound for reading.
    if (gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) !== null) return Number.NaN;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (w < PATCH * 4 || h < PATCH * 4) return Number.NaN;
    SPOTS.forEach(([fx, fy], i) => {
      const x = Math.round(fx * w - PATCH / 2);
      const y = Math.round((1 - fy) * h - PATCH / 2);
      gl.readPixels(x, y, PATCH, PATCH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      all.set(pixels, i * pixels.length);
    });
    return meanLuma(all);
  }

  return {
    /** The exposure multiplier to use this frame. */
    get gain() {
      return shown;
    },
    /** @param {number} dt seconds */
    update(dt) {
      clock += dt;
      if (clock >= GUARD.interval) {
        clock = 0;
        due = true;
      }
      // Ease towards the chosen gain over about a second, so a lift is never a jump.
      shown += (gain - shown) * Math.min(1, dt * 2.5);
      if (Math.abs(gain - shown) < 0.002) shown = gain;
    },
    /** Call right after the frame is drawn to the canvas. */
    afterRender() {
      // Judge only a settled frame, drawn at the gain the guard chose.
      if (!due || shown !== gain) return;
      due = false;
      const measured = read();
      if (Number.isFinite(measured)) gain = nextGain(gain, measured);
    },
    /** Forget what was learnt (a restored GPU context, a new look): start from no lift. */
    reset() {
      gain = 1;
      shown = 1;
      clock = GUARD.interval - 1.5;
      due = false;
    },
  };
}
