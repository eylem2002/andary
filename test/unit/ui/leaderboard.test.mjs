import assert from 'node:assert/strict';
import { test } from 'node:test';
import { busiestAgents, createRecords, streakOf } from '../../../public/js/core/records.js';
import { growthText, holderName } from '../../../public/js/ui/leaderboard.js';

/** @returns {any} */
const ev = (kind, ts, commandKind, agentKey = 's1:main', sessionId = 's1', extra = {}) => ({ kind, ts, sessionId, agentKey, data: { commandKind, ...extra } });

test('the fastest fix is from a crew\'s first failing test run to its next passing one', () => {
  const r = createRecords();
  r.observe(ev('tool.fail', 1000, 'test'));
  r.observe(ev('tool.fail', 5000, 'test'));
  r.observe(ev('tool.end', 3000, 'build'));
  r.observe(ev('tool.end', 61_000, 'test', 's1:abc'));
  assert.deepEqual(r.snapshot().fastest, { sessionId: 's1', agentKey: 's1:abc', ms: 60_000 });
  r.observe(ev('tool.fail', 100_000, 'test', 's2:main', 's2'));
  r.observe(ev('tool.end', 130_000, 'test', 's2:main', 's2'));
  assert.equal(r.snapshot().fastest?.ms, 30_000);
  r.observe(ev('tool.end', 200_000, 'test'));
  assert.equal(r.snapshot().greens.length, 2);
  r.observe(ev('tool.fail', 300_000, 'test', 's3:main', 's3', { isInterrupt: true }));
  r.observe(ev('tool.end', 301_000, 'test', 's3:main', 's3'));
  assert.equal(r.snapshot().greens.length, 2, 'an interrupt is not a failure to fix');
  r.observe(ev('tool.fail', 0, 'test', 's4:main', 's4'));
  r.observe(ev('tool.end', 3 * 60 * 60_000, 'test', 's4:main', 's4'));
  assert.equal(r.snapshot().greens.length, 2, 'too long ago to count as a fix');
  assert.equal(r.snapshot().testRuns.get('s1:main'), 3);
});

test('streakOf counts busy days back from today, or from yesterday', () => {
  const now = new Date('2026-11-20T12:00:00').getTime();
  assert.equal(streakOf(['2026-11-18', '2026-11-19', '2026-11-20'], now), 3);
  assert.equal(streakOf(['2026-11-18', '2026-11-19'], now), 2);
  assert.equal(streakOf(['2026-11-17', '2026-11-19', '2026-11-20'], now), 2);
  assert.equal(streakOf(['2026-11-10'], now), 0);
  assert.equal(streakOf([], now), 0);
});

test('busiestAgents ranks by tool calls, then files changed', () => {
  const agent = (key, name, counts, changes = 0) => ({ key, name, sessionId: 's1', toolCounts: counts, changes: Array(changes).fill(0) });
  const state = { agents: { a: agent('a', 'Scout 1', { Read: 3 }), b: agent('b', 'Builder 1', { Edit: 2, Bash: 1 }, 2), c: agent('c', 'Idle', {}) } };
  assert.deepEqual(busiestAgents(state).map((r) => r.agent.name), ['Builder 1', 'Scout 1']);
  assert.equal(busiestAgents(state, 1).length, 1);
});

test('growthText and holderName read naturally', () => {
  assert.equal(growthText(0), '0 points. Next: bunting along the north avenue, in 10 points.');
  assert.equal(growthText(99), '99 points. Next: a Ferris wheel on the beach, in 1 point.');
  assert.equal(growthText(600), '600 points: every landmark is built.');
  const state = /** @type {any} */ ({ agents: { 's1:main': { name: 'Foreman', sessionId: 's1' } }, sessions: [{ id: 's1', project: 'api-server' }] });
  assert.equal(holderName(state, 's1:main'), 'Foreman in api-server');
  assert.equal(holderName(state, 'gone'), 'an agent who has gone home');
});
