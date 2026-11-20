// The World facade (CONTRACTS §6): the only world module the app imports. It owns the renderer,
// the frame loop, resizing, input and picking, composes the Environment (terrain, buildings,
// camera; env/environment.js) with the crowd of characters (agents/), and keeps every public
// method safe to call with unknown ids or bad input.

import * as THREE from 'three';
import { Crowd, isBuilding } from './agents/crowd.js';
import { EFFECT_KINDS } from './agents/effects.js';
import { detectQuality } from './agents/quality.js';
import { attachKeyboard, attachPointer } from './agents/input.js';
import { truncateText } from './agents/bubbles.js';
import { safeColor } from './agents/color.js';

const LABEL =
  'Andary: a 3D view of your agents at work. Arrow keys pan, plus and minus zoom, Q and E rotate, Escape deselects.';
/** World units one arrow-key press pans (at zoom 1; the environment scales it by zoom). */
const PAN_STEP = 2;
const BOARD_STATUSES = new Set(['pending', 'in_progress', 'completed']);
/**
 * Where a building effect plays: a named anchor of that building (CONTRACTS §6.1), else the
 * kind's default ('top' of the roof, or the 'door'). The environment answers unknown names with
 * the door, so only names a building really has are listed.
 * @type {Record<string, {at: 'top'|'door', named?: Record<string, string>}>}
 */
const EFFECT_ANCHORS = {
  smoke: { at: 'top', named: { terminal: 'chimney', workshop: 'chimney' } },
  steam: { at: 'top', named: { spa: 'steam', cafe: 'cup' } },
  signal: { at: 'top', named: { web: 'dish' } },
  portal: { at: 'door', named: { hall: 'portal' } },
  boxes: { at: 'door', named: { post: 'garage', harbor: 'pier' } },
  sparks: { at: 'door', named: { workshop: 'forge' } },
  magnify: { at: 'door', named: { detective: 'telescope' } },
  books: { at: 'door' },
  poof: { at: 'door' },
};

/** @typedef {{type: 'agent', id: string} | {type: 'building', key: string} | null} Selection */

/** True when the browser can create a WebGL 2 context (three.js needs it). */
function webglAvailable() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext(); // free the probe context at once
    return Boolean(gl);
  } catch {
    return false;
  }
}

/** @param {any} v */
const isPoint = (v) => Boolean(v) && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/** @param {any} args */
async function loadEnvironment(args) {
  const { createEnvironment } = await import('./env/environment.js');
  return createEnvironment(args);
}

class World {
  /**
   * @param {HTMLElement} container
   * @param {{quality?: 'auto'|'high'|'low', reducedMotion?: boolean, timeOfDay?: number|'auto'}} options
   */
  constructor(container, options) {
    // Methods stay usable when destructured off the world object.
    for (const name of Object.getOwnPropertyNames(World.prototype)) {
      if (name !== 'constructor' && typeof this[name] === 'function') this[name] = this[name].bind(this);
    }
    this.container = container;
    this.quality = detectQuality(options.quality);
    this.reducedMotion =
      options.reducedMotion ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.paused = false;
    this.disposed = false;
    /** Whether prepareContainer had to make the container a positioned box (undone on teardown). */
    this.positioned = false;
    this.raf = 0;
    this.last = 0;
    this.elapsed = 0;
    this.frames = 0;
    this.fps = 0;
    this.fpsSince = 0;
    this.drawCalls = 0;
    /** @type {Record<'select'|'hover', Set<(sel: Selection) => void>>} */
    this.listeners = { select: new Set(), hover: new Set() };
    /** @type {string} */
    this.hoverKey = '';
    this.warned = new Set();
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.dir = new THREE.Vector3();
    this.view = { camera: /** @type {THREE.Camera} */ (null), width: 1, height: 1, faceYaw: 0 };
    /** @type {(() => void)[]} */
    this.cleanups = [];
  }

  /** @param {((args: any) => any)|undefined} envFactory */
  async init(envFactory) {
    this.prepareContainer();
    this.createRenderer();
    this.env = await (envFactory ?? loadEnvironment)({
      renderer: this.renderer,
      container: this.container,
      quality: this.quality,
      reducedMotion: this.reducedMotion,
      onSelectBuilding: (/** @type {string} */ key) => {
        if (isBuilding(key)) this.userSelect({ type: 'building', key });
      },
    });
    this.crowd = new Crowd({
      scene: this.env.scene,
      env: this.env,
      container: this.container,
      quality: this.quality,
      reducedMotion: this.reducedMotion,
      onPick: (id) => this.userSelect({ type: 'agent', id }),
    });
    this.view.camera = this.env.camera;
    this.renderer.info.autoReset = false; // count every pass of a frame, not just the last one
    this.attachInput();
    this.resize();
    this.start();
  }

  prepareContainer() {
    const c = this.container;
    c.classList.add('tt-world');
    c.tabIndex = 0;
    c.setAttribute('role', 'application');
    c.setAttribute('aria-label', LABEL);
    // Overlays are absolutely placed inside the container, so it must be a positioned box.
    this.positioned = getComputedStyle(c).position === 'static';
    if (this.positioned) c.style.position = 'relative';
  }

  createRenderer() {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    } catch (error) {
      throw new Error(`WebGL could not start (${error?.message ?? 'unknown error'}), so the 3D town cannot be drawn.`, {
        cause: error,
      });
    }
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.domElement.classList.add('tt-world__canvas');
    this.container.appendChild(this.renderer.domElement);
  }

  pixelRatio() {
    return this.quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  }

  attachInput() {
    const canvas = this.renderer.domElement;
    this.cleanups.push(
      attachPointer(canvas, {
        onClick: (x, y) => this.userSelect(this.pickAt(x, y)),
        onHover: (x, y) => this.hoverAt(x, y),
        onLeave: () => this.setHover(null),
      }),
      attachKeyboard(this.container, (action) => this.keyAction(action)),
    );
    const observer = new ResizeObserver(() => this.resize());
    observer.observe(this.container);
    const onVisibility = () => (document.hidden ? this.stop() : this.start());
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanups.push(
      () => observer.disconnect(),
      () => document.removeEventListener('visibilitychange', onVisibility),
    );
  }

  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height || !this.env) return;
    this.renderer.setSize(width, height, false);
    this.view.width = width;
    this.view.height = height;
    this.envCall('resize', width, height);
    if (!this.raf) this.draw(0); // resizing clears the canvas; repaint even while paused
  }

  // ── frame loop ──────────────────────────────────────────────────────────────

  start() {
    if (this.raf || this.paused || document.hidden || !this.env) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** @param {number} now */
  frame(now) {
    this.raf = requestAnimationFrame(this.frame);
    // Clamp long gaps (a busy tab, a breakpoint) so nobody teleports across town.
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.draw(dt);
    this.countFrame(now);
  }

  /** Advances the town by dt seconds and renders it. @param {number} dt */
  draw(dt) {
    this.elapsed += dt;
    this.renderer.info.reset();
    try {
      this.env.update(dt, this.elapsed);
      const camera = this.env.camera;
      camera.updateMatrixWorld();
      camera.getWorldDirection(this.dir);
      this.view.camera = camera;
      this.view.faceYaw = Math.atan2(-this.dir.x, -this.dir.z);
      this.crowd.tick(dt, this.view);
      this.env.render();
    } catch (error) {
      this.warnOnce('frame', error);
    }
    this.drawCalls = this.renderer.info.render.calls;
  }

  /** @param {number} now */
  countFrame(now) {
    this.frames++;
    if (now - this.fpsSince >= 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsSince));
      this.frames = 0;
      this.fpsSince = now;
    }
  }

  // ── input ───────────────────────────────────────────────────────────────────

  /** @param {number} x @param {number} y CSS px in the canvas @returns {Selection} */
  pickAt(x, y) {
    this.ndc.set((x / this.view.width) * 2 - 1, -(y / this.view.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.env.camera);
    const id = this.crowd.pick(this.raycaster.ray);
    if (id) return { type: 'agent', id };
    let key = null;
    try {
      key = this.env.pickBuilding(this.raycaster);
    } catch (error) {
      this.warnOnce('pickBuilding', error);
    }
    return isBuilding(key) ? { type: 'building', key } : null;
  }

  /** @param {number} x @param {number} y */
  hoverAt(x, y) {
    this.setHover(this.pickAt(x, y));
  }

  /** @param {Selection} sel */
  setHover(sel) {
    const key = sel ? `${sel.type}:${sel.type === 'agent' ? sel.id : sel.key}` : '';
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.crowd.hover(sel?.type === 'agent' ? sel.id : null);
    this.renderer.domElement.classList.toggle('is-pointing', Boolean(sel));
    this.emit('hover', sel);
  }

  /** A selection the user made (click, sign, pill, Escape): apply it and tell listeners. @param {Selection} sel */
  userSelect(sel) {
    this.select(sel);
    this.emit('select', sel);
  }

  /** @param {import('./agents/input.js').KeyAction} action */
  keyAction(action) {
    if (action.type === 'pan') {
      // Env.panBy is in screen terms: dx to the right, dz towards the viewer (down the screen).
      this.envCall('panBy', action.right * PAN_STEP, -action.up * PAN_STEP);
    } else if (action.type === 'zoom') this.zoomBy(action.factor);
    else if (action.type === 'rotate') this.rotateCamera(action.dir);
    else if (action.type === 'reset') this.resetCamera();
    else if (action.type === 'deselect') {
      this.stopFollow();
      this.userSelect(null);
    }
  }

  /** @param {'select'|'hover'} event @param {Selection} sel */
  emit(event, sel) {
    for (const cb of this.listeners[event]) {
      try {
        cb(sel);
      } catch (error) {
        console.error(error);
      }
    }
  }

  /** Calls an Environment method, never letting it throw into the app. @param {string} name @param {...any} args */
  envCall(name, ...args) {
    try {
      return this.env?.[name]?.(...args);
    } catch (error) {
      this.warnOnce(name, error);
      return undefined;
    }
  }

  /** @param {string} what @param {unknown} error */
  warnOnce(what, error) {
    if (this.warned.has(what)) return;
    this.warned.add(what);
    console.warn(`[world] ${what} failed:`, error);
  }

  // ── World API: lifecycle and view ───────────────────────────────────────────

  dispose() {
    if (this.disposed) return;
    this.teardown();
  }

  /** Releases everything that exists so far; also used when start-up fails half way. */
  teardown() {
    this.disposed = true;
    this.stop();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.listeners.select.clear();
    this.listeners.hover.clear();
    this.crowd?.dispose();
    this.envCall('dispose');
    this.env = null;
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer?.domElement.remove();
    const c = this.container;
    c.classList.remove('tt-world');
    c.removeAttribute('tabindex');
    c.removeAttribute('role');
    c.removeAttribute('aria-label');
    if (this.positioned) c.style.removeProperty('position');
  }

  /** @param {boolean} paused */
  setPaused(paused) {
    this.paused = Boolean(paused);
    if (this.paused) this.stop();
    else this.start();
  }

  /** @param {'high'|'low'} q */
  setQuality(q) {
    if ((q !== 'high' && q !== 'low') || !this.env) return;
    this.quality = q;
    this.renderer.setPixelRatio(this.pixelRatio());
    this.envCall('setQuality', q);
    this.crowd.setQuality(q);
    this.resize();
  }

  /** @param {number|'auto'} h */
  setTimeOfDay(h) {
    if (h === 'auto' || (typeof h === 'number' && Number.isFinite(h))) this.envCall('setTimeOfDay', h === 'auto' ? h : ((h % 24) + 24) % 24);
  }

  getTimeOfDay() {
    const h = this.envCall('getTimeOfDay');
    return Number.isFinite(h) ? h : 12;
  }

  /** @param {boolean} on */
  setReducedMotion(on) {
    this.reducedMotion = Boolean(on);
    this.envCall('setReducedMotion', this.reducedMotion);
    this.crowd.setReducedMotion(this.reducedMotion);
  }

  /** @param {string} id @param {{follow?: boolean, zoom?: number}} [opts] */
  focusAgent(id, opts) {
    const p = this.crowd.followPoint(id);
    if (!p) return;
    const focus = {};
    if (opts?.follow) focus.follow = () => this.crowd.followPoint(id);
    if (Number.isFinite(opts?.zoom)) focus.zoom = opts.zoom;
    this.envCall('focus', { x: p.x, y: p.y, z: p.z }, focus);
  }

  /** @param {string} key */
  focusBuilding(key) {
    if (!isBuilding(key) || !this.env) return;
    const b = this.env.buildings?.[key];
    const p = isPoint(b?.center) ? b.center : this.crowd.anchorPoint(key);
    this.envCall('focus', { x: p.x, y: p.y, z: p.z }, {});
  }

  stopFollow() {
    this.envCall('stopFollow');
  }

  resetCamera() {
    this.envCall('resetCamera');
  }

  /** @param {1|-1} dir */
  rotateCamera(dir) {
    if (dir === 1 || dir === -1) this.envCall('rotateCamera', dir);
  }

  /** @param {number} factor > 1 zooms in */
  zoomBy(factor) {
    if (Number.isFinite(factor) && factor > 0) this.envCall('zoomBy', factor);
  }

  // ── World API: buildings ────────────────────────────────────────────────────

  /** @param {string} key @param {string|null} text */
  setBuildingStat(key, text) {
    if (!isBuilding(key)) return;
    this.envCall('setBuildingStat', key, typeof text === 'string' && text ? truncateText(text, 24) : null);
  }

  /** @param {string} key @param {string} [color] */
  pulseBuilding(key, color) {
    if (isBuilding(key)) this.envCall('pulseBuilding', key, color === undefined ? undefined : safeColor(color, '#ffffff'));
  }

  /** @param {{text: string, status: string}[]} items @param {string} [title] */
  setBoard(items, title) {
    if (!Array.isArray(items)) return;
    const clean = items
      .filter((item) => item && typeof item.text === 'string')
      .slice(0, 50)
      .map((item) => ({ text: truncateText(item.text, 80), status: BOARD_STATUSES.has(item.status) ? item.status : 'pending' }));
    this.envCall('setBoard', clean, typeof title === 'string' ? truncateText(title, 40) : undefined);
  }

  /** @param {number} level 0–5 */
  setNodeModules(level) {
    if (Number.isFinite(level)) this.envCall('setNodeModules', Math.max(0, Math.min(5, Math.round(level))));
  }

  /** @param {string} id @param {string} label */
  addWorktree(id, label) {
    if (typeof id === 'string' && id) this.envCall('addWorktree', id, truncateText(label ?? id, 24));
  }

  /** @param {string} id */
  removeWorktree(id) {
    if (typeof id === 'string' && id) this.envCall('removeWorktree', id);
  }

  // ── World API: agents ───────────────────────────────────────────────────────

  /** @param {any} spec AgentSpec */
  addAgent(spec) {
    if (this.env) this.crowd.add(spec); // nothing to add to once disposed
  }

  /** @param {string} id @param {any} patch */
  updateAgent(id, patch) {
    this.crowd.update(id, patch);
  }

  /** @param {string} id @param {{exit?: 'portal'|'bus'|'poof'}} [opts] */
  removeAgent(id, opts) {
    return this.crowd.remove(id, opts);
  }

  /** @param {string} id */
  hasAgent(id) {
    return this.crowd.has(id);
  }

  /** @param {string} id @param {string} key @param {{pace?: 'walk'|'run'|'teleport'}} [opts] */
  goTo(id, key, opts) {
    return this.crowd.goTo(id, key, opts);
  }

  /** @param {string} id @param {string} activity */
  setActivity(id, activity) {
    this.crowd.setActivity(id, activity);
  }

  /** @param {string} id @param {string} status */
  setStatus(id, status) {
    this.crowd.setStatus(id, status);
  }

  /** @param {string} id @param {string} text @param {{ms?: number, tone?: 'speech'|'thought'|'shout'|'code'}} [opts] */
  say(id, text, opts) {
    this.crowd.say(id, text, opts);
  }

  /** @param {string} id @param {string} emoji */
  emote(id, emoji) {
    this.crowd.emote(id, emoji);
  }

  /** @param {string} id @param {string|null} text */
  setBadge(id, text) {
    this.crowd.setBadge(id, text);
  }

  /**
   * Landmarks the town has earned (core/growth.js).
   * @param {string[]} ids @param {{ grow?: boolean }} [options]
   */
  setLandmarks(ids, options) {
    this.envCall('setLandmarks', ids, options);
  }

  /**
   * Weather over the whole town (core/town-weather.js).
   * @param {import('../core/town-weather.js').TownWeather} w
   */
  setTownWeather(w) {
    this.envCall('setWeather', w);
  }

  /** @param {string} id @param {'rain'|'storm'|null} kind */
  weather(id, kind) {
    this.crowd.setWeather(id, kind);
  }

  /**
   * @param {string} kind EffectKind
   * @param {{agent: string}|{building: string}} at
   * @param {{color?: string}} [opts]
   */
  effect(kind, at, opts) {
    if (!EFFECT_KINDS.includes(kind) || !at || typeof at !== 'object') return;
    if ('agent' in at) this.crowd.effectOnAgent(kind, at.agent, opts);
    else if ('building' in at && isBuilding(at.building)) {
      this.crowd.effects.emit(kind, this.buildingPoint(at.building, kind), { color: opts?.color, ground: 0 });
    }
  }

  /** Where a building effect plays (see EFFECT_ANCHORS). @param {string} key @param {string} kind */
  buildingPoint(key, kind) {
    const rule = EFFECT_ANCHORS[kind] ?? { at: 'top' };
    const p = this.envCall('anchor', key, rule.named?.[key] ?? rule.at);
    if (isPoint(p)) return { x: p.x, y: p.y, z: p.z };
    return this.crowd.anchorPoint(/** @type {any} */ (key));
  }

  /**
   * Paper plane from an agent to another agent (tracking it) or a building sign.
   * @param {string} fromId @param {{agent: string}|{building: string}} to
   * @returns {Promise<void>}
   */
  sendMessage(fromId, to) {
    if (!to || typeof to !== 'object' || !this.env || !this.crowd.has(fromId)) return Promise.resolve();
    if ('agent' in to) {
      if (!this.crowd.has(to.agent)) return Promise.resolve();
      return this.crowd.sendPlane(fromId, () => this.crowd.agents.get(to.agent)?.top ?? null);
    }
    if (!('building' in to) || !isBuilding(to.building)) return Promise.resolve();
    const sign = this.env.buildings?.[to.building]?.signAnchor;
    const p = isPoint(sign) ? { x: sign.x, y: sign.y, z: sign.z } : this.buildingPoint(to.building, 'check');
    return this.crowd.sendPlane(fromId, () => p);
  }

  /** @param {'mailtruck'|'boat'|'bus'} kind @param {'arrive'|'depart'|'trip'} [action] */
  vehicle(kind, action = 'trip') {
    if (!['mailtruck', 'boat', 'bus'].includes(kind) || !['arrive', 'depart', 'trip'].includes(action)) return;
    this.envCall('vehicle', kind, action);
  }

  // ── World API: selection ────────────────────────────────────────────────────

  /**
   * @param {'select'|'hover'} event
   * @param {(sel: Selection) => void} cb
   * @returns {() => void} unsubscribe
   */
  on(event, cb) {
    const set = this.listeners[event];
    if (!set || typeof cb !== 'function') return () => {};
    set.add(cb);
    return () => set.delete(cb);
  }

  /** Shows a selection without emitting 'select' (the caller already knows). @param {Selection} sel */
  select(sel) {
    if (sel === null) {
      this.crowd.select(null);
      this.envCall('highlightBuilding', null);
    } else if (sel?.type === 'agent' && this.crowd.has(sel.id)) {
      this.crowd.select(sel.id);
      this.envCall('highlightBuilding', null);
    } else if (sel?.type === 'building' && isBuilding(sel.key)) {
      this.crowd.select(null);
      this.envCall('highlightBuilding', sel.key);
    }
  }

  /** @param {string} id */
  getScreenPosition(id) {
    return this.crowd.screenPosition(id);
  }

  stats() {
    return { fps: this.fps, agents: this.crowd.agents.size, drawCalls: this.drawCalls };
  }

  /**
   * Lab helper (not part of the app contract): stands an agent at an exact point.
   * @param {string} id @param {number} x @param {number} z @param {number} [yaw]
   */
  debugPlace(id, x, z, yaw) {
    this.crowd.place(id, x, z, yaw);
  }
}

/**
 * Creates the 3D town inside `container`. Rejects with a clear Error when WebGL is unavailable.
 * @param {HTMLElement} container
 * @param {{quality?: 'auto'|'high'|'low', reducedMotion?: boolean, timeOfDay?: number|'auto',
 *   envFactory?: (args: any) => any}} [options]
 * @returns {Promise<World>}
 */
export async function createWorld(container, options = {}) {
  if (!(container instanceof HTMLElement)) throw new Error('createWorld needs a container element.');
  if (!webglAvailable()) throw new Error('WebGL 2 is not available in this browser, so the 3D town cannot be drawn.');
  const world = new World(container, options);
  try {
    await world.init(options.envFactory);
  } catch (error) {
    world.teardown(); // leave the container as we found it, for the app's fallback view
    throw error;
  }
  world.setTimeOfDay(options.timeOfDay ?? 'auto');
  return world;
}

