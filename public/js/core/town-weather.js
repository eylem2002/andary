// Weather over the whole town, from what the crews are going through (CONTRACTS §6): failures
// bring rain, a pile of them or a failed turn (rate limit, overload) a storm, tests that pass
// again after failing a rainbow, and a crew thinking for a long time without touching a tool
// fog. Pure and clock-driven, so it is unit-tested; a driver feeds it the store's events and
// hands the result to the world.

/** @typedef {import('./events.js').TownEvent} TownEvent */

/**
 * @typedef {object} TownWeather
 * @property {'clear'|'rain'|'storm'|'fog'|'rainbow'} kind  the strongest thing going on, for words
 * @property {number} rain      0–1
 * @property {number} overcast  0–1, how grey the sky is
 * @property {number} fog       0–1
 * @property {number} rainbow   0–1
 * @property {boolean} storm    lightning now and then
 */

const HALF_LIFE_MS = 60_000;
const STORM_MS = 45_000;
const RAINBOW_MS = 30_000;
const RED_MEMORY_MS = 10 * 60_000;
const FOG_AFTER_MS = 30_000;
const FOG_FULL_MS = 90_000;
/**
 * Nobody thinks for this long without a tool or a reply: past it the session was interrupted
 * (Esc sends no hook) or the events are an old replay, so its fog lifts.
 */
const FOG_GIVE_UP_MS = 8 * 60_000;

export const CLEAR = Object.freeze({ kind: 'clear', rain: 0, overcast: 0, fog: 0, rainbow: 0, storm: false });

export function createTownWeather() {
  /** @type {{ ts: number, weight: number }[]} */
  let failures = [];
  let stormUntil = -Infinity;
  let rainbowAt = -Infinity;
  /** @type {Map<string, number>} session → when its tests last failed */
  const red = new Map();
  /** @type {Map<string, number>} session → when it started thinking without tools */
  const thinking = new Map();

  /** @type {Record<string, (e: TownEvent, ts: number, session: string) => void>} */
  const handlers = {
    'tool.fail': (e, ts, session) => {
      thinking.delete(session);
      if (e.data?.errorKind === 'interrupted' || e.data?.isInterrupt) return;
      const tests = e.data?.commandKind === 'test';
      failures.push({ ts, weight: tests ? 2 : 1 });
      if (tests) red.set(session, ts);
    },
    'turn.fail': (e, ts, session) => {
      failures.push({ ts, weight: 3 });
      stormUntil = Math.max(stormUntil, ts + STORM_MS);
      thinking.delete(session);
    },
    'tool.end': (e, ts, session) => {
      thinking.delete(session);
      const failedAt = red.get(session);
      if (e.data?.commandKind !== 'test' || failedAt === undefined || ts - failedAt >= RED_MEMORY_MS) return;
      red.delete(session);
      rainbowAt = ts;
      // Green again: most of the rain was about this.
      failures = failures.map((f) => ({ ts: f.ts, weight: f.weight * 0.1 }));
      stormUntil = Math.min(stormUntil, ts);
    },
    prompt: (e, ts, session) => {
      thinking.set(session, ts);
    },
  };
  const calming = new Set(['tool.start', 'turn.stop', 'session.end', 'subagent.start']);

  return {
    /** @param {TownEvent} e */
    observe(e) {
      const ts = Number(e?.ts) || 0;
      const session = e?.sessionId ?? '';
      const handler = Object.hasOwn(handlers, e?.kind) ? handlers[e.kind] : null;
      if (handler) handler(e, ts, session);
      else if (calming.has(e?.kind)) thinking.delete(session);
    },

    /**
     * The weather at a moment.
     * @param {number} now
     * @returns {TownWeather}
     */
    at(now) {
      failures = failures.filter((f) => now - f.ts < HALF_LIFE_MS * 6);
      const score = failures.reduce((sum, f) => sum + f.weight * 0.5 ** (Math.max(0, now - f.ts) / HALF_LIFE_MS), 0);
      const storm = now < stormUntil || score >= 6;
      const rain = storm ? Math.max(0.85, Math.min(1, score / 6)) : score >= 0.5 ? Math.min(0.8, score / 5) : 0;
      const sinceRainbow = now - rainbowAt;
      const rainbow = sinceRainbow >= 0 && sinceRainbow < RAINBOW_MS ? Math.min(1, sinceRainbow / 2000, (RAINBOW_MS - sinceRainbow) / 4000) : 0;
      let longest = 0;
      for (const [session, since] of thinking) {
        if (now - since > FOG_GIVE_UP_MS) thinking.delete(session);
        else longest = Math.max(longest, now - since);
      }
      const fog = longest > FOG_AFTER_MS ? Math.min(1, (longest - FOG_AFTER_MS) / (FOG_FULL_MS - FOG_AFTER_MS)) * 0.8 : 0;
      const overcast = Math.max(rain, fog * 0.5);
      /** @type {TownWeather['kind']} */
      const kind = storm ? 'storm' : rainbow > 0 ? 'rainbow' : rain > 0 ? 'rain' : fog > 0 ? 'fog' : 'clear';
      return { kind, rain: round(rain), overcast: round(overcast), fog: round(fog), rainbow: round(rainbow), storm };
    },
  };
}

/** @param {number} x */
function round(x) {
  return Math.round(x * 100) / 100;
}

/**
 * Feeds the store's events to the weather and tells the world when it changes, checking once a
 * second. Turned off, the town stays clear.
 * @param {object} options
 * @param {{ subscribe: (fn: (change: any) => void) => () => void }} options.store
 * @param {() => ({ setTownWeather?: (w: TownWeather) => void }|null)} options.world
 * @param {(w: TownWeather) => void} [options.onChange]   for words (the HUD's announcements)
 * @param {() => number} [options.now]
 * @param {() => boolean} [options.enabled]
 */
export function createWeatherDriver({ store, world, onChange = () => {}, now = Date.now, enabled = () => true }) {
  let weather = createTownWeather();
  /** @type {TownWeather} */
  let last = CLEAR;
  const unsubscribe = store.subscribe((change) => {
    if (change.type === 'reset') weather = createTownWeather();
    if (change.type === 'event') weather.observe(change.event);
  });
  const tick = () => {
    const next = enabled() ? weather.at(now()) : CLEAR;
    if (same(next, last)) return;
    const kindChanged = next.kind !== last.kind;
    last = next;
    world()?.setTownWeather?.(next);
    if (kindChanged) onChange(next);
  };
  const timer = setInterval(tick, 1000);
  return {
    tick,
    get current() {
      return last;
    },
    dispose() {
      clearInterval(timer);
      unsubscribe();
    },
  };
}

/** @param {TownWeather} a @param {TownWeather} b */
function same(a, b) {
  return a.kind === b.kind && a.rain === b.rain && a.overcast === b.overcast && a.fog === b.fog && a.rainbow === b.rainbow && a.storm === b.storm;
}
