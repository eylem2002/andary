// Demo mode: runs the built-in simulation and feeds its hook payloads to the store exactly as the
// server would (wrapped as envelopes). A PermissionRequest becomes a held approval that the HUD
// can answer; the simulation waits on it and continues with the decision, or after 25 seconds of
// story time without one (so the card's countdown runs faster at 2× and 4×, like the story, and
// stands still while the demo is paused).

/** @typedef {import('./types.js').Approval} Approval */

export const DEMO_APPROVAL_MS = 25_000;

/** Agent ids arrive as "agent-abc" or "abc"; the store keys agents without the prefix. @param {unknown} id */
export function normalizeAgentId(id) {
  return typeof id === 'string' && id ? id.replace(/^agent-/, '') : null;
}

/**
 * @typedef {object} DemoOptions
 * @property {{ ingest: (e: any) => any, setApproval: (a: Approval) => void }} store
 * @property {(options: { seed?: number, speed?: number, emit: (payload: any) => any }) => { start(): void, stop(): void, setSpeed(n: number): void, running: boolean }} createSimulation
 * @property {number} [seed]
 * @property {number} [speed]
 * @property {number} [approvalMs]
 * @property {() => number} [now]
 */

/** @param {DemoOptions} options */
export function createDemo({ store, createSimulation, seed, speed = 1, approvalMs = DEMO_APPROVAL_MS, now = Date.now }) {
  let sequence = 0;
  let currentSpeed = speed;
  let paused = false;
  /**
   * Requests waiting for an answer. `left` is set while the demo is paused: the time the request
   * still had when the story stopped.
   * @type {Map<string, { approval: Approval, resolve: (value: object) => void, timer: ReturnType<typeof setTimeout>|undefined, left?: number }>}
   */
  const waiting = new Map();

  /** @param {any} payload */
  function emit(payload) {
    const ts = now();
    const id = ++sequence;
    store.ingest({ id, ts, rx: ts, event: payload });
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
    };
    return new Promise((resolve) => {
      const entry = { approval, resolve, timer: undefined, left: paused ? wait : undefined };
      waiting.set(approval.id, entry);
      if (paused) store.setApproval({ ...approval, expiresAt: null });
      else {
        store.setApproval(approval);
        entry.timer = setTimeout(() => settle(approval.id, 'expired', 'timeout'), wait);
      }
    });
  }

  /**
   * Pausing the demo stops the countdown of every waiting request as well (WCAG 2.2.1): the card
   * hides its timer, and the request keeps the time it had left for when the story resumes.
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
   */
  function settle(id, status, decidedBy) {
    const entry = waiting.get(id);
    if (!entry) return false;
    waiting.delete(id);
    clearTimeout(entry.timer);
    store.setApproval({ ...entry.approval, status, decidedBy });
    entry.resolve(status === 'allowed' ? { decision: 'allow' } : status === 'denied' ? { decision: 'deny' } : {});
    return true;
  }

  const simulation = createSimulation({ seed, speed, emit });

  return {
    start: () => simulation.start(),
    /** @param {boolean} on */
    setPaused(on) {
      paused = on;
      if (on) {
        simulation.stop();
        freezeApprovals();
      } else {
        resumeApprovals();
        simulation.start();
      }
    },
    /** @param {number} value */
    setSpeed(value) {
      currentSpeed = value;
      simulation.setSpeed(value);
    },
    /**
     * @param {string} id
     * @param {'allow'|'deny'} decision
     */
    decide: (id, decision) => settle(id, decision === 'allow' ? 'allowed' : 'denied', 'town'),
    /** Stops the simulation and lets anything still waiting carry on. */
    dispose() {
      simulation.stop();
      for (const id of Array.from(waiting.keys())) settle(id, 'expired', 'timeout');
    },
  };
}
