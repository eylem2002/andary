// A person of a team town, built from the look they chose (core/profile.js, resolved by looks.js):
// body and build, every top with its details (hood, collar, zip, lapels, buttons, bib) and its
// pattern, bottoms with their seams and pockets, shoes, hair styles with a streak, the whole face
// (eyes, brows, mouth, cheeks, facial hair, glasses, earrings), hats, extras, a pet that walks at
// their heel and something in their hand. Modelled in figure space like the helpers' body
// (figure-body.js: boots at y = 0, facing +z, the figure's left at +x), and like it one skinned
// mesh: the pet rides the body bone, the hand item the right hand, so a person is one draw call.

import { B, JOINTS as J } from './rig.js';
import { ball, box, capsule, cone, cyl, dome, halfDisc, rbox, ring, taper, taperAt } from './figure-parts.js';
import { darken, lighten, mix } from './color.js';
import { addHat } from './figure-hats.js';

/** @typedef {import('./figure-parts.js').PartList} PartList */
/** @typedef {import('./looks.js').PersonParts} PersonParts */

const EYE = '#1A1A22';
const MOUTH = '#6B2F2A';
const DARK = '#2D3340';
const GOLD = '#E0B33A';
const SILVER = '#C9CED6';
const WHITE = '#F2F0EA';
const SOLE = '#2A1D15';
const STITCH = '#E8C07A';

const TORSO = { w: 0.33, h: 0.27, d: 0.2, y: 0.51, waist: 0.86 };
/** Torso width by build. */
const BUILD = Object.freeze({ slim: 0.88, regular: 1, broad: 1.16 });
/** Hats that cover the crown: hair volume (bun, curls, quiff…) is hidden under them. */
export const COVERING_HATS = new Set(['cap', 'beanie', 'beret', 'sunhat', 'wizard', 'hardhat', 'bucket', 'viking', 'tophat', 'chef', 'bandana']);
/** Tops with long sleeves. */
const LONG_SLEEVES = new Set(['longsleeve', 'hoodie', 'zip', 'denim', 'bomber', 'blazer', 'shirt', 'sweater', 'cardigan', 'labcoat', 'kimono']);

/**
 * @param {PartList} parts
 * @param {PersonParts} p
 */
export function addPerson(parts, p) {
  const w = BUILD[/** @type {keyof typeof BUILD} */ (p.build)] ?? 1;
  addLegs(parts, p);
  addShoes(parts, p);
  addTorso(parts, p, w);
  addArms(parts, p, w);
  parts.add(B.HEAD, cyl(0.05, 0.056, 0.05, 8).translate(0, 0.665, 0), p.colors.skin); // neck
  addHead(parts, p);
  addHair(parts, p);
  if (p.hat !== 'none') addHat(parts, /** @type {any} */ ({ hat: p.hat, color: p.colors.theme }));
  addExtra(parts, p, w);
  addPet(parts, p.pet, p.colors);
  addHandItem(parts, p.hand, p.colors.theme);
}

// ── legs and shoes ───────────────────────────────────────────────────────────

/** @param {PartList} parts @param {PersonParts} p */
function addLegs(parts, p) {
  const { pants, skin } = p.colors;
  const bare = p.bottom === 'shorts' || p.bottom === 'skirt';
  const thigh = p.bottom === 'skirt' || p.bottom === 'longskirt' ? skin : pants;
  const shin = bare || p.bottom === 'longskirt' ? skin : pants;
  const wide = p.bottom === 'cargo' || p.bottom === 'joggers' ? 1.08 : 1;
  parts.addPair(B.LEG_L, B.LEG_R, () => rbox(0.104 * wide, 0.16, 0.115 * wide, 0.035).translate(J.legX, 0.225, 0), thigh);
  parts.addPair(B.KNEE_L, B.KNEE_R, () => rbox(0.096 * (bare ? 0.82 : wide), 0.1, 0.105 * (bare ? 0.82 : wide), 0.03).translate(J.legX, 0.105, 0), shin);
  if (p.bottom === 'skirt') parts.add(B.PELVIS, cyl(0.15, 0.2, 0.15, 14).translate(0, 0.28, 0), pants);
  else if (p.bottom === 'longskirt') parts.add(B.PELVIS, cyl(0.15, 0.23, 0.28, 16).translate(0, 0.21, 0), pants);
  else parts.add(B.PELVIS, rbox(0.25 * wide, 0.1, 0.16, 0.04).translate(0, 0.32, 0), pants);
  if (p.bottom === 'jeans') {
    // Seams down the outside of each leg, and a gold rivet by the pocket.
    parts.addPair(B.LEG_L, B.LEG_R, () => box(0.006, 0.15, 0.008).translate(J.legX + 0.052, 0.225, 0.01), STITCH);
    parts.addPair(B.KNEE_L, B.KNEE_R, () => box(0.006, 0.09, 0.008).translate(J.legX + 0.048, 0.105, 0.01), STITCH);
    parts.add(B.PELVIS, ball(0.008, 4, 3).translate(0.09, 0.33, 0.082), GOLD);
  } else if (p.bottom === 'cargo') {
    parts.addPair(B.LEG_L, B.LEG_R, () => rbox(0.03, 0.07, 0.07, 0.01).translate(J.legX + 0.065, 0.21, 0), darken(pants, 0.15));
  } else if (p.bottom === 'joggers') {
    parts.addPair(B.KNEE_L, B.KNEE_R, () => cyl(0.05, 0.05, 0.02, 10).translate(J.legX, 0.065, 0), darken(pants, 0.2));
    parts.addPair(B.LEG_L, B.LEG_R, () => box(0.008, 0.15, 0.008).translate(J.legX + 0.056, 0.225, 0), WHITE);
  } else if (p.bottom === 'shorts') {
    parts.addPair(B.LEG_L, B.LEG_R, () => cyl(0.06, 0.06, 0.02, 10).translate(J.legX, 0.15, 0), darken(pants, 0.15));
  }
}

/** @param {PartList} parts @param {PersonParts} p */
function addShoes(parts, p) {
  const color = p.colors.shoes;
  /** @param {() => import('three').BufferGeometry} make @param {string} c */
  const pair = (make, c) => parts.addPair(B.KNEE_L, B.KNEE_R, make, c);
  const x = J.legX;
  if (p.shoes === 'sandals') {
    pair(() => rbox(0.1, 0.04, 0.15, 0.02).translate(x, 0.04, 0.02), p.colors.skin);
    pair(() => box(0.104, 0.016, 0.03).translate(x, 0.052, 0.05), color);
    pair(() => box(0.116, 0.02, 0.166).translate(x, 0.01, 0.02), color);
  } else if (p.shoes === 'boots') {
    pair(() => rbox(0.112, 0.1, 0.16, 0.028).translate(x, 0.05, 0.02), color);
    pair(() => box(0.116, 0.016, 0.164).translate(x, 0.008, 0.02), SOLE);
    pair(() => box(0.114, 0.012, 0.03).translate(x, 0.085, 0.09), darken(color, 0.25));
  } else if (p.shoes === 'loafers') {
    pair(() => rbox(0.106, 0.045, 0.165, 0.022).translate(x, 0.03, 0.025), color);
    pair(() => box(0.06, 0.01, 0.02).translate(x, 0.05, 0.08), GOLD);
  } else if (p.shoes === 'slippers') {
    pair(() => rbox(0.118, 0.055, 0.17, 0.03).translate(x, 0.032, 0.025), color);
    pair(() => ball(0.03, 6, 5).translate(x, 0.06, 0.095), lighten(color, 0.35));
  } else {
    const high = p.shoes === 'hightops';
    pair(() => rbox(0.11, high ? 0.09 : 0.05, 0.17, 0.024).translate(x, high ? 0.05 : 0.033, 0.025), color);
    pair(() => box(0.116, 0.02, 0.174).translate(x, 0.01, 0.025), WHITE);
    pair(() => box(0.06, 0.006, 0.05).translate(x, high ? 0.093 : 0.06, 0.07), WHITE); // laces
  }
}

// ── torso and arms ───────────────────────────────────────────────────────────

/** @param {PartList} parts @param {PersonParts} p @param {number} w */
function addTorso(parts, p, w) {
  const { shirt, skin } = p.colors;
  const front = TORSO.d / 2 + 0.002;
  const torso = taper(rbox(TORSO.w * w, TORSO.h, TORSO.d, 0.07, 2), TORSO.h, TORSO.waist);
  const bib = p.top === 'vest' || p.top === 'overalls';
  // A vest is worn over a white shirt; overalls over a tee in the pattern colour.
  const under = p.top === 'vest' ? WHITE : p.top === 'overalls' ? p.colors.pattern : shirt;
  parts.add(B.SPINE, torso.translate(0, TORSO.y, 0), under);
  if (p.top === 'tank') parts.add(B.SPINE, box(0.2 * w, 0.06, 0.02).translate(0, 0.6, front), skin);
  if (bib) addBib(parts, p, w, front);
  else addPattern(parts, p, w, front);
  TOP_DETAILS[p.top]?.(parts, p, w, front);
  if (p.top === 'dress' || p.top === 'kimono' || p.top === 'labcoat') parts.add(B.PELVIS, cyl(0.16 * w, 0.21 * w, 0.2, 16).translate(0, 0.27, 0), shirt);
  if (!['dress', 'kimono', 'labcoat', 'tank'].includes(p.top)) parts.add(B.SPINE, rbox(0.29 * w, 0.04, 0.2, 0.015).translate(0, 0.375, 0), darken(p.colors.pants, 0.3));
}

/**
 * The top's pattern on the chest: stripes, checks, dots or a small emblem, in the pattern colour.
 * @param {PartList} parts @param {PersonParts} p @param {number} w @param {number} front
 */
function addPattern(parts, p, w, front) {
  const c = p.colors.pattern;
  if (p.topPattern === 'stripes') {
    for (const y of [0.44, 0.5, 0.56]) parts.add(B.SPINE, box(TORSO.w * w * taperAt((y - 0.375) / TORSO.h, TORSO.waist) + 0.006, 0.02, TORSO.d + 0.008).translate(0, y, 0), c);
  } else if (p.topPattern === 'checks') {
    [[-0.08, 0.45], [0.08, 0.45], [0, 0.53], [-0.08, 0.61], [0.08, 0.61]].forEach(([x, y]) => parts.add(B.SPINE, box(0.045, 0.045, 0.008).translate(x * w, y, front), c));
  } else if (p.topPattern === 'dots') {
    for (const [x, y] of [[-0.08, 0.46], [0.06, 0.5], [-0.03, 0.57], [0.09, 0.6], [-0.1, 0.62]]) parts.add(B.SPINE, ball(0.014, 6, 4).scale(1, 1, 0.4).translate(x * w, y, front), c);
  } else if (p.topPattern === 'emblem') {
    parts.add(B.SPINE, cyl(0.035, 0.035, 0.008, 12).rotateX(Math.PI / 2).translate(0.075 * w, 0.565, front), c);
    parts.add(B.SPINE, ball(0.012, 6, 4).translate(0.075 * w, 0.565, front + 0.006), darken(c, 0.35));
  }
}

/** Overalls' bib with straps, or a vest's front. @param {PartList} parts @param {PersonParts} p @param {number} w @param {number} front */
function addBib(parts, p, w, front) {
  const { shirt } = p.colors;
  if (p.top === 'overalls') {
    parts.add(B.SPINE, rbox(0.2 * w, 0.17, 0.02, 0.01).translate(0, 0.46, front), shirt);
    parts.addPair(B.SPINE, B.SPINE, () => box(0.03, 0.18, 0.02).translate(0.08 * w, 0.58, front), shirt);
    parts.addPair(B.SPINE, B.SPINE, () => ball(0.01, 4, 3).translate(0.08 * w, 0.54, front + 0.01), GOLD);
    parts.add(B.SPINE, rbox(0.07, 0.05, 0.01, 0.01).translate(0, 0.49, front + 0.012), darken(shirt, 0.12));
    if (p.topPattern === 'emblem') parts.add(B.SPINE, cyl(0.025, 0.025, 0.006, 12).rotateX(Math.PI / 2).translate(0, 0.505, front + 0.014), p.colors.pattern);
    return;
  }
  parts.addPair(B.SPINE, B.SPINE, () => box(0.1 * w, 0.22, 0.02).translate(0.07 * w, 0.49, front), shirt);
  for (const y of [0.43, 0.48, 0.53]) parts.add(B.SPINE, ball(0.009, 4, 3).translate(0.025, y, front + 0.01), DARK);
}

/** @type {Record<string, (parts: PartList, p: PersonParts, w: number, front: number) => void>} */
const TOP_DETAILS = {
  tee(parts, p, w, front) {
    parts.add(B.SPINE, ring(0.05, 0.01, Math.PI, 10).rotateZ(Math.PI).translate(0, 0.645, front - 0.04), darken(p.colors.shirt, 0.15));
  },
  longsleeve(parts, p, w, front) {
    parts.add(B.SPINE, ring(0.05, 0.01, Math.PI, 10).rotateZ(Math.PI).translate(0, 0.645, front - 0.04), darken(p.colors.shirt, 0.15));
  },
  hoodie(parts, p, w, front) {
    const trim = darken(p.colors.shirt, 0.18);
    parts.add(B.SPINE, ball(0.12, 10, 8).scale(1.3 * w, 0.85, 0.75).translate(0, 0.63, -0.095), trim); // hood
    parts.add(B.SPINE, rbox(0.17 * w, 0.07, 0.014, 0.02).translate(0, 0.45, front), trim); // pocket
    parts.addPair(B.SPINE, B.SPINE, () => box(0.008, 0.07, 0.008).translate(0.03, 0.585, front + 0.004), WHITE);
  },
  zip(parts, p, w, front) {
    parts.add(B.SPINE, box(0.012, 0.25, 0.012).translate(0, 0.5, front), SILVER);
    parts.add(B.SPINE, cyl(0.06, 0.07, 0.04, 12).translate(0, 0.645, 0), darken(p.colors.shirt, 0.15)); // collar
  },
  denim(parts, p, w, front) {
    parts.addPair(B.SPINE, B.SPINE, () => box(0.07, 0.05, 0.01).translate(0.07 * w, 0.56, front), darken(p.colors.shirt, 0.12));
    parts.addPair(B.SPINE, B.SPINE, () => box(0.004, 0.2, 0.01).translate(0.035 * w, 0.5, front + 0.002), STITCH);
    parts.addPair(B.SPINE, B.SPINE, () => box(0.07, 0.05, 0.02).rotateZ(-0.5).translate(0.05, 0.62, front - 0.01), darken(p.colors.shirt, 0.2));
  },
  bomber(parts, p, w, front) {
    parts.add(B.SPINE, box(0.012, 0.25, 0.012).translate(0, 0.5, front), SILVER);
    parts.add(B.SPINE, rbox(0.3 * w, 0.04, 0.21, 0.015).translate(0, 0.39, 0), darken(p.colors.shirt, 0.25));
    parts.add(B.SPINE, ring(0.06, 0.016, Math.PI * 2, 12).rotateX(Math.PI / 2).translate(0, 0.645, 0), darken(p.colors.shirt, 0.25));
  },
  blazer(parts, p, w, front) {
    parts.add(B.SPINE, box(0.06, 0.16, 0.01).translate(0, 0.55, front), WHITE); // shirt in the V
    parts.addPair(B.SPINE, B.SPINE, () => box(0.05, 0.14, 0.02).rotateZ(-0.35).translate(0.045, 0.56, front), darken(p.colors.shirt, 0.2));
    for (const y of [0.44, 0.48]) parts.add(B.SPINE, ball(0.009, 4, 3).translate(0, y, front + 0.008), DARK);
  },
  shirt(parts, p, w, front) {
    parts.addPair(B.SPINE, B.SPINE, () => box(0.06, 0.04, 0.02).rotateZ(-0.6).translate(0.04, 0.63, front - 0.01), lighten(p.colors.shirt, 0.15));
    for (const y of [0.44, 0.5, 0.56]) parts.add(B.SPINE, ball(0.008, 4, 3).translate(0, y, front + 0.004), WHITE);
  },
  polo(parts, p, w, front) {
    parts.addPair(B.SPINE, B.SPINE, () => box(0.06, 0.035, 0.02).rotateZ(-0.6).translate(0.04, 0.635, front - 0.01), darken(p.colors.shirt, 0.15));
    parts.add(B.SPINE, box(0.03, 0.06, 0.01).translate(0, 0.6, front), darken(p.colors.shirt, 0.1));
  },
  sweater(parts, p) {
    const trim = darken(p.colors.shirt, 0.15);
    parts.add(B.SPINE, ring(0.055, 0.016, Math.PI * 2, 12).rotateX(Math.PI / 2).translate(0, 0.645, 0), trim);
    parts.add(B.SPINE, rbox(0.3, 0.035, 0.2, 0.015).translate(0, 0.39, 0), trim);
  },
  cardigan(parts, p, w, front) {
    parts.add(B.SPINE, box(0.05, 0.25, 0.01).translate(0, 0.5, front), lighten(p.colors.shirt, 0.3));
    for (const y of [0.44, 0.5, 0.56]) parts.add(B.SPINE, ball(0.01, 4, 3).translate(0.035, y, front + 0.006), DARK);
  },
  labcoat(parts, p, w, front) {
    parts.addPair(B.SPINE, B.SPINE, () => box(0.05, 0.16, 0.02).rotateZ(-0.3).translate(0.045, 0.56, front), darken(p.colors.shirt, 0.08));
    parts.add(B.SPINE, box(0.04, 0.05, 0.01).translate(0.08, 0.54, front + 0.004), darken(p.colors.shirt, 0.1));
    parts.add(B.SPINE, box(0.006, 0.04, 0.008).translate(0.07, 0.56, front + 0.01), '#3B5BDB'); // a pen
  },
  dress(parts, p, w, front) {
    parts.add(B.SPINE, box(0.3 * w, 0.03, 0.21).translate(0, 0.4, 0), p.colors.pattern);
    parts.add(B.SPINE, ring(0.05, 0.01, Math.PI, 10).rotateZ(Math.PI).translate(0, 0.645, front - 0.04), darken(p.colors.shirt, 0.15));
  },
  kimono(parts, p, w, front) {
    parts.add(B.SPINE, rbox(0.31 * w, 0.06, 0.21, 0.02).translate(0, 0.41, 0), p.colors.pattern); // sash
    parts.add(B.SPINE, box(0.03, 0.2, 0.012).rotateZ(-0.45).translate(0.02, 0.55, front), darken(p.colors.shirt, 0.25));
  },
};

/** @param {PartList} parts @param {PersonParts} p @param {number} w */
function addArms(parts, p, w) {
  const { shirt, skin } = p.colors;
  const x = J.shoulderX + (w - 1) * 0.15;
  const sleeve = p.top === 'tank' ? skin : p.top === 'vest' ? WHITE : p.top === 'overalls' ? p.colors.pattern : shirt;
  const long = LONG_SLEEVES.has(p.top) || p.top === 'vest';
  const wide = p.top === 'kimono' ? 1.3 : 1;
  parts.addPair(B.ARM_L, B.ARM_R, () => rbox(0.088 * wide, 0.15, 0.09 * wide, 0.035).translate(x + 0.01, 0.54, 0), sleeve);
  parts.addPair(B.ELBOW_L, B.ELBOW_R, () => capsule(0.034 * (long ? wide : 1), 0.07).translate(x + 0.002, 0.42, 0), long ? sleeve : skin);
  if (long && p.top !== 'kimono') parts.addPair(B.ELBOW_L, B.ELBOW_R, () => cyl(0.038, 0.038, 0.02, 10).translate(x + 0.002, 0.37, 0), darken(sleeve, 0.15)); // cuffs
  parts.addPair(B.HAND_L, B.HAND_R, () => ball(0.042, 8, 6).translate(x + 0.002, 0.335, 0.005), skin);
}

// ── head and hair ────────────────────────────────────────────────────────────

/** @param {PartList} parts @param {PersonParts} p */
function addHead(parts, p) {
  const { skin, hair } = p.colors;
  parts.add(B.HEAD, ball(J.headR, 16, 12).scale(1, 0.94, 0.96).translate(0, J.headY, 0), skin);
  parts.addPair(B.HEAD, B.HEAD, () => ball(0.032, 6, 5).scale(0.6, 1, 1).translate(0.163, 0.795, 0), skin);
  parts.add(B.HEAD, ball(0.017, 6, 5).translate(0, 0.783, 0.158), darken(skin, 0.1)); // nose
  EYES[p.eyes]?.(parts);
  if (p.brows !== 'none') {
    const thick = p.brows === 'thick' ? 1.6 : 1;
    const tilt = p.brows === 'arched' ? 0.35 : 0.12;
    parts.addPair(B.EYES, B.EYES, () => box(0.045, 0.008 * thick, 0.01).rotateZ(-tilt).translate(0.058, 0.85, 0.145), darken(hair, 0.1));
  }
  MOUTHS[p.mouth]?.(parts);
  if (p.cheeks === 'blush' || p.cheeks === 'both') parts.addPair(B.HEAD, B.HEAD, () => ball(0.024, 8, 6).scale(1, 0.6, 0.35).translate(0.098, 0.762, 0.135), mix(skin, '#F27C7C', 0.5));
  if (p.cheeks === 'freckles' || p.cheeks === 'both') {
    const dot = darken(skin, 0.28);
    for (const [x, y] of [[0.085, 0.785], [0.11, 0.792], [0.097, 0.8]]) parts.addPair(B.HEAD, B.HEAD, () => ball(0.006, 4, 3).translate(x, y, 0.145), dot);
  }
  addFacialHair(parts, p.facialHair, hair);
  addGlasses(parts, p.glasses, p.colors.theme);
  if (p.earrings === 'studs') parts.addPair(B.HEAD, B.HEAD, () => ball(0.012, 6, 4).translate(0.17, 0.765, 0.01), GOLD);
  if (p.earrings === 'hoops') parts.addPair(B.HEAD, B.HEAD, () => ring(0.022, 0.005, Math.PI * 2, 10).rotateY(Math.PI / 2).translate(0.172, 0.745, 0.01), GOLD);
}

/** @type {Record<string, (parts: PartList) => void>} */
const EYES = {
  dot(parts) {
    parts.addPair(B.EYES, B.EYES, () => ball(0.021, 8, 6).scale(1, 1.15, 0.6).translate(0.056, 0.805, 0.15), EYE);
    parts.addPair(B.EYES, B.EYES, () => ball(0.0065, 4, 3).translate(0.05, 0.815, 0.162), '#FFFFFF');
  },
  round(parts) {
    parts.addPair(B.EYES, B.EYES, () => ball(0.03, 8, 6).scale(1, 1.05, 0.5).translate(0.058, 0.805, 0.148), '#FFFFFF');
    parts.addPair(B.EYES, B.EYES, () => ball(0.017, 8, 6).scale(1, 1, 0.6).translate(0.056, 0.803, 0.16), EYE);
  },
  happy(parts) {
    parts.addPair(B.EYES, B.EYES, () => ring(0.02, 0.006, Math.PI, 8).translate(0.056, 0.8, 0.155), EYE);
  },
  sleepy(parts) {
    parts.addPair(B.EYES, B.EYES, () => box(0.036, 0.008, 0.01).translate(0.056, 0.808, 0.155), EYE);
    parts.addPair(B.EYES, B.EYES, () => ball(0.02, 8, 5).scale(1, 0.4, 0.5).translate(0.056, 0.799, 0.152), EYE);
  },
  lashes(parts) {
    parts.addPair(B.EYES, B.EYES, () => ball(0.021, 8, 6).scale(1, 1.15, 0.6).translate(0.056, 0.805, 0.15), EYE);
    parts.addPair(B.EYES, B.EYES, () => box(0.014, 0.005, 0.006).rotateZ(-0.6).translate(0.08, 0.83, 0.15), EYE);
    parts.addPair(B.EYES, B.EYES, () => box(0.012, 0.005, 0.006).rotateZ(-0.2).translate(0.066, 0.836, 0.152), EYE);
  },
  wink(parts) {
    parts.add(B.EYES, ball(0.021, 8, 6).scale(1, 1.15, 0.6).translate(0.056, 0.805, 0.15), EYE);
    parts.add(B.EYES, ring(0.02, 0.006, Math.PI, 8).rotateZ(Math.PI).translate(-0.056, 0.812, 0.155), EYE);
  },
};

/** @type {Record<string, (parts: PartList) => void>} */
const MOUTHS = {
  smile(parts) {
    parts.add(B.HEAD, ring(0.026, 0.0065, Math.PI, 10).rotateZ(Math.PI).rotateX(0.35).translate(0, 0.757, 0.152), MOUTH);
  },
  grin(parts) {
    parts.add(B.HEAD, halfDisc(0.032, 0.012, 10).rotateX(-Math.PI / 2).rotateZ(Math.PI).translate(0, 0.756, 0.152), '#FFFFFF');
    parts.add(B.HEAD, ring(0.032, 0.006, Math.PI, 10).rotateZ(Math.PI).translate(0, 0.756, 0.152), MOUTH);
  },
  neutral(parts) {
    parts.add(B.HEAD, box(0.04, 0.007, 0.008).translate(0, 0.752, 0.155), MOUTH);
  },
  open(parts) {
    parts.add(B.HEAD, ball(0.018, 8, 6).scale(1.1, 1, 0.4).translate(0, 0.75, 0.152), MOUTH);
  },
};

/** @param {PartList} parts @param {string} kind @param {string} hair */
function addFacialHair(parts, kind, hair) {
  if (kind === 'stubble') parts.add(B.HEAD, ball(0.13, 12, 8).scale(1.1, 0.55, 0.72).translate(0, 0.725, 0.065), mix(hair, '#C89A7A', 0.55));
  else if (kind === 'beard') parts.add(B.HEAD, ball(0.13, 12, 8).scale(1.15, 0.7, 0.75).translate(0, 0.72, 0.06), hair);
  else if (kind === 'goatee') parts.add(B.HEAD, cone(0.03, 0.06, 8).rotateX(Math.PI).translate(0, 0.705, 0.135), hair);
  if (kind === 'moustache' || kind === 'goatee' || kind === 'beard') parts.add(B.HEAD, ball(0.04, 8, 5).scale(1.3, 0.35, 0.5).translate(0, 0.77, 0.158), hair);
}

/** @param {PartList} parts @param {string} kind @param {string} theme */
function addGlasses(parts, kind, theme) {
  if (kind === 'none') return;
  const frame = kind === 'goggles' ? '#5B4A3A' : kind === 'sunglasses' ? '#111114' : DARK;
  if (kind === 'square' || kind === 'sunglasses') {
    parts.addPair(B.HEAD, B.HEAD, () => rbox(0.06, 0.045, 0.008, 0.008).translate(0.056, 0.805, 0.163), frame);
    if (kind === 'sunglasses') parts.addPair(B.HEAD, B.HEAD, () => box(0.052, 0.036, 0.006).translate(0.056, 0.805, 0.167), '#24242A');
  } else {
    const r = kind === 'goggles' ? 0.038 : 0.033;
    parts.addPair(B.HEAD, B.HEAD, () => ring(r, kind === 'goggles' ? 0.011 : 0.0075, Math.PI * 2, 12).translate(0.056, 0.805, 0.163), frame);
    if (kind === 'goggles') {
      parts.addPair(B.HEAD, B.HEAD, () => cyl(0.032, 0.032, 0.006, 12).rotateX(Math.PI / 2).translate(0.056, 0.805, 0.164), mix(theme, '#9EE6FF', 0.6));
      parts.add(B.HEAD, ring(0.172, 0.012, Math.PI * 2, 20).rotateX(Math.PI / 2).translate(0, 0.81, 0), '#5B4A3A');
    }
  }
  parts.add(B.HEAD, box(0.04, 0.008, 0.008).translate(0, 0.81, 0.168), frame);
  parts.addPair(B.HEAD, B.HEAD, () => box(0.008, 0.008, 0.16).translate(0.155, 0.81, 0.075), frame);
}

/** @param {PartList} parts @param {PersonParts} p */
function addHair(parts, p) {
  const { hair, streak } = p.colors;
  if (p.hair === 'bald') return;
  if (p.hair === 'buzz') {
    parts.add(B.HEAD, dome(0.168, 1.25).rotateX(-0.4).translate(0, 0.803, -0.004), hair);
    return;
  }
  const covered = COVERING_HATS.has(p.hat);
  // The helmet of hair every style starts from: the hairline high at the front, low at the neck.
  parts.add(B.HEAD, dome(0.173, 1.3).rotateX(-0.4).translate(0, 0.805, -0.005), hair);
  if (streak && !covered) parts.add(B.HEAD, box(0.035, 0.012, 0.16).rotateX(-0.25).translate(0.06, 0.95, 0.03), streak);
  HAIR[p.hair]?.(parts, hair, streak ?? hair, covered);
}

/** @type {Record<string, (parts: PartList, hair: string, tips: string, covered: boolean) => void>} */
const HAIR = {
  short(parts, hair, tips, covered) {
    if (covered) return;
    parts.add(B.HEAD, ball(0.07, 8, 6).scale(1.5, 0.65, 1).rotateZ(0.25).translate(0.03, 0.955, 0.075), hair);
    parts.add(B.HEAD, ball(0.05, 8, 6).scale(1.2, 0.7, 1).translate(-0.07, 0.94, 0.09), tips);
  },
  side(parts, hair, tips, covered) {
    if (covered) return;
    parts.add(B.HEAD, ball(0.09, 10, 6).scale(1.7, 0.5, 1.1).rotateZ(-0.3).translate(-0.04, 0.96, 0.06), hair);
    parts.add(B.HEAD, box(0.006, 0.02, 0.12).translate(0.06, 0.975, 0.02), darken(hair, 0.35)); // the parting
    parts.add(B.HEAD, ball(0.04, 8, 5).translate(0.11, 0.93, 0.1), tips);
  },
  quiff(parts, hair, tips, covered) {
    if (!covered) parts.add(B.HEAD, ball(0.075, 10, 8).scale(1.4, 0.9, 1.2).rotateX(-0.6).translate(0, 1.0, 0.09), tips);
  },
  spiky(parts, hair, tips, covered) {
    if (covered) return;
    for (const [x, z, t] of [[-0.08, 0.05, -0.4], [0, 0.07, 0], [0.08, 0.05, 0.4], [-0.05, -0.06, -0.3], [0.05, -0.06, 0.3]]) {
      parts.add(B.HEAD, cone(0.04, 0.1, 6).rotateZ(-t).rotateX(z * 4).translate(x, 0.98, z), tips);
    }
  },
  straight(parts, hair, tips) {
    parts.add(B.HEAD, rbox(0.33, 0.3, 0.11, 0.05).translate(0, 0.66, -0.11), hair);
    parts.addPair(B.HEAD, B.HEAD, () => rbox(0.05, 0.22, 0.1, 0.02).translate(0.15, 0.7, 0.03), tips);
  },
  wavy(parts, hair, tips) {
    for (const [x, y] of [[-0.13, 0.66], [0, 0.63], [0.13, 0.66], [-0.08, 0.56], [0.08, 0.56]]) parts.add(B.HEAD, ball(0.07, 8, 6).translate(x, y, -0.1), y < 0.6 ? tips : hair);
    parts.addPair(B.HEAD, B.HEAD, () => ball(0.05, 8, 6).scale(0.8, 1.6, 1).translate(0.15, 0.7, 0.03), hair);
  },
  ponytail(parts, hair, tips) {
    parts.add(B.HEAD, cyl(0.025, 0.025, 0.03, 8).rotateX(0.5).translate(0, 0.86, -0.17), lighten(hair, 0.4));
    parts.add(B.HEAD, capsule(0.04, 0.16, 6).rotateX(0.35).translate(0, 0.74, -0.2), tips);
  },
  pigtails(parts, hair, tips) {
    parts.addPair(B.HEAD, B.HEAD, () => capsule(0.04, 0.12, 6).rotateZ(0.4).translate(0.2, 0.74, -0.04), tips);
  },
  bun(parts, hair, tips, covered) {
    if (!covered) parts.add(B.HEAD, ball(0.075, 10, 8).translate(0, 0.98, -0.07), tips);
  },
  braids(parts, hair, tips) {
    for (const side of [1, -1]) for (let k = 0; k < 4; k++) parts.add(B.HEAD, ball(0.034, 6, 5).translate(side * 0.13, 0.7 - k * 0.055, -0.07), k === 3 ? tips : hair);
  },
  afro(parts, hair, tips, covered) {
    if (!covered) parts.add(B.HEAD, ball(0.24, 14, 10).scale(1, 0.85, 0.95).translate(0, 0.9, -0.03), hair);
  },
  curly(parts, hair, tips, covered) {
    if (covered) return;
    for (const [x, y, z] of [[-0.09, 0.93, 0.07], [0, 0.96, 0.08], [0.09, 0.93, 0.07], [-0.12, 0.88, -0.04], [0.12, 0.88, -0.04], [0, 0.95, -0.07]]) parts.add(B.HEAD, ball(0.055, 8, 6).translate(x, y, z), z > 0 ? tips : hair);
  },
  mohawk(parts, hair, tips, covered) {
    if (!covered) parts.add(B.HEAD, rbox(0.04, 0.12, 0.3, 0.02).translate(0, 0.98, -0.01), tips);
  },
};

// ── extras, pet and hand ─────────────────────────────────────────────────────

/** @type {Record<string, (parts: PartList, color: string, w: number, front: number) => void>} */
const EXTRAS = {
  cape(parts, color, w) {
    parts.add(B.SPINE, box(0.36 * w, 0.42, 0.02).rotateX(0.12).translate(0, 0.42, -0.13), darken(color, 0.15));
    parts.add(B.SPINE, box(0.38 * w, 0.03, 0.06).translate(0, 0.635, -0.1), darken(color, 0.3));
  },
  scarf(parts, color) {
    parts.add(B.SPINE, ring(0.085, 0.032, Math.PI * 2, 14).rotateX(Math.PI / 2).translate(0, 0.64, 0), color);
    parts.add(B.SPINE, box(0.06, 0.17, 0.03).rotateZ(0.12).translate(0.06, 0.53, 0.105), lighten(color, 0.15));
  },
  backpack(parts, color, w) {
    parts.add(B.SPINE, rbox(0.23, 0.25, 0.11, 0.04).translate(0, 0.52, -0.155), color);
    parts.add(B.SPINE, rbox(0.16, 0.08, 0.04, 0.015).translate(0, 0.46, -0.215), darken(color, 0.2));
    parts.addPair(B.SPINE, B.SPINE, () => box(0.035, 0.24, 0.016).translate(0.085 * w, 0.52, 0.104), '#5A3A1E');
  },
  headphones(parts, color) {
    parts.add(B.HEAD, ring(0.182, 0.016, Math.PI, 16).translate(0, 0.8, 0), DARK);
    parts.addPair(B.HEAD, B.HEAD, () => cyl(0.05, 0.05, 0.045, 14).rotateZ(Math.PI / 2).translate(0.172, 0.795, 0), color);
  },
  tie(parts, color, w, front) {
    parts.add(B.SPINE, box(0.03, 0.03, 0.01).translate(0, 0.625, front), darken(color, 0.2));
    parts.add(B.SPINE, box(0.035, 0.17, 0.01).translate(0, 0.52, front), color);
  },
  bowtie(parts, color, w, front) {
    parts.addPair(B.SPINE, B.SPINE, () => cone(0.025, 0.04, 4).rotateZ(Math.PI / 2).translate(0.02, 0.625, front), color);
  },
  necklace(parts, color, w, front) {
    parts.add(B.SPINE, ring(0.07, 0.006, Math.PI, 12).rotateZ(Math.PI).rotateX(-0.3).translate(0, 0.635, front - 0.04), GOLD);
    parts.add(B.SPINE, ball(0.016, 6, 4).translate(0, 0.57, front), color);
  },
  watch(parts, color) {
    parts.add(B.ELBOW_L, cyl(0.04, 0.04, 0.025, 10).translate(J.shoulderX + 0.002, 0.37, 0), DARK);
    parts.add(B.ELBOW_L, box(0.01, 0.026, 0.026).translate(J.shoulderX + 0.045, 0.37, 0), color);
  },
  satchel(parts, color, w) {
    parts.add(B.SPINE, rbox(0.06, 0.13, 0.15, 0.02).translate(0.21 * w, 0.38, 0), color);
    parts.add(B.SPINE, box(0.028, 0.44, 0.012).rotateZ(0.62).translate(0, 0.52, 0.106), '#5A3A1E');
  },
  wings(parts) {
    parts.addPair(B.SPINE, B.SPINE, () => ball(0.12, 10, 6).scale(0.5, 1.4, 0.12).rotateZ(-0.5).translate(0.14, 0.62, -0.14), '#FFFFFF');
  },
};

/** @param {PartList} parts @param {PersonParts} p @param {number} w */
function addExtra(parts, p, w) {
  EXTRAS[p.extra]?.(parts, p.colors.theme, w, TORSO.d / 2 + 0.012);
}

/**
 * A small pet walking at the person's left heel, on the body bone (no draw call of its own); a
 * bird sits on their shoulder.
 * @param {PartList} parts @param {string} kind @param {PersonParts['colors']} colors
 */
function addPet(parts, kind, colors) {
  if (kind === 'none') return;
  if (kind === 'bird') {
    parts.add(B.SPINE, ball(0.04, 8, 6).scale(1, 0.9, 1.3).translate(0.2, 0.68, 0), '#F2C230');
    parts.add(B.SPINE, cone(0.012, 0.03, 5).rotateX(Math.PI / 2).translate(0.2, 0.69, 0.055), '#E0742A');
    parts.add(B.SPINE, ball(0.006, 4, 3).translate(0.225, 0.7, 0.03), EYE);
    return;
  }
  const x = 0.32;
  const z = 0.12;
  const fur = kind === 'cat' ? '#8C8F96' : '#A86B3C';
  parts.add(B.BODY, rbox(0.07, 0.06, 0.13, 0.025).translate(x, 0.08, z), fur);
  parts.add(B.BODY, ball(0.045, 8, 6).translate(x, 0.135, z + 0.08), fur);
  for (const [dx, dz] of [[-0.022, -0.04], [0.022, -0.04], [-0.022, 0.04], [0.022, 0.04]]) parts.add(B.BODY, box(0.018, 0.05, 0.018).translate(x + dx, 0.025, z + dz), darken(fur, 0.15));
  for (const dx of [-0.022, 0.022]) parts.add(B.BODY, (kind === 'cat' ? cone(0.016, 0.035, 4) : ball(0.016, 5, 4).scale(1, 1.6, 0.6)).translate(x + dx, 0.18, z + 0.08), darken(fur, 0.2));
  parts.add(B.BODY, cyl(0.01, 0.006, 0.08, 5).rotateX(kind === 'cat' ? -0.3 : -1).translate(x, 0.13, z - 0.08), fur);
  parts.add(B.BODY, ball(0.007, 4, 3).translate(x, 0.14, z + 0.125), EYE);
  parts.add(B.BODY, box(0.075, 0.012, 0.012).translate(x, 0.105, z + 0.055), colors.theme); // collar
}

/** Something held in the right hand. @param {PartList} parts @param {string} kind @param {string} theme */
function addHandItem(parts, kind, theme) {
  const x = -J.shoulderX - 0.002;
  const y = 0.31;
  if (kind === 'laptop') {
    parts.add(B.HAND_R, rbox(0.17, 0.012, 0.12, 0.005).translate(x, y, 0.05), '#9AA3AD');
    parts.add(B.HAND_R, rbox(0.17, 0.11, 0.008, 0.004).rotateX(-0.3).translate(x, y + 0.055, -0.005), '#9AA3AD');
    parts.add(B.HAND_R, ball(0.01, 6, 4).translate(x, y + 0.06, 0.002), theme);
  } else if (kind === 'coffee') {
    parts.add(B.HAND_R, cyl(0.03, 0.025, 0.07, 10).translate(x, y, 0.04), WHITE);
    parts.add(B.HAND_R, cyl(0.031, 0.031, 0.025, 10).translate(x, y, 0.04), theme);
    parts.add(B.HAND_R, cyl(0.032, 0.032, 0.008, 10).translate(x, y + 0.038, 0.04), '#5A3A1E');
  } else if (kind === 'book') {
    parts.add(B.HAND_R, rbox(0.03, 0.14, 0.1, 0.005).translate(x - 0.01, y, 0.03), theme);
    parts.add(B.HAND_R, box(0.022, 0.13, 0.092).translate(x - 0.004, y, 0.03), WHITE);
  }
}
