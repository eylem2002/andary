// What each agent is waiting for you on, and since when (docs/design/agent-health.md §3). The store
// asks after every event it applies, and after every approval change; core/attention.js turns the
// waits into the "needs you" list. Pure: the store keeps the result on AgentState.wait.
//
// A wait starts when the agent stops for you (a permission request, a question, a plan to approve,
// a finished or failed turn) and ends when it moves again (a prompt, a tool call, an answer).
import { clip, isObject, oneLine, own, str } from './text.js';

/** @typedef {'approval'|'question'|'plan'|'finished'|'stopped'} WaitKind */

/**
 * @typedef {object} Wait
 * @property {WaitKind} kind
 * @property {number} since    when it started (the hook's time)
 * @property {string} text     one line: what it waits for
 * @property {number|null} idleAt  finished turns: when Claude Code said nobody answered (idle_prompt)
 */

/** Tools that stop the agent until you answer in the terminal. */
const INTERACTIVE_TOOLS = Object.freeze({ AskUserQuestion: 'question', ExitPlanMode: 'plan' });
/** Notifications that mean the agent asks you something. */
const QUESTION_NOTICES = new Set(['agent_needs_input', 'elicitation_dialog', 'elicitation_url_dialog']);
/** Kinds an answer or the agent moving on ends. */
const ANSWERABLE = new Set(['approval', 'question', 'plan']);
const STOP_WORDS = Object.freeze({
  rate_limit: 'Rate limited',
  overloaded: 'Servers overloaded',
  authentication_failed: 'Signed out',
  billing_error: 'Billing problem',
  server_error: 'Server error',
  max_output_tokens: 'Hit the output limit',
});

/**
 * @param {WaitKind} kind @param {number} since @param {string} text
 * @returns {Wait}
 */
function wait(kind, since, text) {
  return { kind, since, text: clip(oneLine(text), 160), idleAt: null };
}

/** The first question of an AskUserQuestion call, read defensively. @param {unknown} input */
function questionOf(input) {
  const first = isObject(input) && Array.isArray(input.questions) ? input.questions[0] : null;
  const text = isObject(first) ? str(first.question) : '';
  return text ? `Asks: ${text}` : 'Asks you a question';
}

/**
 * @typedef {object} WaitEvent  the parts of a TownEvent this module reads
 * @property {string} kind
 * @property {number} ts
 * @property {Record<string, any>} data
 */

/** Events after which the agent no longer waits for you, whatever it waited for. */
const MOVES_ON = new Set(['prompt', 'session.start', 'subagent.stop', 'teammate.idle']);
/** Events that answer a permission request, a question or a plan (the tool ran or was refused). */
const ANSWERS = new Set(['tool.end', 'tool.fail', 'permission.denied']);

/**
 * @typedef {(agent: { role: string }, current: Wait|null, ts: number, data: Record<string, any>) => Wait|null|undefined} WaitRule
 */

/** @type {Readonly<Record<string, WaitRule>>} */
const RULES = Object.freeze({
  'tool.start': (_agent, _current, ts, data) => {
    const interactive = own(INTERACTIVE_TOOLS, data.tool);
    if (!interactive) return null;
    return wait(interactive, ts, interactive === 'question' ? questionOf(data.input) : 'Waits for you to approve its plan');
  },
  'permission.request': (_agent, _current, ts, data) => wait('approval', ts, `Needs permission: ${str(data.summary) || str(data.tool) || 'a tool'}`),
  notify: afterNotice,
  'turn.stop': (agent, _current, ts, data) => (agent.role === 'lead' ? wait('finished', ts, finishedText(data.lastMessage)) : null),
  'turn.fail': (_agent, _current, ts, data) => wait('stopped', ts, own(STOP_WORDS, data.error) ?? `Stopped (${String(data.error ?? 'error').replace(/_/g, ' ')})`),
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
  if (ANSWERS.has(event.kind)) return current && ANSWERABLE.has(current.kind) ? null : undefined;
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
  const type = data.notificationType;
  const message = str(data.message);
  if (type === 'permission_prompt') return current?.kind === 'approval' ? undefined : wait('approval', ts, message || 'Needs your permission');
  if (QUESTION_NOTICES.has(type)) return wait('question', ts, message || 'Needs your input');
  if (type !== 'idle_prompt') return undefined;
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

/**
 * The agent's wait after its permission request changed (from the server or the demo). An answer
 * in the town ends it; a request handed back to the terminal (expired, released) keeps it, since
 * the agent still waits there.
 * @param {{ wait?: Wait|null }} agent
 * @param {{ status: string, createdAt?: number }} approval
 * @param {string} text  what the request is about
 * @returns {Wait|null|undefined}
 */
export function waitAfterApproval(agent, approval, text) {
  const current = agent.wait ?? null;
  if (approval.status === 'pending') {
    return current?.kind === 'approval' ? undefined : wait('approval', Number(approval.createdAt) || 0, `Needs permission: ${text}`);
  }
  if (approval.status === 'allowed' || approval.status === 'denied' || approval.status === 'resolved') {
    return current?.kind === 'approval' ? null : undefined;
  }
  return undefined;
}
