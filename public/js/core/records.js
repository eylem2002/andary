// Records for the leaderboard: the fastest fix (from failing tests to passing ones in the same
// crew), who made the most test runs go green, and, from the store's own counts, the busiest
// agents. Pure and fed with the store's events, so it is unit-tested.

/** @typedef {import('./events.js').TownEvent} TownEvent */

/**
 * @typedef {object} FixRecord
 * @property {string} sessionId
 * @property {string} agentKey  who ran the passing tests
 * @property {number} ms        from the first failing run to the passing one
 */

/** A failure older than this is not "being fixed" any more. */
const FIX_WINDOW_MS = 2 * 60 * 60_000;

export function createRecords() {
  /** @type {Map<string, number>} session → when its tests started failing */
  const redSince = new Map();
  /** @type {FixRecord|null} */
  let fastest = null;
  /** @type {Map<string, number>} agentKey → test runs it turned green */
  const greens = new Map();
  /** @type {Map<string, number>} agentKey → test runs */
  const testRuns = new Map();

  return {
    /** @param {TownEvent} e */
    observe(e) {
      if (e?.data?.commandKind !== 'test') return;
      const ts = Number(e.ts) || 0;
      if (e.kind === 'tool.fail') {
        if (e.data.isInterrupt) return;
        testRuns.set(e.agentKey, (testRuns.get(e.agentKey) ?? 0) + 1);
        if (!redSince.has(e.sessionId)) redSince.set(e.sessionId, ts);
        return;
      }
      if (e.kind !== 'tool.end') return;
      testRuns.set(e.agentKey, (testRuns.get(e.agentKey) ?? 0) + 1);
      const since = redSince.get(e.sessionId);
      if (since === undefined) return;
      redSince.delete(e.sessionId);
      const ms = ts - since;
      if (ms < 0 || ms > FIX_WINDOW_MS) return;
      greens.set(e.agentKey, (greens.get(e.agentKey) ?? 0) + 1);
      if (!fastest || ms < fastest.ms) fastest = { sessionId: e.sessionId, agentKey: e.agentKey, ms };
    },
    /** @returns {{ fastest: FixRecord|null, greens: [string, number][], testRuns: Map<string, number> }} */
    snapshot() {
      return { fastest, greens: [...greens].sort((a, b) => b[1] - a[1]), testRuns };
    },
  };
}

/**
 * Consecutive busy days up to today (or yesterday, so a streak is not lost before the day's
 * first work).
 * @param {string[]} days  YYYY-MM-DD, any order
 * @param {number} now
 */
export function streakOf(days, now) {
  const set = new Set(days);
  const date = (/** @type {number} */ back) => {
    const d = new Date(now);
    d.setDate(d.getDate() - back);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  let back = set.has(date(0)) ? 0 : 1;
  let streak = 0;
  while (set.has(date(back))) {
    streak += 1;
    back += 1;
  }
  return streak;
}

/**
 * The agents ranked by tool calls, then by files changed.
 * @template {{ key: string, name: string, sessionId: string, toolCounts: Record<string, number>, changes?: unknown[] }} A
 * @param {{ agents: Record<string, A> }} state
 * @param {number} [limit]
 */
export function busiestAgents(state, limit = 5) {
  return Object.values(state.agents)
    .map((agent) => ({ agent, calls: Object.values(agent.toolCounts ?? {}).reduce((a, b) => a + b, 0), changes: agent.changes?.length ?? 0 }))
    .filter((row) => row.calls > 0)
    .sort((a, b) => b.calls - a.calls || b.changes - a.changes || a.agent.name.localeCompare(b.agent.name))
    .slice(0, limit);
}
