// "Allow always" on an approval card (CONTRACTS §4.5), in words: which of the rules a request
// offers the card shows, the rule as Claude Code's settings write it, where it is kept, and a
// short hint when earlier requests for the same rule say something useful. Pure (no DOM), so it
// is unit-tested in Node; ui/approvals.js builds the card.
import { localDate } from '../core/dates.js';
import { isOfferedDestination, isPermissionRule, rulesText } from '../core/permission-rules.js';
import { isObject, listOf } from '../core/text.js';
import { revealHidden } from './format.js';

/** @typedef {import('./types.js').Approval} Approval */
/** @typedef {import('../core/permission-rules.js').OfferedSuggestion} OfferedSuggestion */

/** Where a saved rule applies. */
const DESTINATION_WORDS = Object.freeze({
  localSettings: 'for this project, only you',
  session: 'until this session ends',
});

/** Allows of the same rule today after which a card says so. */
const OFTEN = 2;
/** …and after which a terminal card points to the terminal's own "don't ask again". */
const VERY_OFTEN = 3;

/**
 * Where a saved rule applies: "for this project, only you" or "until this session ends".
 * @param {unknown} destination
 * @returns {string}
 */
export function destinationWords(destination) {
  return isOfferedDestination(destination) ? DESTINATION_WORDS[destination] : '';
}

/**
 * Rules as a card shows them, in Claude Code's own syntax (`Bash(npm test:*)`), with hidden
 * characters revealed: the viewer saves exactly what they read.
 * @param {unknown} rules
 * @returns {string}
 */
export function shownRules(rules) {
  return revealHidden(rulesText(rules));
}

/**
 * Whether an offer from the network has the shape the server sends.
 * @param {unknown} offer
 * @returns {offer is OfferedSuggestion}
 */
function isOffer(offer) {
  if (!isObject(offer) || !Number.isInteger(offer.index) || offer.index < 0) return false;
  const { rules } = offer;
  return Array.isArray(rules) && rules.length > 0 && rules.every(isPermissionRule) && isOfferedDestination(offer.destination);
}

/**
 * The one rule a card offers to save: the first suggestion kept for this project, otherwise the
 * first kept for this session.
 * @param {Approval} approval
 * @returns {OfferedSuggestion|null}
 */
export function offeredSuggestion(approval) {
  const offers = listOf(approval.suggestions).filter(isOffer);
  return offers.find((offer) => offer.destination === 'localSettings') ?? offers.find((offer) => offer.destination === 'session') ?? null;
}

/**
 * What "Allow always" would save, in the three parts of the line under the button (the rules go
 * in the mono face): "Adds the rule", "Bash(npm test:*)", "for this project, only you".
 * @param {OfferedSuggestion} offer
 * @returns {{ lead: string, rules: string, where: string }}
 */
export function alwaysParts(offer) {
  return { lead: offer.rules.length === 1 ? 'Adds the rule' : 'Adds the rules', rules: shownRules(offer.rules), where: destinationWords(offer.destination) };
}

/**
 * What an "Allow always" saved, for the card's result: "Bash(npm test:*) for this project, only
 * you"; '' when the approval saved nothing.
 * @param {Approval} approval
 * @returns {string}
 */
export function savedText(approval) {
  if (!isObject(approval.always)) return '';
  const rules = shownRules(approval.always.rules);
  return rules ? [rules, destinationWords(approval.always.destination)].filter(Boolean).join(' ') : '';
}

/**
 * The rule a request is about, to compare requests: what it saved, otherwise what it offers.
 * @param {Approval} approval
 * @returns {string}
 */
function ruleOf(approval) {
  if (isObject(approval.always)) return rulesText(approval.always.rules);
  const offer = offeredSuggestion(approval);
  return offer ? rulesText(offer.rules) : '';
}

/**
 * How many earlier requests for the same rule were allowed today, in the town or in the
 * terminal. A request answered in the terminal counts as allowed: the town only sees the agent
 * carry on.
 * @param {Approval} approval
 * @param {Approval[]} approvals  every approval the town knows
 * @param {number} now
 * @returns {number}
 */
export function allowedToday(approval, approvals, now) {
  const rule = ruleOf(approval);
  if (!rule) return 0;
  const today = localDate(now);
  return approvals.filter(
    (other) =>
      other.id !== approval.id &&
      (other.status === 'allowed' || other.status === 'resolved') &&
      other.createdAt < approval.createdAt &&
      localDate(other.createdAt) === today &&
      ruleOf(other) === rule,
  ).length;
}

/**
 * Whether a request asks for a rule its own session saved with "Allow always" before it was
 * made. Claude Code applies a saved rule to that session at once, so the rule did not take.
 * @param {Approval} approval
 * @param {Approval[]} approvals
 * @returns {boolean}
 */
export function askedAgainAfterAlways(approval, approvals) {
  const rule = ruleOf(approval);
  if (!rule) return false;
  return approvals.some(
    (other) =>
      other.id !== approval.id &&
      other.sessionId === approval.sessionId &&
      isObject(other.always) &&
      Number(other.always.at) < approval.createdAt &&
      rulesText(other.always.rules) === rule,
  );
}

/**
 * A short hint for a waiting card, when earlier requests for its rule say something useful; ''
 * otherwise. A rule that came back after "Allow always" comes first; then how often it was
 * allowed today, and on a card answered in the terminal, from the third time, the terminal's own
 * way to stop the questions.
 * @param {Approval} approval
 * @param {Approval[]} approvals
 * @param {number} now
 * @returns {string}
 */
export function approvalHint(approval, approvals, now) {
  if (approval.status !== 'pending') return '';
  if (askedAgainAfterAlways(approval, approvals)) return 'You chose allow always for this; Claude Code asked again (a managed setting may not allow saved rules).';
  const count = allowedToday(approval, approvals, now);
  if (count < OFTEN) return '';
  const times = `You allowed this ${count} times today.`;
  return !approval.held && count >= VERY_OFTEN ? `${times} Tip: choose “don't ask again” in the terminal.` : times;
}
