// A stand-in for the 3D world (CONTRACTS §6) that draws nothing. The app uses it with `?world=fake`
// (fast HUD work, tests that assert which world calls were made) and as the fallback when WebGL is
// unavailable, so the director and HUD keep working without a renderer. Every call is recorded in
// `calls` (the most recent 500); with `?world=fake&log=1` they are also printed to the console.

/** @typedef {{ method: string, args: unknown[] }} WorldCall */

const MAX_CALLS = 500;
/** @type {Record<string, [number, number]>} */
const STEP_KEYS = { ArrowUp: [0, -1], w: [0, -1], W: [0, -1], ArrowDown: [0, 1], s: [0, 1], S: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0], ArrowRight: [1, 0], d: [1, 0], D: [1, 0] };

/**
 * @param {HTMLElement} container
 * @param {{ timeOfDay?: number|'auto', log?: boolean }} [options]
 */
export function createFakeWorld(container, { timeOfDay = 'auto', log = false } = {}) {
  /** @type {WorldCall[]} */
  const calls = [];
  /** @type {Map<string, Set<(sel: any) => void>>} */
  const listeners = new Map([['select', new Set()], ['hover', new Set()], ['ground', new Set()], ['step', new Set()]]);
  const agents = new Set();
  let hour = timeOfDay;

  container.classList.add('is-fake-world');
  let walking = false;
  // Walk mode: arrows and WASD on the town take a step, as in the 3D world under its default camera.
  container.addEventListener('keydown', (event) => {
    const step = STEP_KEYS[event.key];
    if (!walking || event.target !== container || !step || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    emit('step', step);
  });

  /** @param {string} event @param {unknown} value */
  function emit(event, value) {
    for (const cb of listeners.get(event) ?? []) cb(value);
  }

  /** @param {string} method @param {unknown[]} args */
  function record(method, args) {
    calls.push({ method, args });
    if (calls.length > MAX_CALLS) calls.splice(0, calls.length - MAX_CALLS);
    if (log) console.debug('[fake world]', method, ...args);
  }

  /** @param {string} method */
  const noop = (method) => (/** @type {unknown[]} */ ...args) => {
    record(method, args);
  };

  const clockHour = () => {
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60;
  };

  return {
    calls,
    dispose: noop('dispose'),
    setPaused: noop('setPaused'),
    setQuality: noop('setQuality'),
    /** @param {number|'auto'} h */
    setTimeOfDay(h) {
      record('setTimeOfDay', [h]);
      hour = h;
    },
    getTimeOfDay: () => (hour === 'auto' ? clockHour() : hour),
    setReducedMotion: noop('setReducedMotion'),
    setPlaceNames: noop('setPlaceNames'),
    focusAgent: noop('focusAgent'),
    focusBuilding: noop('focusBuilding'),
    stopFollow: noop('stopFollow'),
    resetCamera: noop('resetCamera'),
    rotateCamera: noop('rotateCamera'),
    zoomBy: noop('zoomBy'),
    setBuildingStat: noop('setBuildingStat'),
    setTownWeather: noop('setTownWeather'),
    setLandmarks: noop('setLandmarks'),
    pulseBuilding: noop('pulseBuilding'),
    setBoard: noop('setBoard'),
    setNodeModules: noop('setNodeModules'),
    addWorktree: noop('addWorktree'),
    removeWorktree: noop('removeWorktree'),
    setHome: noop('setHome'),
    /** @param {{ id: string }} spec */
    addAgent(spec) {
      record('addAgent', [spec]);
      agents.add(spec.id);
    },
    updateAgent: noop('updateAgent'),
    /** @param {string} id @param {unknown} [opts] */
    async removeAgent(id, opts) {
      record('removeAgent', [id, opts]);
      agents.delete(id);
    },
    /** @param {string} id */
    hasAgent: (id) => agents.has(id),
    /** @param {string} id @param {string} key @param {unknown} [opts] */
    async goTo(id, key, opts) {
      record('goTo', [id, key, opts]);
      return true;
    },
    setActivity: noop('setActivity'),
    setStatus: noop('setStatus'),
    say: noop('say'),
    emote: noop('emote'),
    setBadge: noop('setBadge'),
    weather: noop('weather'),
    effect: noop('effect'),
    /** @param {string} fromId @param {unknown} to */
    async sendMessage(fromId, to) {
      record('sendMessage', [fromId, to]);
    },
    vehicle: noop('vehicle'),
    /** Walk mode; the town takes keyboard focus while it is on. @param {boolean} on */
    setWalkMode(on) {
      record('setWalkMode', [on]);
      walking = Boolean(on);
      if (walking) {
        container.tabIndex = 0;
        container.setAttribute('role', 'application');
        container.setAttribute('aria-label', 'The town (walk mode: arrow keys walk)');
      } else for (const name of ['tabindex', 'role', 'aria-label']) container.removeAttribute(name);
    },
    placePerson: noop('placePerson'),
    /** @param {number} right @param {number} up @returns {[number, number]} */
    screenStep: (right, up) => [right, up === 0 ? 0 : -up],
    /**
     * @param {'select'|'hover'|'ground'|'step'} event
     * @param {(sel: any) => void} cb
     */
    on(event, cb) {
      listeners.get(event)?.add(cb);
      return () => listeners.get(event)?.delete(cb);
    },
    /** Records the selection the HUD made (the real world highlights it). @param {any} sel */
    select(sel) {
      record('select', [sel]);
    },
    /** Test hook: raises 'select' as a click on an agent or building sign would. @param {any} sel */
    emitSelect(sel) {
      emit('select', sel);
    },
    /** Test hook: raises 'ground' as a click on the ground in walk mode would. @param {[number, number]} tile */
    emitGround(tile) {
      emit('ground', tile);
    },
    getScreenPosition: () => null,
    stats: () => ({ fps: 0, agents: agents.size, drawCalls: 0 }),
  };
}
