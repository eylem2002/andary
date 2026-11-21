// What an agent waits for you on besides its open dialogs (core/dialogs.js: the requests,
// questions, plans and MCP forms): a finished turn nobody answered, or a turn that stopped on an
// error. The store asks after every event it applies and keeps the result on AgentState.wait;
// core/attention.js turns waits and dialogs into the "needs you" list. Pure.
//
// A wait starts when the agent stops for you and ends when it moves again (a prompt, a tool call,
// a new session, a helper finishing).
import { clip, oneLine, own, str } from './text.js';

/** @typedef {'finished'|'stopped'} WaitKind */

/**
 * @typedef {object} Wait
 * @property {WaitKind} kind
 * @property {number} since    when it started (the hook's time)
 * @property {string} text     one line: what it waits for
 * @property {number|null} idleAt  finished turns: when Claude Code said nobody answered (idle_prompt)
 * @property {string|null} cause   stopped turns: the hook's error code (rate_limit, overloaded…)
 */

/** How a stopped turn reads, by the StopFailure hook's error code (also the activity log's words). */
const STOP_LABELS = Object.freeze({
  rate_limit: 'Rate limited',
  overloaded: 'Servers overloaded',
  authentication_failed: 'Authentication failed',
  billing_error: 'Billing problem',
  server_error: 'Server error',
  max_output_tokens: 'Hit the output limit',
});

/** @param {unknown} error */
export function stopLabel(error) {
  return own(STOP_LABELS, error) ?? `Stopped (${String(error ?? 'error').replace(/_/g, ' ')})`;
}

/**
 * @param {WaitKind} kind @param {number} since @param {string} text @param {string|null} [cause]
 * @returns {Wait}
 */
function wait(kind, since, text, cause = null) {
  return { kind, since, text: clip(oneLine(text), 160), idleAt: null, cause };
}

/**
 * @typedef {object} WaitEvent  the parts of a TownEvent this module reads
 * @property {string} kind
 * @property {number} ts
 * @property {Record<string, any>} data
 */

/** Events after which the agent no longer waits for you, whatever it waited for. */
const MOVES_ON = new Set(['prompt', 'session.start', 'subagent.stop', 'tool.start']);

/**
 * @typedef {(agent: { role: string }, current: Wait|null, ts: number, data: Record<string, any>) => Wait|null|undefined} WaitRule
 */

/** @type {Readonly<Record<string, WaitRule>>} */
const RULES = Object.freeze({
  notify: afterNotice,
  'turn.stop': (agent, _current, ts, data) => (agent.role === 'lead' ? wait('finished', ts, finishedText(data.lastMessage)) : null),
  'turn.fail': (_agent, _current, ts, data) => wait('stopped', ts, stopLabel(data.error), str(data.error) || null),
  // A teammate going idle ends its own wait; one the store cannot place lands on the lead and
  // must not clear the lead's.
  'teammate.idle': (agent) => (agent.role === 'teammate' ? null : undefined),
  // You typed /compact: you are here.
  'compact.start': (_agent, _current, _ts, data) => (data.trigger === 'manual' ? null : undefined),
});

/**
 * The agent's wait after an event: a new Wait, null (no longer waiting), or undefined (unchanged).
 * @param {{ role: string, wait?: Wait|null }} agent
 * @param {WaitEvent} event
 * @returns {Wait|null|undefined}
 */
export function waitAfter(agent, event) {
  const current = agent.wait ?? null;
  if (MOVES_ON.has(event.kind)) return null;
  return own(RULES, event.kind)?.(agent, current, event.ts, event.data);
}

/**
 * @param {{ role: string }} agent
 * @param {Wait|null} current
 * @param {number} ts
 * @param {Record<string, any>} data
 * @returns {Wait|null|undefined}
 */
function afterNotice(agent, current, ts, data) {
  if (data.notificationType !== 'idle_prompt') return undefined;
  // Claude Code says nobody answered for a while: a finished turn now counts as waiting for you.
  if (current?.kind === 'finished') return current.idleAt === null ? { ...current, idleAt: ts } : undefined;
  if (current || agent.role !== 'lead') return undefined;
  return { ...wait('finished', ts, 'Waiting for your next prompt'), idleAt: ts };
}

/** @param {unknown} lastMessage */
function finishedText(lastMessage) {
  const said = oneLine(lastMessage);
  return said ? `Finished: ${said}` : 'Finished its turn';
}
