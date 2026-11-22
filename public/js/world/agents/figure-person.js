// The extras a person of a team town may wear (core/profile.js `extra`): a cape, a scarf or
// headphones, in shades of their own colour. A backpack is the teammates' (figure-body.js), and
// glasses are part of the face. Modelled in figure space like the body.

import { B } from './rig.js';
import { ball, box, cyl, ring } from './figure-parts.js';
import { darken, lighten } from './color.js';

/** @typedef {import('./figure-parts.js').PartList} PartList */

/** @type {Record<string, (parts: PartList, color: string) => void>} */
const EXTRAS = {
  cape(parts, color) {
    // Hangs from the shoulders down the back, flaring a little towards the hem.
    parts.add(B.SPINE, box(0.36, 0.42, 0.02).rotateX(0.12).translate(0, 0.42, -0.13), darken(color, 0.15));
    parts.add(B.SPINE, box(0.38, 0.03, 0.06).translate(0, 0.635, -0.1), darken(color, 0.3));
  },
  scarf(parts, color) {
    parts.add(B.SPINE, ring(0.085, 0.032, Math.PI * 2, 14).rotateX(Math.PI / 2).translate(0, 0.64, 0), color);
    parts.add(B.SPINE, box(0.06, 0.17, 0.03).rotateZ(0.12).translate(0.06, 0.53, 0.105), lighten(color, 0.15));
  },
  headphones(parts, color) {
    parts.add(B.HEAD, ring(0.182, 0.016, Math.PI, 16).translate(0, 0.8, 0), '#2D3340');
    parts.addPair(B.HEAD, B.HEAD, () => cyl(0.05, 0.05, 0.045, 14).rotateZ(Math.PI / 2).translate(0.172, 0.795, 0), color);
    parts.addPair(B.HEAD, B.HEAD, () => ball(0.03, 8, 6).scale(0.5, 1, 1).translate(0.198, 0.795, 0), lighten(color, 0.3));
  },
};

/**
 * @param {PartList} parts
 * @param {import('./looks.js').Look} look
 */
export function addExtra(parts, look) {
  const add = EXTRAS[look.extra];
  if (add) add(parts, look.color);
}
