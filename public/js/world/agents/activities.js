// Procedural animation for every Activity in catalog.js. Each activity is a pure function of
// (time in the activity, per-agent context) that writes a pose, so poses can be blended, tested
// and computed without allocating. Toy figures move in big readable gestures: the camera sees
// them from far away, so subtle motion would be invisible.

import { P, neutralPose } from './pose.js';
import { TAU, clamp01, easeInCubic, easeInOutCubic, lerp, rand01, smoothstep, windowed } from './easing.js';

/**
 * @typedef {object} AnimContext
 * @property {number} seed     0..1, varies timing between agents
 * @property {number} seedInt  integer hash of the agent id
 * @property {number} gait     walk-cycle phase in radians, advanced by distance travelled
 * @property {'box'|'mailbag'} variant  what `carry` holds
 * @property {boolean} [calm]  reduced motion: smaller hops, no twirls
 */

/** @typedef {(out: Float32Array, t: number, ctx: AnimContext) => void} PoseFn */

/** Props a figure can hold or wear; each has its own bone that is scaled to 0 when hidden. */
export const PROP_NAMES = Object.freeze([
  'hat',
  'book',
  'laptop',
  'hammer',
  'magnifier',
  'clipboard',
  'pencil',
  'mug',
  'box',
  'mailbag',
  'towel',
  'blueprint',
  'toolbox',
]);

export const HAMMER_PERIOD = 1.05;
/** Fraction of the hammer cycle at which the head lands (sparks fly). */
export const HAMMER_IMPACT = 0.7;
const HOP_PERIOD = 0.62;
const SIP_PERIOD = 4.2;
/** How far the body drops when a figure sits on the ground. */
const SIT_DROP = 0.235;
/** Seconds of waiting until impatience is at its peak. */
const PATIENCE_SECONDS = 18;

/** @param {Float32Array} o @param {number} t @param {AnimContext} c */
function breathe(o, t, c) {
  const b = Math.sin(t * 1.8 + c.seed * TAU);
  o[P.SPINE_PITCH] += 0.018 * b;
  o[P.ROOT_Y] += 0.003 * (b + 1);
  o[P.ARM_L_ABDUCT] += 0.015 * b;
  o[P.ARM_R_ABDUCT] += 0.015 * b;
}

/**
 * Head yaw for idle glances: every few seconds the figure looks to one side and back.
 * @param {number} t @param {AnimContext} c
 */
function glanceYaw(t, c) {
  const period = 4.2 + 2.6 * c.seed;
  const k = Math.floor(t / period);
  const u = t / period - k;
  const side = rand01(c.seedInt, k) < 0.5 ? -1 : 1;
  return side * 0.55 * windowed(u, 0.55, 0.85, 0.08);
}

/**
 * Eye closedness for blinking (0 open, 1 shut), deterministic per agent.
 * @param {number} t seconds @param {number} seedInt
 */
export function blinkAmount(t, seedInt) {
  const period = 2.8 + 2.4 * rand01(seedInt, 7);
  const u = (t + rand01(seedInt, 8) * period) % period;
  return u < 0.15 ? Math.sin((u / 0.15) * Math.PI) : 0;
}

/** Impatience 0..1 after `t` seconds of waiting. @param {number} t */
export function impatience(t) {
  return clamp01(t / PATIENCE_SECONDS);
}

/**
 * Cycles completed after `t` seconds by a beat whose frequency ramps linearly from f0 to f1
 * over `ramp` seconds. Integrating (rather than computing t * f(t)) keeps the beat smooth while
 * it speeds up.
 * @param {number} t @param {number} f0 @param {number} f1 @param {number} ramp
 */
export function rampPhase(t, f0, f1, ramp) {
  if (t <= ramp) return f0 * t + ((f1 - f0) * t * t) / (2 * ramp);
  return f0 * ramp + ((f1 - f0) * ramp) / 2 + f1 * (t - ramp);
}

/** @type {PoseFn} */
function idle(o, t, c) {
  neutralPose(o);
  breathe(o, t, c);
  const shift = Math.sin(t * 0.55 + c.seed * 3);
  o[P.HEAD_YAW] = glanceYaw(t, c);
  o[P.HEAD_PITCH] = -0.03 + 0.03 * Math.sin(t * 0.7 + c.seed * 5);
  o[P.ROOT_ROLL] = 0.022 * shift;
  o[P.LEG_L_SPLAY] = 0.04;
  o[P.LEG_R_SPLAY] = 0.04;
  o[P.KNEE_L] = 0.05 * Math.max(0, shift);
  o[P.KNEE_R] = 0.05 * Math.max(0, -shift);
}

/** @param {Float32Array} o @param {AnimContext} c @param {boolean} run */
function locomote(o, c, run) {
  neutralPose(o);
  const s = Math.sin(c.gait);
  const co = Math.cos(c.gait);
  const legSwing = run ? 0.8 : 0.52;
  const kneeLift = run ? 1.0 : 0.55;
  const base = run ? 0.15 : 0.03;
  o[P.LEG_L_PITCH] = legSwing * s;
  o[P.LEG_R_PITCH] = -legSwing * s;
  // The knee bends while the leg swings forward (cos > 0 for the left leg): the foot lifts.
  o[P.KNEE_L] = kneeLift * Math.max(0, co) + base;
  o[P.KNEE_R] = kneeLift * Math.max(0, -co) + base;
  const armSwing = run ? 0.75 : 0.45;
  const elbow = run ? 1.35 : 0.3;
  o[P.ARM_L_PITCH] = -armSwing * s;
  o[P.ARM_R_PITCH] = armSwing * s;
  o[P.ELBOW_L] = elbow + 0.15 * Math.max(0, -s);
  o[P.ELBOW_R] = elbow + 0.15 * Math.max(0, s);
  o[P.ARM_L_ABDUCT] = run ? 0.18 : 0.1;
  o[P.ARM_R_ABDUCT] = run ? 0.18 : 0.1;
  // Highest when the legs pass each other, lowest at full stride.
  o[P.ROOT_Y] = (run ? 0.05 : 0.025) * Math.abs(co);
  o[P.ROOT_PITCH] = run ? 0.2 : 0.05;
  o[P.ROOT_ROLL] = (run ? 0.02 : 0.045) * s; // toy waddle
  o[P.SPINE_YAW] = 0.1 * s;
  o[P.HEAD_PITCH] = run ? -0.12 : -0.03;
  o[P.HEAD_YAW] = -0.06 * s;
}

/** @type {PoseFn} */
function walk(o, _t, c) {
  locomote(o, c, false);
}

/** @type {PoseFn} */
function run(o, _t, c) {
  locomote(o, c, true);
}

/** @type {PoseFn} */
function read(o, t, c) {
  neutralPose(o);
  breathe(o, t, c);
  const flip = windowed((t % 4.6) / 4.6, 0.78, 0.96, 0.05); // turns a page now and then
  o[P.ARM_L_PITCH] = 1.15;
  o[P.ARM_L_ABDUCT] = -0.22;
  o[P.ELBOW_L] = 1.1;
  o[P.ARM_R_PITCH] = 1.15 + 0.2 * flip;
  o[P.ARM_R_ABDUCT] = -0.22 - 0.35 * flip;
  o[P.ELBOW_R] = 1.1 + 0.2 * flip;
  o[P.HEAD_PITCH] = 0.22;
  o[P.HEAD_YAW] = 0.12 * Math.sin(t * 1.3 + c.seed * 4); // eyes running along the lines
  o[P.PROP_BOB] = 0.006 * Math.sin(t * 1.8);
  o[P.LEG_L_SPLAY] = 0.04;
  o[P.LEG_R_SPLAY] = 0.04;
}

/** @type {PoseFn} */
function type(o, t, c) {
  neutralPose(o);
  breathe(o, t, c);
  const pause = windowed((t % 5.2) / 5.2, 0.7, 0.88, 0.05); // stops to read the output
  const k = 1 - pause;
  o[P.ARM_L_PITCH] = 0.62 + 0.04 * k * Math.sin(t * 11);
  o[P.ARM_L_ABDUCT] = -0.2;
  o[P.ELBOW_L] = 0.95 + 0.14 * k * Math.sin(t * 17 + 1.3);
  o[P.ARM_R_PITCH] = 0.62 + 0.04 * k * Math.sin(t * 13 + 2);
  o[P.ARM_R_ABDUCT] = -0.2;
  o[P.ELBOW_R] = 0.95 + 0.14 * k * Math.sin(t * 19.5);
  o[P.HEAD_PITCH] = 0.22 - 0.2 * pause + 0.03 * k * Math.sin(t * 8);
  o[P.HEAD_YAW] = 0.2 * pause * Math.sin(c.seed * 9);
  o[P.SPINE_PITCH] += 0.08;
}

/**
 * How far the hammer arm is wound up (0 at the work, 1 overhead) at cycle fraction u.
 * @param {number} u 0..1
 */
export function hammerRaise(u) {
  if (u < 0.58) return easeInOutCubic(u / 0.58);
  if (u < HAMMER_IMPACT) return 1 - easeInCubic((u - 0.58) / (HAMMER_IMPACT - 0.58));
  return 0.06 * Math.sin(((u - HAMMER_IMPACT) / (1 - HAMMER_IMPACT)) * Math.PI); // rebound
}

/** @type {PoseFn} */
function hammer(o, t) {
  neutralPose(o);
  const raise = hammerRaise((t % HAMMER_PERIOD) / HAMMER_PERIOD);
  const strike = 1 - raise;
  o[P.ARM_R_PITCH] = lerp(0.55, 2.55, raise);
  o[P.ELBOW_R] = lerp(0.35, 1.25, raise);
  o[P.ARM_R_ABDUCT] = -0.12;
  o[P.ARM_L_PITCH] = 0.6;
  o[P.ARM_L_ABDUCT] = -0.12;
  o[P.ELBOW_L] = 0.75;
  o[P.SPINE_PITCH] = lerp(-0.04, 0.26, strike);
  o[P.HEAD_PITCH] = 0.22;
  o[P.KNEE_L] = 0.1 + 0.12 * strike;
  o[P.KNEE_R] = 0.1 + 0.12 * strike;
  o[P.LEG_L_SPLAY] = 0.1;
  o[P.LEG_R_SPLAY] = 0.1;
  o[P.ROOT_Y] = -0.01 * strike;
}

/** @type {PoseFn} */
function search(o, t, c) {
  neutralPose(o);
  const sweep = Math.sin(t * 1.25 + c.seed * 3);
  const peer = windowed((t % 6.5) / 6.5, 0.6, 0.85, 0.08); // leans in for a closer look
  o[P.SPINE_PITCH] = 0.3 + 0.15 * peer;
  o[P.SPINE_YAW] = 0.32 * sweep;
  o[P.HEAD_YAW] = 0.2 * sweep;
  o[P.HEAD_PITCH] = 0.24 + 0.1 * peer;
  o[P.ARM_R_PITCH] = 1.0 + 0.1 * peer;
  o[P.ARM_R_ABDUCT] = -0.12;
  o[P.ELBOW_R] = 0.45;
  o[P.ARM_L_PITCH] = -0.45; // free hand tucked behind the back, detective style
  o[P.ARM_L_ABDUCT] = 0.15;
  o[P.ELBOW_L] = 1.25;
  o[P.KNEE_L] = 0.16;
  o[P.KNEE_R] = 0.16;
  o[P.LEG_L_SPLAY] = 0.1;
  o[P.LEG_R_SPLAY] = 0.1;
  o[P.ROOT_Y] = -0.008;
}

/** @type {PoseFn} */
function think(o, t, c) {
  neutralPose(o);
  breathe(o, t, c);
  const tap = windowed((t % 3.4) / 3.4, 0.1, 0.45, 0.05); // drums fingers on the chin
  o[P.ARM_R_PITCH] = 0.95;
  o[P.ARM_R_ABDUCT] = -0.38;
  o[P.ELBOW_R] = 2.15 + 0.07 * tap * Math.sin(t * 16);
  o[P.ARM_L_PITCH] = 0.42;
  o[P.ARM_L_ABDUCT] = -0.5;
  o[P.ELBOW_L] = 1.55;
  o[P.HEAD_PITCH] = -0.14;
  o[P.HEAD_ROLL] = 0.13;
  o[P.HEAD_YAW] = 0.28 * Math.sin(t * 0.45 + c.seed * 6);
  o[P.ROOT_ROLL] = 0.02 * Math.sin(t * 0.5);
  o[P.KNEE_L] = 0.05;
}

/** Foot tapping that speeds up with impatience. @param {Float32Array} o @param {number} t @param {number} level */
function footTap(o, t, level) {
  const tap = Math.max(0, Math.sin(rampPhase(t, 1.4, 3.8, PATIENCE_SECONDS) * TAU));
  o[P.LEG_R_PITCH] = 0.14 * tap;
  o[P.KNEE_R] = 0.18 * tap;
  if (level > 0.7) o[P.ROOT_Y] -= 0.006 * tap; // stomping by now
}

/** @param {Float32Array} o @param {number} amount 0..1 how firmly the arms are crossed */
function crossArms(o, amount) {
  o[P.ARM_L_PITCH] = lerp(0, 0.55, amount);
  o[P.ARM_R_PITCH] = lerp(0, 0.55, amount);
  o[P.ARM_L_ABDUCT] = lerp(0.08, -0.6, amount);
  o[P.ARM_R_ABDUCT] = lerp(0.08, -0.6, amount);
  o[P.ELBOW_L] = lerp(0.12, 1.9, amount);
  o[P.ELBOW_R] = lerp(0.12, 1.85, amount);
}

/** @type {PoseFn} */
function wait(o, t, c) {
  neutralPose(o);
  breathe(o, t, c);
  const level = impatience(t);
  crossArms(o, smoothstep(0.2, 0.45, level));
  footTap(o, t, level);
  // Checks the watch on the left wrist: every 7 s at first, every 3 s when fed up.
  const look = windowed(rampPhase(t, 1 / 7, 1 / 3, PATIENCE_SECONDS) % 1, 0.5, 0.82, 0.07);
  o[P.ARM_L_PITCH] = lerp(o[P.ARM_L_PITCH], 1.15, look);
  o[P.ARM_L_ABDUCT] = lerp(o[P.ARM_L_ABDUCT], -0.5, look);
  o[P.ELBOW_L] = lerp(o[P.ELBOW_L], 1.75, look);
  o[P.HEAD_PITCH] = lerp(-0.02, 0.32, look);
  o[P.HEAD_YAW] = lerp(0.18 * Math.sin(t * 0.8), 0.32, look);
  const sigh = level > 0.45 ? windowed((t % 5.3) / 5.3, 0.1, 0.3, 0.08) : 0;
  o[P.SPINE_PITCH] += 0.12 * sigh;
  o[P.ROOT_Y] -= 0.01 * sigh;
  if (level > 0.85) {
    const shake = windowed((t % 4) / 4, 0, 0.35, 0.06) * (1 - look);
    o[P.HEAD_YAW] += 0.22 * Math.sin(t * 10) * shake;
  }
  o[P.ROOT_ROLL] = 0.025 * Math.sin(t * 1.4) * (0.5 + level);
}

/** @type {PoseFn} */
function celebrate(o, t, c) {
  neutralPose(o);
  const hop = Math.floor(t / HOP_PERIOD);
  const u = t / HOP_PERIOD - hop;
  const air = Math.sin(Math.PI * u) * (c.calm ? 0.35 : 1);
  const crouch = (1 - air) * (1 - air);
  o[P.ROOT_Y] = 0.17 * air - 0.03 * crouch;
  o[P.KNEE_L] = 0.55 * crouch;
  o[P.KNEE_R] = 0.55 * crouch;
  o[P.LEG_L_PITCH] = 0.22 * crouch;
  o[P.LEG_R_PITCH] = 0.22 * crouch;
  o[P.ARM_L_ABDUCT] = 2.5 + 0.22 * Math.sin(t * 13);
  o[P.ARM_R_ABDUCT] = 2.5 + 0.22 * Math.sin(t * 13 + 1.6);
  o[P.ARM_L_PITCH] = 0.2;
  o[P.ARM_R_PITCH] = 0.2;
  o[P.ELBOW_L] = 0.3;
  o[P.ELBOW_R] = 0.3;
  o[P.HEAD_PITCH] = -0.22;
  o[P.EYES] = 0.4; // happy squint
  o[P.HAT_LIFT] = 0.07 * air;
  if (hop % 3 === 2 && !c.calm) o[P.ROOT_YAW] = TAU * easeInOutCubic(u); // every third hop is a twirl
}

/** @type {PoseFn} */
function facepalm(o, t) {
  neutralPose(o);
  const k = windowed((t % 3.8) / 3.8, 0.02, 0.86, 0.12);
  o[P.ARM_R_PITCH] = lerp(0.1, 1.25, k);
  o[P.ARM_R_ABDUCT] = lerp(0.08, -0.45, k);
  o[P.ELBOW_R] = lerp(0.2, 2.3, k);
  o[P.HEAD_PITCH] = 0.08 + 0.24 * k;
  o[P.HEAD_YAW] = 0.18 * Math.sin(t * 5.5) * k;
  o[P.SPINE_PITCH] = 0.1 + 0.1 * k;
  o[P.ARM_L_ABDUCT] = 0.02;
  o[P.ELBOW_L] = 0.05;
  o[P.ROOT_Y] = -0.006;
  o[P.EYES] = lerp(1, 0.15, k);
}

/** @type {PoseFn} */
function sleep(o, t, c) {
  neutralPose(o);
  const b = Math.sin(t * 1.15 + c.seed * 4);
  o[P.ROOT_Y] = -SIT_DROP; // sits on the ground, legs out
  o[P.LEG_L_PITCH] = 1.45;
  o[P.LEG_R_PITCH] = 1.45;
  o[P.LEG_L_SPLAY] = 0.14;
  o[P.LEG_R_SPLAY] = 0.14;
  o[P.KNEE_L] = 0.12;
  o[P.KNEE_R] = 0.12;
  o[P.SPINE_PITCH] = 0.16 + 0.03 * b;
  o[P.HEAD_PITCH] = 0.42 + 0.05 * b;
  o[P.HEAD_ROLL] = 0.16;
  o[P.ARM_L_PITCH] = 0.38;
  o[P.ARM_R_PITCH] = 0.38;
  o[P.ARM_L_ABDUCT] = 0.14;
  o[P.ARM_R_ABDUCT] = 0.14;
  o[P.ELBOW_L] = 0.55;
  o[P.ELBOW_R] = 0.55;
  o[P.EYES] = 0;
}

/** @type {PoseFn} */
function sip(o, t, c) {
  neutralPose(o);
  breathe(o, t, c);
  const drink = windowed((t % SIP_PERIOD) / SIP_PERIOD, 0.45, 0.8, 0.1);
  o[P.ARM_R_PITCH] = lerp(0.2, 0.75, drink);
  o[P.ARM_R_ABDUCT] = lerp(-0.1, -0.4, drink);
  o[P.ELBOW_R] = lerp(1.35, 2.25, drink);
  o[P.HEAD_PITCH] = lerp(0.04, -0.24, drink);
  o[P.HEAD_YAW] = glanceYaw(t, c) * (1 - drink);
  o[P.ARM_L_PITCH] = -0.05;
  o[P.ARM_L_ABDUCT] = 0.05;
  o[P.ELBOW_L] = 0.25;
  o[P.EYES] = lerp(1, 0.45, drink);
  o[P.ROOT_ROLL] = 0.02 * Math.sin(t * 0.6);
}

/** @type {PoseFn} */
function carry(o, t, c) {
  neutralPose(o);
  breathe(o, t, c);
  const hitch = windowed((t % 3.6) / 3.6, 0.15, 0.32, 0.06); // re-adjusts the grip
  if (c.variant === 'mailbag') {
    o[P.ARM_R_PITCH] = 0.3;
    o[P.ARM_R_ABDUCT] = -0.12;
    o[P.ELBOW_R] = 1.75 + 0.1 * hitch; // hand on the strap
    o[P.ROOT_ROLL] = -0.04 - 0.03 * hitch; // leaning away from the heavy bag
    o[P.HEAD_YAW] = glanceYaw(t, c);
    return;
  }
  o[P.ARM_L_PITCH] = 0.88 + 0.1 * hitch;
  o[P.ARM_R_PITCH] = 0.88 + 0.1 * hitch;
  o[P.ARM_L_ABDUCT] = -0.2;
  o[P.ARM_R_ABDUCT] = -0.2;
  o[P.ELBOW_L] = 0.9;
  o[P.ELBOW_R] = 0.9;
  o[P.SPINE_PITCH] = -0.07; // leaning back under the weight
  o[P.PROP_BOB] = 0.03 * hitch;
  o[P.ROOT_Y] += 0.01 * hitch;
  o[P.HEAD_PITCH] = 0.05;
}

/** @type {PoseFn} */
function wave(o, t, c) {
  neutralPose(o);
  breathe(o, t, c);
  const beat = Math.sin(t * 4.25);
  o[P.ARM_R_ABDUCT] = 2.35 + 0.32 * Math.sin(t * 8.5);
  o[P.ARM_R_PITCH] = 0.15;
  o[P.ELBOW_R] = 0.35;
  o[P.ARM_L_ABDUCT] = 0.6; // other hand on the hip
  o[P.ARM_L_PITCH] = -0.12;
  o[P.ELBOW_L] = 1.45;
  o[P.HEAD_ROLL] = -0.1 + 0.06 * beat;
  o[P.ROOT_Y] += 0.008 * Math.abs(beat);
  o[P.ROOT_ROLL] = 0.02 * beat;
}

/** @type {PoseFn} */
function spa(o, t, c) {
  neutralPose(o);
  const s = Math.sin(t * 0.9 + c.seed * 3);
  o[P.ARM_L_ABDUCT] = 0.32;
  o[P.ARM_R_ABDUCT] = 0.32;
  o[P.ELBOW_L] = 0.3;
  o[P.ELBOW_R] = 0.3;
  o[P.HEAD_PITCH] = -0.16;
  o[P.HEAD_ROLL] = 0.09 * s;
  o[P.ROOT_ROLL] = 0.04 * s;
  o[P.ROOT_Y] = 0.005 * Math.sin(t * 1.8);
  o[P.SPINE_PITCH] = -0.06;
  o[P.EYES] = 0; // blissful
}

/** @type {PoseFn} */
function write(o, t, c) {
  neutralPose(o);
  breathe(o, t, c);
  const ponder = windowed((t % 5.4) / 5.4, 0.72, 0.92, 0.06); // taps the pencil on the chin
  const scribble = (1 - ponder) * Math.sin(t * 15);
  o[P.ARM_L_PITCH] = 0.95;
  o[P.ARM_L_ABDUCT] = -0.38;
  o[P.ELBOW_L] = 1.3;
  o[P.ARM_R_PITCH] = lerp(0.85, 0.95, ponder);
  o[P.ARM_R_ABDUCT] = lerp(-0.45, -0.38, ponder);
  o[P.ELBOW_R] = lerp(1.25 + 0.07 * scribble, 2.15, ponder);
  o[P.ARM_R_TWIST] = 0.1 * scribble;
  o[P.HEAD_PITCH] = lerp(0.26, -0.08, ponder);
  o[P.HEAD_YAW] = 0.06 * scribble;
}

/**
 * @typedef {object} ActivityDef
 * @property {PoseFn} pose
 * @property {readonly string[]} props   props shown while the activity plays
 * @property {boolean} [kit]             the figure's signature tool may stay in hand
 * @property {boolean} [locomotion]      a travel gait (driven by distance, not time)
 * @property {boolean} [hideHat]         the hat comes off (the spa towel replaces it)
 */

/** @type {Readonly<Record<import('../../core/catalog.js').Activity, ActivityDef>>} */
export const ACTIVITY_DEFS = Object.freeze({
  idle: { pose: idle, props: [], kit: true },
  walk: { pose: walk, props: [], kit: true, locomotion: true },
  run: { pose: run, props: [], kit: true, locomotion: true },
  read: { pose: read, props: ['book'] },
  type: { pose: type, props: ['laptop'] },
  hammer: { pose: hammer, props: ['hammer'] },
  search: { pose: search, props: ['magnifier'] },
  think: { pose: think, props: [] },
  wait: { pose: wait, props: [] },
  celebrate: { pose: celebrate, props: [] },
  facepalm: { pose: facepalm, props: [] },
  sleep: { pose: sleep, props: [] },
  sip: { pose: sip, props: ['mug'] },
  carry: { pose: carry, props: ['box'] },
  wave: { pose: wave, props: [] },
  spa: { pose: spa, props: ['towel'], hideHat: true },
  write: { pose: write, props: ['clipboard', 'pencil'] },
});

/** Every activity name, in catalog order. */
export const ACTIVITY_NAMES = Object.freeze(Object.keys(ACTIVITY_DEFS));

/**
 * One-shot effects some activities emit on a beat (sparks on each hammer strike, zzz while
 * asleep). `at` names the point they come from.
 * @type {Readonly<Record<string, {kind: string, period: number, offset: number, at: 'head'|'hammer'|'mug'}>>}
 */
export const ACTIVITY_EMITTERS = Object.freeze({
  hammer: { kind: 'sparks', period: HAMMER_PERIOD, offset: HAMMER_PERIOD * HAMMER_IMPACT, at: 'hammer' },
  sleep: { kind: 'zzz', period: 2.6, offset: 0.9, at: 'head' },
  sip: { kind: 'steam', period: SIP_PERIOD / 2, offset: 0.4, at: 'mug' },
  spa: { kind: 'steam', period: 1.7, offset: 0.5, at: 'head' },
});

/** @param {string} name */
export function isActivity(name) {
  return Object.hasOwn(ACTIVITY_DEFS, name);
}
