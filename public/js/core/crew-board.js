// The crews board's order and folding (ui/crews.js): crews at work first, the one that needs you
// most at the top, then the working, then the idle; ended crews in a group of their own, newest
// first; a crew's helpers that finished a while ago fold into one "+3 finished" line. Pure, no DOM.

/** @typedef {import('./store.js').Session} Session */
/** @typedef {import('./store.js').AgentState} AgentState */
/** @typedef {import('./attention.js').AttentionLevel} AttentionLevel */

/** A helper that finished this long ago folds away (its crew's "+n finished" brings it back). */
export const FOLD_FINISHED_MS = 60_000;

/** Lower comes first. What needs you, by how urgent; then a crew at work; then an idle one. */
const RANK = Object.freeze({ blocked: 0, stopped: 1, alert: 2, ready: 3, waiting: 0, working: 4, idle: 5 });

/**
 * Where a crew at work goes on the board: by the most urgent thing it needs you for, else by
 * what it is doing. A crew waiting on a permission ranks with a blocked one.
 * @param {Session} session
 * @param {AttentionLevel|undefined} need  its most urgent counted "needs you" level
 */
export function crewRank(session, need) {
  const byStatus = RANK[/** @type {keyof typeof RANK} */ (session.status)] ?? RANK.idle;
  return need ? Math.min(RANK[need], byStatus) : byStatus;
}

/**
 * The board's two groups. Crews at work by rank, then by number (so equals keep a steady
 * order); ended crews newest first.
 * @param {Session[]} sessions
 * @param {ReadonlyMap<string, AttentionLevel>} needs  session id → its most urgent level
 * @returns {{ live: Session[], ended: Session[] }}
 */
export function arrangeCrews(sessions, needs) {
  const live = sessions.filter((s) => s.status !== 'ended');
  const ended = sessions.filter((s) => s.status === 'ended');
  const rank = new Map(live.map((s) => [s.id, crewRank(s, needs.get(s.id))]));
  live.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0) || a.number - b.number);
  ended.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  return { live, ended };
}

/**
 * Keeps an order the viewer is reading: the crews of `held` stay where they were, newcomers
 * join at the end in `wanted` order, and crews gone from `wanted` drop out.
 * @param {Session[]} wanted  the order the board would show now
 * @param {string[]} held     session ids in the order on screen
 * @returns {Session[]}
 */
export function holdOrder(wanted, held) {
  const byId = new Map(wanted.map((s) => [s.id, s]));
  const kept = held.map((id) => byId.get(id)).filter((s) => s !== undefined);
  const seen = new Set(held);
  return [...kept, ...wanted.filter((s) => !seen.has(s.id))];
}

/**
 * A crew's agents split into those shown and the finished helpers folded away: a helper that
 * finished more than FOLD_FINISHED_MS ago. The lead is always shown, finished or not.
 * @param {AgentState[]} agents  in the crew's order
 * @param {number} now
 * @returns {{ shown: AgentState[], folded: AgentState[] }}
 */
export function foldFinished(agents, now) {
  /** @type {AgentState[]} */
  const shown = [];
  /** @type {AgentState[]} */
  const folded = [];
  for (const agent of agents) {
    const old = agent.role !== 'lead' && agent.status === 'done' && now - agent.lastActivity >= FOLD_FINISHED_MS;
    (old ? folded : shown).push(agent);
  }
  return { shown, folded };
}

/**
 * The number a crew shows (its key, 1–9): an ended crew shows none, since a crew at work may
 * hold its number now.
 * @param {Session|undefined|null} session
 */
export function shownNumber(session) {
  return session && session.status !== 'ended' ? session.number : 0;
}
