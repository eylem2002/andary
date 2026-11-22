// The demo's team town people (CONTRACTS §4.11): you, the host, and Lina, the teammate whose crew
// the story has. Both are online, so the demo shows two homes lit and two characters on their
// porches. The "You" dialog saves to here instead of a host; your look also stays in this browser
// (ui/character.js), so the demo starts with it next time.
import { PERSON_COLOR_COUNT, defaultProfile, validateProfile } from '../core/profile.js';

/** @typedef {import('../ui/town-people.js').PersonView} PersonView */
/** @typedef {import('../core/profile.js').Profile} Profile */

export const DEMO_ME = 'You';

const LINA = /** @type {Profile} */ (/** @type {unknown} */ ({
  v: 1, color: 1, house: 'desert',
  look: { skin: 5, hair: 'curly', hairColor: 0, eyes: 'round', face: 'glasses', top: 'hoodie', topColor: 'theme', bottom: 'skirt', bottomColor: 1, shoes: 'sneakers', shoesColor: 4, hat: 'none', extra: 'headphones' },
}));

/**
 * @param {{ onPeople: (people: PersonView[], me: string) => void, saved?: Profile|null }} options
 *   saved: your look from an earlier visit
 */
export function createDemoPeople({ onPeople, saved = null }) {
  /** @type {PersonView[]} */
  let people = [
    { name: DEMO_ME, slot: 0, color: saved?.color === LINA.color ? 0 : (saved?.color ?? 0), host: true, online: true, profile: saved ?? { ...defaultProfile(0), look: { ...defaultProfile(0).look, hat: 'cap' } } },
    { name: 'Lina', slot: 1, color: LINA.color, host: false, online: true, profile: LINA },
  ];
  return {
    start() {
      onPeople(people, DEMO_ME);
    },
    /**
     * Saves your profile, with the colour you asked for unless Lina has it (then the next free one).
     * @param {unknown} profile
     * @returns {{ color: number, asked: number }|null}
     */
    save(profile) {
      const check = validateProfile(profile);
      if (!check.ok) return null;
      const taken = new Set(people.filter((p) => p.name !== DEMO_ME).map((p) => p.color));
      let color = check.profile.color;
      while (taken.has(color)) color = (color + 1) % PERSON_COLOR_COUNT;
      people = people.map((p) => (p.name === DEMO_ME ? { ...p, color, profile: check.profile } : p));
      onPeople(people, DEMO_ME);
      return { color, asked: check.profile.color };
    },
  };
}
