// A team town's people in the 3D town (CONTRACTS §4.11): each person's home in the residential
// quarter (their house style, colour, name plate, and lights while they are online) and, while
// they are online, their figure on their porch. Called with the whole list whenever it changes;
// only what changed reaches the world.
import { CREW_COLORS } from '../core/catalog.js';
import { HOME_COUNT } from '../core/town-map.js';
import { defaultProfile } from '../core/profile.js';

/**
 * A person as the server (or the demo) describes them.
 * @typedef {object} PersonView
 * @property {string} name
 * @property {number} slot     their home, 0–5
 * @property {number} color    an index into CREW_COLORS
 * @property {boolean} host
 * @property {boolean} online
 * @property {import('../core/profile.js').Profile|null} profile
 */

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

  return {
    /** @param {PersonView[]} people */
    sync(people) {
      const world = getWorld();
      if (!world) return;
      for (let slot = 0; slot < HOME_COUNT; slot++) {
        const person = people.find((p) => p.slot === slot);
        const home = person ? { name: person.name, color: CREW_COLORS[person.color], style: person.profile?.house ?? 'coast', lights: person.online } : null;
        if (changed(`home:${slot}`, home)) world.setHome?.(slot, home);
      }
      const here = new Set();
      for (const person of people) {
        if (!person.online) continue;
        const id = personFigureId(person.name);
        here.add(id);
        const spec = { id, name: person.name, color: CREW_COLORS[person.color], role: 'person', person: (person.profile ?? defaultProfile(person.color)).look, home: person.slot };
        const known = shown.has(`figure:${id}`);
        if (!changed(`figure:${id}`, spec)) continue;
        if (known && world.hasAgent(id)) world.updateAgent?.(id, { name: spec.name, color: spec.color, person: spec.person });
        else world.addAgent?.({ ...spec, entrance: 'pop' });
      }
      for (const key of [...shown.keys()]) {
        const id = key.slice('figure:'.length);
        if (!key.startsWith('figure:') || here.has(id)) continue;
        shown.delete(key);
        void world.removeAgent?.(id, { exit: 'poof' });
      }
    },
    /** A new world: everything is set again. @param {PersonView[]} people */
    redraw(people) {
      shown.clear();
      this.sync(people);
    },
  };
}
