// Hats, bound to the hat bone so they can hop off the head when celebrating. The hat tells you
// the model a crew runs on (crown = Opus, beret = Sonnet, sunhat = Haiku, wizard = …); the
// Foreman's default is a hard hat. A person of a team town picks any of them, or one of their own:
// a beanie, a bucket hat, a headband, a bandana, a flower crown, a viking helmet, a top hat, a
// chef's hat or a halo (core/profile.js), in their own colour where it has one.

import { B } from './rig.js';
import { ball, cone, cyl, dome, halfDisc, ring } from './figure-parts.js';

/** @typedef {import('./figure-parts.js').PartList} PartList */
import { darken, lighten } from './color.js';

const TAU = Math.PI * 2;

/** @type {Record<string, (parts: PartList, crew: string) => void>} */
const HATS = {
  hardhat(parts) {
    const yellow = '#FFC21A';
    parts.add(B.HAT, dome(0.183).scale(1, 0.82, 1.03).translate(0, 0.86, 0), yellow);
    parts.add(B.HAT, cyl(0.215, 0.215, 0.018, 20).scale(1, 1, 1.08).translate(0, 0.866, 0.018), yellow);
    // Ridge over the crown, front to back.
    parts.add(B.HAT, ring(0.183, 0.016, Math.PI, 14).rotateY(Math.PI / 2).scale(1, 0.82, 1.03).translate(0, 0.86, 0), '#EBAA00');
  },
  cap(parts, crew) {
    parts.add(B.HAT, dome(0.176).scale(1, 0.72, 1.02).translate(0, 0.865, 0), lighten(crew, 0.18));
    parts.add(B.HAT, halfDisc(0.15, 0.016, 14).rotateX(0.12).translate(0, 0.87, 0.075), darken(crew, 0.25));
    parts.add(B.HAT, ball(0.02, 6, 4).translate(0, 0.99, 0), darken(crew, 0.25));
  },
  crown(parts) {
    const gold = '#F4C430';
    parts.add(B.HAT, cyl(0.125, 0.115, 0.075, 16).translate(0, 0.955, 0), gold);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU;
      const x = Math.sin(a) * 0.112;
      const z = Math.cos(a) * 0.112;
      parts.add(B.HAT, cone(0.03, 0.075, 6).translate(x, 1.03, z), gold);
      parts.add(B.HAT, ball(0.014, 6, 4).translate(x, 1.07, z), '#FFE58A');
    }
    parts.add(B.HAT, ball(0.019, 8, 6).scale(1, 1, 0.6).translate(0, 0.955, 0.123), '#E0245E');
    for (const side of [-1, 1]) {
      const a = side * (TAU / 5);
      parts.add(B.HAT, ball(0.015, 6, 4).translate(Math.sin(a) * 0.12, 0.955, Math.cos(a) * 0.12), '#2D7FF9');
    }
  },
  beret(parts) {
    const red = '#8E2236';
    parts.add(B.HAT, ball(0.195, 16, 8).scale(1, 0.3, 1).rotateZ(-0.22).translate(0.035, 0.94, -0.015), red);
    parts.add(B.HAT, cyl(0.01, 0.014, 0.04, 6).translate(0.03, 1.0, -0.015), red);
  },
  sunhat(parts, crew) {
    parts.add(B.HAT, cyl(0.32, 0.32, 0.014, 28).translate(0, 0.885, 0), '#E9CD84');
    parts.add(B.HAT, cyl(0.125, 0.15, 0.1, 18).translate(0, 0.94, 0), '#E3C277');
    parts.add(B.HAT, cyl(0.152, 0.152, 0.032, 18).translate(0, 0.905, 0), crew);
    parts.add(B.HAT, ball(0.026, 8, 6).translate(0.13, 0.925, 0.075), '#FF6B8B');
  },
  beanie(parts, crew) {
    parts.add(B.HAT, dome(0.182).scale(1, 0.95, 1.02).translate(0, 0.83, -0.005), crew);
    parts.add(B.HAT, cyl(0.186, 0.186, 0.05, 20).translate(0, 0.845, -0.005), darken(crew, 0.22));
    parts.add(B.HAT, ball(0.045, 8, 6).translate(0, 1.02, -0.01), '#F2F0EA');
  },
  bucket(parts, crew) {
    parts.add(B.HAT, cyl(0.15, 0.185, 0.12, 18).translate(0, 0.92, 0), crew);
    parts.add(B.HAT, cyl(0.26, 0.26, 0.012, 22).rotateX(0.05).translate(0, 0.87, 0), darken(crew, 0.18));
  },
  headband(parts, crew) {
    parts.add(B.HAT, ring(0.17, 0.02, TAU, 20).rotateX(Math.PI / 2).translate(0, 0.86, -0.01), crew);
  },
  bandana(parts, crew) {
    parts.add(B.HAT, dome(0.178).scale(1, 0.7, 1.02).translate(0, 0.86, -0.01), crew);
    parts.add(B.HAT, cone(0.04, 0.1, 4).rotateX(-2.2).translate(0, 0.86, -0.19), darken(crew, 0.2));
    for (const [x, z] of [[0.06, 0.12], [-0.08, 0.1], [0.12, 0.02]]) parts.add(B.HAT, ball(0.012, 4, 3).translate(x, 0.93, z), '#F2F0EA');
  },
  flowers(parts) {
    const petals = ['#FF6B8B', '#FFD54A', '#FFFFFF', '#B987FF', '#FF9F43'];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      parts.add(B.HAT, ball(0.03, 6, 4).translate(Math.sin(a) * 0.15, 0.9, Math.cos(a) * 0.15), petals[k % petals.length]);
      parts.add(B.HAT, ball(0.022, 5, 3).translate(Math.sin(a + 0.4) * 0.16, 0.89, Math.cos(a + 0.4) * 0.16), '#5C9E4A');
    }
  },
  viking(parts) {
    parts.add(B.HAT, dome(0.185).translate(0, 0.84, 0), '#9AA3AD');
    parts.add(B.HAT, cyl(0.188, 0.188, 0.03, 20).translate(0, 0.85, 0), '#C9944A');
    for (const side of [-1, 1]) parts.add(B.HAT, cone(0.035, 0.16, 8).rotateZ(side * -0.9).translate(side * 0.2, 0.96, 0), '#F2EAD8');
  },
  tophat(parts, crew) {
    parts.add(B.HAT, cyl(0.25, 0.25, 0.014, 22).translate(0, 0.885, 0), '#1E1E22');
    parts.add(B.HAT, cyl(0.13, 0.13, 0.26, 18).translate(0, 1.02, 0), '#1E1E22');
    parts.add(B.HAT, cyl(0.133, 0.133, 0.035, 18).translate(0, 0.915, 0), crew);
  },
  chef(parts) {
    parts.add(B.HAT, cyl(0.15, 0.15, 0.1, 18).translate(0, 0.92, 0), '#FFFFFF');
    for (const [x, z] of [[0, 0], [0.08, 0.04], [-0.08, 0.04], [0, -0.08]]) parts.add(B.HAT, ball(0.1, 10, 8).translate(x, 1.03, z), '#FFFFFF');
  },
  halo(parts) {
    parts.add(B.HAT, ring(0.12, 0.016, TAU, 24).rotateX(Math.PI / 2).translate(0, 1.07, 0), '#FFE58A');
  },
  wizard(parts) {
    const purple = '#4C3A9E';
    parts.add(B.HAT, cyl(0.25, 0.25, 0.018, 22).translate(0, 0.885, 0), purple);
    // The cone leans back a little, pivoting at its base.
    parts.add(B.HAT, cone(0.155, 0.42, 16).translate(0, 0.21, 0).rotateX(-0.22).translate(0, 0.89, 0), purple);
    parts.add(B.HAT, cyl(0.152, 0.158, 0.035, 16).translate(0, 0.905, 0), '#FFD54A');
    for (const [x, y, z] of [
      [0.062, 0.968, 0.091],
      [-0.052, 1.085, 0.018],
      [0.03, 1.15, -0.04],
    ]) {
      parts.add(B.HAT, ball(0.024, 4, 2).translate(x, y, z), '#FFD54A');
    }
  },
};

/**
 * @param {PartList} parts
 * @param {import('./looks.js').Look} look
 */
export function addHat(parts, look) {
  const add = HATS[look.hat];
  if (add) add(parts, look.color);
}
