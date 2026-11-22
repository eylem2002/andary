// The toy figure's body, face, hair and worn accessories, modelled in figure space (boots at
// y = 0, facing +z, the figure's left at +x). Chunky proportions and a big head keep it readable
// when it is only a few dozen pixels tall. Helpers all wear the plain look (a tee, trousers and
// boots, short hair, dot eyes); a person's chosen hair, eyes, face, top, bottom and shoes are
// variations of it (looks.js).

import { B, JOINTS as J } from './rig.js';
import { ball, box, capsule, cone, cyl, dome, rbox, ring, taper, taperAt } from './figure-parts.js';

/** @typedef {import('./figure-parts.js').PartList} PartList */
import { darken, mix } from './color.js';

const SOLE = '#2A1D15';
const SNEAKER_SOLE = '#F2F0EA';
const BELT = '#3A2A1F';
const GOLD = '#E0B33A';
const EYE = '#1A1A22';
const MOUTH = '#6B2F2A';
const DARK = '#2D3340';

const TORSO = { w: 0.33, h: 0.27, d: 0.2, y: 0.51, waist: 0.86 };

/**
 * @param {PartList} parts
 * @param {import('./looks.js').Look} look
 */
export function addBody(parts, look) {
  const { shirt } = look;
  addLegs(parts, look);
  if (look.bottom === 'skirt') {
    parts.add(B.PELVIS, cyl(0.15, 0.2, 0.17, 14).translate(0, 0.29, 0), look.pants);
  } else {
    parts.add(B.PELVIS, rbox(0.25, 0.1, 0.16, 0.04).translate(0, 0.32, 0), look.pants);
  }
  parts.add(B.SPINE, rbox(0.29, 0.04, 0.2, 0.015).translate(0, 0.375, 0), look.top === 'sweater' ? darken(shirt, 0.15) : BELT);
  if (look.top === 'tee') parts.add(B.SPINE, box(0.05, 0.03, 0.012).translate(0, 0.375, 0.1), GOLD);
  const torso = taper(rbox(TORSO.w, TORSO.h, TORSO.d, 0.07, 2), TORSO.h, TORSO.waist);
  parts.add(B.SPINE, torso.translate(0, TORSO.y, 0), shirt);
  addTop(parts, look);
  parts.add(B.HEAD, cyl(0.05, 0.056, 0.05, 8).translate(0, 0.665, 0), look.skin); // neck
  addArms(parts, look);
  addHead(parts, look);
}

/**
 * What makes each top: a tee has a breast pocket, a hoodie a hood and a front pocket, a jacket
 * a zip and a collar, a sweater a ribbed neck.
 * @param {PartList} parts @param {import('./looks.js').Look} look
 */
function addTop(parts, look) {
  const { shirt } = look;
  const trim = darken(shirt, 0.18);
  if (look.top === 'tee') {
    parts.add(B.SPINE, box(0.06, 0.05, 0.012).translate(0.08, 0.555, 0.098), trim); // pocket
  } else if (look.top === 'hoodie') {
    parts.add(B.SPINE, ball(0.11, 10, 8).scale(1.25, 0.8, 0.75).translate(0, 0.63, -0.09), trim); // hood
    parts.add(B.SPINE, rbox(0.17, 0.07, 0.014, 0.02).translate(0, 0.45, 0.098), trim); // pocket
    parts.addPair(B.SPINE, B.SPINE, () => box(0.008, 0.07, 0.008).translate(0.03, 0.585, 0.103), '#F2F0EA');
  } else if (look.top === 'jacket') {
    parts.add(B.SPINE, box(0.012, 0.24, 0.012).translate(0, 0.5, 0.101), darken(shirt, 0.35)); // zip
    parts.addPair(B.SPINE, B.SPINE, () => box(0.07, 0.05, 0.02).rotateZ(-0.5).translate(0.05, 0.62, 0.09), trim);
  } else {
    parts.add(B.SPINE, ring(0.055, 0.016, Math.PI * 2, 12).rotateX(Math.PI / 2).translate(0, 0.645, 0), trim);
  }
}

/** @param {PartList} parts @param {import('./looks.js').Look} look */
function addLegs(parts, look) {
  const thigh = look.bottom === 'skirt' ? look.skin : look.pants;
  const shin = look.bottom === 'trousers' ? look.pants : look.skin;
  const thin = look.bottom === 'trousers' ? 1 : 0.8;
  parts.addPair(B.LEG_L, B.LEG_R, () => rbox(0.104 * thin, 0.16, 0.115 * thin, 0.035).translate(J.legX, 0.225, 0), thigh);
  parts.addPair(B.KNEE_L, B.KNEE_R, () => rbox(0.096 * thin, 0.1, 0.105 * thin, 0.03).translate(J.legX, 0.105, 0), shin);
  addShoes(parts, look);
}

/** @param {PartList} parts @param {import('./looks.js').Look} look */
function addShoes(parts, look) {
  const color = look.shoesColor;
  if (look.shoes === 'sneakers') {
    parts.addPair(B.KNEE_L, B.KNEE_R, () => rbox(0.11, 0.05, 0.17, 0.024).translate(J.legX, 0.033, 0.025), color);
    parts.addPair(B.KNEE_L, B.KNEE_R, () => box(0.116, 0.02, 0.174).translate(J.legX, 0.01, 0.025), SNEAKER_SOLE);
    return;
  }
  if (look.shoes === 'sandals') {
    parts.addPair(B.KNEE_L, B.KNEE_R, () => rbox(0.1, 0.04, 0.15, 0.02).translate(J.legX, 0.04, 0.02), look.skin);
    parts.addPair(B.KNEE_L, B.KNEE_R, () => box(0.104, 0.016, 0.03).translate(J.legX, 0.052, 0.05), color);
    parts.addPair(B.KNEE_L, B.KNEE_R, () => box(0.116, 0.02, 0.166).translate(J.legX, 0.01, 0.02), color);
    return;
  }
  parts.addPair(B.KNEE_L, B.KNEE_R, () => rbox(0.112, 0.065, 0.16, 0.028).translate(J.legX, 0.036, 0.02), color);
  parts.addPair(B.KNEE_L, B.KNEE_R, () => box(0.116, 0.014, 0.164).translate(J.legX, 0.007, 0.02), SOLE);
}

/** Short sleeves for a tee, long ones for the rest. @param {PartList} parts @param {import('./looks.js').Look} look */
function addArms(parts, look) {
  const { shirt, skin } = look;
  const x = J.shoulderX;
  parts.addPair(B.ARM_L, B.ARM_R, () => rbox(0.088, 0.15, 0.09, 0.035).translate(x + 0.01, 0.54, 0), shirt);
  parts.addPair(B.ELBOW_L, B.ELBOW_R, () => capsule(0.034, 0.07).translate(x + 0.002, 0.42, 0), look.top === 'tee' ? skin : shirt);
  parts.addPair(B.HAND_L, B.HAND_R, () => ball(0.042, 8, 6).translate(x + 0.002, 0.335, 0.005), skin);
  // A wristwatch on the left arm, for checking while waiting.
  parts.add(B.ELBOW_L, ring(0.037, 0.011, Math.PI * 2, 10).rotateX(Math.PI / 2).translate(x + 0.002, 0.372, 0), DARK);
  parts.add(B.ELBOW_L, box(0.01, 0.028, 0.03).translate(x + 0.043, 0.372, 0), '#F5F5F0');
}

/** @param {PartList} parts @param {import('./looks.js').Look} look */
function addHead(parts, look) {
  const { skin } = look;
  parts.add(B.HEAD, ball(J.headR, 16, 12).scale(1, 0.94, 0.96).translate(0, J.headY, 0), skin);
  parts.addPair(B.HEAD, B.HEAD, () => ball(0.032, 6, 5).scale(0.6, 1, 1).translate(0.163, 0.795, 0), skin);
  parts.add(B.HEAD, ball(0.017, 6, 5).translate(0, 0.783, 0.158), darken(skin, 0.1)); // nose
  addEyes(parts, look.eyes);
  const blush = mix(skin, '#F27C7C', 0.45);
  parts.addPair(B.HEAD, B.HEAD, () => ball(0.024, 8, 6).scale(1, 0.6, 0.35).translate(0.098, 0.762, 0.135), blush);
  // A smile: the lower half of a thin ring, tucked into the curve of the face.
  parts.add(B.HEAD, ring(0.026, 0.0065, Math.PI, 10).rotateZ(Math.PI).rotateX(0.35).translate(0, 0.757, 0.152), MOUTH);
  addFace(parts, look);
  addHair(parts, look);
}

/** @param {PartList} parts @param {string} eyes */
function addEyes(parts, eyes) {
  if (eyes === 'happy') {
    // Closed, smiling eyes: the upper half of a thin ring.
    parts.addPair(B.EYES, B.EYES, () => ring(0.02, 0.006, Math.PI, 8).translate(0.056, 0.8, 0.155), EYE);
    return;
  }
  if (eyes === 'round') {
    parts.addPair(B.EYES, B.EYES, () => ball(0.03, 8, 6).scale(1, 1.05, 0.5).translate(0.058, 0.805, 0.148), '#FFFFFF');
    parts.addPair(B.EYES, B.EYES, () => ball(0.017, 8, 6).scale(1, 1, 0.6).translate(0.056, 0.803, 0.16), EYE);
    return;
  }
  parts.addPair(B.EYES, B.EYES, () => ball(0.021, 8, 6).scale(1, 1.15, 0.6).translate(0.056, 0.805, 0.15), EYE);
  parts.addPair(B.EYES, B.EYES, () => ball(0.0065, 4, 3).translate(0.05, 0.815, 0.162), '#FFFFFF');
}

/** Freckles, a beard, a moustache or glasses. @param {PartList} parts @param {import('./looks.js').Look} look */
function addFace(parts, look) {
  if (look.face === 'glasses') WEARABLES.glasses(parts, look);
  else if (look.face === 'moustache') parts.add(B.HEAD, ball(0.04, 8, 5).scale(1.3, 0.35, 0.5).translate(0, 0.77, 0.158), look.hair);
  else if (look.face === 'beard') parts.add(B.HEAD, ball(0.13, 12, 8).scale(1.15, 0.7, 0.75).translate(0, 0.72, 0.06), look.hair);
  else if (look.face === 'freckles') {
    const dot = darken(look.skin, 0.25);
    for (const [x, y] of [[0.085, 0.775], [0.11, 0.785], [0.095, 0.792]]) parts.addPair(B.HEAD, B.HEAD, () => ball(0.006, 4, 3).translate(x, y, 0.142), dot);
  }
}

/** @param {PartList} parts @param {import('./looks.js').Look} look */
function addHair(parts, look) {
  const { hair, hairStyle } = look;
  if (hairStyle === 'bald') return;
  if (hairStyle === 'buzz') {
    parts.add(B.HEAD, dome(0.168, 1.25).rotateX(-0.4).translate(0, 0.803, -0.004), hair);
    return;
  }
  // A helmet of hair tilted back: the hairline sits high at the front and low at the neck.
  parts.add(B.HEAD, dome(0.173, 1.3).rotateX(-0.4).translate(0, 0.805, -0.005), hair);
  if (hairStyle === 'long') parts.add(B.HEAD, rbox(0.3, 0.24, 0.1, 0.05).translate(0, 0.68, -0.11), hair);
  if (look.hat !== 'none') return;
  if (hairStyle === 'bun') {
    parts.add(B.HEAD, ball(0.075, 10, 8).translate(0, 0.98, -0.07), hair);
  } else if (hairStyle === 'curly') {
    for (const [x, y, z] of [[-0.09, 0.93, 0.07], [0, 0.96, 0.08], [0.09, 0.93, 0.07], [-0.12, 0.88, -0.04], [0.12, 0.88, -0.04], [0, 0.95, -0.07]]) {
      parts.add(B.HEAD, ball(0.055, 8, 6).translate(x, y, z), hair);
    }
  } else {
    parts.add(B.HEAD, ball(0.07, 8, 6).scale(1.5, 0.65, 1).rotateZ(0.25).translate(0.03, 0.955, 0.075), hair);
    parts.add(B.HEAD, ball(0.05, 8, 6).scale(1.2, 0.7, 1).translate(-0.07, 0.94, 0.09), hair);
  }
}

/**
 * Worn accessories: always visible, part of who the agent is.
 * @param {PartList} parts
 * @param {import('./looks.js').Look} look
 */
export function addWearable(parts, look) {
  const add = WEARABLES[look.wearable];
  if (add) add(parts, look);
}

/** @type {Record<string, (parts: PartList, look: import('./looks.js').Look) => void>} */
const WEARABLES = {
  hivis(parts) {
    // Reflective stripes around the Foreman's shirt.
    for (const y of [0.462, 0.56]) {
      const s = taperAt((y - (TORSO.y - TORSO.h / 2)) / TORSO.h, TORSO.waist);
      parts.add(B.SPINE, rbox((TORSO.w + 0.01) * s, 0.03, TORSO.d * (0.5 + 0.5 * s) + 0.01, 0.012).translate(0, y, 0), '#E9F542');
    }
  },
  backpack(parts) {
    parts.add(B.SPINE, rbox(0.23, 0.25, 0.11, 0.04).translate(0, 0.52, -0.155), '#E8833A');
    parts.add(B.SPINE, rbox(0.235, 0.07, 0.116, 0.025).translate(0, 0.625, -0.155), '#C96A27');
    parts.add(B.SPINE, rbox(0.16, 0.08, 0.04, 0.015).translate(0, 0.46, -0.215), '#C96A27');
    parts.addPair(B.SPINE, B.SPINE, () => box(0.035, 0.24, 0.016).translate(0.085, 0.52, 0.104), '#5A3A1E');
  },
  glasses(parts) {
    parts.addPair(B.HEAD, B.HEAD, () => ring(0.034, 0.0075, Math.PI * 2, 12).translate(0.056, 0.805, 0.163), DARK);
    parts.add(B.HEAD, box(0.04, 0.008, 0.008).translate(0, 0.81, 0.168), DARK);
    parts.addPair(B.HEAD, B.HEAD, () => box(0.008, 0.008, 0.16).translate(0.155, 0.81, 0.075), DARK);
  },
  net(parts) {
    // A bug net slung across the back, for the testers.
    parts.add(B.SPINE, cyl(0.009, 0.009, 0.55, 6).rotateZ(0.5).translate(0, 0.58, -0.135), '#A0703C');
    parts.add(B.SPINE, ring(0.075, 0.009, Math.PI * 2, 14).translate(-0.168, 0.887, -0.135), '#D64541');
    parts.add(B.SPINE, cone(0.07, 0.12, 8).rotateX(-Math.PI / 2).translate(-0.168, 0.887, -0.2), '#E6EAF0');
  },
  earpencil(parts) {
    parts.add(B.HEAD, cyl(0.009, 0.009, 0.1, 6).rotateX(Math.PI / 2 - 0.3).translate(-0.172, 0.85, 0), '#F2C230');
    parts.add(B.HEAD, cone(0.009, 0.025, 6).rotateX(Math.PI / 2 - 0.3).translate(-0.172, 0.835, 0.06), '#E8C99B');
    parts.add(B.HEAD, cyl(0.0095, 0.0095, 0.018, 6).rotateX(Math.PI / 2 - 0.3).translate(-0.172, 0.866, -0.055), '#F28BA8');
  },
  wrench(parts) {
    parts.add(B.PELVIS, box(0.026, 0.15, 0.014).rotateZ(0.25).translate(-0.165, 0.3, 0.07), '#9AA3AD');
    parts.add(B.PELVIS, ring(0.03, 0.011, Math.PI * 1.5, 10).rotateZ(-0.5).translate(-0.183, 0.385, 0.07), '#9AA3AD');
  },
  headset(parts) {
    parts.add(B.HEAD, ring(0.178, 0.013, Math.PI, 16).translate(0, 0.8, 0), DARK);
    parts.addPair(B.HEAD, B.HEAD, () => cyl(0.042, 0.042, 0.035, 12).rotateZ(Math.PI / 2).translate(0.17, 0.79, 0), DARK);
    parts.add(B.HEAD, cyl(0.006, 0.006, 0.13, 5).rotateX(Math.PI / 2).rotateY(0.6).translate(-0.125, 0.765, 0.08), DARK);
    parts.add(B.HEAD, ball(0.017, 6, 5).translate(-0.065, 0.748, 0.14), '#E5484D');
  },
  satchel(parts) {
    parts.add(B.SPINE, rbox(0.06, 0.13, 0.15, 0.02).translate(0.205, 0.38, 0), '#8B5A2B');
    parts.add(B.SPINE, rbox(0.066, 0.06, 0.156, 0.02).translate(0.207, 0.425, 0), '#A8713A');
    // Cross-body strap from the right shoulder down to the bag on the left hip.
    parts.add(B.SPINE, box(0.028, 0.44, 0.012).rotateZ(0.62).translate(0, 0.52, 0.106), '#5A3A1E');
    parts.add(B.SPINE, box(0.028, 0.44, 0.012).rotateZ(0.62).translate(0, 0.52, -0.106), '#5A3A1E');
  },
};
