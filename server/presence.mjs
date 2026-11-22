// Where the people of a team town are, on the host (CONTRACTS §4.11): each person's tile, their
// walk, whether they are online (a connection, or their relay posted in the last 2 minutes),
// away (no connection: on their porch after 60 s, inside after 10 min) and their duty from
// their own events (a prompt: work; a permission request, a question or a failed turn: needs;
// Stop or SessionEnd: free). Walks are planned with core/presence.js on the town plan and timed
// on this clock; while a person's duty is not free their character is at work and stays put.
// Changes go out at most ten times a second, a person at a time. Nothing here is ever stored or
// recorded: after a restart everyone starts at home.
import { HOMES } from '../public/js/core/town-map.js';
import { EMOTES, PHRASES, planWalk, tileAt } from '../public/js/core/presence.js';

/** @typedef {import('../public/js/core/presence.js').Tile} Tile */
/** @typedef {'free'|'work'|'needs'} Duty */

/** How long without a connection before a person sits on their porch, then goes inside. */
export const PORCH_MS = 60_000;
export const INSIDE_MS = 10 * 60_000;
/** A relay that posted this recently keeps its person's lights on. */
const RELAY_LIGHTS_MS = 2 * 60_000;
/** The shortest time between broadcasts (10 Hz at most). */
const FLUSH_MS = 100;
/** At most four walks a second per person; a walk asked sooner waits its turn, the latest wins. */
const WALK_EVERY_MS = 250;
const EMOTE_EVERY_MS = 2000;
const PHRASE_EVERY_MS = 5000;
/** One "come look" per 30 s from one person to another. */
const LOOK_EVERY_MS = 30_000;

/** Events that set a person's duty, by hook name. */
const DUTY = Object.freeze({ UserPromptSubmit: 'work', PermissionRequest: 'needs', StopFailure: 'needs', Notification: 'needs', Stop: 'free', SessionEnd: 'free' });

/**
 * @typedef {object} PersonState
 * @property {Tile} tile          where they stand (the start of their walk, while walking)
 * @property {{ path: Tile[], at: number }|null} walk
 * @property {number} connections
 * @property {number} leftAt     when their last connection closed (ms)
 * @property {number} relayAt    when their relay last posted (ms)
 * @property {Duty} duty
 * @property {Record<string, number>} last  when they last did each rate-limited thing
 * @property {{ to: Tile, timer: NodeJS.Timeout }|null} pendingWalk
 */

/**
 * The view of a person every browser gets, beside their profile.
 * @typedef {{ tile: Tile, walk: { path: Tile[], at: number }|null, online: boolean, away: null|'porch'|'inside', duty: Duty, lights: boolean }} PresenceView
 */

/**
 * @param {{ homeOf: (name: string) => number|null, hostName: () => string|null, onChange: (names: string[]) => void,
 *   now?: () => number, porchMs?: number, insideMs?: number }} options
 *   homeOf: a person's home slot, null when not on the roster
 */
export function createPresence({ homeOf, hostName, onChange, now = Date.now, porchMs = PORCH_MS, insideMs = INSIDE_MS }) {
  /** @type {Map<string, PersonState>} */
  const people = new Map();
  /** @type {Set<string>} */
  const dirty = new Set();
  /** @type {NodeJS.Timeout|null} */
  let flushTimer = null;
  let lastFlush = -Infinity;
  /** @type {Map<string, NodeJS.Timeout[]>} the porch and inside timers of people with no connection */
  const awayTimers = new Map();

  const homeTile = (/** @type {string} */ name) => doorOf(homeOf(name));
  /** @param {string} name */
  function state(name) {
    let person = people.get(name);
    if (!person) {
      person = { tile: homeTile(name), walk: null, connections: 0, leftAt: -Infinity, relayAt: -Infinity, duty: 'free', last: {}, pendingWalk: null };
      people.set(name, person);
    }
    return person;
  }

  /** Queues a person's change for the next broadcast (at most every FLUSH_MS). @param {string} name */
  function changed(name) {
    dirty.add(name);
    if (flushTimer) return;
    flushTimer = later(flush, Math.max(0, lastFlush + FLUSH_MS - now()));
  }

  function flush() {
    flushTimer = null;
    lastFlush = now();
    const names = [...dirty];
    dirty.clear();
    if (names.length) onChange(names);
  }

  const standing = (/** @type {PersonState} */ person) => standingAt(person, now());
  /** @param {string} name @param {PersonState} person @param {Tile} to */
  function startWalk(name, person, to) {
    const from = standing(person);
    const plan = planWalk(from, to);
    if (!plan.ok) return plan;
    person.tile = from;
    person.walk = { path: /** @type {Tile[]} */ (plan.path), at: now() };
    person.last.walk = now();
    changed(name);
    return { ok: true };
  }

  /** @param {string} name */
  function forget(name) {
    clearAwayTimers(name);
    const pending = people.get(name)?.pendingWalk;
    if (pending) clearTimeout(pending.timer);
    people.delete(name);
  }

  /** @param {string} name */
  function clearAwayTimers(name) {
    for (const timer of awayTimers.get(name) ?? []) clearTimeout(timer);
    awayTimers.delete(name);
  }

  return {
    /**
     * Everything browsers are told about a person's presence.
     * @param {string} name
     * @returns {PresenceView}
     */
    view(name) {
      return viewOf(state(name), now(), porchMs, insideMs);
    },
    /** A browser playing this person connected. @param {string} name */
    connect(name) {
      const person = state(name);
      person.connections += 1;
      clearAwayTimers(name);
      changed(name);
    },
    /** One of their browsers left; with none left, the away timers start. @param {string} name */
    disconnect(name) {
      const person = state(name);
      person.connections = Math.max(0, person.connections - 1);
      if (person.connections > 0) return;
      person.leftAt = now();
      clearAwayTimers(name);
      const toPorch = () => {
        // On their porch: back home at once (nobody is watching them walk).
        person.tile = homeTile(name);
        person.walk = null;
        changed(name);
      };
      awayTimers.set(name, [later(toPorch, porchMs), later(() => changed(name), insideMs)]);
      changed(name);
    },
    /**
     * A sanitized event that entered the town: its person's duty, and their relay's lights.
     * @param {Record<string, any>} event
     * @param {'local'|'team'} origin
     */
    observe(event, origin) {
      const name = origin === 'team' ? event.andary_member : hostName();
      if (typeof name !== 'string' || homeOf(name) === null) return;
      const person = state(name);
      const before = this.view(name).lights;
      if (origin === 'team') person.relayAt = now();
      const duty = /** @type {Duty|undefined} */ (/** @type {Record<string, string>} */ (DUTY)[event.hook_event_name]);
      if ((duty && duty !== person.duty) || before !== this.view(name).lights) {
        if (duty) person.duty = duty;
        changed(name);
      }
    },
    /**
     * Walks a person to a tile. Refused while they are at work; a walk asked less than 250 ms
     * after the last one waits for its turn, and a later one replaces it.
     * @param {string} name @param {unknown} to
     * @returns {{ ok: boolean, error?: string }}
     */
    walk(name, to) {
      const person = state(name);
      if (person.duty !== 'free') return { ok: false, error: 'Your character is at work' };
      const plan = planWalk(standing(person), to);
      if (!plan.ok) return plan;
      const wait = (person.last.walk ?? -Infinity) + WALK_EVERY_MS - now();
      if (wait <= 0) return startWalk(name, person, /** @type {Tile} */ (to));
      if (person.pendingWalk) clearTimeout(person.pendingWalk.timer);
      const timer = later(() => {
        const pending = person.pendingWalk;
        person.pendingWalk = null;
        if (pending && person.duty === 'free') startWalk(name, person, pending.to);
      }, wait);
      person.pendingWalk = { to: /** @type {Tile} */ (to), timer };
      return { ok: true };
    },
    /**
     * Checks an emote or a phrase: one of the set ones, and not too often.
     * @param {string} name @param {'emote'|'phrase'} kind @param {unknown} id
     * @returns {{ ok: boolean, error?: string }}
     */
    say(name, kind, id) {
      const list = kind === 'emote' ? EMOTES : PHRASES;
      if (!Number.isInteger(id) || /** @type {number} */ (id) < 0 || /** @type {number} */ (id) >= list.length) return { ok: false, error: `${kind}.id is one of the set ${kind}s` };
      const every = kind === 'emote' ? EMOTE_EVERY_MS : PHRASE_EVERY_MS;
      return allowed(state(name), kind, every, now()) ? { ok: true } : { ok: false, error: `One ${kind} every ${every / 1000} seconds` };
    },
    /**
     * Checks a "come look" from one person to another: at most one per 30 s per pair.
     * @param {string} from @param {string} to
     */
    look(from, to) {
      if (from === to || homeOf(to) === null) return { ok: false, error: 'look.to is a teammate' };
      return allowed(state(from), `look:${to}`, LOOK_EVERY_MS, now()) ? { ok: true } : { ok: false, error: 'You asked them a moment ago' };
    },
    /** How long a person's walk still takes (ms), for tests and the live region. @param {string} name */
    /** Forgets everyone not on the roster any more. @param {Set<string>} names */
    forgetAllBut(names) {
      for (const name of [...people.keys()]) if (!names.has(name)) forget(name);
    },
    dispose() {
      if (flushTimer) clearTimeout(flushTimer);
      for (const name of [...people.keys()]) forget(name);
    },
  };
}

/**
 * What browsers are told about a person at a time.
 * @param {PersonState} person @param {number} t @param {number} porchMs @param {number} insideMs
 * @returns {PresenceView}
 */
function viewOf(person, t, porchMs, insideMs) {
  const online = person.connections > 0;
  const gone = online ? 0 : t - person.leftAt;
  const away = online ? null : gone >= insideMs ? 'inside' : gone >= porchMs ? 'porch' : null;
  const relaying = t - person.relayAt < RELAY_LIGHTS_MS;
  return { tile: person.tile, walk: person.walk, online, away, duty: person.duty, lights: online || relaying };
}

/** The door of a home, where its person starts. @param {number|null} slot @returns {Tile} */
function doorOf(slot) {
  return /** @type {Tile} */ ([...(HOMES[slot ?? 0] ?? HOMES[0]).door]);
}

/** Where a person stands at a time (the end of a finished walk). @param {PersonState} person @param {number} t */
function standingAt(person, t) {
  return person.walk ? tileAt(person.walk.path, person.walk.at, t) : person.tile;
}

/** A timer that never keeps the process alive. @param {() => void} fn @param {number} ms */
function later(fn, ms) {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return timer;
}

/**
 * A rate check: true (and noted) when `kind` was last done at least `every` ms ago.
 * @param {PersonState} person @param {string} kind @param {number} every @param {number} t
 */
function allowed(person, kind, every, t) {
  if (t - (person.last[kind] ?? -Infinity) < every) return false;
  person.last[kind] = t;
  return true;
}

/** @typedef {ReturnType<typeof createPresence>} Presence */
