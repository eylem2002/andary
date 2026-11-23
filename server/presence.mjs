// Where the people of a team town are, on the host (CONTRACTS §4.11): each person's tile, their
// walk, whether they are online (a connection), their home's lights (online, or their relay
// posted in the last 2 minutes), away (no connection: on their porch after 60 s, inside after
// 10 min) and their duty from
// their own events (a prompt: work; a permission request, a question or a failed turn: needs;
// Stop or SessionEnd: free). Walks are planned with core/presence.js on the town plan and timed
// on this clock (a new walk carries on from where the figure is); while a person's duty is not free their character is at work and stays put.
// Changes go out at most ten times a second, a person at a time. Nothing here is ever stored or
// recorded: after a restart everyone starts at home.
import { HOMES } from '../public/js/core/town-map.js';
import { EMOTES, PHRASES, continueWalk } from '../public/js/core/presence.js';
import { agentKeyOf, normalizeAgentId } from '../public/js/core/ids.js';

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

/** Events that set a person's duty, by hook name (a Notification: see NEEDS_NOTICES). */
const DUTY = Object.freeze({ UserPromptSubmit: 'work', PermissionRequest: 'needs', StopFailure: 'needs', Stop: 'free', SessionEnd: 'free' });
/** The notifications that mean a person is needed; idle_prompt (a minute after Stop) and others change nothing. */
const NEEDS_NOTICES = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation', 'question']);
/** With no event from a person for this long (their relay went quiet too), their duty is free again. */
export const DUTY_STALE_MS = 10 * 60_000;
/** Agent keys remembered for "come look" (the newest; the oldest is forgotten first). */
const MAX_AGENT_KEYS = 2000;

/** The duty an event sets, if any. @param {Record<string, any>} event @returns {Duty|undefined} */
export function dutyOf(event) {
  if (event.hook_event_name === 'Notification') return NEEDS_NOTICES.has(event.notification_type) ? 'needs' : undefined;
  return /** @type {Duty|undefined} */ (/** @type {Record<string, string>} */ (DUTY)[event.hook_event_name]);
}

/**
 * @typedef {object} PersonState
 * @property {Tile} tile          where they stand (the start of their walk, while walking)
 * @property {{ path: Tile[], at: number }|null} walk
 * @property {number} connections
 * @property {number} leftAt     when their last connection closed (ms)
 * @property {number} relayAt    when their relay last posted (ms)
 * @property {Duty} duty
 * @property {number} eventAt   when their last event came (ms)
 * @property {NodeJS.Timeout|null} dutyTimer  tells browsers when their duty lapses to free
 * @property {Record<string, number>} last  when they last did each rate-limited thing
 * @property {{ to: Tile, timer: NodeJS.Timeout }|null} pendingWalk
 */

/**
 * The view of a person every browser gets, beside their profile.
 * @typedef {{ tile: Tile, walk: { path: Tile[], at: number }|null, online: boolean, away: null|'porch'|'inside', duty: Duty, lights: boolean }} PresenceView
 */

/**
 * @param {{ homeOf: (name: string) => number|null, hostName: () => string|null, onChange: (names: string[]) => void,
 *   onRefused?: (name: string, message: string) => void, now?: () => number, porchMs?: number, insideMs?: number }} options
 *   homeOf: a person's home slot, null when not on the roster; onRefused: a queued walk was dropped
 */
export function createPresence({ homeOf, hostName, onChange, onRefused = () => {}, now = Date.now, porchMs = PORCH_MS, insideMs = INSIDE_MS }) {
  /** @type {Map<string, PersonState>} */
  const people = new Map();
  const { changed, stop } = batcher(onChange, now);
  /** @type {Map<string, NodeJS.Timeout[]>} the porch and inside timers of people with no connection */
  const awayTimers = new Map();
  const agents = agentMemory();
  const dutyNow = (/** @type {PersonState} */ person) => (now() - person.eventAt >= DUTY_STALE_MS ? 'free' : person.duty);

  const homeTile = (/** @type {string} */ name) => doorOf(homeOf(name));
  /** @param {string} name */
  function state(name) {
    let person = people.get(name);
    if (!person) {
      person = { tile: homeTile(name), walk: null, connections: 0, leftAt: -Infinity, relayAt: -Infinity, duty: 'free', eventAt: -Infinity, dutyTimer: null, last: {}, pendingWalk: null };
      people.set(name, person);
    }
    return person;
  }

  /** @param {string} name @param {PersonState} person @param {Tile} to */
  function startWalk(name, person, to) {
    const plan = continueWalk(person, to, now());
    if (!plan.ok) return plan;
    const path = /** @type {Tile[]} */ (plan.path);
    person.tile = path[0];
    person.walk = { path, at: /** @type {number} */ (plan.at) };
    person.last.walk = now();
    changed(name);
    return { ok: true };
  }

  /** @param {string} name */
  function forget(name) {
    clearAwayTimers(name);
    const person = people.get(name);
    if (person?.pendingWalk) clearTimeout(person.pendingWalk.timer);
    if (person?.dutyTimer) clearTimeout(person.dutyTimer);
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
      const person = state(name);
      return { ...viewOf(person, now(), porchMs, insideMs), duty: dutyNow(person) };
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
      agents.remember(event);
      const name = origin === 'team' ? event.andary_member : hostName();
      if (typeof name !== 'string' || homeOf(name) === null) return;
      const person = state(name);
      const before = this.view(name);
      if (origin === 'team') person.relayAt = now();
      person.eventAt = now();
      const duty = dutyOf(event);
      if (duty) person.duty = duty;
      // Quiet for DUTY_STALE_MS: browsers hear the duty is free again.
      if (person.dutyTimer) clearTimeout(person.dutyTimer);
      person.dutyTimer = person.duty === 'free' ? null : later(() => changed(name), DUTY_STALE_MS);
      const after = this.view(name);
      if (after.duty !== before.duty || after.lights !== before.lights) changed(name);
    },
    /**
     * Walks a person to a tile. Refused while they are at work; a walk asked less than 250 ms
     * after the last one waits for its turn, and a later one replaces it.
     * @param {string} name @param {unknown} to
     * @returns {{ ok: boolean, error?: string }}
     */
    walk(name, to) {
      const person = state(name);
      if (dutyNow(person) !== 'free') return { ok: false, error: 'Your character is at work' };
      const plan = continueWalk(person, to, now());
      if (!plan.ok) return plan;
      const wait = (person.last.walk ?? -Infinity) + WALK_EVERY_MS - now();
      if (wait <= 0) return startWalk(name, person, /** @type {Tile} */ (to));
      if (person.pendingWalk) clearTimeout(person.pendingWalk.timer);
      const timer = later(() => {
        const pending = person.pendingWalk;
        person.pendingWalk = null;
        if (!pending) return;
        const result = dutyNow(person) === 'free' ? startWalk(name, person, pending.to) : { ok: false, error: 'Your character is at work' };
        if (!result.ok) onRefused(name, `Walk dropped: ${result.error}`);
      }, wait);
      person.pendingWalk = { to: /** @type {Tile} */ (to), timer };
      return { ok: true };
    },
    /** Whether an agent key was seen in the town's events (a "come look" may point at it). @param {string} key */
    knowsAgent(key) {
      return agents.knows(key);
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
    /** Forgets everyone not on the roster any more. @param {Set<string>} names */
    forgetAllBut(names) {
      for (const name of [...people.keys()]) if (!names.has(name)) forget(name);
    },
    dispose() {
      stop();
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

/** The door of a home, where its person starts (the first home's for a name not on the roster). @param {number|null} slot @returns {Tile} */
function doorOf(slot) {
  const home = slot === null ? undefined : HOMES[slot];
  if (!home) return /** @type {Tile} */ ([...HOMES[0].door]);
  return /** @type {Tile} */ ([...home.door]);
}

/**
 * Batches people's changes: each name at most once per broadcast, at most every FLUSH_MS.
 * @param {(names: string[]) => void} onChange @param {() => number} now
 */
function batcher(onChange, now) {
  /** @type {Set<string>} */
  const dirty = new Set();
  /** @type {NodeJS.Timeout|null} */
  let timer = null;
  let last = -Infinity;
  function flush() {
    timer = null;
    last = now();
    const names = [...dirty];
    dirty.clear();
    if (names.length) onChange(names);
  }
  return {
    /** @param {string} name */
    changed(name) {
      dirty.add(name);
      if (!timer) timer = later(flush, Math.max(0, last + FLUSH_MS - now()));
    },
    stop() {
      if (timer) clearTimeout(timer);
    },
  };
}

/** The agent keys seen in the town's events (the newest MAX_AGENT_KEYS), for "come look". */
function agentMemory() {
  /** @type {Set<string>} */
  const keys = new Set();
  return {
    /** @param {Record<string, any>} event */
    remember(event) {
      if (typeof event.session_id !== 'string') return;
      const key = agentKeyOf(event.session_id, normalizeAgentId(event.agent_id));
      keys.delete(key);
      keys.add(key);
      if (keys.size > MAX_AGENT_KEYS) keys.delete(/** @type {string} */ (keys.values().next().value));
    },
    /** @param {string} key */
    knows: (key) => keys.has(key),
  };
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
