// The server's side of the andary-limits mod: what a report may hold, and how limits are kept per
// account (server/limits.mjs).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LIMITS_BODY_BYTES, createLimitsTracker, parseLimitsReport } from '../../../server/limits.mjs';

const NOW = Date.parse('2026-11-21T12:00:00.000Z');
const HOUR = 3_600_000;
const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();

/** @param {unknown} body */
const parse = (body) => parseLimitsReport(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)), NOW);

describe('parseLimitsReport', () => {
  it('reads what the mod sends', () => {
    const report = parse({
      v: 1,
      sessionId: 'b3f1c2d4-1111-2222-3333-444455556666',
      claudeVersion: '2.1.330',
      configDir: '/home/u/.claude-work',
      limits: [{ kind: 'five_hour', percentUsed: 42.04, resetsAt: iso(NOW + 3 * HOUR) }, { kind: 'seven_day', percentUsed: 12, resetsAt: iso(NOW + 72 * HOUR) }],
      context: { tokens: 182_340, window: 1_000_000 },
    });
    assert.deepEqual(report.limits, [{ kind: 'five_hour', percentUsed: 42, resetsAt: NOW + 3 * HOUR }, { kind: 'seven_day', percentUsed: 12, resetsAt: NOW + 72 * HOUR }]);
    assert.equal(report.sessionId, 'b3f1c2d4-1111-2222-3333-444455556666');
    assert.equal(report.claudeVersion, '2.1.330');
    assert.deepEqual(report.context, { tokens: 182_340, window: 1_000_000 });
    // The folder's path stays on the server: a key made from it, and its name.
    assert.match(report.account, /^dir-[\w-]{16}$/);
    assert.equal(report.label, '.claude-work');
    assert.ok(!JSON.stringify(report).includes('/home/u'));
    assert.equal(parse({ v: 1, configDir: '/home/u/.claude-work/' }).account, report.account, 'a trailing slash names the same folder');
    assert.notEqual(parse({ v: 1, configDir: '/home/u/.claude' }).account, report.account);
  });

  it('refuses what is not a version-1 JSON object', () => {
    for (const body of ['not json', '[]', 'null', { v: 2, limits: [] }, { limits: [] }]) {
      assert.throws(() => parse(body), (/** @type {any} */ error) => error.status === 400);
    }
    assert.equal(LIMITS_BODY_BYTES, 16 * 1024);
  });

  it('drops malformed or implausible limits, and bounds every field', () => {
    const report = parse({
      v: 1,
      sessionId: 'x'.repeat(201),
      claudeVersion: '2.1.330; rm -rf /',
      configDir: 42,
      limits: [
        { kind: 'five_hour', percentUsed: 140, resetsAt: iso(NOW + HOUR) },
        { kind: 'five_hour', percentUsed: 1, resetsAt: iso(NOW + HOUR) },
        { kind: 'Seven Day', percentUsed: 1, resetsAt: iso(NOW + HOUR) },
        { kind: 'seven_day', percentUsed: -5, resetsAt: iso(NOW + HOUR) },
        { kind: 'spend_limit', percentUsed: 1, resetsAt: iso(NOW + 40 * 24 * HOUR) },
        { kind: 'old', percentUsed: 1, resetsAt: iso(NOW - 25 * HOUR) },
        { kind: 'nan', percentUsed: Number.NaN, resetsAt: iso(NOW + HOUR) },
        { kind: 'date', percentUsed: 1, resetsAt: 'tomorrow' },
        'junk',
      ],
      context: { tokens: 1.5, window: 1_000_000 },
    });
    assert.deepEqual(report.limits.map((l) => [l.kind, l.percentUsed]), [['five_hour', 100], ['seven_day', 0]]);
    assert.equal(report.sessionId, null);
    assert.equal(report.claudeVersion, null);
    assert.deepEqual([report.account, report.label], ['default', null]);
    assert.equal(report.context, null);
    const many = parse({ v: 1, limits: Array.from({ length: 20 }, (_, i) => ({ kind: `k${i}`, percentUsed: 1, resetsAt: iso(NOW + HOUR) })) });
    assert.equal(many.limits.length, 8);
  });
});

describe('createLimitsTracker', () => {
  it('keeps limits per account, each with the time it was read, and drops windows that reset', () => {
    let now = NOW;
    /** @type {any[]} */
    const changes = [];
    const tracker = createLimitsTracker({ now: () => now, onChange: (snapshot, account) => changes.push({ snapshot, account }) });
    tracker.observe({ ...parse({ v: 1, sessionId: 's1', limits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: iso(NOW + HOUR) }, { kind: 'seven_day', percentUsed: 10, resetsAt: iso(NOW + 48 * HOUR) }], context: { tokens: 5, window: 10 } }), claudeVersion: '2.1.330' });
    now += 60_000;
    // A session before its first answer (or on an API key) reports no limits: the account keeps its own.
    tracker.observe(parse({ v: 1, sessionId: 's2', claudeVersion: '2.1.331', limits: [] }));
    now += 60_000;
    tracker.observe(parse({ v: 1, sessionId: 's1', limits: [{ kind: 'five_hour', percentUsed: 47, resetsAt: iso(NOW + HOUR) }] }));
    const account = tracker.snapshot().accounts[0];
    assert.equal(account.account, 'default');
    assert.equal(account.claudeVersion, '2.1.331', 'a report without a version keeps the last one');
    assert.deepEqual(account.limits, [
      { kind: 'five_hour', percentUsed: 47, resetsAt: NOW + HOUR, at: NOW + 120_000 },
      { kind: 'seven_day', percentUsed: 10, resetsAt: NOW + 48 * HOUR, at: NOW },
    ]);
    assert.deepEqual(tracker.snapshot().contexts, { s1: { tokens: 5, window: 10, at: NOW } });
    assert.equal(changes.length, 3);
    assert.deepEqual(changes[2].account, account);
    now = NOW + 2 * HOUR;
    assert.deepEqual(tracker.snapshot().accounts[0].limits.map((l) => l.kind), ['seven_day']);
  });

  it('tells accounts apart by their config folder, newest first, and keeps at most eight', () => {
    let now = NOW;
    const tracker = createLimitsTracker({ now: () => now });
    for (let i = 0; i < 10; i += 1) {
      now += 1000;
      tracker.observe(parse({ v: 1, configDir: `/home/u/.claude-${i}`, limits: [{ kind: 'five_hour', percentUsed: i, resetsAt: iso(NOW + HOUR) }] }));
    }
    const { accounts } = tracker.snapshot();
    assert.equal(accounts.length, 8);
    assert.deepEqual(accounts.map((a) => a.label).slice(0, 2), ['.claude-9', '.claude-8']);
    assert.ok(!accounts.some((a) => a.label === '.claude-0'));
  });
});
