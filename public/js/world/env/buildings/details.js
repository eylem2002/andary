// Reusable architectural details in a building's local frame (+z = front/south): windows with
// sills and shutters, doors, cornices, parapets and the rooftop clutter that makes a skyline look
// like Amman: water tanks, satellite dishes and solar water heaters.
import { C, S } from '../palette.js';
import { range } from '../rand.js';

/**
 * A wall plane. axis 'z' walls face ±z (front/back), axis 'x' walls face ±x (sides).
 * @typedef {{axis: 'x'|'z', sign: 1|-1, plane: number}} Face
 */

/** @param {number} plane @returns {Face} */
export const front = (plane) => ({ axis: 'z', sign: 1, plane });
/** @param {number} plane @returns {Face} */
export const back = (plane) => ({ axis: 'z', sign: -1, plane });
/** @param {number} plane @returns {Face} */
export const east = (plane) => ({ axis: 'x', sign: 1, plane });
/** @param {number} plane @returns {Face} */
export const west = (plane) => ({ axis: 'x', sign: -1, plane });

/**
 * A box flush against a wall, protruding `depth` outwards. `u` runs along the wall, `y` is the
 * bottom of the box.
 * @param {import('../kit.js').Kit} kit
 * @param {Face} f
 * @param {[number, number, number, number, number]} rect  [u, y, w, h, depth]
 * @param {number} color
 * @param {import('../kit.js').PartOptions} [opts]
 */
export function onFace(kit, f, [u, y, w, h, depth], color, opts) {
  const c = f.plane + (f.sign * depth) / 2;
  if (f.axis === 'z') kit.box([u, y, c], [w, h, depth], color, opts);
  else kit.box([c, y, u], [depth, h, w], color, opts);
}

/**
 * @typedef {object} WindowRow
 * @property {number} from      start of the row along the wall
 * @property {number} to        end of the row
 * @property {number} count
 * @property {number} y         bottom of the windows
 * @property {number} [w]
 * @property {number} [h]
 * @property {boolean} [arched]
 * @property {number} [shutters]  shutter colour
 * @property {number} [frame]     frame / sill colour
 * @property {() => number} rng
 * @property {number} [dark]     share of windows that never light up
 */

/**
 * A row of evenly spaced windows on a wall.
 * @param {import('../kit.js').Kit} kit
 * @param {Face} f
 * @param {WindowRow} row
 */
export function windows(kit, f, row) {
  const w = row.w ?? 0.5;
  const h = row.h ?? 0.7;
  const step = (row.to - row.from) / row.count;
  for (let i = 0; i < row.count; i++) {
    const u = row.from + step * (i + 0.5);
    windowAt(kit, f, [u, row.y, w, h], row);
  }
}

/**
 * One window: glass, frame and sill, optional arch and shutters.
 * @param {import('../kit.js').Kit} kit
 * @param {Face} f
 * @param {[number, number, number, number]} rect  [u, y, w, h]
 * @param {WindowRow} row
 */
function windowAt(kit, f, [u, y, w, h], row) {
  const lit = row.rng() >= (row.dark ?? 0.18);
  const glass = { surface: S.glass, glow: lit ? range(row.rng, 0.32, 0.5) : 0, seed: row.rng() };
  const frame = row.frame ?? C.stoneTrim;
  onFace(kit, f, [u, y - 0.08, w + 0.16, 0.08, 0.09], frame, { surface: S.stone });
  onFace(kit, f, [u, y, w + 0.1, h + 0.05, 0.03], frame, { surface: S.matte });
  onFace(kit, f, [u, y, w, h, 0.05], C.glass, glass);
  if (row.arched) archTop(kit, f, [u, y + h, w], glass, frame);
  if (row.shutters != null) {
    for (const side of [-1, 1]) onFace(kit, f, [u + side * (w / 2 + 0.13), y, 0.22, h, 0.05], row.shutters, { surface: S.gloss });
  }
}

/**
 * Half-disc glass on top of a window, for arched windows and doors.
 * @param {import('../kit.js').Kit} kit
 * @param {Face} f
 * @param {[number, number, number]} at  [u, y, w]: centre along the wall, springing height, width
 * @param {import('../kit.js').PartOptions} glass
 * @param {number} frame
 */
function archTop(kit, f, [u, y, w], glass, frame) {
  const r = w / 2;
  const facingZ = f.axis === 'z';
  // A half cylinder turned so its flat side lies on the wall and its round side points up.
  const turn = { rotZ: Math.PI / 2, rotY: facingZ ? Math.PI / 2 : 0, arc: Math.PI, seg: 12 };
  const c = f.plane + f.sign * 0.025;
  const [x, z] = facingZ ? [u, c] : [c, u];
  kit.cyl([x, y, z], r, 0.05, C.glass, { ...glass, ...turn });
  const cf = f.plane + f.sign * 0.015;
  const [fx, fz] = facingZ ? [u, cf] : [cf, u];
  kit.cyl([fx, y, fz], r + 0.06, 0.03, frame, turn);
}

/**
 * A door with a frame; arched doors get a fanlight.
 * @param {import('../kit.js').Kit} kit
 * @param {Face} f
 * @param {[number, number, number]} size  [u, w, h]: centre along the wall, width, height
 * @param {{color?: number, frame?: number, arched?: boolean, rng: () => number, step?: boolean, y?: number}} opts
 */
export function door(kit, f, [u, w, h], opts) {
  const frame = opts.frame ?? C.stoneTrim;
  const y = opts.y ?? 0;
  onFace(kit, f, [u, y, w + 0.24, h + 0.12, 0.05], frame, { surface: S.stone });
  onFace(kit, f, [u, y, w, h, 0.08], opts.color ?? C.teal, { surface: S.gloss });
  onFace(kit, f, [u, y + h * 0.62, w * 0.82, h * 0.28, 0.09], C.glass, { surface: S.glass, glow: 0.5, seed: opts.rng() * 0.3 });
  if (opts.arched) archTop(kit, f, [u, y + h, w], { surface: S.glass, glow: 0.5, seed: 0.1 }, frame);
  if (opts.step !== false) onFace(kit, f, [u, y - 0.02, w + 0.5, 0.06, 0.32], C.stoneTrim, { surface: S.stone });
}

/**
 * Flat-roof parapet with a thin coping all round.
 * @param {import('../kit.js').Kit} kit
 * @param {[number, number, number]} at  roof centre and height [x, y, z]
 * @param {[number, number]} size  [w, d]
 * @param {number} [color]
 */
export function parapet(kit, [x, y, z], [w, d], color = C.stoneTrim) {
  const t = 0.12;
  const h = 0.22;
  kit.box([x, y, z + d / 2 - t / 2], [w, h, t], color, { surface: S.stone });
  kit.box([x, y, z - d / 2 + t / 2], [w, h, t], color, { surface: S.stone });
  kit.box([x + w / 2 - t / 2, y, z], [t, h, d - 2 * t], color, { surface: S.stone });
  kit.box([x - w / 2 + t / 2, y, z], [t, h, d - 2 * t], color, { surface: S.stone });
}

/**
 * Projecting cornice band around a block.
 * @param {import('../kit.js').Kit} kit
 * @param {[number, number, number]} at  block centre and cornice height [x, y, z]
 * @param {[number, number]} size  block footprint [w, d]
 * @param {number} [color]
 */
export function cornice(kit, [x, y, z], [w, d], color = C.stoneTrim) {
  kit.box([x, y, z], [w + 0.16, 0.12, d + 0.16], color, { surface: S.stone });
  kit.box([x, y + 0.12, z], [w + 0.26, 0.08, d + 0.26], color, { surface: S.stone });
}

/**
 * Rooftop clutter: water tanks on stands, satellite dishes and solar water heaters. The rect is
 * the free roof area [x0, z0, x1, z1] at height y.
 * @param {import('../kit.js').Kit} kit
 * @param {[number, number, number, number]} rect
 * @param {number} y
 * @param {() => number} rng
 * @param {number} [count]
 */
export function roofClutter(kit, rect, y, rng, count = 3) {
  const [x0, z0, x1, z1] = rect;
  const makers = [waterTank, solarHeater, satelliteDish, waterTank, satelliteDish];
  for (let i = 0; i < count; i++) {
    const x = range(rng, x0 + 0.4, x1 - 0.4);
    const z = range(rng, z0 + 0.4, z1 - 0.4);
    makers[(i + Math.floor(rng() * 2)) % makers.length](kit, x, y, z, rng);
  }
}

/** Cylindrical water tank on a small steel stand (white, black or blue). */
function waterTank(kit, x, y, z, rng) {
  const colors = [0xf2f2ee, 0x2f3338, 0x3b78b8, 0xf2f2ee];
  const color = colors[Math.floor(rng() * colors.length)];
  for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) {
    kit.box([x + dx, y, z + dz], [0.05, 0.25, 0.05], C.steelDark, { surface: S.steel });
  }
  kit.cyl([x, y + 0.25, z], 0.3, 0.5, color, { seg: 14, surface: S.gloss });
  kit.cyl([x, y + 0.75, z], 0.31, 0.06, color, { seg: 14, top: 0.18, surface: S.gloss });
}

/** Solar water heater: tilted dark panel facing south with a white tank above. */
function solarHeater(kit, x, y, z, rng) {
  const rotY = range(rng, -0.25, 0.25);
  kit.push(x, y, z, rotY);
  kit.box([0, 0, -0.15], [0.9, 0.35, 0.06], C.steelDark, { surface: S.steel });
  kit.box([0, 0.18, 0.05], [0.9, 0.06, 0.62], 0x1d3557, { surface: S.glass, rotX: 0.75 });
  kit.cyl([0, 0.52, -0.18], 0.13, 0.94, 0xf4f4f0, { rotZ: Math.PI / 2, seg: 12, surface: S.gloss, center: true });
  kit.pop();
}

/** Small white satellite dish on a short post, pointing south-ish. */
function satelliteDish(kit, x, y, z, rng) {
  kit.cyl([x, y, z], 0.03, 0.35, C.steel, { seg: 6, surface: S.steel });
  // Facing south and up towards the satellites.
  const elevation = range(rng, 0.4, 0.75);
  kit.dish([x, y + 0.36, z + 0.05], 0.22, 0xf4f4f0, { rotX: Math.PI / 2 - elevation, rotY: range(rng, -0.6, 0.6), surface: S.gloss });
}

/**
 * Low planter box with flowers along a wall or path.
 * @param {import('../kit.js').Kit} kit
 * @param {[number, number]} at  [x, z]
 * @param {[number, number]} size  [w, d]
 * @param {() => number} rng
 */
export function flowerBed(kit, [x, z], [w, d], rng) {
  kit.box([x, 0, z], [w, 0.22, d], C.stoneTrim, { surface: S.stone });
  kit.box([x, 0.22, z], [w - 0.1, 0.03, d - 0.1], C.soil, { surface: S.ground });
  const flowers = [C.flowerPink, C.flowerRed, C.flowerYellow, C.flowerPurple, C.flowerWhite];
  const n = Math.max(3, Math.round(w * d * 14));
  for (let i = 0; i < n; i++) {
    const fx = x + range(rng, -w / 2 + 0.1, w / 2 - 0.1);
    const fz = z + range(rng, -d / 2 + 0.1, d / 2 - 0.1);
    const leafy = rng() < 0.45;
    const color = leafy ? (rng() < 0.5 ? C.leafOlive : C.lawnDark) : flowers[Math.floor(rng() * flowers.length)];
    kit.ball([fx, 0.27, fz], range(rng, 0.06, 0.11), color, { surface: leafy ? S.foliage : S.matte });
  }
}

/**
 * Clipped hedge.
 * @param {import('../kit.js').Kit} kit
 * @param {[number, number]} at  [x, z]
 * @param {[number, number]} size  [w, d]
 * @param {number} [h]
 */
export function hedge(kit, [x, z], [w, d], h = 0.45) {
  kit.rbox([x, 0, z], [w, h, d], C.leafDeep, { surface: S.foliage, radius: 0.12, segments: 2 });
}

/**
 * Round café/plaza table with chairs and an optional parasol.
 * @param {import('../kit.js').Kit} kit
 * @param {number} x @param {number} z
 * @param {{parasol?: number, rng: () => number}} opts
 */
export function cafeTable(kit, x, z, opts) {
  kit.cyl([x, 0, z], 0.04, 0.5, C.iron, { seg: 6, surface: S.steel });
  kit.cyl([x, 0.5, z], 0.32, 0.04, C.plaster, { seg: 14, surface: S.gloss });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + opts.rng();
    const cx = x + Math.cos(a) * 0.48;
    const cz = z + Math.sin(a) * 0.48;
    kit.box([cx, 0, cz], [0.24, 0.3, 0.24], C.iron, { surface: S.steel, rotY: -a });
    kit.box([cx + Math.cos(a) * 0.1, 0.3, cz + Math.sin(a) * 0.1], [0.05, 0.3, 0.24], C.iron, { surface: S.steel, rotY: -a });
  }
  if (opts.parasol == null) return;
  kit.cyl([x, 0.54, z], 0.025, 1.1, C.woodLight, { seg: 6 });
  kit.cone([x, 1.42, z], 0.85, 0.32, opts.parasol, { seg: 8, surface: S.fabric });
  kit.cone([x, 1.4, z], 0.84, 0.3, C.cream, { seg: 8, surface: S.fabric, rotY: Math.PI / 8 });
}

/**
 * Park bench facing +z (rotate with a kit frame for other directions).
 * @param {import('../kit.js').Kit} kit
 */
export function bench(kit, x, z, rotY = 0) {
  kit.push(x, 0, z, rotY);
  kit.box([0, 0.26, 0], [1.1, 0.05, 0.36], C.wood, { surface: S.matte });
  kit.box([0, 0.36, -0.17], [1.1, 0.3, 0.05], C.wood, { surface: S.matte, rotX: -0.12 });
  for (const sx of [-0.45, 0.45]) kit.box([sx, 0, 0], [0.06, 0.28, 0.34], C.iron, { surface: S.steel });
  kit.pop();
}

/**
 * Small golden cupola on a stone drum, floodlit at night like the Town Hall dome.
 * @param {import('../kit.js').Kit} kit
 * @param {[number, number, number]} at  base centre on the roof
 * @param {number} r  dome radius
 */
export function cupola(kit, [x, y, z], r) {
  kit.cyl([x, y, z], r * 1.08, r * 0.7, C.stonePale, { seg: 16, surface: S.stone });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    kit.box([x + Math.cos(a) * r * 1.09, y + r * 0.15, z + Math.sin(a) * r * 1.09], [r * 0.28, r * 0.4, 0.03], C.glass, {
      surface: S.glass,
      glow: 0.4,
      seed: 0.15,
      rotY: Math.PI / 2 - a,
    });
  }
  kit.cyl([x, y + r * 0.7, z], r * 1.16, r * 0.1, C.stoneTrim, { seg: 16, surface: S.stone });
  kit.dome([x, y + r * 0.8, z], r, C.gold, { seg: 18, sy: 1.15, surface: S.gold, glow: 0.1, seed: 0.03 });
  kit.sphere([x, y + r * 2.0, z], r * 0.12, C.gold, { surface: S.gold });
}
