// "Allow always" on an approval card (CONTRACTS §4.5), in words: which of the rules a request
// offers the card shows, the rule as Claude Code's settings write it and what it allows, where it
// is kept, and a short hint when earlier requests for the same rule say something useful. Pure
// (no DOM), so it is unit-tested in Node; ui/approvals.js builds the card.
import { localDate } from '../core/dates.js';
import { isOfferedDestination, ruleReach, ruleText, rulesText } from '../core/permission-rules.js';
import { isObject, listOf, revealHidden } from '../core/text.js';

/** @typedef {import('./types.js').Approval} Approval */
/** @typedef {import('../core/permission-rules.js').OfferedSuggestion} OfferedSuggestion */
/** @typedef {import('../core/permission-rules.js').PermissionRule} PermissionRule */
/** A piece of a line on the card: plain text, or a rule in the mono face. @typedef {{ text: string } | { code: string }} Segment */

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
 * What a rule allows beyond its literal text, in words: "commands starting with “npm test”" for
 * a prefix, "every use of this tool" for an MCP tool; '' for one exact command or value.
 * @param {PermissionRule} rule
 * @returns {string}
 */
export function reachWords(rule) {
  const reach = ruleReach(rule);
  if (reach?.kind === 'prefix') return `commands starting with “${revealHidden(reach.prefix)}”`;
  return reach?.kind === 'tool' ? 'every use of this tool' : '';
}

/**
 * Whether an offer from the network has the shape the server sends, with rules it would offer.
 * @param {unknown} offer
 * @returns {offer is OfferedSuggestion}
 */
function isOffer(offer) {
  if (!isObject(offer) || !Number.isInteger(offer.index) || offer.index < 0) return false;
  const { rules } = offer;
  return Array.isArray(rules) && rules.length > 0 && rules.every((rule) => ruleReach(rule) !== null) && isOfferedDestination(offer.destination);
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
 * The line between Allow / Deny and the "Allow always" button: what it saves, what that allows,
 * and where, e.g. "Allow always saves the rule `Bash(npm test:*)` (commands starting with
 * “npm test”) for this project, only you."
 * @param {OfferedSuggestion} offer
 * @returns {Segment[]}
 */
export function alwaysLine(offer) {
  /** @type {Segment[]} */
  const line = [{ text: offer.rules.length === 1 ? 'Allow always saves the rule ' : 'Allow always saves the rules ' }];
  offer.rules.forEach((rule, i) => {
    if (i > 0) line.push({ text: ', ' });
    line.push({ code: ruleText(rule) });
    const words = reachWords(rule);
    if (words) line.push({ text: ` (${words})` });
  });
  line.push({ text: ` ${destinationWords(offer.destination)}.` });
  return line;
}

/**
 * The rule an "Allow always" asked Claude Code to save, for the card's result: "Bash(npm test:*)
 * for this project, only you"; '' when the approval asked for none.
 * @param {Approval} approval
 * @returns {string}
 */
export function savedText(approval) {
  if (!isObject(approval.always)) return '';
  const rules = rulesText(approval.always.rules);
  return rules ? [rules, destinationWords(approval.always.destination)].filter(Boolean).join(' ') : '';
}

/**
 * The rule a request is about, to compare requests: what it asked to save, otherwise what it offers.
 * @param {Approval} approval
 * @returns {string}
 */
function ruleOf(approval) {
  if (isObject(approval.always)) return rulesText(approval.always.rules);
  const offer = offeredSuggestion(approval);
  return offer ? rulesText(offer.rules) : '';
}

/**
 * Whether an earlier request was allowed: in the town, or in the terminal when its tool then ran.
 * One the terminal settled because the agent or session stopped may have been denied, so it does
 * not count.
 * @param {Approval} approval
 */
function wasAllowed(approval) {
  return approval.status === 'allowed' || (approval.status === 'resolved' && approval.proof === 'ran');
}

/**
 * How many earlier requests for the same rule, in the same project, were allowed today.
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
      wasAllowed(other) &&
      other.cwd === approval.cwd &&
      other.createdAt < approval.createdAt &&
      localDate(other.createdAt) === today &&
      ruleOf(other) === rule,
  ).length;
}

/**
 * Whether a request asks for a rule its own session asked Claude Code to save for this project
 * before the request was made. Claude Code applies a saved rule at once, so the rule may not have
 * been saved. Rules kept for a session are not judged: a resumed session keeps its id but not them.
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
      other.always.destination === 'localSettings' &&
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
  if (askedAgainAfterAlways(approval, approvals)) return 'Claude Code asked again after “Allow always”: the rule may not have been saved (a managed setting can forbid saved rules).';
  const count = allowedToday(approval, approvals, now);
  if (count < OFTEN) return '';
  const times = `You allowed this ${count} times today.`;
  return !approval.held && count >= VERY_OFTEN ? `${times} Tip: choose “don't ask again” in the terminal.` : times;
}
