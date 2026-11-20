// Paths for vehicles: road centre lines offset into the right-hand lane, corners rounded, sampled
// by distance travelled, and whether someone is on the lane ahead. Pure (no three.js),
// unit-tested in Node.

/**
 * @typedef {{x: number, z: number}} Point
 * @typedef {{x: number, z: number, angle: number}} PathSample  angle = yaw of a model facing +x
 */

/**
 * Right-hand normal of a direction (x east, z south, y up): facing east, your right is south.
 * @param {number} dx
 * @param {number} dz
 * @returns {Point}
 */
export function rightOf(dx, dz) {
  const len = Math.hypot(dx, dz) || 1;
  return { x: -dz / len, z: dx / len };
}

/**
 * Offsets a polyline to the right of its direction of travel (positive offset) with mitred joins,
 * so vehicles drive on the right-hand side of the road.
 * @param {Point[]} points
 * @param {number} offset
 * @param {boolean} closed
 * @returns {Point[]}
 */
export function offsetPolyline(points, offset, closed) {
  const n = points.length;
  return points.map((p, i) => {
    const prev = closed ? points[(i - 1 + n) % n] : points[Math.max(0, i - 1)];
    const next = closed ? points[(i + 1) % n] : points[Math.min(n - 1, i + 1)];
    const inDir = i === 0 && !closed ? { x: next.x - p.x, z: next.z - p.z } : { x: p.x - prev.x, z: p.z - prev.z };
    const outDir = i === n - 1 && !closed ? inDir : { x: next.x - p.x, z: next.z - p.z };
    const a = rightOf(inDir.x, inDir.z);
    const b = rightOf(outDir.x, outDir.z);
    const dot = a.x * b.x + a.z * b.z;
    const scale = offset / (1 + dot);
    return { x: p.x + (a.x + b.x) * scale, z: p.z + (a.z + b.z) * scale };
  });
}

/**
 * Replaces sharp corners by quadratic curves of the given radius.
 * @param {Point[]} points
 * @param {number} radius
 * @param {boolean} closed
 * @param {number} [steps]
 * @returns {Point[]}
 */
export function roundCorners(points, radius, closed, steps = 6) {
  const n = points.length;
  /** @type {Point[]} */
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const isEnd = !closed && (i === 0 || i === n - 1);
    if (isEnd) {
      out.push({ x: p.x, z: p.z });
      continue;
    }
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const inLen = Math.hypot(p.x - prev.x, p.z - prev.z) || 1;
    const outLen = Math.hypot(next.x - p.x, next.z - p.z) || 1;
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const a = { x: p.x + ((prev.x - p.x) / inLen) * r, z: p.z + ((prev.z - p.z) / inLen) * r };
    const b = { x: p.x + ((next.x - p.x) / outLen) * r, z: p.z + ((next.z - p.z) / outLen) * r };
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      out.push({ x: u * u * a.x + 2 * u * t * p.x + t * t * b.x, z: u * u * a.z + 2 * u * t * p.z + t * t * b.z });
    }
  }
  return out;
}

/**
 * A path that can be sampled by distance. Closed paths wrap around.
 * @param {Point[]} points
 * @param {boolean} closed
 */
export function createPath(points, closed) {
  const pts = closed ? [...points, points[0]] : points.slice();
  const cumulative = [0];
  for (let i = 1; i < pts.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  const length = cumulative[cumulative.length - 1];
  let cursor = 0;
  return {
    length,
    closed,
    points: pts,
    /**
     * Writes the position and heading at a distance along the path into `out` (no allocation).
     * @param {number} distance
     * @param {PathSample} out
     */
    sample(distance, out) {
      const d = closed ? ((distance % length) + length) % length : Math.min(length, Math.max(0, distance));
      if (d < cumulative[cursor] || d > cumulative[cursor + 1]) cursor = findSegment(cumulative, d);
      const i = cursor;
      const segLen = cumulative[i + 1] - cumulative[i] || 1;
      const t = (d - cumulative[i]) / segLen;
      const a = pts[i];
      const b = pts[i + 1] ?? a;
      out.x = a.x + (b.x - a.x) * t;
      out.z = a.z + (b.z - a.z) * t;
      out.angle = Math.atan2(-(b.z - a.z), b.x - a.x);
      return out;
    },
  };
}

/**
 * Index of the segment containing a distance (binary search over cumulative lengths).
 * @param {number[]} cumulative
 * @param {number} d
 */
function findSegment(cumulative, d) {
  let lo = 0;
  let hi = cumulative.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumulative[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** Where ahead of a vehicle's centre its lane is checked for people (world units along the path). */
const LOOK_AHEAD = Object.freeze([0.5, 1, 1.5, 2]);
/** @type {PathSample} */
const scratch = { x: 0, z: 0, angle: 0 };

/**
 * Whether someone is in a vehicle's lane just ahead of it, so it should wait: a few points along
 * its path, each checked with `occupied` (is anyone within `reach` of this point?).
 * @param {{ sample: (distance: number, out: PathSample) => PathSample }} path
 * @param {number} distance  the vehicle's position along the path
 * @param {(x: number, z: number, reach: number) => boolean} occupied
 * @param {number} reach  half the vehicle's width plus a little of a person's
 */
export function laneBlocked(path, distance, occupied, reach) {
  for (const ahead of LOOK_AHEAD) {
    path.sample(distance + ahead, scratch);
    if (occupied(scratch.x, scratch.z, reach)) return true;
  }
  return false;
}
