// Side effects of store changes: toasts, sounds and announcements. Changes are queued as they
// arrive and played once per rendered frame. Only fresh changes count: history replayed to a
// late-joining browser renders in the panels but never toasts or rings.
import { INTERACTIVE_TOOLS } from '../core/dialogs.js';
import { describeApproval, truncate } from './format.js';
import { approvalAgentKey, crewNumber, findSession } from './parts.js';

/** @typedef {import('./types.js').StoreChange} StoreChange */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('./types.js').HudContext} HudContext */

/** Events older than this are history: they render but don't toast. */
export const FRESH_MS = 15_000;
const MAX_QUEUED = 20;
/** As many as the toast list shows (toasts.js MAX_VISIBLE): more in one frame would push each other out. */
const MAX_TOASTS_PER_FRAME = 2;

/**
 * @typedef {{ type: 'session', sessionId: string }
 *   | { type: 'approval', approval: import('./types.js').Approval }
 *   | { type: 'achievement', achievement: import('./types.js').Achievement }
 *   | { type: 'sound', name: 'pop'|'buzz' }} Effect
 */

/**
 * The effect a change deserves, if any. Each pending approval is announced once, however often
 * the server re-sends it (it does on every reconnect).
 * @param {StoreChange} change
 * @param {Set<string>} seenApprovals
 * @param {number} now
 * @returns {Effect|null}
 */
export function effectFor(change, seenApprovals, now) {
  if (change.type === 'approval') {
    const { approval } = change;
    if (approval.status !== 'pending' || seenApprovals.has(approval.id)) return null;
    // A question or a plan is not a permission to grant: "needs you" tells of it in its words.
    if (Object.hasOwn(INTERACTIVE_TOOLS, approval.toolName)) return null;
    seenApprovals.add(approval.id);
    return now - approval.createdAt < FRESH_MS * 4 ? { type: 'approval', approval } : null;
  }
  if (change.type === 'achievement') {
    return now - change.achievement.unlockedAt < FRESH_MS ? { type: 'achievement', achievement: change.achievement } : null;
  }
  if (change.type !== 'event') return null;
  const { event } = change;
  if (now - event.ts > FRESH_MS) return null;
  if (event.kind === 'session.start') return { type: 'session', sessionId: event.sessionId };
  if (event.kind === 'subagent.start') return { type: 'sound', name: 'pop' };
  if (event.kind === 'tool.fail' || event.kind === 'turn.fail') return { type: 'sound', name: 'buzz' };
  return null;
}

export function createEffectQueue() {
  /** @type {Effect[]} */
  let queued = [];
  const seenApprovals = new Set();
  return {
    /** @param {StoreChange} change */
    push(change) {
      if (change.type === 'reset') {
        queued = [];
        return;
      }
      const effect = effectFor(change, seenApprovals, Date.now());
      if (effect && queued.length < MAX_QUEUED) queued.push(effect);
    },
    /** @returns {Effect[]} */
    take() {
      const taken = queued;
      queued = [];
      return taken;
    },
  };
}

/**
 * Plays queued effects: sounds always, at most a few toasts per frame.
 * @param {HudContext} ctx
 * @param {Effect[]} effects
 * @param {StoreState} state
 */
export function playEffects(ctx, effects, state) {
  let toasts = 0;
  for (const effect of effects) {
    if (effect.type === 'sound') ctx.sound.play(effect.name);
    // A quiet town keeps its achievements in the log and the leaderboard, without a toast.
    else if (effect.type === 'achievement' && ctx.prefs.quietTown) continue;
    else if (toasts++ < MAX_TOASTS_PER_FRAME) showToast(ctx, effect, state);
  }
}

/** @param {HudContext} ctx @param {Exclude<Effect, { type: 'sound' }>} effect @param {StoreState} state */
function showToast(ctx, effect, state) {
  if (effect.type === 'session') return crewArrived(ctx, effect.sessionId, state);
  if (effect.type === 'approval') return approvalArrived(ctx, effect.approval, state);
  const { achievement } = effect;
  ctx.toasts.show({ tone: 'achievement', icon: 'medal', title: achievement.title, body: achievement.description, group: 'achievement' });
  ctx.sound.play('chime');
  ctx.announcer.polite(`Achievement unlocked: ${achievement.title}.`);
  return undefined;
}

/**
 * The second line of a new crew's toast: its number key where there is a keyboard to press it
 * (on a phone the toast's Show button is the way there).
 * @param {number} number  1-based crew number
 * @param {boolean} mobile
 */
export function crewToastBody(number, mobile) {
  return !mobile && number >= 1 && number <= 9 ? `Press ${number} to jump to it.` : 'A Claude Code session started.';
}

/** @param {HudContext} ctx @param {string} sessionId @param {StoreState} state */
function crewArrived(ctx, sessionId, state) {
  const session = findSession(state, sessionId);
  if (!session) return;
  const number = crewNumber(state, session.id);
  ctx.toasts.show({
    tone: 'crew',
    group: 'crew',
    number,
    color: session.color,
    title: `New crew in ${session.project}`,
    body: crewToastBody(number, ctx.view.mobile),
    action: { label: 'Show', run: () => showCrew(ctx, session.id) },
  });
  ctx.sound.play('whoosh');
}

/** Selects the crew's lead agent, as its number key does. @param {HudContext} ctx @param {string} sessionId */
function showCrew(ctx, sessionId) {
  const state = ctx.store.getState();
  const session = findSession(state, sessionId);
  const lead = session?.agentKeys.find((key) => state.agents[key]?.role === 'lead') ?? session?.agentKeys[0];
  if (lead) ctx.select({ type: 'agent', id: lead }, { camera: true, focus: true });
}

/** @param {HudContext} ctx @param {import('./types.js').Approval} approval @param {StoreState} state */
function approvalArrived(ctx, approval, state) {
  const who = state.agents[approvalAgentKey(approval)]?.name ?? 'An agent';
  const project = findSession(state, approval.sessionId)?.project ?? 'a crew';
  const { action, detail } = describeApproval(approval);
  ctx.toasts.show({
    tone: 'approval',
    icon: 'hourglass',
    title: `${who} in ${project} wants to ${action}`,
    body: truncate(detail, 90),
    mono: true,
    action: { label: 'Review', run: () => ctx.showTab('approvals', { focus: true }) },
  });
  ctx.sound.play('bell');
  ctx.announcer.polite(`Approval needed: ${who} in ${project} wants to ${action}.`);
}
