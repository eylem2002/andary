// What a figure looks like, derived from its AgentSpec: crew colour, hat, the tool it carries
// (by agent type), what it wears (by role/type), and stable per-agent variety (skin tone, hair,
// trousers, height) from a hash of the id. A person of a team town (role 'person') is drawn
// from the look they chose instead (core/profile.js), a head taller than everyone else. Pure, so
// the mapping is unit-tested.

import { hashString, rand01 } from './easing.js';
import { lighten, safeColor } from './color.js';
import { CLOTH_COLORS, HAIR_COLORS as PERSON_HAIR, LOOK_CHOICES, LOOK_FIELDS, SKIN_TONES as PERSON_SKIN, defaultProfile } from '../../core/profile.js';

export const HATS = Object.freeze(['hardhat', 'cap', 'crown', 'beret', 'sunhat', 'wizard', 'beanie', 'none']);

const SKIN_TONES = Object.freeze(['#F7D7BC', '#EDBB93', '#D9A06F', '#B97D4E', '#8F5A36', '#5E3B25']);
const HAIR_COLORS = Object.freeze(['#2B1B12', '#4A2E1C', '#7A4A24', '#C9944A', '#1C1C1F', '#9E3B1F', '#A7A9AE']);
const PANTS_COLORS = Object.freeze(['#2F3B57', '#3A3F48', '#5E5140', '#25496E']);

/**
 * Figures are modelled about 1 unit tall; drawn 1.6× so they read as people at a glance, the way
 * game characters are (toy proportions), while still fitting the 0.75-unit spacing of work spots.
 */
const FIGURE_SCALE = 1.6;
/** A person stands 1.3× a helper's height: the main character of their crew. */
const PERSON_SCALE = 1.3;

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

/** What a helper wears: the plain figure every person's options are variations of. */
const PLAIN = Object.freeze({ hairStyle: 'short', eyes: 'dot', face: 'none', top: 'tee', bottom: 'trousers', shoes: 'boots', shoesColor: '#4A3426', extra: 'none' });

/**
 * A person's look, every field checked against its choices (a bad one falls back to the default
 * look's), so the facade stays safe whatever it is given.
 * @param {unknown} raw
 * @returns {import('../../core/profile.js').PersonLook}
 */
export function cleanPersonLook(raw) {
  const fallback = defaultProfile(0).look;
  const source = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  return /** @type {any} */ (Object.fromEntries(LOOK_FIELDS.map((field) => {
    const value = source[field];
    const choices = /** @type {readonly unknown[]} */ (LOOK_CHOICES[field]);
    const ok = typeof choices[0] === 'string' ? choices.includes(value) : (Number.isInteger(value) && /** @type {number} */ (value) >= 0 && /** @type {number} */ (value) < choices.length) || (field === 'topColor' && value === 'theme');
    return [field, ok ? value : fallback[field]];
  })));
}

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
 * @property {string} shirt     top colour
 * @property {string} hairStyle 'short'|'long'|'bun'|'curly'|'buzz'|'bald'
 * @property {string} eyes      'dot'|'round'|'happy'
 * @property {string} face      'none'|'freckles'|'beard'|'moustache'|'glasses'
 * @property {string} top       'tee'|'hoodie'|'jacket'|'sweater'
 * @property {string} bottom    'trousers'|'shorts'|'skirt'
 * @property {string} shoes     'boots'|'sneakers'|'sandals'
 * @property {string} shoesColor
 * @property {string} extra     'none'|'cape'|'scarf'|'backpack'|'headphones'
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
  const shirt = lighten(color, 0.1);
  return { color, role, hat, kit, wearable, skin, hair, pants, shirt, ...PLAIN, height, seedInt, key };
}

/**
 * A person's figure: everything from the look they chose.
 * @param {{color?: string, person?: unknown}} spec @param {number} seedInt
 * @returns {Look}
 */
function personLook(spec, seedInt) {
  const look = cleanPersonLook(spec.person);
  const color = safeColor(spec.color, '#2457d6');
  const cloth = (/** @type {number} */ i) => CLOTH_COLORS[i].hex;
  const shirt = look.topColor === 'theme' ? color : cloth(look.topColor);
  const parts = {
    color, role: /** @type {const} */ ('person'), hat: look.hat, kit: null,
    wearable: /** @type {Wearable} */ (look.extra === 'backpack' ? 'backpack' : null),
    skin: PERSON_SKIN[look.skin].hex, hair: PERSON_HAIR[look.hairColor].hex, pants: cloth(look.bottomColor), shirt,
    hairStyle: look.hair, eyes: look.eyes, face: look.face, top: look.top, bottom: look.bottom,
    shoes: look.shoes, shoesColor: cloth(look.shoesColor), extra: look.extra,
  };
  const key = ['person', ...Object.values(parts)].join('|');
  return { ...parts, height: FIGURE_SCALE * PERSON_SCALE, seedInt, key };
}
