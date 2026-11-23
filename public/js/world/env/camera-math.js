// Pure maths for the isometric camera rig (no three.js), unit-tested in Node.

/** Default yaw: the camera looks from the south-east, so every south-facing door is visible. */
export const ISO_YAW = Math.PI / 4;
/** Fixed downward pitch of the camera. */
export const ISO_PITCH = (35 * Math.PI) / 180;
/** User zoom is relative to the framing that fits the town: 1 = whole town. */
export const MIN_ZOOM = 0.7;
export const MAX_ZOOM = 9;
/** World-space footprint the default framing should show (x and z extents of the plinth). */
const TOWN_VIEW = Object.freeze({ width: 60, depth: 78 });

/**
 * @param {number} value
 * @param {number} lo
 * @param {number} hi
 */
export function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Frame-rate independent exponential smoothing towards a target.
 * @param {number} current
 * @param {number} target
 * @param {number} lambda  higher = snappier (1/s)
 * @param {number} dt      seconds
 */
export function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/** @param {number} t 0..1 */
export function easeInOutCubic(t) {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * Unit vector from the target towards the camera.
 * @param {number} yaw
 * @param {number} pitch
 * @returns {[number, number, number]}
 */
export function cameraDirection(yaw, pitch) {
  const c = Math.cos(pitch);
  return [Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c];
}

/**
 * Size in world units of the town's bounding box on screen for a camera yaw, so the default zoom
 * can fit it: the rotated ground rectangle projected onto the screen axes.
 * @param {number} yaw
 * @param {number} pitch
 * @param {{width: number, depth: number}} [view]
 */
export function projectedTownSize(yaw, pitch, view = TOWN_VIEW) {
  const sx = Math.abs(Math.cos(yaw)) * view.width + Math.abs(Math.sin(yaw)) * view.depth;
  const sz = Math.abs(Math.sin(yaw)) * view.width + Math.abs(Math.cos(yaw)) * view.depth;
  return { width: sx, height: sz * Math.sin(pitch) };
}

/**
 * Orthographic half-height (world units at zoom 1) that fits the town in a viewport.
 * Small portrait screens crop the plinth's corners rather than shrinking the town to specks.
 * @param {number} width  viewport px
 * @param {number} height viewport px
 * @param {number} [yaw]
 */
export function fitHalfHeight(width, height, yaw = ISO_YAW) {
  const aspect = Math.max(0.1, width / Math.max(1, height));
  const size = projectedTownSize(yaw, ISO_PITCH);
  // Wide screens show the whole town with a margin; portrait phones show the middle half (the
  // town then fills more of the tall screen; drag to see the rest).
  const widthFactor = aspect < 0.8 ? 0.52 : 1 / 0.9;
  const byWidth = (size.width * widthFactor) / aspect / 2;
  const byHeight = (size.height / 0.92) / 2;
  return Math.max(byWidth, byHeight);
}

/**
 * The ground point (y = 0) that must be the camera target for `point` to appear at the centre of
 * the screen: slide the point along the view ray down to the ground.
 * @param {{x: number, y: number, z: number}} point
 * @param {[number, number, number]} toCamera  unit vector from target towards the camera
 */
export function groundTargetFor(point, toCamera) {
  const k = point.y / toCamera[1];
  return { x: point.x - toCamera[0] * k, z: point.z - toCamera[2] * k };
}

/**
 * Yaw angle for a whole number of 90° steps away from the default view.
 * @param {number} steps
 */
export function yawForStep(steps) {
  return ISO_YAW + steps * (Math.PI / 2);
}

/**
 * Converts a pan request in screen terms (dx = right, dz = towards the viewer) into world x/z for
 * the current yaw.
 * @param {number} dx
 * @param {number} dz
 * @param {number} yaw
 */
export function screenPanToWorld(dx, dz, yaw) {
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  const backX = Math.sin(yaw);
  const backZ = Math.cos(yaw);
  return { x: rightX * dx + backX * dz, z: rightZ * dx + backZ * dz };
}

/**
 * Keeps the camera target over the plinth.
 * @param {{x: number, z: number}} target
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} bounds
 */
export function clampTarget(target, bounds) {
  target.x = clamp(target.x, bounds.minX, bounds.maxX);
  target.z = clamp(target.z, bounds.minZ, bounds.maxZ);
  return target;
}
