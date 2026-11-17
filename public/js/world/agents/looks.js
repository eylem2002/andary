// What a figure looks like, derived from its AgentSpec: crew colour, hat, the tool it carries
// (by agent type), what it wears (by role/type), and stable per-agent variety (skin tone, hair,
// trousers, height) from a hash of the id. Pure, so the mapping is unit-tested.

import { hashString, rand01 } from './easing.js';
import { safeColor } from './color.js';

export const HATS = Object.freeze(['hardhat', 'cap', 'crown', 'beret', 'sunhat', 'wizard', 'none']);

const SKIN_TONES = Object.freeze(['#F7D7BC', '#EDBB93', '#D9A06F', '#B97D4E', '#8F5A36', '#5E3B25']);
const HAIR_COLORS = Object.freeze(['#2B1B12', '#4A2E1C', '#7A4A24', '#C9944A', '#1C1C1F', '#9E3B1F', '#A7A9AE']);
const PANTS_COLORS = Object.freeze(['#2F3B57', '#3A3F48', '#5E5140', '#25496E']);

/**
 * Figures are modelled about 1 unit tall; drawn 1.6× so they read as people at a glance, the way
 * game characters are (toy proportions), while still fitting the 0.75-unit spacing of work spots.
 */
const FIGURE_SCALE = 1.6;

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

/** @param {unknown} role @returns {'lead'|'subagent'|'teammate'} */
function normalizeRole(role) {
  return role === 'lead' || role === 'teammate' ? role : 'subagent';
}

/**
 * @typedef {object} Look
 * @property {string} color     crew colour (sanitised hex)
 * @property {'lead'|'subagent'|'teammate'} role
 * @property {string} hat
 * @property {'magnifier'|'blueprint'|'toolbox'|null} kit
 * @property {Wearable} wearable
 * @property {string} skin
 * @property {string} hair
 * @property {string} pants
 * @property {number} height    uniform scale of the figure
 * @property {number} seedInt   hash of the id: drives animation timing and lanes
 * @property {string} key       cache key for the figure geometry (everything baked into it)
 */

/**
 * @param {{id: string, color?: string, role?: string, type?: string, hat?: string}} spec
 * @returns {Look}
 */
export function resolveLook(spec) {
  const seedInt = hashString(spec.id);
  const role = normalizeRole(spec.role);
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
  return { color, role, hat, kit, wearable, skin, hair, pants, height, seedInt, key };
}
