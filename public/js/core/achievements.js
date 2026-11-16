// Achievements: small milestones the town celebrates. Pure and stateful only in its own counters:
// the store feeds it every applied TownEvent plus a read-only view of current state, and it
// answers with the ids that just unlocked (each unlocks once per store lifetime).

/** @typedef {import('./events.js').TownEvent} TownEvent */

/**
 * @typedef {object} AchievementDef
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} icon
 */

/**
 * @typedef {object} Achievement
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} icon
 * @property {number} unlockedAt  ms timestamp of the event that unlocked it
 */

/**
 * What the tracker may ask about current state (supplied by the store after applying an event).
 * @typedef {object} TrackerView
 * @property {(sessionId: string) => number} activeHelpers  subagents + teammates not done, in one session
 * @property {() => number} activeAgents                    agents of every live session that are not done
 * @property {(sessionId: string) => ({tasks: {status: string}[]}|undefined)} session
 */

/** @type {ReadonlyArray<Readonly<AchievementDef>>} */
export const ACHIEVEMENTS = Object.freeze(
  [
    { id: 'first-contact', title: 'First Contact', icon: '👋', description: 'A Claude Code session arrived in town.' },
    { id: 'delegator', title: 'Delegator', icon: '🧑‍🤝‍🧑', description: 'Three or more helpers working for one lead at once.' },
    { id: 'swarm', title: 'Swarm', icon: '🐝', description: 'Eight or more agents in town at the same time.' },
    { id: 'red-to-green', title: 'Red to Green', icon: '🚦', description: 'A failing test run, then a passing one.' },
    { id: 'bookworm', title: 'Bookworm', icon: '📚', description: 'Fifty files read.' },
    { id: 'night-shift', title: 'Night Shift', icon: '🌙', description: 'Agents at work between midnight and 5 a.m.' },
    { id: 'black-hole', title: 'node_modules Black Hole', icon: '🕳️', description: 'Five JavaScript package installs.' },
    { id: 'rubber-stamp', title: 'Rubber Stamp', icon: '🛂', description: 'Five permission requests approved.' },
    { id: 'memory-lane', title: 'Memory Lane', icon: '♨️', description: 'The first context compaction.' },
    { id: 'ship-it', title: 'Ship It', icon: '🚚', description: 'A successful git push.' },
    { id: 'clean-sweep', title: 'Clean Sweep', icon: '🧹', description: 'Every item done on a list of three or more.' },
    { id: 'polyglot', title: 'Polyglot', icon: '🎩', description: 'Three different models in town.' },
    { id: 'teamwork', title: 'Teamwork', icon: '✉️', description: 'The first message from one agent to another.' },
  ].map((a) => Object.freeze(a)),
);

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

const READ_TOOLS = new Set(['Read', 'NotebookRead']);
const RUBBER_STAMP = 'rubber-stamp';
const ACTIVITY_KINDS = new Set(['prompt', 'tool.start']);

/**
 * @typedef {object} Counters
 * @property {number} reads
 * @property {number} installs
 * @property {number} approvals
 * @property {Set<string>} models
 * @property {Set<string>} redSessions  sessions whose last test run failed
 */

/** @returns {Counters} */
function freshCounters() {
  return { reads: 0, installs: 0, approvals: 0, models: new Set(), redSessions: new Set() };
}

/**
 * "claude-opus-5-5" and "opus" are one model for Polyglot; unknown ids count as themselves.
 * @param {unknown} model
 */
export function modelFamily(model) {
  const id = typeof model === 'string' ? model.trim().toLowerCase() : '';
  if (!id) return '';
  return ['opus', 'sonnet', 'haiku', 'fable', 'mythos'].find((family) => id.includes(family)) ?? id;
}

/** @param {TownEvent} e */
function modelsIn(e) {
  if (e.kind === 'session.start') return [e.data.model];
  if (e.kind === 'model.switch') return [e.data.from, e.data.to];
  if (e.kind === 'spawn.request') return [e.data.model];
  return [];
}

/**
 * Updates counters before the rules look at them.
 * @param {Counters} c
 * @param {TownEvent} e
 */
function count(c, e) {
  for (const model of modelsIn(e)) {
    const family = modelFamily(model);
    if (family) c.models.add(family);
  }
  if (e.kind === 'tool.start' && READ_TOOLS.has(e.data.tool)) c.reads += 1;
  if (e.kind === 'tool.start' && e.data.commandKind === 'install') c.installs += 1;
  if (e.kind === 'tool.fail' && e.data.commandKind === 'test') c.redSessions.add(e.sessionId);
}

/** @param {{status: string}[]} items */
function allDone(items) {
  return items.length >= 3 && items.every((item) => item.status === 'completed');
}

/**
 * One rule per achievement: true when the event (with the counters and current state) earns it.
 * @type {Readonly<Record<string, (e: TownEvent, view: TrackerView, c: Counters, hour: number) => boolean>>}
 */
const RULES = Object.freeze({
  'first-contact': (e) => e.kind !== 'unknown',
  delegator: (e, view) => e.kind === 'subagent.start' && view.activeHelpers(e.sessionId) >= 3,
  swarm: (e, view) => (e.kind === 'subagent.start' || e.kind === 'session.start') && view.activeAgents() >= 8,
  'red-to-green': (e, _view, c) => e.kind === 'tool.end' && e.data.commandKind === 'test' && c.redSessions.has(e.sessionId),
  bookworm: (_e, _view, c) => c.reads >= 50,
  'night-shift': (e, _view, _c, hour) => ACTIVITY_KINDS.has(e.kind) && hour >= 0 && hour < 5,
  'black-hole': (_e, _view, c) => c.installs >= 5,
  'memory-lane': (e) => e.kind === 'compact.start' || e.kind === 'compact.end',
  'ship-it': (e) => e.kind === 'tool.end' && e.data.commandKind === 'git-push',
  'clean-sweep': (e, view) =>
    (e.kind === 'todos.set' && allDone(e.data.todos ?? [])) ||
    ((e.kind === 'task.upsert' || e.kind === 'task.completed') && allDone(view.session(e.sessionId)?.tasks ?? [])),
  polyglot: (_e, _view, c) => c.models.size >= 3,
  teamwork: (e) => e.kind === 'message.send',
});

/**
 * @param {{localHour?: (ts: number) => number}} [options]  local clock hour of a timestamp
 *   (injectable so Night Shift is testable in any time zone)
 */
export function createAchievementTracker(options = {}) {
  const localHour = options.localHour ?? ((ts) => new Date(ts).getHours());
  /** @type {Set<string>} */
  const unlocked = new Set();
  let counters = freshCounters();

  /**
   * @param {TownEvent} event
   * @param {TrackerView} view
   * @returns {string[]} ids unlocked by this event
   */
  function evaluate(event, view) {
    const hour = localHour(event.ts);
    const fresh = [];
    for (const [id, rule] of Object.entries(RULES)) {
      if (unlocked.has(id) || !rule(event, view, counters, hour)) continue;
      unlocked.add(id);
      fresh.push(id);
    }
    return fresh;
  }

  return {
    /**
     * @param {TownEvent} event  an event the store has just applied
     * @param {TrackerView} view
     */
    observe(event, view) {
      count(counters, event);
      const fresh = evaluate(event, view);
      // A passing run turns the session green again; the next failure starts a new story.
      if (event.kind === 'tool.end' && event.data.commandKind === 'test') counters.redSessions.delete(event.sessionId);
      return fresh;
    },
    /**
     * A permission request was approved (in the town or in the terminal). Approvals are not
     * TownEvents, so Rubber Stamp is counted here rather than by a rule.
     * @returns {string[]}
     */
    approvalAllowed() {
      counters.approvals += 1;
      if (unlocked.has(RUBBER_STAMP) || counters.approvals < 5) return [];
      unlocked.add(RUBBER_STAMP);
      return [RUBBER_STAMP];
    },
    /** @param {string} id */
    isUnlocked(id) {
      return unlocked.has(id);
    },
    reset() {
      unlocked.clear();
      counters = freshCounters();
    },
  };
}

/**
 * @param {string} id
 * @param {number} unlockedAt
 * @returns {Achievement|null}
 */
export function achievementFor(id, unlockedAt) {
  const def = BY_ID.get(id);
  return def ? { ...def, unlockedAt } : null;
}
