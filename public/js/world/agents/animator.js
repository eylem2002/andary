// Per-agent animation state: which activity plays, how far the cross-fade from the previous one
// has got, which props are in hand, and when to blink. Pure (no three.js), so state transitions
// are unit-tested; the rig turns the resulting pose into bone rotations.

import { ACTIVITY_DEFS, ACTIVITY_EMITTERS, PROP_NAMES, blinkAmount, isActivity } from './activities.js';
import { P, UPPER_BODY, blendPose, copyChannels, createPose } from './pose.js';
import { crossedTick, easeInOutCubic, easeOutBack } from './easing.js';

/** Seconds a cross-fade between two activities takes. */
export const BLEND_SECONDS = 0.28;
/** Seconds a prop takes to pop in or out of a hand. */
export const PROP_SECONDS = 0.2;
/** Walk-cycle radians per world unit travelled (one full cycle is two steps). */
export const GAIT_PER_UNIT = (Math.PI * 2) / 0.78;
/** Nominal speeds, used when a gait plays in place. */
export const WALK_SPEED = 2.2;
export const RUN_SPEED = 4.5;

/** Activities that can be layered over walking: their arms and props stay while travelling. */
const CARRIED_WHILE_WALKING = new Set(['carry']);

/** @param {string} activity @param {string|null} kit @param {'box'|'mailbag'} variant */
function propTargets(activity, kit, variant) {
  const def = ACTIVITY_DEFS[activity];
  const out = new Float32Array(PROP_NAMES.length);
  for (const name of def.props) {
    const shown = name === 'box' && variant === 'mailbag' ? 'mailbag' : name;
    out[PROP_NAMES.indexOf(shown)] = 1;
  }
  if (def.kit && kit) out[PROP_NAMES.indexOf(kit)] = 1;
  out[PROP_NAMES.indexOf('hat')] = def.hideHat ? 0 : 1;
  return out;
}

export class Animator {
  /**
   * @param {number} seedInt  per-agent hash, so idle timing differs between agents
   * @param {string|null} [kit] the prop this figure carries around (e.g. a Scout's magnifier)
   */
  constructor(seedInt, kit = null) {
    /** @type {import('./activities.js').AnimContext} */
    this.ctx = { seed: (seedInt % 1000) / 1000, seedInt, gait: 0, variant: 'box' };
    this.kit = kit;
    /** @type {string} */
    this.activity = 'idle';
    /** Upper-body activity layered over a gait, or null. */
    this.overlay = null;
    this.time = 0;
    this.prevTime = 0;
    this.clock = 0;
    this.blend = 1;
    this.from = createPose();
    this.target = createPose();
    this.scratch = createPose();
    this.pose = createPose();
    /** Linear pop progress per prop (0 hidden, 1 shown). */
    this.propProgress = new Float32Array(PROP_NAMES.length);
    /** Displayed scale per prop (eased, with overshoot). */
    this.propScale = new Float32Array(PROP_NAMES.length);
    this.propGoal = propTargets('idle', kit, 'box');
    this.propProgress.set(this.propGoal);
    this.propScale.set(this.propGoal);
  }

  /**
   * Switches to another activity with a cross-fade. Returns false when nothing changed.
   * @param {string} activity
   */
  set(activity) {
    if (!isActivity(activity) || activity === this.activity) return false;
    // Fade from whatever is on screen now, so switching mid-blend never pops.
    this.from.set(this.pose);
    this.activity = activity;
    this.time = 0;
    this.prevTime = 0;
    this.blend = 0;
    this.refreshProps();
    return true;
  }

  /**
   * Layers an upper-body activity (only `carry` qualifies) over walking, or clears it.
   * @param {string|null} activity
   */
  setOverlay(activity) {
    const next = activity && CARRIED_WHILE_WALKING.has(activity) ? activity : null;
    if (next === this.overlay) return;
    this.overlay = next;
    this.refreshProps();
  }

  /** @param {'box'|'mailbag'} variant */
  setVariant(variant) {
    if (variant === this.ctx.variant) return;
    this.ctx.variant = variant;
    this.refreshProps();
  }

  /** Reduced motion: gentler versions of the bounciest activities. @param {boolean} on */
  setCalm(on) {
    this.ctx.calm = on;
  }

  /** @param {string|null} kit */
  setKit(kit) {
    this.kit = kit;
    this.refreshProps();
  }

  refreshProps() {
    const goal = propTargets(this.activity, this.kit, this.ctx.variant);
    if (this.overlay && ACTIVITY_DEFS[this.activity].locomotion) {
      const extra = propTargets(this.overlay, null, this.ctx.variant);
      for (let i = 0; i < goal.length; i++) goal[i] = Math.max(goal[i], extra[i]);
    }
    this.propGoal = goal;
  }

  /** Advances the walk cycle by a distance travelled. @param {number} distance */
  advanceGait(distance) {
    this.ctx.gait = (this.ctx.gait + distance * GAIT_PER_UNIT) % (Math.PI * 2);
  }

  /** @returns {boolean} the current activity is a travel gait */
  get isGait() {
    return Boolean(ACTIVITY_DEFS[this.activity].locomotion);
  }

  /**
   * Computes this frame's pose.
   * @param {number} dt seconds
   * @param {boolean} [moving] the walker advanced the gait itself this frame
   */
  update(dt, moving = false) {
    this.prevTime = this.time;
    this.time += dt;
    this.clock += dt;
    const def = ACTIVITY_DEFS[this.activity];
    if (def.locomotion && !moving) {
      this.advanceGait(dt * (this.activity === 'run' ? RUN_SPEED : WALK_SPEED)); // treadmill
    }
    def.pose(this.target, this.time, this.ctx);
    if (this.overlay && def.locomotion) {
      ACTIVITY_DEFS[this.overlay].pose(this.scratch, this.clock, this.ctx);
      copyChannels(this.target, this.scratch, UPPER_BODY);
    }
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / BLEND_SECONDS);
      blendPose(this.pose, this.from, this.target, easeInOutCubic(this.blend));
    } else {
      this.pose.set(this.target);
    }
    this.pose[P.EYES] *= 1 - blinkAmount(this.clock, this.ctx.seedInt);
    this.updateProps(dt);
    return this.pose;
  }

  /** @param {number} dt */
  updateProps(dt) {
    const step = dt / PROP_SECONDS;
    for (let i = 0; i < this.propProgress.length; i++) {
      const goal = this.propGoal[i];
      const p = this.propProgress[i];
      const next = goal > p ? Math.min(goal, p + step) : Math.max(goal, p - step);
      this.propProgress[i] = next;
      // easeOutBack overshoots a little: props "pop" into the hand like a cartoon.
      this.propScale[i] = next >= 1 ? 1 : next <= 0 ? 0 : easeOutBack(next);
    }
  }

  /**
   * The effect an activity emits on this frame's beat (e.g. sparks when the hammer lands), or
   * null. Quiet while cross-fading so a half-raised hammer does not spark.
   * @returns {{kind: string, at: 'head'|'hammer'|'mug'}|null}
   */
  beat() {
    const emitter = ACTIVITY_EMITTERS[this.activity];
    if (!emitter || this.blend < 0.6) return null;
    return crossedTick(this.prevTime, this.time, emitter.period, emitter.offset) ? emitter : null;
  }
}
