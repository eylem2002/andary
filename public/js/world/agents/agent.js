// One character in the town: its figure, where it is going, how it appears and disappears, and
// its animation. The crowd decides *where* agents go (spots, queues, routes); an Agent only
// knows how to follow a route and play transitions.

import * as THREE from 'three';
import { Animator, RUN_SPEED, WALK_SPEED } from './animator.js';
import { applyPose, B } from './rig.js';
import { createFigure, disposeFigure, restyleFigure } from './figure.js';
import { laneOffset } from './routes.js';
import { easeInCubic, easeOutBack, easeOutCubic, turnToward } from './easing.js';
import { createBubbleSlot } from './bubbles.js';

const TURN_SPEED = 11; // rad/s
const ACCEL = 14; // units/s², so walkers ease into their stride
const TAU = Math.PI * 2;

/** How far above the head bone each hat reaches (figure units), for pills and icons. */
const HAT_TOP = { hardhat: 0.38, cap: 0.35, crown: 0.43, beret: 0.35, sunhat: 0.35, wizard: 0.66, none: 0.33 };

/**
 * Appear/disappear animations. Each maps progress u (0..1) to scale, lift and extra spin.
 * @type {Record<string, {duration: number, apply: (a: Agent, u: number) => void}>}
 */
const TRANSITIONS = {
  'pop-in': { duration: 0.42, apply: (a, u) => set(a, easeOutBack(u), 0, 0) },
  'pop-out': { duration: 0.28, apply: (a, u) => set(a, 1 - easeInCubic(u), 0.15 * u, 0) },
  'portal-in': {
    duration: 1.0,
    apply: (a, u) => set(a, Math.min(1, u * 2.5), 1.2 * (1 - easeOutCubic(u)), (1 - easeOutCubic(u)) * 2 * TAU),
  },
  'portal-out': {
    duration: 0.95,
    apply: (a, u) => set(a, 1 - easeInCubic(u), 1.5 * easeInCubic(u), u * u * 2 * TAU),
  },
  hidden: { duration: 1.3, apply: (a) => set(a, 0, 0, 0) },
  pause: { duration: 1, apply: (a) => set(a, 1, 0, 0) },
  'tele-out': { duration: 0.2, apply: (a, u) => set(a, 1 - u, 0, u * Math.PI) },
  'tele-in': { duration: 0.32, apply: (a, u) => set(a, easeOutBack(u), 0, (1 - u) * Math.PI) },
};

/** @param {Agent} a @param {number} appear @param {number} lift @param {number} spin */
function set(a, appear, lift, spin) {
  a.appear = appear;
  a.lift = lift;
  a.spin = spin;
}

/**
 * @typedef {object} Route
 * @property {{x: number, z: number}[]} points
 * @property {number} index   next point
 * @property {number} speed
 * @property {number} facing  heading on arrival
 * @property {() => void} [then] called on arrival instead of settling
 */

export class Agent {
  /**
   * @param {string} id
   * @param {string} name
   * @param {import('./looks.js').Look} look
   * @param {import('./overlay.js').AgentTag} tag
   */
  constructor(id, name, look, tag) {
    this.id = id;
    this.name = name;
    this.look = look;
    /** @type {string|undefined} agent type (Explore, Plan, …), kept so restyles can re-derive the look */
    this.type = undefined;
    const { mesh, bones } = createFigure(look);
    this.mesh = mesh;
    this.bones = bones;
    this.group = new THREE.Group();
    this.group.name = 'agent';
    this.group.add(mesh);
    this.anim = new Animator(look.seedInt, look.kit);
    this.lane = laneOffset(look.seedInt);
    this.heading = Math.PI / 4;
    this.goalHeading = this.heading;
    /** The activity the director asked for (shown when standing at a work spot). */
    this.activity = 'idle';
    this.status = 'idle';
    /** @type {import('../../core/catalog.js').BuildingKey|null} */
    this.building = null;
    this.queued = false;
    /** @type {Route|null} */
    this.route = null;
    this.speed = 0;
    /** @type {((arrived: boolean) => void)[]} */
    this.waiters = [];
    /** @type {{kind: string, t: number, duration: number, done: (() => void)|null}|null} */
    this.transition = null;
    this.entering = false;
    this.leaving = false;
    this.appear = 1;
    this.lift = 0;
    this.spin = 0;
    this.tag = tag;
    this.bubble = createBubbleSlot();
    /** Head-top point in world space, refreshed every frame (pill anchor, icon effects). */
    this.top = new THREE.Vector3();
    /** Last frame's place on screen (px): head top (x, y), feet (`feet`) and half the figure's width. */
    this.screen = { x: 0, y: 0, feet: 0, half: 0, visible: false };
    /** @type {{key: import('../../core/catalog.js').BuildingKey, pace: string}|null} goTo received while entering */
    this.pendingGo = null;
  }

  get position() {
    return this.group.position;
  }

  get moving() {
    return this.route !== null;
  }

  get busy() {
    return this.route !== null || this.transition !== null;
  }

  /**
   * Starts following waypoints.
   * @param {{x: number, z: number}[]} points
   * @param {string} pace 'walk' | 'run'
   * @param {number} facing heading on arrival
   * @param {() => void} [then] replaces the normal arrival (used by exits)
   */
  walk(points, pace, facing, then) {
    this.route = { points, index: 0, speed: pace === 'run' ? RUN_SPEED : WALK_SPEED, facing, then };
    this.anim.set(pace === 'run' ? 'run' : 'walk');
    this.anim.setOverlay(this.activity);
  }

  /**
   * Plays an appear/disappear animation (or a timed pause), then calls `done`.
   * @param {keyof typeof TRANSITIONS} kind @param {(() => void)|null} [done]
   * @param {number} [duration] seconds, overriding the transition's own length
   */
  play(kind, done = null, duration = TRANSITIONS[kind].duration) {
    this.transition = { kind, t: 0, duration: Math.max(0.01, duration), done };
    TRANSITIONS[kind].apply(this, 0);
  }

  /** Picks the standing animation for where the agent is: waiting in line, or its work. */
  settle() {
    this.anim.setOverlay(null);
    this.anim.set(this.queued && isWorkActivity(this.activity) ? 'wait' : this.activity);
  }

  /** @param {boolean} arrived */
  resolveWaiters(arrived) {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve(arrived);
  }

  /** @param {number} dt */
  stepRoute(dt) {
    const route = this.route;
    if (!route) return 0;
    this.speed = Math.min(route.speed, this.speed + ACCEL * dt);
    const pos = this.group.position;
    let budget = this.speed * dt;
    let travelled = 0;
    while (budget > 1e-6 && route.index < route.points.length) {
      const p = route.points[route.index];
      const dx = p.x - pos.x;
      const dz = p.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-3) this.goalHeading = Math.atan2(dx, dz);
      const step = Math.min(d, budget);
      if (d > 1e-9) {
        pos.x += (dx / d) * step;
        pos.z += (dz / d) * step;
      }
      budget -= step;
      travelled += step;
      if (step >= d) route.index++;
    }
    if (route.index >= route.points.length) this.arrive();
    return travelled;
  }

  arrive() {
    const route = this.route;
    this.route = null;
    this.speed = 0;
    this.goalHeading = route.facing;
    if (route.then) {
      route.then();
      return;
    }
    this.settle();
    this.resolveWaiters(true);
  }

  /** @param {number} dt */
  stepTransition(dt) {
    const tr = this.transition;
    if (!tr) return;
    tr.t += dt;
    const u = Math.min(1, tr.t / tr.duration);
    TRANSITIONS[tr.kind].apply(this, u);
    if (u >= 1) {
      this.transition = null;
      tr.done?.();
    }
  }

  /**
   * Advances movement, transitions and animation, and writes the pose onto the bones.
   * @param {number} dt
   */
  update(dt) {
    this.stepTransition(dt);
    const travelled = this.stepRoute(dt);
    if (travelled > 0) this.anim.advanceGait(travelled);
    this.heading = turnToward(this.heading, this.goalHeading, TURN_SPEED * dt);
    const pose = this.anim.update(dt, travelled > 0);
    applyPose(this.bones, pose, this.anim.propScale);
    const g = this.group;
    g.position.y = this.lift;
    g.rotation.y = this.heading + this.spin;
    g.scale.setScalar(this.look.height * Math.max(1e-3, this.appear));
    g.visible = this.appear > 0.01;
    g.updateMatrixWorld(true);
    this.updateTop();
  }

  /** Refreshes the head-top anchor from the posed head bone (follows sitting and hopping). */
  updateTop() {
    this.bones[B.HEAD].localToWorld(this.top.set(0, HAT_TOP[this.look.hat] ?? 0.36, 0));
  }

  /**
   * World position of a point on a bone (e.g. the hammer head), for effects.
   * @param {number} bone @param {number} x @param {number} y @param {number} z @param {THREE.Vector3} out
   */
  bonepoint(bone, x, y, z, out) {
    return this.bones[bone].localToWorld(out.set(x, y, z));
  }

  /** @param {import('./looks.js').Look} look */
  restyle(look) {
    restyleFigure(this.mesh, this.look.key, look);
    if (look.kit !== this.look.kit) this.anim.setKit(look.kit);
    this.look = look;
  }

  /** @param {boolean} on */
  setCastShadow(on) {
    this.mesh.castShadow = on;
  }

  dispose() {
    this.resolveWaiters(false);
    this.group.removeFromParent();
    disposeFigure(this.mesh, this.look.key);
    this.tag.remove();
  }
}

/** Work that waits for a free spot; reactions (celebrate, wave, …) play even in a queue. */
const WORK = new Set(['read', 'type', 'hammer', 'search', 'think', 'write', 'carry', 'sip', 'spa']);

/** @param {string} activity */
export function isWorkActivity(activity) {
  return WORK.has(activity);
}
