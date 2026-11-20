import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crewUsage, formatCost, formatTokens, lastDays, usageSentence, usageShort } from '../../../public/js/ui/usage.js';
import { createDemoUsage } from '../../../public/js/sources/demo-usage.js';
import { createStore } from '../../../public/js/core/store.js';

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

const usage = (cost, tokens = 1000) => ({ tokens: { input: tokens, output: 10, cacheRead: 0, cacheWrite: 0 }, costUsd: cost, unpriced: false, model: 'claude-opus-5-5' });

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
