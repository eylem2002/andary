// The demo's team town people (CONTRACTS §4.11): you, the host, and Lina, the teammate whose crew
// the story has. Both are online, so the demo shows two homes lit and two characters on their
// porches. The "You" dialog saves to here instead of a host; your look also stays in this browser
// (ui/character.js), so the demo starts with it next time. You can walk, wave and say the set
// phrases as on a host; Lina takes a stroll now and then, and waves.
import { PERSON_COLOR_COUNT, defaultProfile, nameProblem, validateProfile } from '../core/profile.js';
import { EMOTES, PHRASES, continueWalk, walkDuration } from '../core/presence.js';
import { HOMES, LOTS } from '../core/town-map.js';

/** @typedef {import('../ui/town-people.js').PersonView} PersonView */
/** @typedef {import('../core/profile.js').Profile} Profile */

export const DEMO_ME = 'You';

const LINA = /** @type {Profile} */ (/** @type {unknown} */ ({
  v: 1, color: 1, house: 'desert', name: 'Lina', agents: '',
  look: {
    skin: 8, height: 'medium', build: 'slim', hair: 'curly', hairColor: 0, hairStreak: 8, eyes: 'round', brows: 'arched', mouth: 'grin',
    facialHair: 'none', glasses: 'round', cheeks: 'freckles', earrings: 'hoops', top: 'hoodie', topPattern: 'emblem', topColor: 'theme', patternColor: 4,
    bottom: 'skirt', bottomColor: 1, shoes: 'hightops', shoesColor: 4, hat: 'none', extra: 'headphones', pet: 'cat', hand: 'coffee',
  },
}));

/** Where Lina strolls to, in turn, and back home: one stop every LINA_EVERY_MS. */
const LINA_STOPS = Object.freeze([LOTS.cafe.door, HOMES[1].door, LOTS.library.door, HOMES[1].door]);
const LINA_EVERY_MS = 14_000;

/** @param {number} slot @returns {[number, number]} */
const doorOf = (slot) => [HOMES[slot].door[0], HOMES[slot].door[1]];

/**
 * @param {object} options
 * @param {(people: PersonView[], me: string, offset: number) => void} options.onPeople
 * @param {(patches: object[]) => void} [options.onPresence]  where someone is now
 * @param {(said: { kind: 'emote'|'phrase', name: string, id: number }) => void} [options.onSaid]
 * @param {Profile|null} [options.saved]  your look from an earlier visit
 * @param {() => number} [options.now]
 * @param {(fn: () => void, ms: number) => void} [options.every]  a repeating timer (a test's own)
 */
export function createDemoPeople({ onPeople, onPresence = () => {}, onSaid = () => {}, saved = null, now = Date.now, every = repeat }) {
  /** @type {PersonView[]} */
  let people = [
    { name: DEMO_ME, slot: 0, color: saved?.color === LINA.color ? 0 : (saved?.color ?? 0), host: true, online: true, profile: saved ?? { ...defaultProfile(0), look: { ...defaultProfile(0).look, hat: 'cap', hand: 'laptop' } }, tile: doorOf(0), walk: null, away: null, duty: 'free', lights: true },
    { name: 'Lina', slot: 1, color: LINA.color, host: false, online: true, profile: LINA, tile: doorOf(1), walk: null, away: null, duty: 'free', lights: true },
  ];
  let linaStop = 0;

  /** @param {string} name @param {unknown} to @returns {{ ok: boolean, error?: string }} */
  function walk(name, to) {
    const person = /** @type {PersonView} */ (people.find((p) => p.name === name));
    const plan = continueWalk({ tile: person.tile ?? doorOf(person.slot), walk: person.walk ?? null }, to, now());
    if (!plan.ok) return plan;
    const path = /** @type {[number, number][]} */ (plan.path);
    const moved = { tile: path[0], walk: { path, at: /** @type {number} */ (plan.at) } };
    people = people.map((p) => (p.name === name ? { ...p, ...moved } : p));
    onPresence([{ name, ...moved }]);
    return { ok: true };
  }

  function stroll() {
    const lina = people[1];
    if (lina.walk && now() < lina.walk.at + walkDuration(lina.walk.path)) return;
    walk('Lina', LINA_STOPS[linaStop % LINA_STOPS.length]);
    if (linaStop % 2 === 0) onSaid({ kind: 'emote', name: 'Lina', id: 0 });
    linaStop += 1;
  }

  return {
    start() {
      onPeople(people, DEMO_ME, 0);
      every(stroll, LINA_EVERY_MS);
    },
    /** Walks your character. @param {unknown} to */
    walk: (to) => walk(DEMO_ME, to),
    /**
     * Shows one of the set emotes or phrases over your character.
     * @param {'emote'|'phrase'} kind @param {number} id
     */
    say(kind, id) {
      const list = kind === 'emote' ? EMOTES : PHRASES;
      if (!Number.isInteger(id) || id < 0 || id >= list.length) return false;
      onSaid({ kind, name: DEMO_ME, id });
      return true;
    },
    /**
     * Saves your profile, with the colour you asked for unless Lina has it (then the next free one).
     * @param {unknown} profile
     * @returns {{ color: number, asked: number }|{ error: string }}
     */
    save(profile) {
      const check = validateProfile(profile);
      if (!check.ok) return { error: `Profile not saved: ${check.error}.` };
      const others = ['Lina', LINA.name, LINA.agents];
      const problem = nameProblem(check.profile.name, others) ?? nameProblem(check.profile.agents, others);
      if (problem) return { error: `Profile not saved: ${problem}.` };
      const taken = /** @type {Set<number>} */ (new Set(people.filter((p) => p.name !== DEMO_ME).map((p) => p.color)));
      let color = check.profile.color;
      while (taken.has(color)) color = (color + 1) % PERSON_COLOR_COUNT;
      people = people.map((p) => (p.name === DEMO_ME ? { ...p, color, profile: check.profile } : p));
      onPeople(people, DEMO_ME, 0);
      return { color, asked: check.profile.color };
    },
  };
}

/** setInterval that never keeps Node alive (the unit tests). @param {() => void} fn @param {number} ms */
function repeat(fn, ms) {
  /** @type {any} */ (setInterval(fn, ms)).unref?.();
}
