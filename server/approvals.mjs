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
// dialog in the broker's own tracker, fed through afterHook() like the phone notes and the town,
// at each hook's own time. When a dialog closes and its request is pending and not held, the
// terminal answered it; a held one closed meanwhile (its turn or session ended) is resolved when
// released; one that expired and then ran or was denied was answered there too.
//
// An approval may offer to save one of the permission rules Claude Code suggested ("Allow
// always"). Browsers see the offer; the suggestion itself, exactly as it arrived, stays here and
// is what an allow saves, so a browser can only choose among the request's own suggestions.
import { randomUUID } from 'node:crypto';
import { afterHook, createDialogs } from '../public/js/core/dialogs.js';
import { normalizeAgentId } from '../public/js/core/ids.js';
import { offerableSuggestions } from '../public/js/core/permission-rules.js';
import { callOf, hookStep, hookTime } from './hook-steps.mjs';

export const DENY_MESSAGE = 'Denied from Andary';

/** Open dialogs the broker keeps; the oldest give way. */
const MAX_DIALOGS = 500;

/**
 * @typedef {'ran'|'denied'|'stopped'} Proof  how the terminal answered: the tool ran (or failed),
 *   it was denied, or the agent moved on without it (a prompt, the turn or the session ending)
 */

/**
 * @typedef {import('../public/js/core/permission-rules.js').OfferedSuggestion} OfferedSuggestion
 * @typedef {import('../public/js/core/permission-rules.js').PermissionRule} PermissionRule
 */

/**
 * A suggestion the town offers to save, with the suggestion exactly as Claude Code sent it
 * (`saved`), which never leaves the server.
 * @typedef {OfferedSuggestion & { saved: object }} Offer
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
 * @property {'claude'|'codex'} source  the agent that asked (a Codex card says what Allow may grant)
 * @property {string} cwd
 * @property {number} createdAt
 * @property {number|null} expiresAt  when a held approval times out; null when not held
 * @property {OfferedSuggestion[]} suggestions  rules an allow may save ("Allow always"); [] for none
 * @property {boolean} canStop        a deny from the town may also stop the agent ("Deny and stop")
 * @property {string} [stopNote]      why it may not, when it may not (Codex, an older forwarder)
 * @property {boolean} [stopped]      denied from the town with a stop
 * @property {'town'|'terminal'|'timeout'} [decidedBy]
 * @property {Proof} [proof]          set when resolved: what showed the terminal answered; on an
 *   expired one, 'ran' or 'denied' when it was answered in the terminal after it expired
 * @property {string} [message]
 * @property {{ rules: PermissionRule[], destination: string, at: number }} [always]  the rule an "Allow always" asked Claude Code to save, and when
 */

/**
 * @typedef {object} Entry
 * @property {Approval} approval
 * @property {((output: object|null) => void) | null} respond  answers the held hook (once)
 * @property {any} timer
 * @property {number} settledOrder  increases with every settlement (orders the history)
 * @property {Proof} [gone]  its dialog closed while the town held it: what the terminal shows once released
 * @property {Map<number, Offer>} offers  by their place in the request's permission_suggestions
 */


/**
 * The hook output for a town decision (CONTRACTS §4.5). An allow may save one permission rule:
 * `saved`, one of the request's own suggestions, exactly as Claude Code sent it. A deny may also
 * stop the agent (`interrupt`, "Deny and stop").
 * @param {'allow'|'deny'} decision
 * @param {string} [note] optional reason typed in the town; shown to Claude on deny
 * @param {object|null} [saved] the suggestion an "Allow always" saves; ignored for a denial
 * @param {boolean} [stop] with a denial: stop the agent too
 * @returns {{ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow'|'deny', message?: string, updatedPermissions?: object[], interrupt?: true } } }}
 */
export function decisionOutput(decision, note = '', saved = null, stop = false) {
  /** @type {{ behavior: 'allow'|'deny', message?: string, updatedPermissions?: object[], interrupt?: true }} */
  const verdict =
    decision === 'allow'
      ? { behavior: 'allow', ...(saved ? { updatedPermissions: [saved] } : {}) }
      : { behavior: 'deny', message: note ? `${DENY_MESSAGE}: ${note}` : DENY_MESSAGE, ...(stop ? { interrupt: true } : {}) };
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: verdict } };
}

/**
 * Which of a permission request's suggestions the town offers to save with an allow (CONTRACTS
 * §4.5): those of a kind it offers (core/permission-rules.js) that sanitizing left exactly as
 * Claude Code sent them, as routes.mjs checks the tool input, so the card shows the very rule an
 * allow would save. Codex sends no suggestions, so a Codex request offers none.
 * @param {Record<string, any>} raw        the request as the forwarder sent it
 * @param {Record<string, any>} sanitized  the same request after sanitizing (what browsers see)
 * @returns {Offer[]}
 */
export function offeredSuggestions(raw, sanitized) {
  if (sanitized.andary_source === 'codex') return [];
  const sent = raw.permission_suggestions;
  const shown = Array.isArray(sanitized.permission_suggestions) ? sanitized.permission_suggestions : [];
  return offerableSuggestions(sent)
    .filter(({ index }) => JSON.stringify(sent[index]) === JSON.stringify(shown[index]))
    .map((offer) => ({ ...offer, saved: sent[offer.index] }));
}

/** @param {PermissionRule[]} rules */
function copyRules(rules) {
  return rules.map((rule) => ({ ...rule }));
}

/**
 * What a town decision changes on its approval: the answer, the note typed with it, the rule an
 * "Allow always" asked Claude Code to save, with when, and whether a denial stopped the agent.
 * @param {'allow'|'deny'} decision
 * @param {string} note
 * @param {Offer|undefined} offer  the suggestion an "Allow always" chose
 * @param {number} at
 * @param {boolean} stop
 * @returns {Partial<Approval>}
 */
function townPatch(decision, note, offer, at, stop) {
  /** @type {Partial<Approval>} */
  const patch = { status: decision === 'allow' ? 'allowed' : 'denied', decidedBy: 'town' };
  if (note) patch.message = note;
  if (stop) patch.stopped = true;
  if (offer) patch.always = { rules: copyRules(offer.rules), destination: offer.destination, at };
  return patch;
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
 * @param {{ offers: Offer[], canStop: boolean, stopNote?: string }} extras  the rules an allow may
 *   save, and whether "Deny and stop" can stop the agent (if not, why)
 * @returns {Approval}
 */
function newApproval(event, hold, createdAt, timeoutMs, { offers, canStop, stopNote }) {
  return {
    id: randomUUID(),
    status: 'pending',
    held: hold,
    sessionId: text(event.session_id),
    agentId: normalizeAgentId(event.agent_id),
    toolName: text(event.tool_name),
    toolInput: event.tool_input ?? null,
    callKey: typeof event.andary_key === 'string' ? event.andary_key : null,
    source: event.andary_source === 'codex' ? 'codex' : 'claude',
    cwd: text(event.cwd),
    createdAt,
    expiresAt: hold ? createdAt + timeoutMs : null,
    // The offers without the suggestions themselves, which stay on the server.
    suggestions: offers.map(({ index, rules, destination }) => ({ index, rules: copyRules(rules), destination })),
    canStop,
    ...(stopNote ? { stopNote } : {}),
  };
}

/**
 * Keeps the `maxSettled` most recently settled approvals; older ones are forgotten.
 * @param {Map<string, Entry>} entries @param {number} maxSettled
 */
function pruneSettled(entries, maxSettled) {
  const settled = [...entries.values()].filter((entry) => entry.approval.status !== 'pending');
  settled.sort((a, b) => a.settledOrder - b.settledOrder);
  for (const entry of settled.slice(0, Math.max(0, settled.length - maxSettled))) {
    entries.delete(entry.approval.id);
  }
}

/**
 * A pending approval's entry, and the hook's answer to come.
 * @param {Approval} approval
 * @param {Offer[]} offers  the rules an allow may save
 * @returns {{ entry: Entry, response: Promise<object|null> }}
 */
function newEntry(approval, offers) {
  /** @type {Entry} */
  const entry = { approval, respond: null, timer: null, settledOrder: 0, offers: new Map(offers.map((offer) => [offer.index, offer])) };
  const response = new Promise((resolve) => {
    entry.respond = resolve;
  });
  return { entry, response };
}

/**
 * A reason typed by the owner for the agent to read: one line, no control characters, 500 at most.
 * @param {unknown} message
 * @returns {string}
 */
function denyNote(message) {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  return typeof message === 'string' ? message.replace(/[\s\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, 500) : '';
}

/**
 * Why a decision's `stop` is refused, or '' when it is not: a stop goes with a deny only, as
 * `true`, and only to an agent that can be stopped (Approval.canStop).
 * @param {Approval} approval @param {unknown} decision @param {unknown} stop
 */
function stopRefusal(approval, decision, stop) {
  if (stop === undefined) return '';
  if (stop !== true || decision !== 'deny') return 'Deny and stop needs a deny and stop: true';
  return approval.canStop ? '' : (approval.stopNote ?? 'This agent cannot be stopped from the town');
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
 * A request that expired in the town, then ran or was denied: it was answered in the terminal
 * after all. Marks it with that proof, once; true when it did.
 * @param {Approval} approval @param {Proof} proof
 */
function answeredLate(approval, proof) {
  if (approval.status !== 'expired' || proof === 'stopped' || approval.proof) return false;
  approval.proof = proof;
  return true;
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
    pruneSettled(entries, maxSettled);
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

  /**
   * Dialogs a hook closed: the terminal answered their requests, if pending and not held. A held
   * one keeps waiting for the town, remembering what closed its dialog for when it is released.
   * One that expired in the town and then ran or was denied was answered there too: it stays
   * expired, with that proof.
   * @param {import('../public/js/core/dialogs.js').Dialog[]} closed @param {string} hook
   * @returns {number} how many approvals were resolved
   */
  function answered(closed, hook) {
    let resolved = 0;
    const proof = proofOf(hook);
    for (const dialog of closed) {
      const entry = dialog.approvalId === null ? undefined : entries.get(dialog.approvalId);
      if (entry && answeredLate(entry.approval, proof)) publish(entry);
      if (!entry || entry.approval.status !== 'pending') continue;
      if (entry.approval.held) {
        entry.gone = proof;
        continue;
      }
      settle(entry, { status: 'resolved', decidedBy: 'terminal', proof }, null);
      resolved += 1;
    }
    return resolved;
  }

  /**
   * No answer from the town in time (or too many waiting): the terminal asks now, so your next
   * prompt answers its dialog, which no later call of the same tool may then take for its own.
   * @param {Entry} entry @param {string} [message]
   */
  function expire(entry, message) {
    dialogs.toTerminal(entry.approval.id);
    settle(entry, { status: 'expired', decidedBy: 'timeout', ...(message ? { message } : {}) }, null);
  }

  /** Keeps at most maxPending - 1 pending so a new one fits; the oldest give way. */
  function makeRoom() {
    const waiting = pending();
    for (const entry of waiting.slice(0, Math.max(0, waiting.length - maxPending + 1))) expire(entry, 'Too many pending approvals');
  }

  /**
   * Hands a held request to the terminal: it shows there now, so your next prompt answers it. One
   * whose dialog closed while it was held (its turn or session ended) was answered already.
   * @param {Entry} entry
   */
  function release(entry) {
    if (entry.approval.status !== 'pending' || !entry.approval.held) return;
    stopTimer(entry);
    entry.approval.held = false;
    entry.approval.expiresAt = null;
    dialogs.toTerminal(entry.approval.id);
    answer(entry, null);
    if (entry.gone) settle(entry, { status: 'resolved', decidedBy: 'terminal', proof: entry.gone }, null);
    else publish(entry);
  }

  return {
    /**
     * Registers a PermissionRequest. `response` resolves with the hook output: a decision object
     * if the town decides, otherwise null (immediately when not held).
     * @param {Record<string, any>} event sanitized PermissionRequest payload
     * @param {{ hold: boolean, message?: string, at?: number, offers?: Offer[], canStop?: boolean, stopNote?: string }} options
     *   message: why it was not held; at: when the agent sent it (the forwarder's time); offers:
     *   the rules an allow may save (offeredSuggestions); canStop: a deny may stop the agent too,
     *   or stopNote says why not
     * @returns {{ approval: Approval, response: Promise<object|null> }}
     */
    create(event, { hold, message, at, offers = [], canStop = false, stopNote }) {
      makeRoom();
      const approval = newApproval(event, hold, now(), timeoutMs, { offers, canStop, stopNote });
      if (message) approval.message = message;
      // Its dialog: a new one, or the open question or plan this request belongs to. A plan the
      // agent asks for again shows its older one was answered.
      const call = callOf(event);
      answered(dialogs.ask(call, hookTime(at, approval.createdAt)).closed, 'PermissionRequest');
      dialogs.link(call, approval.id, hold);
      const { entry, response } = newEntry(approval, offers);
      entries.set(approval.id, entry);
      if (hold) {
        entry.timer = timers.set(() => expire(entry), timeoutMs);
      } else {
        answer(entry, null);
      }
      publish(entry);
      return { approval: { ...approval }, response };
    },

    /**
     * A decision from a browser. Only held, pending approvals can be decided in the town.
     * `always` asks an allow to save one of the request's own suggestions ("Allow always"):
     * anything but an allow with the place of an offered suggestion is refused, and nothing
     * changes. `stop` asks a deny to stop the agent too ("Deny and stop"): refused with anything
     * but a deny, and for an approval that cannot stop its agent (canStop false).
     * @param {unknown} id
     * @param {unknown} decision
     * @param {unknown} [message]
     * @param {unknown} [always]  the `index` of one of the approval's suggestions
     * @param {unknown} [stop]    true: a deny that stops the agent
     * @returns {{ ok: boolean, error?: string }}
     */
    decide(id, decision, message, always, stop) {
      const entry = typeof id === 'string' ? entries.get(id) : undefined;
      if (!entry) return { ok: false, error: 'Unknown approval' };
      if (entry.approval.status !== 'pending') return { ok: false, error: `This request is already ${entry.approval.status}` };
      if (!entry.approval.held) return { ok: false, error: 'This request is waiting in the terminal; answer it there' };
      if (decision !== 'allow' && decision !== 'deny') return { ok: false, error: 'Decision must be "allow" or "deny"' };
      const offer = decision === 'allow' && typeof always === 'number' ? entry.offers.get(always) : undefined;
      if (always !== undefined && !offer) return { ok: false, error: 'Allow always needs an allow and one of the rules this request offers' };
      const refused = stopRefusal(entry.approval, decision, stop);
      if (refused) return { ok: false, error: refused };
      const note = denyNote(message);
      settle(entry, townPatch(decision, note, offer, now(), stop === true), decisionOutput(decision, note, offer?.saved ?? null, stop === true));
      dialogs.decided(entry.approval.id);
      return { ok: true };
    },

    /**
     * Follows a hook through the broker's dialogs (afterHook), at its own time. A request whose
     * dialog closes while it is pending and not held (never held, or released) was answered in
     * the terminal: it is resolved, with what proved it. A held one waits for the town, and is
     * resolved if released after its dialog closed; an expired one stays expired (with `proof`
     * when it ran or was denied after all).
     * @param {Record<string, any>} event  sanitized, with its call key
     * @param {number} [ts]  when the agent sent it (the forwarder's time)
     * @returns {number} how many approvals were resolved
     */
    observe(event, ts) {
      const step = hookStep(event, hookTime(ts, now()));
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
