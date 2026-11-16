// Props a figure holds during activities, each bound to its own bone (see rig.PROP_BONE) so it
// can pop in and out by scaling. Hand props are modelled relative to the hand at rest: the arm
// hangs straight down, so local -y runs along the forearm and +z points forward.

import * as THREE from 'three';
import { JOINTS as J, PROP_BONE } from './rig.js';
import { ball, box, cone, cyl, rbox, ring } from './figure-parts.js';

/** @typedef {import('./figure-parts.js').PartList} PartList */

const HAND_L = new THREE.Vector3(J.shoulderX, J.shoulderY - J.upperArm - J.forearm, 0);
const HAND_R = new THREE.Vector3(-J.shoulderX, J.shoulderY - J.upperArm - J.forearm, 0);
const FRONT = new THREE.Vector3(0, J.frontY, J.frontZ);
const HEAD_BASE = new THREE.Vector3(0, J.neckY, 0);
const PAPER = '#FBF8F0';
const STEEL = '#8D96A0';
const WOOD = '#A0703C';

/**
 * Adds geometry to a prop bone, positioned relative to an anchor point.
 * @param {PartList} parts @param {string} prop @param {THREE.Vector3} anchor
 * @param {THREE.BufferGeometry} geo @param {string} color
 */
function put(parts, prop, anchor, geo, color) {
  parts.add(PROP_BONE[prop], geo.translate(anchor.x, anchor.y, anchor.z), color);
}

/** @type {Record<string, (parts: PartList, crew: string) => void>} */
const PROPS = {
  magnifier(parts) {
    put(parts, 'magnifier', HAND_R, cyl(0.013, 0.016, 0.1, 8).translate(0, -0.07, 0), '#6B4226');
    put(parts, 'magnifier', HAND_R, ring(0.058, 0.012, Math.PI * 2, 18).translate(0, -0.175, 0), '#C9A227');
    put(parts, 'magnifier', HAND_R, cyl(0.052, 0.052, 0.008, 16).rotateX(Math.PI / 2).translate(0, -0.175, 0), '#BFE6FF');
  },
  hammer(parts) {
    put(parts, 'hammer', HAND_R, cyl(0.011, 0.013, 0.17, 8).translate(0, -0.075, 0), WOOD);
    put(parts, 'hammer', HAND_R, rbox(0.048, 0.048, 0.13, 0.012).translate(0, -0.165, 0), STEEL);
  },
  mug(parts) {
    // Upright when the forearm is level (the sip pose); tilts toward the mouth as it rises.
    put(parts, 'mug', HAND_R, cyl(0.044, 0.04, 0.085, 12).rotateX(Math.PI / 2).translate(0, -0.045, 0.025), '#F4F1EA');
    put(parts, 'mug', HAND_R, cyl(0.045, 0.045, 0.016, 12).rotateX(Math.PI / 2).translate(0, -0.045, 0.02), '#E5484D');
    put(parts, 'mug', HAND_R, cyl(0.037, 0.037, 0.004, 12).rotateX(Math.PI / 2).translate(0, -0.045, 0.068), '#4B2E1F');
    put(parts, 'mug', HAND_R, ring(0.022, 0.007, Math.PI * 2, 8).rotateY(Math.PI / 2).translate(0, -0.002, 0.025), '#F4F1EA');
  },
  pencil(parts) {
    put(parts, 'pencil', HAND_R, cyl(0.008, 0.008, 0.08, 6).translate(0, -0.06, 0), '#F2C230');
    put(parts, 'pencil', HAND_R, cone(0.008, 0.02, 6).rotateX(Math.PI).translate(0, -0.11, 0), '#E8C99B');
    put(parts, 'pencil', HAND_R, cyl(0.0085, 0.0085, 0.016, 6).translate(0, -0.013, 0), '#F28BA8');
  },
  clipboard(parts) {
    put(parts, 'clipboard', HAND_L, box(0.13, 0.18, 0.012).translate(0, -0.09, 0.012), '#B07A45');
    put(parts, 'clipboard', HAND_L, box(0.11, 0.14, 0.004).translate(0, -0.1, 0.02), PAPER);
    put(parts, 'clipboard', HAND_L, box(0.05, 0.02, 0.016).translate(0, -0.004, 0.018), STEEL);
    for (const y of [-0.075, -0.1, -0.125]) {
      put(parts, 'clipboard', HAND_L, box(0.08, 0.007, 0.003).translate(0, y, 0.023), '#7FA6E0');
    }
  },
  blueprint(parts) {
    put(parts, 'blueprint', HAND_L, cyl(0.026, 0.026, 0.26, 10).rotateX(Math.PI / 2).translate(0, -0.015, 0.03), '#3D7DD8');
    for (const z of [-0.1, 0.16]) {
      put(parts, 'blueprint', HAND_L, cyl(0.0265, 0.0265, 0.012, 10).rotateX(Math.PI / 2).translate(0, -0.015, z), '#EAF2FF');
    }
  },
  toolbox(parts) {
    put(parts, 'toolbox', HAND_L, rbox(0.085, 0.1, 0.2, 0.015).translate(0.025, -0.085, 0), '#D64541');
    put(parts, 'toolbox', HAND_L, box(0.089, 0.02, 0.204).translate(0.025, -0.045, 0), '#A8322F');
    put(parts, 'toolbox', HAND_L, ring(0.035, 0.008, Math.PI, 10).rotateY(Math.PI / 2).translate(0.025, -0.035, 0), '#4A4F57');
  },
  book(parts) {
    // A big storybook held up at face height: wider than the head, so its bright cover still
    // shows when the reader has its back to the camera (as agents at work do).
    const tilt = new THREE.Matrix4().makeRotationX(0.45).setPosition(0, 0.17, 0.07);
    const local = [
      [rbox(0.21, 0.23, 0.016, 0.005).rotateY(0.22).translate(0.102, 0, 0.008), '#C0392B'],
      [rbox(0.21, 0.23, 0.016, 0.005).rotateY(-0.22).translate(-0.102, 0, 0.008), '#C0392B'],
      [box(0.38, 0.21, 0.014).translate(0, 0, -0.01), PAPER],
      [cyl(0.009, 0.009, 0.22, 6).translate(0, 0, 0.01), '#8E2A20'],
    ];
    for (const [geo, color] of local) {
      put(parts, 'book', FRONT, /** @type {THREE.BufferGeometry} */ (geo).applyMatrix4(tilt), /** @type {string} */ (color));
    }
  },
  laptop(parts, crew) {
    put(parts, 'laptop', FRONT, rbox(0.25, 0.016, 0.17, 0.006).translate(0, -0.005, 0), '#C3C9D2');
    put(parts, 'laptop', FRONT, box(0.22, 0.004, 0.08).translate(0, 0.004, -0.02), '#3B4250');
    // The lid is hinged at the far edge and leans back; a crew-coloured sticker on its back.
    const hinge = new THREE.Matrix4().makeRotationX(0.25).setPosition(0, 0.003, 0.085);
    const lid = [
      [rbox(0.25, 0.165, 0.012, 0.006).translate(0, 0.0825, 0), '#C3C9D2'],
      [box(0.226, 0.14, 0.003).translate(0, 0.085, -0.007), '#1B2733'],
      [box(0.12, 0.012, 0.002).translate(-0.04, 0.12, -0.0095), '#4ADE80'],
      [box(0.16, 0.012, 0.002).translate(-0.02, 0.095, -0.0095), '#60A5FA'],
      [box(0.09, 0.012, 0.002).translate(-0.055, 0.07, -0.0095), '#4ADE80'],
      [cyl(0.026, 0.026, 0.003, 12).rotateX(Math.PI / 2).translate(0, 0.085, 0.0075), crew],
    ];
    for (const [geo, color] of lid) {
      put(parts, 'laptop', FRONT, /** @type {THREE.BufferGeometry} */ (geo).applyMatrix4(hinge), /** @type {string} */ (color));
    }
  },
  box(parts) {
    put(parts, 'box', FRONT, rbox(0.27, 0.2, 0.2, 0.014).translate(0, 0.05, 0.045), '#C8965A');
    put(parts, 'box', FRONT, box(0.05, 0.203, 0.203).translate(0, 0.05, 0.045), '#E3C48C');
  },
  mailbag(parts) {
    const spine = new THREE.Vector3(0, J.waistY, 0);
    put(parts, 'mailbag', spine, rbox(0.085, 0.15, 0.17, 0.03).translate(-0.215, 0.05, 0.02), '#7A5230');
    put(parts, 'mailbag', spine, rbox(0.09, 0.07, 0.175, 0.02).translate(-0.217, 0.1, 0.02), '#956538');
    put(parts, 'mailbag', spine, box(0.012, 0.06, 0.1).translate(-0.205, 0.14, 0.02), '#FFFFFF');
    put(parts, 'mailbag', spine, box(0.093, 0.02, 0.06).translate(-0.217, 0.1, 0.02), '#D64541');
    // Strap from the left shoulder down to the bag on the right hip, front and back.
    for (const z of [0.107, -0.107]) {
      put(parts, 'mailbag', spine, box(0.03, 0.46, 0.012).rotateZ(-0.7).translate(0, 0.18, z), '#5A3A1E');
    }
  },
  towel(parts) {
    const white = '#F7F4EC';
    put(parts, 'towel', HEAD_BASE, ring(0.12, 0.055, Math.PI * 2, 18).rotateX(Math.PI / 2).translate(0, 0.25, -0.005), white);
    put(parts, 'towel', HEAD_BASE, ball(0.11, 12, 8).scale(1, 0.75, 1.05).translate(0, 0.305, -0.01), white);
    put(parts, 'towel', HEAD_BASE, ball(0.035, 8, 6).translate(0, 0.29, 0.1), '#A7D8F0');
  },
};

/**
 * Adds every activity prop (they all exist on every figure, hidden until used), plus the
 * type-specific kit (toolbox) only on the figures that carry it.
 * @param {PartList} parts
 * @param {import('./looks.js').Look} look
 */
export function addProps(parts, look) {
  for (const [name, add] of Object.entries(PROPS)) {
    if (name === 'toolbox' && look.kit !== 'toolbox') continue;
    if (name === 'blueprint' && look.kit !== 'blueprint') continue;
    add(parts, look.color);
  }
}
