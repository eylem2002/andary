// The one way events enter the town (CONTRACTS §4.4). Routes authenticate and parse; everything
// that happens to an event after that is here, in order:
//
//   source payload ──adapter──▶ town payloads ──policy──▶ observers ──record──▶ envelope ──▶ browsers
//                   (adapters/)                 (usage, growth,       (sanitize, history,
//                                                notifications,        recording, broadcast)
//                                                approvals, digest,
//                                                relay)
//
// Which observers see an event depends on where it came from, and that is written down once, in
// POLICIES, instead of in each route. Before any of them, a tool hook gets its call key
// (`andary_key`, hook-steps.mjs), from its input as it arrived, and a local one the top of its
// folder's work tree (`andary_root`, work-trees.mjs). The town, the phone notes and the approval
// broker get the hook's own time (`ts`, hookTime) with it: hooks may arrive out of order.
import { toTownPayloads } from './adapters/index.mjs';
import { hookTime, withCallKey } from './hook-steps.mjs';
import { sanitize } from './sanitize.mjs';
import { withWorkTree } from './work-trees.mjs';

/** @typedef {import('./app.mjs').TownContext} TownContext */
/** @typedef {import('./history.mjs').Envelope & { event: Record<string, any> }} TownEnvelope */
/** @typedef {'local'|'team'} Origin */

/**
 * What each origin's events do besides appearing in the town.
 * - local: this computer's agents, through the forwarder.
 * - team: a teammate's agents, relayed by their Andary (CONTRACTS §4.11). They grow the town, but
 *   their prompts are theirs to answer, their notifications and their catch-up (digest: what their
 *   crews did while they were away) theirs to get, and they are never relayed again.
 * @type {Readonly<Record<Origin, Readonly<{ growth: boolean, notify: boolean, approvals: boolean, digest: boolean, relay: boolean }>>>}
 */
export const POLICIES = Object.freeze({
  local: Object.freeze({ growth: true, notify: true, approvals: true, digest: true, relay: true }),
  team: Object.freeze({ growth: true, notify: false, approvals: false, digest: false, relay: false }),
});

/** A teammate's queued events older than this arrive dated an hour ago. */
const TEAM_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * A hook from this computer's forwarder: usage (Claude Code transcripts only), then the source's
 * adapter, then the local policy. Returns the envelopes in order; at most one is a
 * PermissionRequest, which the caller answers (adapters never split or rewrite one).
 * @param {TownContext} ctx
 * @param {{ ts: number, source: import('./adapters/index.mjs').Source, event: Record<string, any> }} body
 * @param {number} [now]
 * @returns {TownEnvelope[]}
 */
export function ingestHook(ctx, body, now = Date.now()) {
  // Its own time, kept within the last hour (hookTime): the town, the notes and the broker go by it.
  const ts = hookTime(body.ts, now);
  // With the hook's start time: a compaction drops context readings of messages written before it.
  if (body.source === 'claude') ctx.usage.observe(body.event, ts);
  return toTownPayloads(body.source, body.event).map((event) => admit(ctx, 'local', { ts, event }));
}

/**
 * A teammate's batch, already authenticated: each event is marked as theirs, its session id
 * prefixed so two people's sessions can never collide, and its time kept within the last hour
 * (another computer's clock).
 * @param {TownContext} ctx
 * @param {string} member
 * @param {{ ts: number, event: Record<string, any> }[]} items
 * @param {number} [now]
 * @returns {TownEnvelope[]}
 */
export function ingestTeam(ctx, member, items, now = Date.now()) {
  return items.map((item) => {
    const event = { ...item.event, andary_member: member, session_id: `${member}~${String(item.event.session_id ?? 'unknown')}` };
    const ts = Number.isFinite(item.ts) ? Math.min(now, Math.max(now - TEAM_MAX_AGE_MS, item.ts)) : now;
    return admit(ctx, 'team', { ts, event });
  });
}

/**
 * One town payload through its origin's policy.
 * @param {TownContext} ctx
 * @param {Origin} origin
 * @param {{ ts: number, event: Record<string, any> }} item
 * @returns {TownEnvelope}
 */
function admit(ctx, origin, item) {
  const policy = POLICIES[origin];
  // The call key first, from the input as it arrived: every reader below matches calls by it. A
  // work tree's top is this computer's to find: a teammate's folders are on theirs.
  const event = withWorkTree(withCallKey(item.event), origin === 'local' ? ctx.workTrees : null);
  if (policy.growth) ctx.progress.observe(event);
  if (policy.notify) ctx.notifier.observe(event, item.ts);
  // What a session left running is this computer's to look for (§4.16).
  if (origin === 'local') ctx.leftovers?.observe(event);
  const envelope = record(ctx, { ts: item.ts, event });
  // Sanitized, as what it counts (a turn's last message) goes to browsers; timed by arrival, so a
  // late hook still counts in the period a browser asks about.
  if (policy.digest) ctx.digest.observe(envelope.event, envelope.rx);
  // A team town: a person's duty (their character at work) and their relay's lights.
  ctx.team?.presence.observe(envelope.event, origin);
  if (policy.relay) ctx.relay?.send(envelope);
  // A permission request is answered by the route (it may be held); everything else settles or
  // updates waiting approvals.
  if (policy.approvals && envelope.event.hook_event_name !== 'PermissionRequest') ctx.broker.observe(envelope.event, envelope.ts);
  return envelope;
}

/**
 * Sanitizes a payload into an envelope, keeps it, records it (with --record) and sends it to
 * every browser.
 * @param {TownContext} ctx
 * @param {{ ts: number, event: object }} item
 * @returns {TownEnvelope}
 */
function record(ctx, { ts, event }) {
  ctx.counts.events += 1;
  const envelope = { id: ctx.counts.events, ts, rx: Date.now(), event: sanitize(event) };
  if (envelope.id === 1) ctx.log('Receiving hook events');
  // Serialised once: its length is the envelope's share of the history budget.
  const text = JSON.stringify(envelope);
  ctx.history.push(envelope, text.length);
  ctx.recorder?.write(envelope);
  ctx.hub.broadcastText(`{"t":"hook","e":${text}}`);
  return envelope;
}
