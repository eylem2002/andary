// The toy figure's body, face, hair and worn accessories, modelled in figure space (boots at
// y = 0, facing +z, the figure's left at +x). Chunky proportions and a big head keep it readable
// when it is only a few dozen pixels tall.

import { B, JOINTS as J } from './rig.js';
import { ball, box, capsule, cone, cyl, dome, rbox, ring, taper, taperAt } from './figure-parts.js';

/** @typedef {import('./figure-parts.js').PartList} PartList */
import { darken, lighten, mix } from './color.js';

const BOOT = '#4A3426';
const SOLE = '#2A1D15';
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
  const shirt = lighten(look.color, 0.1);
  addLegs(parts, look.pants);
  parts.add(B.PELVIS, rbox(0.25, 0.1, 0.16, 0.04).translate(0, 0.32, 0), look.pants);
  parts.add(B.SPINE, rbox(0.29, 0.04, 0.2, 0.015).translate(0, 0.375, 0), BELT);
  parts.add(B.SPINE, box(0.05, 0.03, 0.012).translate(0, 0.375, 0.1), GOLD);
  const torso = taper(rbox(TORSO.w, TORSO.h, TORSO.d, 0.07, 2), TORSO.h, TORSO.waist);
  parts.add(B.SPINE, torso.translate(0, TORSO.y, 0), shirt);
  parts.add(B.SPINE, box(0.06, 0.05, 0.012).translate(0.08, 0.555, 0.098), darken(shirt, 0.18)); // pocket
  parts.add(B.HEAD, cyl(0.05, 0.056, 0.05, 8).translate(0, 0.665, 0), look.skin); // neck
  addArms(parts, shirt, look.skin);
  addHead(parts, look);
}

/** @param {PartList} parts @param {string} pants */
function addLegs(parts, pants) {
  parts.addPair(B.LEG_L, B.LEG_R, () => rbox(0.104, 0.16, 0.115, 0.035).translate(J.legX, 0.225, 0), pants);
  parts.addPair(B.KNEE_L, B.KNEE_R, () => rbox(0.096, 0.1, 0.105, 0.03).translate(J.legX, 0.105, 0), pants);
  parts.addPair(B.KNEE_L, B.KNEE_R, () => rbox(0.112, 0.065, 0.16, 0.028).translate(J.legX, 0.036, 0.02), BOOT);
  parts.addPair(B.KNEE_L, B.KNEE_R, () => box(0.116, 0.014, 0.164).translate(J.legX, 0.007, 0.02), SOLE);
}

/** @param {PartList} parts @param {string} shirt @param {string} skin */
function addArms(parts, shirt, skin) {
  const x = J.shoulderX;
  parts.addPair(B.ARM_L, B.ARM_R, () => rbox(0.088, 0.15, 0.09, 0.035).translate(x + 0.01, 0.54, 0), shirt);
  parts.addPair(B.ELBOW_L, B.ELBOW_R, () => capsule(0.034, 0.07).translate(x + 0.002, 0.42, 0), skin);
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
  parts.addPair(B.EYES, B.EYES, () => ball(0.021, 8, 6).scale(1, 1.15, 0.6).translate(0.056, 0.805, 0.15), EYE);
  parts.addPair(B.EYES, B.EYES, () => ball(0.0065, 4, 3).translate(0.05, 0.815, 0.162), '#FFFFFF');
  const blush = mix(skin, '#F27C7C', 0.45);
  parts.addPair(B.HEAD, B.HEAD, () => ball(0.024, 8, 6).scale(1, 0.6, 0.35).translate(0.098, 0.762, 0.135), blush);
  // A smile: the lower half of a thin ring, tucked into the curve of the face.
  parts.add(B.HEAD, ring(0.026, 0.0065, Math.PI, 10).rotateZ(Math.PI).rotateX(0.35).translate(0, 0.757, 0.152), MOUTH);
  addHair(parts, look);
}

/** @param {PartList} parts @param {import('./looks.js').Look} look */
function addHair(parts, look) {
  // A helmet of hair tilted back: the hairline sits high at the front and low at the neck.
  parts.add(B.HEAD, dome(0.173, 1.3).rotateX(-0.4).translate(0, 0.805, -0.005), look.hair);
  if (look.hat !== 'none') return;
  parts.add(B.HEAD, ball(0.07, 8, 6).scale(1.5, 0.65, 1).rotateZ(0.25).translate(0.03, 0.955, 0.075), look.hair);
  parts.add(B.HEAD, ball(0.05, 8, 6).scale(1.2, 0.7, 1).translate(-0.07, 0.94, 0.09), look.hair);
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
