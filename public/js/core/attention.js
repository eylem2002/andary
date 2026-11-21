// What needs you, most urgent first (docs/design/agent-health.md §3): one list for the HUD's
// "need you" button, the crew rows, the page title and the desktop notifications, built from the
// store's state. Pure and read-only.
//
//   blocked  an agent cannot go on without you: an open dialog (core/dialogs.js) — a permission
//            request (answered in the town while it holds it, else in the terminal), a question,
//            a plan to approve, an MCP server's form
//   stopped  a turn ended in an error; crews stopped by one rate limit together are one item
//   ready    a lead finished its turn and nobody has answered: counted once Claude Code says so
//            (idle_prompt, a minute later; Codex has no such signal: a minute too), for 30 minutes
import { agentKeyOf } from './ids.js';

/** @typedef {import('./store.js').StoreState} StoreState */
/** @typedef {import('./store.js').AgentState} AgentState */
/** @typedef {import('./store.js').Session} Session */
/** @typedef {import('./store.js').Approval} Approval */
/** @typedef {import('./dialogs.js').Dialog} Dialog */
/** @typedef {'approval'|'terminal'|'question'|'plan'|'stopped'|'finished'} AttentionKind */
/** @typedef {'blocked'|'stopped'|'alert'|'ready'} AttentionLevel */

/**
 * @typedef {object} AttentionItem
 * @property {string} id            one per episode: the same while a request moves between the town and the terminal
 * @property {AttentionKind} kind
 * @property {AttentionLevel} level
 * @property {string} sessionId
 * @property {string} agentKey      who to show (the first, for a group)
 * @property {string[]} agentKeys   everyone it stands for (a shared rate limit: every crew's agent)
 * @property {string|null} approvalId  the request to open in Approvals (kind 'approval')
 * @property {number} since         when the agent stopped for you
 * @property {number} countedSince  when it started to count (since, or idle_prompt for a finished turn)
 * @property {string} text          one line
 * @property {boolean} counted      part of the "need you" count and the page title
 * @property {boolean} dismissable
 * @property {number} crews         how many crews the item stands for (a shared rate limit)
 * @property {boolean} settled      a dialog's request has reached the town (or never will): its kind is final
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
/**
 * A dialog the town does not hold can be set aside once it has waited this long: it may be stale
 * (an interrupted helper sends nothing), and only you can tell.
 */
export const STALE_DIALOG_MS = 5 * 60_000;
const LEVEL_ORDER = Object.freeze({ blocked: 0, stopped: 1, alert: 2, ready: 3 });

/**
 * @param {StoreState} state
 * @param {number} now
 * @param {{ dismissed?: ReadonlySet<string> }} [options]  dismissed: item ids the viewer set aside
 * @returns {AttentionItem[]} most urgent first; within a level, the longest waiting first
 */
export function attentionItems(state, now, { dismissed } = {}) {
  const yours = new Map(state.sessions.filter((s) => s.status !== 'ended' && !s.member).map((s) => [s.id, s]));
  const approvals = new Map(state.approvals.map((a) => [a.id, a]));
  /** @type {AttentionItem[]} */
  const items = [];
  for (const dialog of state.dialogs ?? []) {
    if (yours.has(dialog.sessionId)) items.push(dialogItem(dialog, dialog.approvalId ? approvals.get(dialog.approvalId) : undefined, now));
  }
  /** @type {AttentionItem[]} */
  const limited = [];
  for (const session of yours.values()) {
    for (const key of session.agentKeys) {
      const agent = state.agents[key];
      const item = agent?.wait ? waitItem(agent, session, now) : null;
      if (!item) continue;
      items.push(item);
      if (item.kind === 'stopped' && agent.wait?.cause === 'rate_limit') limited.push(item);
    }
  }
  // A dismissed item stays away until the situation changes (a new episode has a new id).
  return mergeSharedStops(items, limited)
    .filter((item) => !(item.dismissable && dismissed?.has(item.id)))
    .sort(byUrgency);
}

/**
 * @param {Dialog} dialog
 * @param {Approval|undefined} approval  the town's request for it, when it has reached the town
 * @param {number} now
 * @returns {AttentionItem}
 */
function dialogItem(dialog, approval, now) {
  const agentKey = agentKeyOf(dialog.sessionId, dialog.agentId);
  const held = approval?.status === 'pending' && approval.held === true;
  /** @type {AttentionKind} */
  const kind = dialog.kind === 'question' || dialog.kind === 'plan' ? dialog.kind : held ? 'approval' : 'terminal';
  return {
    id: `dialog:${agentKey}:${dialog.at}:${dialog.input ?? dialog.kind}`,
    kind,
    level: 'blocked',
    sessionId: dialog.sessionId,
    agentKey,
    agentKeys: [agentKey],
    approvalId: held && approval ? approval.id : null,
    since: dialog.at,
    countedSince: dialog.at,
    // An MCP server's form (a question with no tool) says what it wants in its own words.
    text: dialog.kind === 'question' && !dialog.tools.length ? dialog.text || 'Needs your input' : dialogText(kind, dialog.text),
    counted: true,
    // Held in the town: answer it there. Otherwise, past a few minutes it may be stale.
    dismissable: !held && now - dialog.at >= STALE_DIALOG_MS,
    crews: 1,
    // A request reaches the town a moment after its hook: until then a permission dialog may
    // still turn out to be held there. Questions, plans and notices never are.
    settled: Boolean(approval) || dialog.kind !== 'permission',
  };
}

/** @param {AttentionKind} kind @param {string} what */
function dialogText(kind, what) {
  switch (kind) {
    case 'approval':
      return `Needs permission: ${what || 'a tool'}`;
    case 'question':
      return what ? `Asks: ${what}` : 'Asks you a question';
    case 'plan':
      return 'Waits for you to approve its plan';
    default:
      return what ? `Answer in your terminal: ${what}` : 'Needs your permission in its terminal';
  }
}

/**
 * @param {AgentState} agent
 * @param {Session} session
 * @param {number} now
 * @returns {AttentionItem|null}
 */
function waitItem(agent, session, now) {
  const wait = /** @type {import('./waits.js').Wait} */ (agent.wait);
  /** @param {AttentionKind} kind @param {AttentionLevel} level @param {Partial<AttentionItem>} [extra] @returns {AttentionItem} */
  const item = (kind, level, extra = {}) => ({
    id: `${kind}:${agent.key}:${wait.since}`,
    kind,
    level,
    sessionId: session.id,
    agentKey: agent.key,
    agentKeys: [agent.key],
    approvalId: null,
    since: wait.since,
    countedSince: wait.since,
    text: wait.text,
    counted: true,
    dismissable: false,
    crews: 1,
    settled: true,
    ...extra,
  });
  switch (wait.kind) {
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
 * one thing to do. Its id is `limit:<when the first stopped>`.
 * @param {AttentionItem[]} items
 * @param {AttentionItem[]} limited  the rate-limit stops among them
 * @returns {AttentionItem[]}
 */
function mergeSharedStops(items, limited) {
  if (limited.length < 2) return items;
  /** @type {AttentionItem[][]} */
  const groups = [];
  for (const stop of [...limited].sort((a, b) => a.since - b.since)) {
    const group = groups.at(-1);
    if (group && stop.since - group[0].since <= SHARED_STOP_MS) group.push(stop);
    else groups.push([stop]);
  }
  const absorbed = new Set();
  /** @type {AttentionItem[]} */
  const merged = [];
  for (const group of groups) {
    const crews = new Set(group.map((g) => g.sessionId)).size;
    // A lead and its helper stopped by the same limit are still one crew's own stop.
    if (crews < 2) continue;
    for (const stop of group) absorbed.add(stop);
    merged.push({ ...group[0], id: `limit:${group[0].since}`, agentKeys: group.map((g) => g.agentKey), text: `Rate limited: ${crews} crews stopped`, crews });
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
