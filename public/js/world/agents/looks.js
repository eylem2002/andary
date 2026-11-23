// What a figure looks like, derived from its AgentSpec: crew colour, hat, the tool it carries
// (by agent type), what it wears (by role/type), and stable per-agent variety (skin tone, hair,
// trousers, height) from a hash of the id. A person of a team town (role 'person') is drawn
// from the look they chose instead (core/profile.js), a head taller than everyone else. Pure, so
// the mapping is unit-tested.

import { hashString, rand01 } from './easing.js';
import { safeColor } from './color.js';
import { CLOTH_COLORS, HAIR_COLORS as PERSON_HAIR, LOOK_FIELDS, SKIN_TONES as PERSON_SKIN, defaultProfile, validChoice } from '../../core/profile.js';

export const HATS = Object.freeze(['hardhat', 'cap', 'crown', 'beret', 'sunhat', 'wizard', 'beanie', 'none']);

const SKIN_TONES = Object.freeze(['#F7D7BC', '#EDBB93', '#D9A06F', '#B97D4E', '#8F5A36', '#5E3B25']);
const HAIR_COLORS = Object.freeze(['#2B1B12', '#4A2E1C', '#7A4A24', '#C9944A', '#1C1C1F', '#9E3B1F', '#A7A9AE']);
const PANTS_COLORS = Object.freeze(['#2F3B57', '#3A3F48', '#5E5140', '#25496E']);

/**
 * Figures are modelled about 1 unit tall; drawn 1.6× so they read as people at a glance, the way
 * game characters are (toy proportions), while still fitting the 0.75-unit spacing of work spots.
 */
const FIGURE_SCALE = 1.6;
/** A person stands 1.3× a helper's height: the main character of their crew; a little less or more by their height. */
const PERSON_SCALE = 1.3;
const PERSON_HEIGHTS = Object.freeze({ short: 0.92, medium: 1, tall: 1.08 });

/**
 * Things worn on the body (always visible), as opposed to the "kit" carried in a hand.
 * @typedef {'hivis'|'backpack'|'glasses'|'net'|'earpencil'|'wrench'|'headset'|'satchel'|null} Wearable
 */

/** Custom agent types get a fitting accessory by keyword; first match wins. */
const TYPE_WEARABLES = /** @type {[RegExp, Wearable][]} */ ([
  [/review|audit|lint|secur|critic|judge|inspect/i, 'glasses'],
  // Before the bug net, so a "debugger" gets a wrench rather than a net.
  [/debug|fix|build|deploy|devops|ops|infra|migrat|refactor/i, 'wrench'],
  [/test|qa|verif|bug/i, 'net'],
  [/doc|writ|copy|summar|note/i, 'earpencil'],
  [/research|web|fetch|data|analy|search|monitor/i, 'headset'],
]);

/**
 * @param {string} role
 * @param {string|undefined} type
 * @returns {'magnifier'|'blueprint'|'toolbox'|null} the prop carried while idle or walking
 */
export function kitFor(role, type) {
  if (role === 'lead' || role === 'teammate') return null;
  if (type === 'Explore') return 'magnifier';
  if (type === 'Plan') return 'blueprint';
  if (!type || type === 'general-purpose') return 'toolbox';
  return null;
}

/**
 * @param {string} role
 * @param {string|undefined} type
 * @returns {Wearable}
 */
export function wearableFor(role, type) {
  if (role === 'lead') return 'hivis';
  if (role === 'teammate') return 'backpack';
  if (!type || type === 'Explore' || type === 'Plan' || type === 'general-purpose') return null;
  for (const [pattern, wearable] of TYPE_WEARABLES) {
    if (pattern.test(type)) return wearable;
  }
  return 'satchel';
}

/** @param {string} role */
function defaultHat(role) {
  return role === 'lead' ? 'hardhat' : 'cap';
}

/** @param {unknown} hat @param {string} role */
export function normalizeHat(hat, role) {
  return HATS.includes(/** @type {string} */ (hat)) ? /** @type {string} */ (hat) : defaultHat(role);
}

/** @param {unknown} role @returns {'lead'|'subagent'|'teammate'|'person'} */
function normalizeRole(role) {
  return role === 'lead' || role === 'teammate' || role === 'person' ? role : 'subagent';
}


/**
 * A person's look, every field checked against its choices (a bad one falls back to the default
 * look's), so the facade stays safe whatever it is given.
 * @param {unknown} raw
 * @returns {import('../../core/profile.js').PersonLook}
 */
export function cleanPersonLook(raw) {
  const fallback = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (defaultProfile(0).look));
  const source = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  return /** @type {any} */ (Object.fromEntries(LOOK_FIELDS.map((field) => [field, validChoice(field, source[field]) ? source[field] : fallback[field]])));
}

/**
 * A person's chosen look with its colours resolved, for the figure builder (figure-person.js).
 * @typedef {import('../../core/profile.js').PersonLook & { colors: { skin: string, hair: string, streak: string|null, shirt: string, pattern: string, pants: string, shoes: string, theme: string } }} PersonParts
 */

/**
 * @typedef {object} Look
 * @property {string} color     crew colour (sanitised hex); a person's own colour
 * @property {'lead'|'subagent'|'teammate'|'person'} role
 * @property {string} hat
 * @property {'magnifier'|'blueprint'|'toolbox'|null} kit
 * @property {Wearable} wearable
 * @property {string} skin
 * @property {string} hair
 * @property {string} pants
 * @property {PersonParts|null} person   a person's whole look; null for helpers
 * @property {number} height    uniform scale of the figure
 * @property {number} seedInt   hash of the id: drives animation timing and lanes
 * @property {string} key       cache key for the figure geometry (everything baked into it)
 */

/**
 * @param {{id: string, color?: string, role?: string, type?: string, hat?: string, person?: unknown}} spec
 *   person: a person's look (core/profile.js PersonLook), for role 'person'
 * @returns {Look}
 */
export function resolveLook(spec) {
  const seedInt = hashString(spec.id);
  const role = normalizeRole(spec.role);
  if (role === 'person') return personLook(spec, seedInt);
  const type = typeof spec.type === 'string' ? spec.type : undefined;
  const color = safeColor(spec.color, '#2457d6');
  const hat = normalizeHat(spec.hat, role);
  const kit = kitFor(role, type);
  const wearable = wearableFor(role, type);
  const skin = SKIN_TONES[Math.floor(rand01(seedInt, 1) * SKIN_TONES.length)];
  const hair = HAIR_COLORS[Math.floor(rand01(seedInt, 2) * HAIR_COLORS.length)];
  const pants = PANTS_COLORS[Math.floor(rand01(seedInt, 3) * PANTS_COLORS.length)];
  // The Foreman stands a head taller than the crew; everyone else varies a little.
  const height = FIGURE_SCALE * (role === 'lead' ? 1.1 : 0.95 + 0.1 * rand01(seedInt, 4));
  const key = [color, hat, kit, wearable, skin, hair, pants].join('|');
  return { color, role, hat, kit, wearable, skin, hair, pants, person: null, height, seedInt, key };
}

/**
 * A person's figure: everything from the look they chose.
 * @param {{color?: string, person?: unknown}} spec @param {number} seedInt
 * @returns {Look}
 */
function personLook(spec, seedInt) {
  const look = cleanPersonLook(spec.person);
  const color = safeColor(spec.color, '#2457d6');
  const cloth = (/** @type {'theme'|number} */ i) => (i === 'theme' ? color : CLOTH_COLORS[i].hex);
  /** @type {PersonParts} */
  const person = {
    ...look,
    colors: {
      skin: PERSON_SKIN[look.skin].hex,
      hair: PERSON_HAIR[look.hairColor].hex,
      streak: look.hairStreak === 'none' ? null : PERSON_HAIR[look.hairStreak].hex,
      shirt: cloth(look.topColor),
      pattern: cloth(look.patternColor),
      pants: cloth(look.bottomColor),
      shoes: cloth(look.shoesColor),
      theme: color,
    },
  };
  const key = `person|${color}|${LOOK_FIELDS.map((field) => look[field]).join('|')}`;
  const height = FIGURE_SCALE * PERSON_SCALE * (PERSON_HEIGHTS[/** @type {keyof typeof PERSON_HEIGHTS} */ (look.height)] ?? 1);
  return { color, role: 'person', hat: look.hat, kit: null, wearable: null, skin: person.colors.skin, hair: person.colors.hair, pants: person.colors.pants, person, height, seedInt, key };
}
