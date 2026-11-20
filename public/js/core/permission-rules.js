// Permission rules that Claude Code proposes with a permission request (`permission_suggestions`,
// CONTRACTS §4.5), and how the town writes them. The server decides with these rules what an
// approval may offer to save, and the demo, which plays the server's part, decides the same way;
// the store and the HUD write the rules the same way. The town only offers an allow rule kept for
// this project and only you (`localSettings`) or until the session ends (`session`): never one
// that changes other people's prompts (`projectSettings`, `userSettings`), a permission mode or
// working folders. Pure and defensive: suggestions come from hook payloads and may be any shape.
import { isObject } from './text.js';

/** Where a rule the town saves may go. */
const OFFERED_DESTINATIONS = Object.freeze(['localSettings', 'session']);
/** Every field of an `addRules` suggestion; a suggestion with any other field is not offered. */
const SUGGESTION_FIELDS = Object.freeze(['type', 'rules', 'behavior', 'destination']);

/** @typedef {{ toolName: string, ruleContent?: string }} PermissionRule */
/** @typedef {'localSettings'|'session'} RuleDestination */

/**
 * A suggestion the town may offer, with its place in the request's `permission_suggestions`: the
 * browser names that place to choose it.
 * @typedef {object} OfferedSuggestion
 * @property {number} index
 * @property {PermissionRule[]} rules
 * @property {RuleDestination} destination
 */

/**
 * A permission rule the way Claude Code describes one: a tool name and, if it covers less than
 * the whole tool, what it matches. A rule with any other field is refused: the card could not
 * show what that field means.
 * @param {unknown} rule
 * @returns {rule is PermissionRule}
 */
export function isPermissionRule(rule) {
  if (!isObject(rule) || typeof rule.toolName !== 'string' || rule.toolName === '') return false;
  return Object.keys(rule).every((key) => key === 'toolName' || (key === 'ruleContent' && typeof rule.ruleContent === 'string'));
}

/**
 * Whether a destination is one the town may save a rule to.
 * @param {unknown} destination
 * @returns {destination is RuleDestination}
 */
export function isOfferedDestination(destination) {
  return OFFERED_DESTINATIONS.includes(/** @type {any} */ (destination));
}

/**
 * Whether the town may offer to save a suggestion: rules to allow (`addRules` with `allow`), at
 * least one, for this project and only you or for this session, and nothing else in it.
 * @param {unknown} suggestion
 * @returns {boolean}
 */
function isOfferable(suggestion) {
  if (!isObject(suggestion) || suggestion.type !== 'addRules' || suggestion.behavior !== 'allow') return false;
  if (!isOfferedDestination(suggestion.destination)) return false;
  const { rules } = suggestion;
  if (!Array.isArray(rules) || rules.length === 0 || !rules.every(isPermissionRule)) return false;
  return Object.keys(suggestion).every((key) => SUGGESTION_FIELDS.includes(key));
}

/**
 * The suggestions of a permission request that the town may offer to save with an allow, each
 * with its place in the list and a copy of its rules.
 * @param {unknown} suggestions  the request's `permission_suggestions`
 * @returns {OfferedSuggestion[]}
 */
export function offerableSuggestions(suggestions) {
  if (!Array.isArray(suggestions)) return [];
  return suggestions.flatMap((suggestion, index) =>
    isOfferable(suggestion) ? [{ index, rules: suggestion.rules.map(copyRule), destination: suggestion.destination }] : [],
  );
}

/**
 * @param {PermissionRule} rule
 * @returns {PermissionRule}
 */
function copyRule({ toolName, ruleContent }) {
  return ruleContent === undefined ? { toolName } : { toolName, ruleContent };
}

/**
 * A rule the way Claude Code's settings write it: `Bash(npm test:*)`, or `Bash` for the whole
 * tool. '' for anything that is not a rule.
 * @param {unknown} rule
 * @returns {string}
 */
export function ruleText(rule) {
  if (!isPermissionRule(rule)) return '';
  return rule.ruleContent === undefined ? rule.toolName : `${rule.toolName}(${rule.ruleContent})`;
}

/**
 * Several rules on one line: `Bash(npm test:*), Bash(npm run lint)`.
 * @param {unknown} rules
 * @returns {string}
 */
export function rulesText(rules) {
  return Array.isArray(rules) ? rules.map(ruleText).filter(Boolean).join(', ') : '';
}
