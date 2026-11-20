// Demo mode: runs the built-in simulation and feeds its hook payloads to the store exactly as the
// server would (wrapped as envelopes). A PermissionRequest becomes a held approval that the HUD
// can answer; the simulation waits on it and continues with the decision, or after 25 seconds of
// story time without one (so the card's countdown runs faster at 2× and 4×, like the story).

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
  /** @type {Map<string, { approval: Approval, resolve: (value: object) => void, timer: ReturnType<typeof setTimeout> }>} */
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
    store.setApproval(approval);
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(approval.id, 'expired', 'timeout'), wait);
      waiting.set(approval.id, { approval, resolve, timer });
    });
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
    /** @param {boolean} paused */
    setPaused(paused) {
      if (paused) simulation.stop();
      else simulation.start();
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
