// The demo event source (sources/types.js): runs the built-in simulation and feeds its hook
// payloads to the store exactly as the server would (wrapped as envelopes). A PermissionRequest becomes a held approval that the HUD
// can answer; the simulation waits on it and continues with the decision, or after 25 seconds of
// story time without one (so the card's countdown runs faster at 2× and 4×, like the story, and
// stands still while the demo is paused, and while a card waiting for you shows in the Approvals
// panel, so a first-time visitor has time to read one). Like the server, an approval offers the permission
// rules the server would offer, and "Allow always" hands the chosen one back with the allow. It
// also plays the server's part for "Catch me up": the same counts (core/digest.js) of the story's
// crews, though nobody is ever away in a demo.

import { createDigest } from '../core/digest.js';
import { normalizeAgentId } from '../core/ids.js';
import { offerableSuggestions } from '../core/permission-rules.js';
import { createDemoUsage } from './demo-usage.js';
import { createDemoProgress } from './demo-progress.js';

/** @typedef {import('../core/store.js').Approval} Approval */
/** @typedef {import('../core/permission-rules.js').OfferedSuggestion} OfferedSuggestion */

/**
 * What the simulation hears back, shaped like a hook's decision: an allow that saves a rule
 * carries it as updatedPermissions, so the simulated session stops asking for it.
 * @param {'allowed'|'denied'|'expired'} status
 * @param {unknown} saved  the suggestion an "Allow always" saved, as the session sent it
 */
function answerFor(status, saved) {
  if (status === 'denied') return { decision: 'deny' };
  if (status !== 'allowed') return {};
  return saved ? { decision: 'allow', updatedPermissions: [saved] } : { decision: 'allow' };
}

export const DEMO_APPROVAL_MS = 25_000;

/**
 * @typedef {object} DemoOptions
 * @property {{ ingest: (e: any) => any, setApproval: (a: Approval) => void, setUsage?: (u: unknown, days?: unknown) => void }} store
 * @property {(options: { seed?: number, speed?: number, emit: (payload: any) => any }) => { start(): void, stop(): void, setSpeed(n: number): void, running: boolean }} createSimulation
 * @property {number} [seed]
 * @property {number} [speed]
 * @property {number} [approvalMs]
 * @property {() => number} [now]
 * @property {(progress: { points: number, days: string[] }) => void} [onProgress]  the town's growth
 * @property {(digest: import('../core/digest.js').Digest) => void} [onDigest]  the answer to requestDigest()
 */

/** @param {DemoOptions} options */
export function createDemo({ store, createSimulation, seed, speed = 1, approvalMs = DEMO_APPROVAL_MS, now = Date.now, onProgress, onDigest = () => {} }) {
  let sequence = 0;
  let currentSpeed = speed;
  let paused = false;
  /** A card waiting for an answer shows in the Approvals panel: countdowns hold, the story goes on. */
  let viewing = false;
  const frozen = () => paused || viewing;
  /**
   * Requests waiting for an answer, with the payload that asked. `left` is set while the demo is
   * paused: the time the request still had when the story stopped.
   * @type {Map<string, { approval: Approval, payload: any, resolve: (value: object) => void, timer: ReturnType<typeof setTimeout>|undefined, left?: number }>}
   */
  const waiting = new Map();
  const usage = createDemoUsage(store, now);
  const progress = onProgress ? createDemoProgress(onProgress, now) : () => {};
  const digest = createDigest({ startedAt: now() });

  /** @param {any} payload */
  function emit(payload) {
    const ts = now();
    const id = ++sequence;
    store.ingest({ id, ts, rx: ts, event: payload });
    usage(payload);
    progress(payload);
    digest.observe(payload, ts);
    if (payload?.hook_event_name === 'PermissionRequest') return hold(payload, id, ts);
    return undefined;
  }

  /** @param {any} payload @param {number} id @param {number} ts */
  function hold(payload, id, ts) {
    const wait = Math.round(approvalMs / currentSpeed);
    /** @type {Approval} */
    const approval = {
      id: `demo-${id}`,
      status: 'pending',
      held: true,
      sessionId: payload.session_id,
      agentId: normalizeAgentId(payload.agent_id),
      toolName: payload.tool_name,
      toolInput: payload.tool_input,
      cwd: payload.cwd,
      createdAt: ts,
      expiresAt: ts + wait,
      // What the server would offer: the story's own suggestions are never changed by sanitizing.
      suggestions: offerableSuggestions(payload.permission_suggestions),
    };
    return new Promise((resolve) => {
      const entry = { approval, payload, resolve, timer: undefined, left: frozen() ? wait : undefined };
      waiting.set(approval.id, entry);
      if (frozen()) store.setApproval({ ...approval, expiresAt: null });
      else {
        store.setApproval(approval);
        entry.timer = setTimeout(() => settle(approval.id, 'expired', 'timeout'), wait);
      }
    });
  }

  /**
   * Pausing the demo stops the countdown of every waiting request as well (WCAG 2.2.1), and so
   * does a card showing in the Approvals panel: the card hides its timer, and the request keeps
   * the time it had left for when the story resumes or the card is out of sight.
   */
  function freezeApprovals() {
    for (const entry of waiting.values()) {
      if (entry.left !== undefined) continue;
      clearTimeout(entry.timer);
      entry.left = Math.max(0, entry.approval.expiresAt - now());
      store.setApproval({ ...entry.approval, expiresAt: null });
    }
  }

  /** Restarts each countdown with the time it had left, moved forward by the pause. */
  function resumeApprovals() {
    for (const [id, entry] of waiting) {
      if (entry.left === undefined) continue;
      const shift = now() + entry.left - entry.approval.expiresAt;
      entry.approval = { ...entry.approval, createdAt: entry.approval.createdAt + shift, expiresAt: entry.approval.expiresAt + shift };
      store.setApproval(entry.approval);
      entry.timer = setTimeout(() => settle(id, 'expired', 'timeout'), entry.left);
      entry.left = undefined;
    }
  }

  /**
   * @param {string} id
   * @param {'allowed'|'denied'|'expired'} status
   * @param {'town'|'timeout'} decidedBy
   * @param {string} [message] why, for a denial
   * @param {OfferedSuggestion} [offer] the rule an "Allow always" saves
   */
  function settle(id, status, decidedBy, message = '', offer = undefined) {
    const entry = waiting.get(id);
    if (!entry) return false;
    waiting.delete(id);
    clearTimeout(entry.timer);
    const note = String(message).trim().slice(0, 500);
    const always = offer ? { always: { rules: offer.rules, destination: offer.destination, at: now() } } : {};
    const settled = { ...entry.approval, status, decidedBy, ...(note ? { message: note } : {}), ...always };
    store.setApproval(settled);
    digest.answered(settled, now());
    entry.resolve(answerFor(status, offer ? entry.payload.permission_suggestions[offer.index] : null));
    return true;
  }

  const simulation = createSimulation({ seed, speed, emit });

  /** @type {import('./types.js').TownSource & { start(): void }} */
  const source = {
    mode: 'demo',
    start: () => simulation.start(),
    /** @param {boolean} on */
    setPaused(on) {
      paused = on;
      if (on) {
        simulation.stop();
        freezeApprovals();
      } else {
        if (!viewing) resumeApprovals();
        simulation.start();
      }
    },
    /**
     * A card waiting for an answer shows in the Approvals panel (true) or no longer does: the
     * countdowns hold while it shows; the story itself goes on.
     * @param {boolean} on
     */
    holdApprovals(on) {
      if (viewing === on) return;
      viewing = on;
      if (on) freezeApprovals();
      else if (!paused) resumeApprovals();
    },
    /** @param {number} value */
    setSpeed(value) {
      currentSpeed = value;
      simulation.setSpeed(value);
    },
    /**
     * Like the server: "Allow always" (`always`, the index of a suggestion the approval offers)
     * goes with an allow only; anything else changes nothing.
     * @param {string} id
     * @param {'allow'|'deny'} decision
     * @param {string} [message]
     * @param {number} [always]
     */
    decide(id, decision, message, always) {
      if (always === undefined) return settle(id, decision === 'allow' ? 'allowed' : 'denied', 'town', decision === 'deny' ? message : '');
      const offer = waiting.get(id)?.approval.suggestions?.find((suggestion) => suggestion.index === always);
      return decision === 'allow' && offer ? settle(id, 'allowed', 'town', '', offer) : false;
    },
    /**
     * What each of the story's crews did since a time, answered a moment later as the server would.
     * @param {number} since
     */
    requestDigest(since) {
      queueMicrotask(() => onDigest(digest.summary(since, now())));
      return true;
    },
    /** Stops the simulation and lets anything still waiting carry on. */
    close() {
      simulation.stop();
      for (const id of Array.from(waiting.keys())) settle(id, 'expired', 'timeout');
    },
  };
  return source;
}
