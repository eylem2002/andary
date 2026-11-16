// Picks the render quality for `quality: 'auto'`. Phones, tablets, small windows and machines with
// few cores get 'low' (no bloom, tilt-shift or shadows, pixel ratio 1) so the town stays smooth.

/**
 * @param {object} probe
 * @param {'auto'|'high'|'low'|undefined} probe.requested
 * @param {boolean} probe.coarsePointer  touch-first device
 * @param {number} probe.width           viewport CSS px
 * @param {number} probe.height
 * @param {number} probe.cores           navigator.hardwareConcurrency (0 when unknown)
 * @returns {'high'|'low'}
 */
export function pickQuality({ requested, coarsePointer, width, height, cores }) {
  if (requested === 'high' || requested === 'low') return requested;
  if (coarsePointer) return 'low';
  if (Math.min(width, height) < 600) return 'low';
  if (cores > 0 && cores <= 4) return 'low';
  return 'high';
}

/**
 * Reads the probe values from the browser.
 * @param {'auto'|'high'|'low'|undefined} requested
 */
export function detectQuality(requested) {
  const coarsePointer = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return pickQuality({
    requested,
    coarsePointer,
    width: window.innerWidth,
    height: window.innerHeight,
    cores: navigator.hardwareConcurrency || 0,
  });
}
