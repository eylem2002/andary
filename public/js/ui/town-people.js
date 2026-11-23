// A team town's people in the 3D town (CONTRACTS §4.11): each person's home in the residential
// quarter (their house style, colour, name plate, and lights while they are online or their crews
// post), and their figure where they are: walking, standing, dimmed on their porch a minute after
// their last browser left, and inside (not shown) after ten. Called with the whole list whenever
// it changes; only what changed reaches the world.
import { CREW_COLORS } from '../core/catalog.js';
import { HOMES, HOME_COUNT } from '../core/town-map.js';
import { defaultProfile } from '../core/profile.js';
import { isTile } from '../core/presence.js';

/**
 * A person as the server (or the demo) describes them.
 * @typedef {object} PersonView
 * @property {string} name
 * @property {number} slot     their home, 0–5
 * @property {number} color    an index into CREW_COLORS
 * @property {boolean} host
 * @property {boolean} online
 * @property {import('../core/profile.js').Profile|null} profile
 * @property {[number, number]} [tile]   where they stand (their door until they walk)
 * @property {{ path: [number, number][], at: number }|null} [walk]  their last walk; at: on the server's clock
 * @property {null|'porch'|'inside'} [away]  no browser of theirs for a minute (porch) or ten (inside)
 * @property {'free'|'work'|'needs'} [duty]
 * @property {boolean} [lights]  their home's lights: online, or their crews posted lately
 */

/** The presence fields a `presence` message may change. */
const PRESENCE_KEYS = Object.freeze(['tile', 'walk', 'online', 'away', 'duty', 'lights']);

/**
 * The people with some of their presence changed (a `presence` message): only the presence
 * fields of people already known are taken.
 * @param {PersonView[]} people @param {unknown[]} patches
 * @returns {PersonView[]}
 */
export function mergePresence(people, patches) {
  const byName = new Map();
  for (const patch of patches) {
    if (patch && typeof patch === 'object' && typeof (/** @type {any} */ (patch).name) === 'string') byName.set(/** @type {any} */ (patch).name, patch);
  }
  return people.map((person) => {
    const patch = byName.get(person.name);
    if (!patch) return person;
    const next = { ...person };
    for (const key of PRESENCE_KEYS) if (key in patch) /** @type {any} */ (next)[key] = patch[key];
    return next;
  });
}

/**
 * Where a person is, for the world: a walk on this browser's clock, or the tile they stand on.
 * @param {PersonView} person @param {number} offset  how far the server's clock is ahead of this one
 */
export function whereOf(person, offset) {
  const walk = person.walk && Array.isArray(person.walk.path) && Number.isFinite(person.walk.at) ? { path: person.walk.path, at: person.walk.at - offset } : null;
  const tile = isTile(person.tile) ? person.tile : /** @type {[number, number]} */ ([...(HOMES[person.slot] ?? HOMES[0]).door]);
  return { tile, walk, dim: !person.online };
}

/** The name a person's character shows: their chosen one, else their name on the team. @param {PersonView} person */
export function displayName(person) {
  return person.profile?.name || person.name;
}

/**
 * A person's name where it must be clear who they are (details, tooltips, notes): their
 * character's name with their name on the team beside it when the two differ, "Ali (alice)".
 * @param {PersonView} person
 */
export function nameWithRoster(person) {
  const shown = displayName(person);
  return shown.toLocaleLowerCase() === person.name.toLocaleLowerCase() ? shown : `${shown} (${person.name})`;
}

/** A home as the world draws it, or null for an empty plot. @param {PersonView|undefined} person */
function homeOf(person) {
  return person ? { name: displayName(person), color: CREW_COLORS[person.color], style: person.profile?.house ?? 'coast', lights: person.lights ?? person.online } : null;
}

/** The world id of a person's figure. @param {string} name */
export function personFigureId(name) {
  return `person:${name}`;
}

/**
 * @param {() => import('./types.js').World|null} getWorld
 */
export function createTownPeople(getWorld) {
  /** What each home and figure was last set to, so unchanged ones are left alone. @type {Map<string, string>} */
  const shown = new Map();

  /** @param {string} key @param {unknown} value @returns {boolean} whether it changed */
  function changed(key, value) {
    const text = JSON.stringify(value);
    if (shown.get(key) === text) return false;
    shown.set(key, text);
    return true;
  }

  /** Adds a person's figure, or changes its look and name. @param {import('./types.js').World} world @param {string} id @param {PersonView} person */
  function showFigure(world, id, person) {
    const spec = { id, name: displayName(person), color: CREW_COLORS[person.color], role: 'person', person: (person.profile ?? defaultProfile(person.color)).look, home: person.slot };
    const known = shown.has(`figure:${id}`);
    if (!changed(`figure:${id}`, spec)) return;
    if (known && world.hasAgent(id)) world.updateAgent?.(id, { name: spec.name, color: spec.color, person: spec.person });
    else world.addAgent?.({ ...spec, entrance: 'pop' });
  }

  return {
    /**
     * @param {PersonView[]} people
     * @param {number} [offset]  how far the server's clock is ahead of this browser's (walks are timed on it)
     */
    sync(people, offset = 0) {
      const world = getWorld();
      if (!world) return;
      for (let slot = 0; slot < HOME_COUNT; slot++) {
        const home = homeOf(people.find((p) => p.slot === slot));
        if (changed(`home:${slot}`, home)) world.setHome?.(slot, home);
      }
      const here = new Set();
      for (const person of people) {
        // Online, or on their porch for a while after they left; inside after that.
        if (!person.online && person.away !== 'porch') continue;
        const id = personFigureId(person.name);
        here.add(id);
        showFigure(world, id, person);
        const where = whereOf(person, offset);
        if (changed(`where:${id}`, where)) world.placePerson?.(id, where);
      }
      for (const key of [...shown.keys()]) {
        const id = key.slice('figure:'.length);
        if (!key.startsWith('figure:') || here.has(id)) continue;
        shown.delete(key);
        shown.delete(`where:${id}`);
        void world.removeAgent?.(id, { exit: 'poof' });
      }
    },
    /** A new world: everything is set again. @param {PersonView[]} people @param {number} [offset] */
    redraw(people, offset = 0) {
      shown.clear();
      this.sync(people, offset);
    },
  };
}
