// What needs you, most urgent first (docs/design/agent-health.md §3): one list for the HUD's
// "need you" button, the crew rows, the page title and the desktop notifications, built from the
// store's state. Pure and read-only.
//
//   blocked  an agent cannot go on without you: a permission request (answer it in the town, or
//            in the terminal when the town cannot hold it), a question, a plan to approve
//   stopped  a turn ended in an error; crews stopped by one rate limit together are one item
//   ready    a lead finished its turn and nobody has answered: counted once Claude Code says so
//            (idle_prompt, a minute later; Codex has no such signal: a minute too), for 30 minutes
import { agentKeyOf, normalizeAgentId } from './ids.js';
import { summarizeTool } from './summaries.js';

/** @typedef {import('./store.js').StoreState} StoreState */
/** @typedef {import('./store.js').AgentState} AgentState */
/** @typedef {import('./store.js').Session} Session */
/** @typedef {'approval'|'terminal'|'question'|'plan'|'stopped'|'finished'} AttentionKind */
/** @typedef {'blocked'|'stopped'|'alert'|'ready'} AttentionLevel */

/**
 * @typedef {object} AttentionItem
 * @property {string} id            kind, agent and start: a new episode is a new item
 * @property {AttentionKind} kind
 * @property {AttentionLevel} level
 * @property {string} sessionId
 * @property {string} agentKey      who to show (the first, for a group)
 * @property {string|null} approvalId  the request to open in Approvals (kind 'approval')
 * @property {number} since         when the agent stopped for you
 * @property {number} countedSince  when it started to count (since, or idle_prompt for a finished turn)
 * @property {string} text          one line
 * @property {boolean} counted      part of the "need you" count and the page title
 * @property {boolean} dismissable
 * @property {number} crews         how many crews the item stands for (a shared rate limit)
 */

/** A finished turn counts for this long; after that the crew is probably done for now. */
export const READY_MS = 30 * 60_000;
/**
 * Codex sends no idle_prompt: a finished Codex turn counts after this long without a prompt, like
 * Claude Code's minute. The phone's Codex note waits as long (server/notify.mjs CODEX_IDLE_MS).
 */
export const CODEX_IDLE_MS = 60_000;
/** Turns stopped by the same limit within this window are one item. */
const SHARED_STOP_MS = 10 * 60_000;
const LEVEL_ORDER = Object.freeze({ blocked: 0, stopped: 1, alert: 2, ready: 3 });

/**
 * @param {StoreState} state
 * @param {number} now
 * @param {{ dismissed?: ReadonlySet<string> }} [options]  dismissed: item ids the viewer set aside
 * @returns {AttentionItem[]} most urgent first; within a level, the longest waiting first
 */
export function attentionItems(state, now, { dismissed } = {}) {
  /** @type {AttentionItem[]} */
  const items = [];
  const yours = new Map(state.sessions.filter((s) => s.status !== 'ended' && !s.member).map((s) => [s.id, s]));
  const asking = new Map();
  for (const approval of state.approvals) {
    if (approval.status !== 'pending' || !yours.has(approval.sessionId)) continue;
    const key = agentKeyOf(approval.sessionId, normalizeAgentId(approval.agentId));
    if (asking.has(key)) continue;
    asking.set(key, approval);
    items.push(approvalItem(approval, key, yours.get(approval.sessionId)));
  }
  for (const session of yours.values()) {
    for (const key of session.agentKeys) {
      const agent = state.agents[key];
      const item = agent?.wait && !asking.has(key) ? waitItem(agent, session, now) : null;
      if (item) items.push(item);
    }
  }
  // A dismissed item stays away until the situation changes (a new episode has a new id).
  return mergeSharedStops(items)
    .filter((item) => !(item.dismissable && dismissed?.has(item.id)))
    .sort(byUrgency);
}

/**
 * @param {import('./store.js').Approval} approval
 * @param {string} key
 * @param {Session|undefined} session
 * @returns {AttentionItem}
 */
function approvalItem(approval, key, session) {
  const what = summarizeTool(String(approval.toolName ?? 'Tool'), approval.toolInput, approval.cwd ?? session?.cwd ?? '');
  const since = Number(approval.createdAt) || 0;
  return {
    id: `${approval.held ? 'approval' : 'terminal'}:${key}:${since}`,
    kind: approval.held ? 'approval' : 'terminal',
    level: 'blocked',
    sessionId: approval.sessionId,
    agentKey: key,
    approvalId: approval.held ? approval.id : null,
    since,
    countedSince: since,
    text: approval.held ? `Needs permission: ${what}` : `Answer in your terminal: ${what}`,
    counted: true,
    dismissable: false,
    crews: 1,
  };
}

/**
 * @param {AgentState} agent
 * @param {Session} session
 * @param {number} now
 * @returns {AttentionItem|null}
 */
function waitItem(agent, session, now) {
  const wait = /** @type {import('./waits.js').Wait} */ (agent.wait);
  /** @param {AttentionKind} kind @param {AttentionLevel} level @param {Partial<AttentionItem>} [extra] */
  const item = (kind, level, extra = {}) => ({
    id: `${kind}:${agent.key}:${wait.since}`,
    kind,
    level,
    sessionId: session.id,
    agentKey: agent.key,
    approvalId: null,
    since: wait.since,
    countedSince: wait.since,
    text: wait.text,
    counted: true,
    dismissable: false,
    crews: 1,
    ...extra,
  });
  switch (wait.kind) {
    // An approval the town no longer lists as pending (expired, released): the terminal asks.
    case 'approval':
      return item('terminal', 'blocked', { text: wait.text.replace(/^Needs permission: /, 'Answer in your terminal: ') });
    case 'question':
      return item('question', 'blocked');
    case 'plan':
      return item('plan', 'blocked');
    case 'stopped':
      return item('stopped', 'stopped', { dismissable: true });
    case 'finished':
      return finishedItem(item, wait, session, now);
    default:
      return null;
  }
}

/**
 * A finished turn: listed at once, counted once nobody answered (idle_prompt, or a minute for
 * Codex), and no longer counted after READY_MS.
 * @param {(kind: AttentionKind, level: AttentionLevel, extra?: Partial<AttentionItem>) => AttentionItem} item
 * @param {import('./waits.js').Wait} wait
 * @param {Session} session
 * @param {number} now
 */
function finishedItem(item, wait, session, now) {
  const idleAt = wait.idleAt ?? (session.source === 'codex' && now - wait.since >= CODEX_IDLE_MS ? wait.since + CODEX_IDLE_MS : null);
  const counted = idleAt !== null && now - wait.since < READY_MS;
  return item('finished', 'ready', { counted, countedSince: idleAt ?? wait.since, dismissable: true });
}

/**
 * Crews stopped by one rate limit within a few minutes of each other are one item: one cause,
 * one thing to do.
 * @param {AttentionItem[]} items
 * @returns {AttentionItem[]}
 */
function mergeSharedStops(items) {
  const limited = items.filter((i) => i.kind === 'stopped' && i.text === 'Rate limited').sort((a, b) => a.since - b.since);
  if (limited.length < 2) return items;
  /** @type {AttentionItem[][]} */
  const groups = [];
  for (const stop of limited) {
    const group = groups.at(-1);
    if (group && stop.since - group[0].since <= SHARED_STOP_MS) group.push(stop);
    else groups.push([stop]);
  }
  const absorbed = new Set();
  /** @type {AttentionItem[]} */
  const merged = [];
  for (const group of groups) {
    if (group.length < 2) continue;
    const crews = new Set(group.map((g) => g.sessionId)).size;
    for (const stop of group) absorbed.add(stop);
    merged.push({ ...group[0], id: `limit:${group[0].since}`, text: `Rate limited: ${crews} crews stopped`, crews });
  }
  return [...items.filter((i) => !absorbed.has(i)), ...merged];
}

/** @param {AttentionItem} a @param {AttentionItem} b */
function byUrgency(a, b) {
  return LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || Number(b.counted) - Number(a.counted) || a.since - b.since;
}

/** @param {AttentionItem[]} items @returns {AttentionItem[]} */
export function countedItems(items) {
  return items.filter((item) => item.counted);
}
