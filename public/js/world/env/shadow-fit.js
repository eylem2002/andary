// Fits the directional light's orthographic shadow camera tightly around the town, so the one
// shadow map spends its texels on the plinth instead of empty sky. Pure maths, unit-tested.

/**
 * @typedef {[number, number, number]} Vec3
 * @typedef {object} LightFrame
 * @property {Vec3} center    where the light looks at
 * @property {Vec3} position  where to put the light
 * @property {number} left
 * @property {number} right
 * @property {number} top
 * @property {number} bottom
 * @property {number} near
 * @property {number} far
 */

/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** @param {Vec3} v @returns {Vec3} */
function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** @param {Vec3} a @param {Vec3} b */
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Axis-aligned box corners.
 * @param {{min: Vec3, max: Vec3}} box
 * @returns {Vec3[]}
 */
export function boxCorners(box) {
  /** @type {Vec3[]} */
  const out = [];
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) out.push([x, y, z]);
    }
  }
  return out;
}

/**
 * Light-space bounds of a set of points, using the same camera basis three.js builds with
 * lookAt(): z axis = towards the light, x = up × z, y = z × x.
 * @param {Vec3} toLight  unit vector from the scene towards the light
 * @param {Vec3[]} points
 * @param {number} [distance]  how far from the centre the light sits
 * @param {number} [margin]
 * @returns {LightFrame}
 */
export function fitLightFrame(toLight, points, distance = 80, margin = 1) {
  const z = normalize(toLight);
  const up = Math.abs(z[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
  const x = normalize(cross(/** @type {Vec3} */ (up), z));
  const y = cross(z, x);
  /** @type {Vec3} */
  const center = [0, 0, 0];
  for (const p of points) {
    center[0] += p[0] / points.length;
    center[1] += p[1] / points.length;
    center[2] += p[2] / points.length;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minD = Infinity;
  let maxD = -Infinity;
  for (const p of points) {
    /** @type {Vec3} */
    const rel = [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
    const px = dot(rel, x);
    const py = dot(rel, y);
    const depth = distance - dot(rel, z);
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
    minD = Math.min(minD, depth);
    maxD = Math.max(maxD, depth);
  }
  return {
    center,
    position: [center[0] + z[0] * distance, center[1] + z[1] * distance, center[2] + z[2] * distance],
    left: minX - margin,
    right: maxX + margin,
    bottom: minY - margin,
    top: maxY + margin,
    near: Math.max(0.1, minD - margin),
    far: maxD + margin,
  };
}
