import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextSentence, contextShort, crewUsage, formatCost, formatTokens, hasCounted, lastDays, liveContext, usageSentence, usageShort } from '../../../public/js/ui/usage.js';
import { createDemoUsage } from '../../../public/js/sources/demo-usage.js';
import { createStore } from '../../../public/js/core/store.js';
import { envelope, hook } from '../core/helpers.mjs';

test('formatCost and formatTokens read naturally', () => {
  assert.equal(formatCost(0), '$0');
  assert.equal(formatCost(0.004), '<$0.01');
  assert.equal(formatCost(0.42), '$0.42');
  assert.equal(formatCost(12.04), '$12');
  assert.equal(formatCost(12.5), '$12.5');
  assert.equal(formatCost(1234.6), '$1,235');
  assert.equal(formatTokens(950), '950');
  assert.equal(formatTokens(1500), '1.5k');
  assert.equal(formatTokens(34_200), '34k');
  assert.equal(formatTokens(1_230_000), '1.2M');
  assert.equal(formatTokens(-1), '0');
});

test('formatTokens never says "1000k": from 999,500 it is a million', () => {
  assert.equal(formatTokens(999_499), '999k');
  assert.equal(formatTokens(999_500), '1M');
  assert.equal(formatTokens(999_999), '1M');
  assert.equal(formatTokens(1_000_000), '1M');
  assert.equal(formatTokens(9999), '10k');
});

const usage = (cost, tokens = 1000) => ({ tokens: { input: tokens, output: 10, cacheRead: 0, cacheWrite: 0 }, costUsd: cost, unpriced: false, model: 'claude-opus-5-5', context: null, compactedAt: null });

test('crewUsage sums a crew\'s agents only', () => {
  const state = /** @type {any} */ ({ usage: { 's1:main': usage(0.5), 's1:abc': usage(0.25), 's10:main': usage(9) } });
  const sum = crewUsage(state, 's1');
  assert.equal(sum?.costUsd, 0.75);
  assert.equal(sum?.tokens.input, 2000);
  assert.equal(crewUsage(state, 's2'), null);
  assert.equal(usageShort(sum), '$0.75');
  assert.equal(usageShort({ ...usage(0, 5000) }), '5k tokens');
  assert.equal(usageShort(null), '');
  assert.match(usageSentence({ ...usage(0.42), unpriced: true }), /About \$0\.42 at API prices \(some of it/);
  assert.match(usageSentence(usage(0)), /No price is known/);
});

test('lastDays fills empty days and ends today', () => {
  const now = new Date('2026-11-20T12:00:00').getTime();
  const days = lastDays([{ date: '2026-11-19', tokens: 5, costUsd: 1 }], now, 3);
  assert.deepEqual(days.map((d) => d.date), ['2026-11-18', '2026-11-19', '2026-11-20']);
  assert.equal(days[1].costUsd, 1);
  assert.equal(days[2].costUsd, 0);
});

test('the store keeps usage per agent and the days, and ignores bad records', () => {
  const store = createStore();
  const changes = [];
  store.subscribe((c) => changes.push(c.type));
  store.setUsage({ sessionId: 's1', agentId: 'agent-abc', tokens: { input: 5, output: 'x' }, costUsd: -1 }, [{ date: '2026-11-20', tokens: 9, costUsd: 0.1 }, { date: 'nope' }]);
  store.setUsage({ agentId: 'x' });
  const state = store.getState();
  assert.deepEqual(state.usage['s1:abc'].tokens, { input: 5, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.equal(state.usage['s1:abc'].costUsd, 0);
  assert.deepEqual(state.usageDays, [{ date: '2026-11-20', tokens: 9, costUsd: 0.1 }]);
  assert.deepEqual(changes, ['usage']);
});

test('the store reads a context reading defensively: a token count with a time, or nothing', () => {
  const store = createStore();
  const record = (/** @type {unknown} */ context, /** @type {unknown} */ compactedAt) => ({ sessionId: 's1', agentId: null, tokens: { input: 5 }, costUsd: 0.1, context, compactedAt });
  const read = (/** @type {unknown} */ context, /** @type {unknown} */ compactedAt = undefined) => {
    store.setUsage(record(context, compactedAt));
    return store.getState().usage['s1:main'];
  };
  assert.deepEqual(read({ tokens: 182_340, at: 1_763_640_000_000 }).context, { tokens: 182_340, at: 1_763_640_000_000 });
  assert.deepEqual(read({ tokens: 1200.6, at: 5, extra: 'dropped' }).context, { tokens: 1201, at: 5 });
  for (const junk of [null, undefined, 'lots', 182_340, [], { tokens: '182340', at: 5 }, { tokens: -3, at: 5 }, { tokens: 0, at: 5 }, { tokens: Infinity, at: 5 }, { tokens: 10 }, { tokens: 10, at: 'today' }, { tokens: 10, at: Number.NaN }]) {
    assert.equal(read(junk).context, null, JSON.stringify(junk) ?? String(junk));
  }
  assert.equal(read(null, 1_763_640_000_000).compactedAt, 1_763_640_000_000);
  for (const junk of [undefined, null, 'yesterday', -5, 0, Number.NaN, {}]) assert.equal(read(null, junk).compactedAt, null, String(junk));
});

/** A store with one crew at work: its lead, and a helper, both read two minutes ago. */
function crewAtWork() {
  const now = Date.parse('2026-11-20T12:00:00.000Z');
  const store = createStore({ now: () => now });
  const lead = (/** @type {string} */ name, /** @type {Record<string, any>} */ extra = {}) => store.ingest(envelope(hook(name, extra, { session: 's1' }), now));
  const helper = (/** @type {string} */ name, /** @type {Record<string, any>} */ extra = {}) => store.ingest(envelope(hook(name, extra, { session: 's1', agent: { id: 'abc', type: 'Explore' } }), now));
  lead('SessionStart', { source: 'startup', model: 'claude-opus-5-5' });
  helper('SubagentStart');
  /** @param {string|null} agentId @param {{ tokens: number, at: number }|null} context @param {number|null} [compactedAt] */
  const usageOf = (agentId, context, compactedAt = null) => store.setUsage({ sessionId: 's1', agentId, tokens: { input: 4, cacheRead: 9000 }, costUsd: 0.42, model: 'claude-opus-5-5', context, compactedAt });
  usageOf(null, { tokens: 182_340, at: now - 2 * 60_000 });
  usageOf('abc', { tokens: 21_524, at: now - 2 * 60_000 });
  return { store, lead, helper, usageOf, now };
}

test('the lead\'s row shows its context in use; the inspector the exact count and how old it is, for any agent', () => {
  const { store, now } = crewAtWork();
  const state = store.getState();
  const lead = liveContext(state, 's1:main');
  assert.equal(contextShort(lead), '182k in context');
  assert.ok(lead);
  assert.equal(contextSentence(lead, now), '182,340 tokens in context, as of 2m ago.');
  const helper = liveContext(state, 's1:abc');
  assert.ok(helper);
  assert.equal(contextSentence(helper, now), '21,524 tokens in context, as of 2m ago.');
  assert.equal(contextSentence({ tokens: 950, at: now - 3000 }, now), '950 tokens in context, as of just now.');
  assert.equal(contextSentence({ tokens: 1, at: now - 3 * 3_600_000 }, now), '1 token in context, as of 3h ago.');
  assert.equal(contextShort(liveContext(state, 's2:main')), '', 'a crew without a reading shows nothing');
});

test('after a compaction the rows say so until the next reading', () => {
  const { store, usageOf, now } = crewAtWork();
  usageOf(null, null, now - 60_000);
  const compacted = liveContext(store.getState(), 's1:main');
  assert.deepEqual(compacted, { tokens: null, at: now - 60_000 });
  assert.equal(contextShort(compacted), 'context compacted');
  assert.equal(contextSentence(/** @type {any} */ (compacted), now), 'Context compacted 1m ago; the new count comes with the next message.');
  // A reading from before the compaction no longer holds, wherever it came from.
  usageOf(null, { tokens: 182_340, at: now - 2 * 60_000 }, now - 60_000);
  assert.equal(contextShort(liveContext(store.getState(), 's1:main')), 'context compacted');
  usageOf(null, { tokens: 31_009, at: now - 10_000 }, now - 60_000);
  assert.equal(contextShort(liveContext(store.getState(), 's1:main')), '31k in context');
});

test('a reading that no longer holds is not shown: the helper finished, the crew ended', () => {
  const { store, lead, helper } = crewAtWork();
  // A lead that finished its turn keeps its conversation, and so its context.
  lead('Stop', { last_assistant_message: 'Done.', stop_hook_active: false });
  assert.equal(contextShort(liveContext(store.getState(), 's1:main')), '182k in context');
  helper('SubagentStop', { agent_transcript_path: '/x/agent-abc.jsonl', last_assistant_message: 'Found it.', stop_hook_active: false });
  assert.equal(liveContext(store.getState(), 's1:abc'), null);
  lead('SessionEnd', { reason: 'prompt_input_exit' });
  assert.equal(liveContext(store.getState(), 's1:main'), null);
});

test('a record that only carries a context reading shows no cost', () => {
  const onlyContext = { ...usage(0, 0), tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, context: { tokens: 51_524, at: 5 } };
  assert.equal(hasCounted(onlyContext), false);
  assert.equal(usageShort(onlyContext), '', 'not "0 tokens"');
  assert.equal(hasCounted(usage(0, 5)), true, 'a model without a price still counted tokens');
  const state = /** @type {any} */ ({ usage: { 's1:main': onlyContext } });
  assert.equal(crewUsage(state, 's1')?.context, null, 'contexts are per agent, never summed');
});

test('the demo makes up repeatable usage, priced by the session\'s model, with past days', () => {
  /** @type {any[]} */
  const calls = [];
  const observe = createDemoUsage({ setUsage: (r, d) => calls.push([structuredClone(r), d]) }, () => new Date('2026-11-20T12:00:00').getTime());
  observe({ session_id: 's1', hook_event_name: 'SessionStart', model: 'claude-haiku-5-5' });
  observe({ session_id: 's1', hook_event_name: 'PostToolUse' });
  assert.equal(calls.length, 0, 'only prompts, tool starts and stops count');
  observe({ session_id: 's1', hook_event_name: 'PreToolUse' });
  observe({ session_id: 's1', agent_id: 'agent-x', hook_event_name: 'SubagentStop' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0].model, 'claude-haiku-5-5');
  assert.ok(calls[0][0].costUsd > 0 && calls[0][0].costUsd < 0.01, 'Haiku is cheap');
  assert.equal(calls[1][0].agentId, 'x');
  const days = calls[1][1];
  assert.equal(days.length, 14);
  assert.equal(days.at(-1).date, '2026-11-20');
});

test('the demo\'s context grows with each step, and a compaction shows until the next step', () => {
  let now = new Date('2026-11-20T12:00:00').getTime();
  /** @type {any[]} */
  const records = [];
  const store = createStore({ now: () => now });
  const observe = createDemoUsage({ setUsage: (r, d) => {
    records.push(structuredClone(r));
    store.setUsage(r, d);
  } }, () => now);
  const step = (/** @type {string} */ name) => {
    now += 1000;
    observe({ session_id: 's1', hook_event_name: name });
  };
  step('UserPromptSubmit');
  for (let i = 0; i < 40; i++) step('PreToolUse');
  const grown = records.map((r) => r.context.tokens);
  assert.ok(grown[0] > 18_000 && grown.every((tokens, i) => i === 0 || tokens > grown[i - 1]), 'grows with every step');
  assert.ok(grown.at(-1) > 80_000 && grown.at(-1) < 200_000, `plausible: ${grown.at(-1)}`);
  assert.equal(records.at(-1).context.at, now);
  // As on the server: PreCompact changes nothing, PostCompact drops the reading.
  step('PreCompact');
  assert.equal(records.length, 41);
  step('PostCompact');
  assert.equal(records.at(-1).context, null);
  assert.equal(records.at(-1).compactedAt, now);
  assert.equal(store.getState().usage['s1:main'].compactedAt, now, 'the store takes it too');
  step('PreToolUse');
  const after = records.at(-1).context.tokens;
  assert.ok(after > 26_000 && after < 40_000, `starts again from the summary: ${after}`);
});
