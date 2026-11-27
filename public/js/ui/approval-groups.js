// How the Approvals panel lays its requests out: the live ones first, where requests that ask the
// same thing in the town (the same tool with the same input, from any crews) share one card with a
// checkbox per request, and the settled ones (answered, expired, gone to the terminal and answered
// there) folded under "Earlier (n)". Each card also carries its risk marks (core/risk.js), for
// each request where it runs, so a request from another folder is never hidden behind the first.
// Pure.
import { riskOf } from '../core/risk.js';
import { isObject } from '../core/text.js';

/** @typedef {import('./types.js').Approval} Approval */
/** @typedef {import('./types.js').StoreState} StoreState */

/**
 * One card: a request, or several asking the same thing.
 * @typedef {object} ApprovalEntry
 * @property {string} key        the card's key: the same while requests join it or leave it
 * @property {Approval} lead     the one the card shows: the first to run out of time
 * @property {Approval[]} members every request it stands for, oldest first (the lead among them)
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (!isObject(value)) return JSON.stringify(value) ?? 'null';
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

/**
 * What a request asks, for grouping: its tool and its input, whatever the order of keys. Two
 * requests with the same key ask exactly the same thing (where each runs may still differ).
 * @param {Approval} approval
 */
export function requestKey(approval) {
  try {
    return `${approval.toolName}\n${canonical(approval.toolInput)}`;
  } catch {
    return `id:${approval.id}`;
  }
}

/**
 * The live cards and the settled requests. Only requests the town can answer (pending and held)
 * are grouped; one waiting in the terminal keeps a card of its own.
 * @param {Approval[]} approvals  as the store keeps them: pending first
 * @returns {{ live: ApprovalEntry[], earlier: Approval[] }}
 */
export function approvalSections(approvals) {
  /** @type {Map<string, ApprovalEntry>} */
  const live = new Map();
  /** @type {Approval[]} */
  const earlier = [];
  for (const approval of approvals) {
    if (approval.status !== 'pending') {
      earlier.push(approval);
      continue;
    }
    const key = approval.held ? `ask:${requestKey(approval)}` : `one:${approval.id}`;
    const entry = live.get(key);
    if (entry) entry.members.push(approval);
    else live.set(key, { key, lead: approval, members: [approval] });
  }
  for (const entry of live.values()) {
    entry.members.sort((a, b) => a.createdAt - b.createdAt);
    entry.lead = entry.members.reduce((first, one) => ((one.expiresAt ?? Infinity) < (first.expiresAt ?? Infinity) ? one : first), entry.members[0]);
  }
  return { live: [...live.values()], earlier };
}

/**
 * The risk marks of a request where it runs: its own folder, its crew's folder.
 * @param {Approval} approval
 * @param {StoreState} state
 * @returns {import('../core/risk.js').Risk|null}
 */
export function approvalRisk(approval, state) {
  const session = state.sessions.find((s) => s.id === approval.sessionId);
  return riskOf(approval.toolName, approval.toolInput, { folder: approval.cwd || session?.cwd, sessionFolder: session?.cwd });
}

/**
 * Every reason any of a card's requests is risky, each once, in the order found.
 * @param {Approval[]} members
 * @param {StoreState} state
 * @returns {string[]}
 */
export function groupReasons(members, state) {
  return [...new Set(members.flatMap((member) => approvalRisk(member, state)?.reasons ?? []))];
}

/**
 * Whether a card's requests run in different folders: then each checkbox names its folder.
 * @param {Approval[]} members
 */
export function differentFolders(members) {
  return new Set(members.map((member) => member.cwd ?? '')).size > 1;
}
