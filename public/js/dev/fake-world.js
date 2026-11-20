// A stand-in for the 3D world (CONTRACTS §6) that draws nothing. The app uses it with `?world=fake`
// (fast HUD work, tests that assert which world calls were made) and as the fallback when WebGL is
// unavailable, so the director and HUD keep working without a renderer. Every call is recorded in
// `calls` (the most recent 500); with `?world=fake&log=1` they are also printed to the console.

/** @typedef {{ method: string, args: unknown[] }} WorldCall */

const MAX_CALLS = 500;

/**
 * @param {HTMLElement} container
 * @param {{ timeOfDay?: number|'auto', log?: boolean }} [options]
 */
export function createFakeWorld(container, { timeOfDay = 'auto', log = false } = {}) {
  /** @type {WorldCall[]} */
  const calls = [];
  /** @type {Map<string, Set<(sel: any) => void>>} */
  const listeners = new Map([['select', new Set()], ['hover', new Set()]]);
  const agents = new Set();
  let hour = timeOfDay;

  container.classList.add('is-fake-world');

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
    focusAgent: noop('focusAgent'),
    focusBuilding: noop('focusBuilding'),
    stopFollow: noop('stopFollow'),
    resetCamera: noop('resetCamera'),
    rotateCamera: noop('rotateCamera'),
    zoomBy: noop('zoomBy'),
    setBuildingStat: noop('setBuildingStat'),
    setTownWeather: noop('setTownWeather'),
    pulseBuilding: noop('pulseBuilding'),
    setBoard: noop('setBoard'),
    setNodeModules: noop('setNodeModules'),
    addWorktree: noop('addWorktree'),
    removeWorktree: noop('removeWorktree'),
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
    /**
     * @param {'select'|'hover'} event
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
      for (const cb of listeners.get('select') ?? []) cb(sel);
    },
    getScreenPosition: () => null,
    stats: () => ({ fps: 0, agents: agents.size, drawCalls: 0 }),
  };
}
