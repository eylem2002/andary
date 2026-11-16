// Time for the simulation. Every wait is a sleeper on this clock, so the whole story can be paused
// (stop: every timer is cleared, each sleeper remembers how long it had left) and resumed (start:
// the sleepers are re-armed), and speed changes apply to waits already in progress.
// Durations are in "story milliseconds" (speed 1); the real delay is duration / speed.

/**
 * @typedef {object} Scheduler
 * @property {(fn: () => void, ms: number) => unknown} setTimeout
 * @property {(handle: unknown) => void} clearTimeout
 * @property {() => number} [now]
 */

/**
 * @typedef {object} Sleeper
 * @property {number} remaining  story ms still to wait
 * @property {() => void} resolve
 * @property {unknown} handle     the scheduler timer while armed
 * @property {number} armedAt
 * @property {number} rate        speed when armed
 */

/** @type {Scheduler} */
const realScheduler = Object.freeze({
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(/** @type {any} */ (handle)),
  now: () => Date.now(),
});

/**
 * @param {{scheduler?: Scheduler, speed?: number}} [options]
 */
export function createClock(options = {}) {
  const scheduler = options.scheduler ?? realScheduler;
  const now = () => (scheduler.now ? scheduler.now() : Date.now());
  /** @type {Set<Sleeper>} */
  const sleepers = new Set();
  /** @type {(() => void)[]} */
  let resumeWaiters = [];
  let running = false;
  let speed = clampSpeed(options.speed ?? 1);

  /** @param {Sleeper} s */
  function arm(s) {
    s.armedAt = now();
    s.rate = speed;
    s.handle = scheduler.setTimeout(() => {
      s.handle = null;
      sleepers.delete(s);
      s.resolve();
    }, s.remaining / speed);
  }

  /** @param {Sleeper} s */
  function disarm(s) {
    if (s.handle == null) return;
    scheduler.clearTimeout(s.handle);
    s.handle = null;
    s.remaining = Math.max(0, s.remaining - (now() - s.armedAt) * s.rate);
  }

  return {
    /**
     * A cancellable wait of `ms` story milliseconds.
     * @param {number} ms
     * @returns {{promise: Promise<void>, cancel: () => void}}
     */
    delay(ms) {
      /** @type {Sleeper} */
      let sleeper;
      const promise = new Promise((resolve) => {
        sleeper = { remaining: Math.max(0, ms), resolve: () => resolve(undefined), handle: null, armedAt: 0, rate: speed };
        sleepers.add(sleeper);
        if (running) arm(sleeper);
      });
      return {
        promise,
        cancel() {
          disarm(sleeper);
          sleepers.delete(sleeper);
        },
      };
    },
    /** @param {number} ms */
    sleep(ms) {
      return this.delay(ms).promise;
    },
    /** Resolves at once while running, otherwise when start() is next called. */
    whenRunning() {
      return running ? Promise.resolve() : new Promise((resolve) => resumeWaiters.push(() => resolve(undefined)));
    },
    start() {
      if (running) return;
      running = true;
      for (const s of sleepers) arm(s);
      const waiters = resumeWaiters;
      resumeWaiters = [];
      for (const wake of waiters) wake();
    },
    stop() {
      if (!running) return;
      running = false;
      for (const s of sleepers) disarm(s);
    },
    /** @param {number} n */
    setSpeed(n) {
      speed = clampSpeed(n);
      if (!running) return;
      for (const s of sleepers) {
        disarm(s);
        arm(s);
      }
    },
    get running() {
      return running;
    },
    get speed() {
      return speed;
    },
    /** Timers currently scheduled (zero whenever stopped). */
    get armed() {
      let n = 0;
      for (const s of sleepers) if (s.handle != null) n += 1;
      return n;
    },
  };
}

/** @param {unknown} n */
function clampSpeed(n) {
  const value = Number(n);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.max(value, 0.1), 50) : 1;
}

/** @typedef {ReturnType<typeof createClock>} Clock */
