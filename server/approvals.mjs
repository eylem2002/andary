// Approval broker: tracks PermissionRequest hooks and, when the town is allowed to answer them,
// holds the hook's HTTP response until a browser decides or the timeout passes.
//
// States: pending → allowed | denied (decided in the town), expired (timeout or overflow),
// resolved (answered in the terminal). A held approval that loses its hook (the forwarder was
// killed) or its audience (remote approvals switched off, every browser gone) is "released":
// it stays pending with held=false, the hook gets a null answer, and Claude Code shows its normal
// terminal prompt.
//
// What the terminal answered follows the one dialog model (core/dialogs.js): every request is a
// dialog in the broker's own tracker, fed through afterHook() like the phone notes and the town.
// When a dialog closes and its request is pending and not held, the terminal answered it.
import { randomUUID } from 'node:crypto';
import { afterHook, createDialogs } from '../public/js/core/dialogs.js';
import { normalizeAgentId } from '../public/js/core/ids.js';
import { callOf, hookStep } from './hook-steps.mjs';

export const DENY_MESSAGE = 'Denied from Andary';

/** Open dialogs the broker keeps; the oldest give way. */
const MAX_DIALOGS = 500;

/**
 * @typedef {'ran'|'denied'|'stopped'} Proof  how the terminal answered: the tool ran (or failed),
 *   it was denied, or the agent moved on without it (a prompt, the turn or the session ending)
 */

/**
 * @typedef {object} Approval
 * @property {string} id
 * @property {'pending'|'allowed'|'denied'|'expired'|'resolved'} status
 * @property {boolean} held           true while the hook's HTTP response waits for the town
 * @property {string} sessionId
 * @property {string|null} agentId    normalised (leading "agent-" removed), null for the main agent
 * @property {string} toolName
 * @property {unknown} toolInput      sanitized
 * @property {string|null} callKey    the request's call key (`andary_key`), so its dialog is found exactly
 * @property {string} cwd
 * @property {number} createdAt
 * @property {number|null} expiresAt  when a held approval times out; null when not held
 * @property {'town'|'terminal'|'timeout'} [decidedBy]
 * @property {Proof} [proof]          set when resolved: what showed the terminal answered
 * @property {string} [message]
 */

/**
 * @typedef {object} Entry
 * @property {Approval} approval
 * @property {((output: object|null) => void) | null} respond  answers the held hook (once)
 * @property {any} timer
 * @property {number} settledOrder  increases with every settlement (orders the history)
 */


/**
 * The hook output for a town decision (CONTRACTS §4.5).
 * @param {'allow'|'deny'} decision
 * @param {string} [note] optional reason typed in the town; shown to Claude on deny
 * @returns {{ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow'|'deny', message?: string } } }}
 */
export function decisionOutput(decision, note = '') {
  /** @type {{ behavior: 'allow'|'deny', message?: string }} */
  const verdict =
    decision === 'allow'
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: note ? `${DENY_MESSAGE}: ${note}` : DENY_MESSAGE };
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: verdict } };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * @param {Record<string, any>} event sanitized PermissionRequest payload
 * @param {boolean} hold
 * @param {number} createdAt
 * @param {number} timeoutMs
 * @returns {Approval}
 */
function newApproval(event, hold, createdAt, timeoutMs) {
  return {
    id: randomUUID(),
    status: 'pending',
    held: hold,
    sessionId: text(event.session_id),
    agentId: normalizeAgentId(event.agent_id),
    toolName: text(event.tool_name),
    toolInput: event.tool_input ?? null,
    callKey: typeof event.andary_key === 'string' ? event.andary_key : null,
    cwd: text(event.cwd),
    createdAt,
    expiresAt: hold ? createdAt + timeoutMs : null,
  };
}

/**
 * What the hook that closed a dialog proves about its request.
 * @param {string} hook
 * @returns {Proof}
 */
function proofOf(hook) {
  if (hook === 'PostToolUse' || hook === 'PostToolUseFailure') return 'ran';
  if (hook === 'PermissionDenied') return 'denied';
  return 'stopped';
}

/**
 * @typedef {object} BrokerOptions
 * @property {number} timeoutMs                    how long a held approval waits for the town
 * @property {number} [maxPending]                 the oldest pending approval expires past this
 * @property {number} [maxSettled]                 settled approvals kept for late-joining browsers
 * @property {(approval: Approval) => void} [onChange]  called with a copy on create and every change
 * @property {() => number} [now]
 * @property {{ set: (fn: () => void, ms: number) => any, clear: (handle: any) => void }} [timers]
 */

/**
 * @param {BrokerOptions} options
 */
export function createApprovalBroker({
  timeoutMs,
  maxPending = 50,
  maxSettled = 50,
  onChange = () => {},
  now = Date.now,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle) },
}) {
  /** @type {Map<string, Entry>} insertion order is creation order */
  const entries = new Map();
  /** Every request as a dialog, so the broker knows when the terminal answered it. */
  const dialogs = createDialogs({ max: MAX_DIALOGS });
  let settlements = 0;

  const publish = (/** @type {Entry} */ entry) => onChange({ ...entry.approval });
  const pending = () => [...entries.values()].filter((entry) => entry.approval.status === 'pending');

  /**
   * @param {Entry} entry
   * @param {Partial<Approval>} patch
   * @param {object|null} output
   */
  function settle(entry, patch, output) {
    stopTimer(entry);
    Object.assign(entry.approval, patch);
    settlements += 1;
    entry.settledOrder = settlements;
    answer(entry, output);
    pruneSettled();
    publish(entry);
  }

  /**
   * @param {Entry} entry
   * @param {object|null} output
   */
  function answer(entry, output) {
    const respond = entry.respond;
    entry.respond = null;
    respond?.(output);
  }

  /** @param {Entry} entry */
  function stopTimer(entry) {
    if (entry.timer) timers.clear(entry.timer);
    entry.timer = null;
  }

  function pruneSettled() {
    const settled = [...entries.values()].filter((entry) => entry.approval.status !== 'pending');
    settled.sort((a, b) => a.settledOrder - b.settledOrder);
    for (const entry of settled.slice(0, Math.max(0, settled.length - maxSettled))) {
      entries.delete(entry.approval.id);
    }
  }

  /**
   * Dialogs a hook closed: the terminal answered their requests, if pending and not held.
   * @param {import('../public/js/core/dialogs.js').Dialog[]} closed @param {string} hook
   * @returns {number} how many approvals were resolved
   */
  function answered(closed, hook) {
    let resolved = 0;
    for (const dialog of closed) {
      const entry = dialog.approvalId === null ? undefined : entries.get(dialog.approvalId);
      if (!entry || entry.approval.status !== 'pending' || entry.approval.held) continue;
      settle(entry, { status: 'resolved', decidedBy: 'terminal', proof: proofOf(hook) }, null);
      resolved += 1;
    }
    return resolved;
  }

  /** Keeps at most maxPending - 1 pending so a new one fits; the oldest give way. */
  function makeRoom() {
    const waiting = pending();
    for (const entry of waiting.slice(0, Math.max(0, waiting.length - maxPending + 1))) {
      settle(entry, { status: 'expired', decidedBy: 'timeout', message: 'Too many pending approvals' }, null);
    }
  }

  /**
   * Hands a held request to the terminal: it shows there now, so your next prompt answers it. (An
   * expired one is never resolved, so its dialog's hold does not matter here.)
   * @param {Entry} entry
   */
  function release(entry) {
    if (entry.approval.status !== 'pending' || !entry.approval.held) return;
    stopTimer(entry);
    entry.approval.held = false;
    entry.approval.expiresAt = null;
    dialogs.toTerminal(entry.approval.id);
    answer(entry, null);
    publish(entry);
  }

  return {
    /**
     * Registers a PermissionRequest. `response` resolves with the hook output: a decision object
     * if the town decides, otherwise null (immediately when not held).
     * @param {Record<string, any>} event sanitized PermissionRequest payload
     * @param {{ hold: boolean, message?: string }} options  message: why it was not held
     * @returns {{ approval: Approval, response: Promise<object|null> }}
     */
    create(event, { hold, message }) {
      makeRoom();
      const approval = newApproval(event, hold, now(), timeoutMs);
      if (message) approval.message = message;
      // Its dialog: a new one, or the open question or plan this request belongs to. A plan the
      // agent asks for again shows its older one was answered.
      const call = callOf(event);
      answered(dialogs.ask(call, approval.createdAt).closed, 'PermissionRequest');
      dialogs.link(call, approval.id, hold);
      /** @type {Entry} */
      const entry = { approval, respond: null, timer: null, settledOrder: 0 };
      const response = new Promise((resolve) => {
        entry.respond = resolve;
      });
      entries.set(approval.id, entry);
      if (hold) {
        entry.timer = timers.set(() => settle(entry, { status: 'expired', decidedBy: 'timeout' }, null), timeoutMs);
      } else {
        answer(entry, null);
      }
      publish(entry);
      return { approval: { ...approval }, response };
    },

    /**
     * A decision from a browser. Only held, pending approvals can be decided in the town.
     * @param {unknown} id
     * @param {unknown} decision
     * @param {unknown} [message]
     * @returns {{ ok: boolean, error?: string }}
     */
    decide(id, decision, message) {
      const entry = typeof id === 'string' ? entries.get(id) : undefined;
      if (!entry) return { ok: false, error: 'Unknown approval' };
      if (entry.approval.status !== 'pending') return { ok: false, error: `This request is already ${entry.approval.status}` };
      if (!entry.approval.held) return { ok: false, error: 'This request is waiting in the terminal; answer it there' };
      if (decision !== 'allow' && decision !== 'deny') return { ok: false, error: 'Decision must be "allow" or "deny"' };
      // Typed by the owner for the agent to read: one line, no control characters, 500 at most.
      // eslint-disable-next-line no-control-regex -- removing control characters is the point
      const note = typeof message === 'string' ? message.replace(/[\s\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, 500) : '';
      const status = decision === 'allow' ? 'allowed' : 'denied';
      settle(entry, { status, decidedBy: 'town', ...(note ? { message: note } : {}) }, decisionOutput(decision, note));
      dialogs.decided(entry.approval.id);
      return { ok: true };
    },

    /**
     * Follows a hook through the broker's dialogs (afterHook). A request whose dialog closes while
     * it is pending and not held was answered in the terminal: it is resolved, with what proved
     * it. A held one waits for the town; an expired or released one stays as it is.
     * @param {Record<string, any>} event  sanitized, with its call key
     * @returns {number} how many approvals were resolved
     */
    observe(event) {
      const step = hookStep(event, now());
      return answered(afterHook(dialogs, step).closed, step.hook);
    },

    /**
     * Hands a held approval back to the terminal (its hook went away).
     * @param {string} id
     */
    release(id) {
      const entry = entries.get(id);
      if (entry) release(entry);
    },

    /** Hands every held approval back to the terminal (remote approvals off, no browsers, shutdown). */
    releaseAll() {
      for (const entry of pending()) release(entry);
    },

    /** @returns {number} */
    heldCount() {
      return pending().filter(({ approval }) => approval.held).length;
    },

    /**
     * Pending approvals (oldest first), then settled ones (most recent first).
     * @returns {Approval[]}
     */
    list() {
      const all = [...entries.values()];
      const waiting = all.filter((entry) => entry.approval.status === 'pending');
      const settled = all.filter((entry) => entry.approval.status !== 'pending').sort((a, b) => b.settledOrder - a.settledOrder);
      return [...waiting, ...settled].map((entry) => ({ ...entry.approval }));
    },
  };
}

/** @typedef {ReturnType<typeof createApprovalBroker>} ApprovalBroker */
