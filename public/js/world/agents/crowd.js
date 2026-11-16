// The crowd: every agent in the town, plus the shared systems around them (spot allocation,
// effects, weather, paper planes, ground markers, DOM tags). It implements the agent half of the
// World API (CONTRACTS §6); world.js forwards to it. Unknown ids and bad input are ignored.

import * as THREE from 'three';
import { BUILDING_KEYS } from '../../core/catalog.js';
import { LOTS, tileToWorld } from '../layout.js';
import { Agent, isWorkActivity } from './agent.js';
import { enter, leave } from './arrivals.js';
import { isActivity } from './activities.js';
import { createSpotAllocator } from './spots.js';
import { planRoute, slotEntry, slotPosition, standingSpots } from './routes.js';
import { normalizeTone, offerBubble, tickBubble, truncateText } from './bubbles.js';
import { resolveLook } from './looks.js';
import { createOverlay } from './overlay.js';
import { createEffects } from './effects.js';
import { createWeather } from './weather.js';
import { createPlanes } from './planes.js';
import { createMarkers } from './markers.js';
import { raySegmentDistance } from './input.js';
import { PROP_BONE } from './rig.js';
import { P } from './pose.js';
import { clamp } from './easing.js';
import { iconBoost, layoutTags, pillClearance } from './tags.js';

const PACES = new Set(['walk', 'run', 'teleport']);
/**
 * Seconds the bus needs to pull in after it is called. The contract has no "bus arrived" event,
 * so this matches the environment's bus (about 6.5 s); riders appear or board on that clock.
 */
const BUS_TRAVEL_SECONDS = 6;
/** One bus serves everyone who arrives or leaves within this many seconds of each other. */
const BUS_SHARE_SECONDS = 8;
const PICK_RADIUS = 0.36;
/** Effects that belong above an agent's head rather than around its body. */
const HEAD_EFFECTS = new Set(['check', 'cross', 'bulb', 'hearts', 'zzz', 'magnify', 'signal', 'steam', 'smoke', 'confetti']);
const BODY_HEIGHT = { sparks: 0.55, fireworks: 0.1, books: 0.7, portal: 0.5, poof: 0.45, boxes: 0.8 };

/** @param {unknown} key @returns {key is import('../../core/catalog.js').BuildingKey} */
export function isBuilding(key) {
  return typeof key === 'string' && BUILDING_KEYS.includes(/** @type {any} */ (key));
}

/** @param {any} v */
const isPoint = (v) => Boolean(v) && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

const _tmp = new THREE.Vector3();
/** Reused options for beat effects (emitted every second or so per working agent). */
const BEAT_OPTS = { scale: 1, ground: 0 };

export class Crowd {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {any} o.env   the Environment (CONTRACTS §6.1)
   * @param {HTMLElement} o.container
   * @param {'high'|'low'} o.quality
   * @param {boolean} o.reducedMotion
   * @param {(id: string) => void} o.onPick   a name pill was clicked
   */
  constructor({ scene, env, container, quality, reducedMotion, onPick }) {
    this.scene = scene;
    this.env = env;
    this.onPick = onPick;
    this.root = new THREE.Group();
    this.root.name = 'agents';
    scene.add(this.root);
    this.overlay = createOverlay(container);
    this.effects = createEffects(scene, { quality, reducedMotion });
    this.weather = createWeather(scene, this.effects.fields.drop);
    this.planes = createPlanes(scene, (p) => this.effects.emit('poof', p, { scale: 0.45 }));
    this.markers = createMarkers(scene);
    this.allocator = createSpotAllocator((key) => standingSpots(/** @type {any} */ (key)).length);
    /** @type {Map<string, Agent>} */
    this.agents = new Map();
    /** Present and leaving agents, for the frame loop. @type {Agent[]} */
    this.live = [];
    this.clock = 0;
    /** @type {string|null} */
    this.selected = null;
    /** @type {string|null} */
    this.hovered = null;
    this.castShadows = quality === 'high';
    this.reducedMotion = reducedMotion;
    /** When the bus was last called for each action, and when the called bus reaches the stop. */
    this.busAt = { trip: -Infinity, arrive: -Infinity, depart: -Infinity };
    this.busReadyAt = -Infinity;
    this.overlay.setReducedMotion(reducedMotion);
    /** World height of a name pill at the current zoom: head icons start above it. */
    this.pillLift = 0.6;
    /** Head icons grow a little when zoomed out (see tags.iconBoost). */
    this.iconScale = 1;
    this.topOf = (/** @type {string} */ id) => this.agents.get(id)?.top ?? null;
    /** Resolvers of exits still playing, settled early if the world is disposed. @type {Set<(value?: any) => void>} */
    this.exits = new Set();
  }

  // ── registry ────────────────────────────────────────────────────────────────

  /** @param {any} spec AgentSpec */
  add(spec) {
    if (!spec || typeof spec.id !== 'string' || !spec.id) return;
    if (this.agents.has(spec.id)) {
      this.update(spec.id, spec);
      return;
    }
    const look = resolveLook(spec);
    const tag = this.overlay.createTag(spec.id, this.onPick);
    const agent = new Agent(spec.id, truncateText(spec.name ?? 'Agent', 40), look, tag);
    agent.type = typeof spec.type === 'string' ? spec.type : undefined;
    tag.setName(agent.name);
    tag.setColor(look.color);
    agent.setCastShadow(this.castShadows);
    agent.anim.setCalm(this.reducedMotion);
    this.root.add(agent.group);
    this.agents.set(spec.id, agent);
    this.live.push(agent);
    const spawn = isBuilding(spec.spawnAt) ? spec.spawnAt : 'hall';
    this.claim(agent, spawn);
    const entrance = ['portal', 'bus', 'pop', 'none'].includes(spec.entrance) ? spec.entrance : 'pop';
    enter(this, agent, entrance);
  }

  /** @param {string} id @param {any} patch */
  update(id, patch) {
    const agent = this.agents.get(id);
    if (!agent || !patch || typeof patch !== 'object') return;
    if (typeof patch.name === 'string') {
      agent.name = truncateText(patch.name, 40);
      agent.tag.setName(agent.name);
    }
    const look = resolveLook({
      id,
      color: patch.color ?? agent.look.color,
      role: patch.role ?? agent.look.role,
      type: 'type' in patch ? patch.type : agent.type,
      hat: patch.hat ?? agent.look.hat,
    });
    if ('type' in patch) agent.type = patch.type;
    if (look.color !== agent.look.color) agent.tag.setColor(look.color);
    agent.restyle(look); // swaps geometry only when something baked into it changed
  }

  /** @param {string} id @param {{exit?: string}} [opts] */
  remove(id, opts) {
    const agent = this.agents.get(id);
    if (!agent) return Promise.resolve();
    this.agents.delete(id);
    agent.leaving = true;
    agent.resolveWaiters(false);
    this.applyMoves(this.allocator.release(id));
    this.weather.remove(id);
    if (this.selected === id) this.select(null);
    if (this.hovered === id) this.hovered = null;
    const exit = ['portal', 'bus', 'poof'].includes(opts?.exit) ? opts.exit : 'poof';
    return new Promise((resolve) => {
      this.exits.add(resolve);
      leave(this, agent, exit, () => {
        this.live.splice(this.live.indexOf(agent), 1);
        agent.dispose();
        this.exits.delete(resolve);
        resolve();
      });
    });
  }

  /** @param {string} id */
  has(id) {
    return this.agents.has(id);
  }

  /**
   * Lab helper: stands an agent at an exact point (no spot, no route), e.g. for line-ups.
   * @param {string} id @param {number} x @param {number} z @param {number} [yaw]
   */
  place(id, x, z, yaw = Math.PI / 4) {
    const agent = this.agents.get(id);
    if (!agent || !Number.isFinite(x) || !Number.isFinite(z)) return;
    agent.resolveWaiters(false);
    this.applyMoves(this.allocator.release(id));
    agent.building = null;
    agent.queued = false;
    agent.route = null;
    agent.position.set(x, 0, z);
    agent.heading = agent.goalHeading = Number.isFinite(yaw) ? yaw : 0;
    if (!agent.entering) agent.settle();
  }

  // ── movement ────────────────────────────────────────────────────────────────

  /**
   * @param {string} id @param {unknown} key @param {{pace?: string}} [opts]
   * @returns {Promise<boolean>} true on arrival, false if superseded or removed
   */
  goTo(id, key, opts) {
    const agent = this.agents.get(id);
    if (!agent || !isBuilding(key)) return Promise.resolve(false);
    const pace = PACES.has(opts?.pace) ? opts.pace : 'walk';
    return new Promise((resolve) => {
      if (agent.entering) {
        agent.resolveWaiters(false);
        agent.pendingGo = { key, pace };
        agent.waiters.push(resolve);
        return;
      }
      if (agent.building === key && agent.busy) {
        agent.waiters.push(resolve); // already on the way there: arrive together
        return;
      }
      if (agent.building === key) {
        resolve(true);
        return;
      }
      agent.resolveWaiters(false);
      agent.waiters.push(resolve);
      this.moveTo(agent, key, pace);
    });
  }

  /**
   * Claims a place at a building and walks (or teleports) there. Used by goTo and entrances.
   * @param {Agent} agent @param {import('../../core/catalog.js').BuildingKey} key @param {string} pace
   */
  moveTo(agent, key, pace) {
    this.claim(agent, key);
    if (pace === 'teleport') {
      this.teleport(agent);
      return;
    }
    this.walkToSlot(agent, pace);
  }

  /** Walks an agent to its current slot, through the building's door. @param {Agent} agent @param {string} pace */
  walkToSlot(agent, pace) {
    const slot = this.allocator.slotOf(agent.id);
    const stand = this.standingFor(agent);
    const via = slot ? slotEntry(/** @type {any} */ (slot.key), slot) : null;
    agent.walk(planRoute(agent.position, stand, agent.lane, via), pace, stand.facing);
  }

  /** @param {Agent} agent @param {import('../../core/catalog.js').BuildingKey} key */
  claim(agent, key) {
    const { slot, moves } = this.allocator.claim(key, agent.id);
    agent.building = key;
    agent.queued = slot.kind === 'queue';
    agent.anim.setVariant(key === 'post' ? 'mailbag' : 'box');
    this.applyMoves(moves);
  }

  /** Poof out, reappear at the destination (looked up at that moment: the queue may have moved). @param {Agent} agent */
  teleport(agent) {
    agent.route = null;
    this.effects.emit('poof', { x: agent.position.x, y: 0.45, z: agent.position.z }, { scale: 0.7 });
    agent.play('tele-out', () => {
      const stand = this.standingFor(agent);
      agent.position.set(stand.x, 0, stand.z);
      agent.heading = agent.goalHeading = stand.facing;
      this.effects.emit('poof', { x: stand.x, y: 0.45, z: stand.z }, { scale: 0.7 });
      agent.play('tele-in', () => {
        agent.settle();
        agent.resolveWaiters(true);
      });
    });
  }

  /** Agents whose place changed because someone left (queue moves up). @param {import('./spots.js').SlotMove[]} moves */
  applyMoves(moves) {
    for (const move of moves) {
      const other = this.agents.get(move.id);
      if (!other) continue;
      other.queued = move.kind === 'queue';
      if (other.entering || other.transition) continue; // picks up its new place when it lands
      this.walkToSlot(other, 'walk');
    }
  }

  /** Standing point of an agent's current slot. @param {Agent} agent */
  standingFor(agent) {
    const slot = this.allocator.slotOf(agent.id);
    if (!slot) return { x: agent.position.x, z: agent.position.z, facing: agent.heading };
    return slotPosition(/** @type {any} */ (slot.key), slot);
  }

  /**
   * A named point at a building from the environment, or the door as a fallback.
   * @param {import('../../core/catalog.js').BuildingKey} key @param {string} [name]
   */
  anchorPoint(key, name) {
    try {
      const v = this.env.anchor?.(key, name);
      if (isPoint(v)) return { x: v.x, y: v.y, z: v.z };
    } catch {
      // An environment without this anchor: use the door.
    }
    const door = tileToWorld(LOTS[key].door[0], LOTS[key].door[1]);
    return { x: door.x, y: 0, z: door.z };
  }

  /**
   * Calls the bus, at most once per few seconds however many agents ride it.
   * @param {'trip'|'arrive'|'depart'} action
   */
  bus(action) {
    if (this.clock - this.busAt[action] < BUS_SHARE_SECONDS) return;
    this.busAt[action] = this.clock;
    if (action !== 'depart' && this.clock > this.busReadyAt + BUS_SHARE_SECONDS) {
      this.busReadyAt = this.clock + BUS_TRAVEL_SECONDS;
    }
    try {
      this.env.vehicle?.('bus', action);
    } catch {
      // Vehicles are decoration; never let them break an arrival or exit.
    }
  }

  /** Seconds until the bus that was called stands at the stop (0 if it is there). */
  busWait() {
    return Math.max(0, this.busReadyAt - this.clock);
  }

  // ── activity and chatter ────────────────────────────────────────────────────

  /** @param {string} id @param {unknown} activity */
  setActivity(id, activity) {
    const agent = this.agents.get(id);
    if (!agent || agent.leaving || typeof activity !== 'string' || !isActivity(activity)) return;
    agent.activity = activity;
    if (agent.moving) agent.anim.setOverlay(activity);
    else if (!agent.entering && !agent.transition && !(agent.queued && isWorkActivity(activity))) agent.anim.set(activity);
  }

  /** @param {string} id @param {unknown} status */
  setStatus(id, status) {
    const agent = this.agents.get(id);
    if (!agent || typeof status !== 'string') return;
    agent.status = status;
    agent.tag.setStatus(status);
  }

  /** @param {string} id @param {unknown} text @param {{ms?: number, tone?: string}} [opts] */
  say(id, text, opts) {
    const agent = this.agents.get(id);
    if (!agent) return;
    const line = { text: truncateText(text), tone: normalizeTone(opts?.tone), ms: Number(opts?.ms) };
    if (offerBubble(agent.bubble, this.clock * 1000, line) === 'show') this.showBubble(agent);
  }

  /** @param {Agent} agent */
  showBubble(agent) {
    const line = agent.bubble.current;
    if (line) agent.tag.showBubble(line.text, line.tone, this.reducedMotion);
  }

  /** @param {string} id @param {unknown} emoji */
  emote(id, emoji) {
    const agent = this.agents.get(id);
    if (!agent || typeof emoji !== 'string' || !emoji.trim()) return;
    agent.tag.emote(truncateText(emoji, 12), this.reducedMotion); // room for ZWJ sequences like 👩‍💻
  }

  /** @param {string} id @param {unknown} text */
  setBadge(id, text) {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.tag.setBadge(typeof text === 'string' && text.trim() ? truncateText(text, 12) : null);
  }

  /** @param {string} id @param {unknown} kind */
  setWeather(id, kind) {
    const agent = this.agents.get(id);
    if (!agent) return;
    this.weather.set(id, kind === 'rain' || kind === 'storm' ? kind : null, agent.top);
  }

  /**
   * Plays an effect on an agent: icons above the head, bursts around the body.
   * @param {string} kind @param {string} id @param {{color?: string}} [opts]
   */
  effectOnAgent(kind, id, opts) {
    const agent = this.agents.get(id);
    if (!agent) return;
    const h = agent.look.height;
    const overHead = HEAD_EFFECTS.has(kind);
    const p = overHead
      ? { x: agent.top.x, y: agent.top.y + this.pillLift, z: agent.top.z }
      : { x: agent.position.x, y: agent.position.y + (BODY_HEIGHT[kind] ?? 0.6) * h, z: agent.position.z };
    this.effects.emit(kind, p, { color: opts?.color, ground: 0, scale: overHead ? this.iconScale : 1 });
  }

  /**
   * @param {string} fromId
   * @param {() => ({x: number, y: number, z: number}|null)} target live target point
   */
  sendPlane(fromId, target) {
    const from = this.agents.get(fromId);
    if (!from) return Promise.resolve();
    const start = { x: from.position.x, y: from.position.y + 0.75 * from.look.height, z: from.position.z };
    return this.planes.launch(start, target);
  }

  // ── selection and picking ───────────────────────────────────────────────────

  /**
   * Nearest agent under a ray, or null.
   * @param {THREE.Ray} ray
   */
  pick(ray) {
    let best = null;
    let bestAlong = Infinity;
    for (const agent of this.agents.values()) {
      if (agent.appear < 0.5) continue;
      const h = agent.look.height;
      const base = agent.position;
      const hit = raySegmentDistance(
        ray.origin,
        ray.direction,
        { x: base.x, y: base.y + 0.1 * h, z: base.z },
        { x: base.x, y: agent.top.y, z: base.z },
      );
      if (hit.distance <= PICK_RADIUS * h && hit.along < bestAlong) {
        best = agent.id;
        bestAlong = hit.along;
      }
    }
    return best;
  }

  /** @param {string|null} id */
  select(id) {
    const next = id && this.agents.has(id) ? id : null;
    if (this.selected) this.agents.get(this.selected)?.tag.setSelected(false);
    this.selected = next;
    if (next) this.agents.get(next).tag.setSelected(true);
  }

  /** @param {string|null} id */
  hover(id) {
    if (id === this.hovered) return;
    if (this.hovered) this.agents.get(this.hovered)?.tag.setHovered(false);
    this.hovered = id && this.agents.has(id) ? id : null;
    if (this.hovered) this.agents.get(this.hovered).tag.setHovered(true);
  }

  /** @param {string} id */
  screenPosition(id) {
    const agent = this.agents.get(id);
    if (!agent) return null;
    return { x: agent.screen.x, y: agent.screen.y, visible: agent.screen.visible };
  }

  /** Live position of an agent for camera follow (null once it is gone). @param {string} id */
  followPoint(id) {
    const agent = this.agents.get(id);
    return agent ? agent.position : null;
  }

  /** @param {'high'|'low'} quality */
  setQuality(quality) {
    this.castShadows = quality === 'high';
    for (const agent of this.live) agent.setCastShadow(this.castShadows);
    this.effects.setQuality(quality);
  }

  /** @param {boolean} on */
  setReducedMotion(on) {
    this.reducedMotion = on;
    this.effects.setReducedMotion(on);
    this.weather.setReducedMotion(on);
    this.planes.setReducedMotion(on);
    this.overlay.setReducedMotion(on);
    for (const agent of this.live) agent.anim.setCalm(on);
  }

  // ── frame ───────────────────────────────────────────────────────────────────

  /**
   * @param {number} dt seconds
   * @param {{camera: THREE.Camera, width: number, height: number, faceYaw: number}} view
   */
  tick(dt, view) {
    this.clock += dt;
    this.pillLift = pillClearance(view);
    this.iconScale = iconBoost(view);
    const nowMs = this.clock * 1000;
    const live = this.live;
    for (let i = 0; i < live.length; i++) {
      const agent = live[i];
      agent.update(dt);
      this.emitBeat(agent);
      const change = tickBubble(agent.bubble, nowMs);
      if (change === 'show') this.showBubble(agent);
      else if (change === 'hide') agent.tag.hideBubble();
    }
    this.weather.update(dt, this.clock, this.topOf, this.pillLift);
    this.planes.update(dt);
    this.effects.update(dt, view.faceYaw);
    this.updateMarkers();
    layoutTags(live, view, dt);
  }

  /** Effects some activities make on their beat (hammer sparks, zzz, steam). @param {Agent} agent */
  emitBeat(agent) {
    const beat = agent.anim.beat();
    if (!beat || agent.appear < 0.5) return;
    if (beat.at === 'hammer') agent.bonepoint(PROP_BONE.hammer, 0, -0.17, 0, _tmp);
    else if (beat.at === 'mug') agent.bonepoint(PROP_BONE.mug, 0, -0.045, 0.08, _tmp);
    else _tmp.set(agent.top.x, agent.top.y + (beat.kind === 'zzz' ? this.pillLift * 0.6 : 0), agent.top.z);
    BEAT_OPTS.scale = beat.kind === 'sparks' ? 0.35 : 0.7;
    this.effects.emit(beat.kind, _tmp, BEAT_OPTS);
  }

  updateMarkers() {
    const markers = this.markers;
    markers.beginShadows();
    const live = this.live;
    for (let i = 0; i < live.length; i++) {
      const agent = live[i];
      if (!agent.group.visible) continue;
      const hop = clamp(agent.anim.pose[P.ROOT_Y] * 2.5, 0, 0.45);
      markers.addShadow(agent.position.x, agent.position.z, 0.62 * agent.look.height * agent.appear * (1 - hop), 0);
    }
    markers.endShadows();
    const selected = this.selected ? this.agents.get(this.selected) : null;
    markers.setRing(selected ? selected.position : null, selected?.look.color, selected?.look.height ?? 1, this.clock);
  }

  dispose() {
    for (const agent of this.live) agent.dispose();
    for (const resolve of this.exits) resolve();
    this.exits.clear();
    this.live.length = 0;
    this.agents.clear();
    this.weather.dispose();
    this.planes.dispose();
    this.effects.dispose();
    this.markers.dispose();
    this.overlay.dispose();
    this.root.removeFromParent();
  }
}
