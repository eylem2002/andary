// When you were away (server/digest.mjs): no prompt and no decision from you for 20 minutes while
// crews kept working; and the server's digest, fed by hooks and the approval broker.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AWAY_MS, createAwayWatch, createTownDigest } from '../../../server/digest.mjs';
import { FIXTURES, createFakeClock, hook } from '../core/helpers.mjs';

const MINUTE = 60_000;

/** An away watch on a fake clock whose timers fire at their time; `changes` lists what it said. */
function watch() {
  const clock = createFakeClock(0);
  /** @type {any[]} */
  const changes = [];
  const away = createAwayWatch({ now: clock.now, onChange: (a) => changes.push(a), setTimer: (fn, ms) => clock.setTimeout(fn, ms), clearTimer: (id) => clock.clearTimeout(id) });
  return {
    away,
    changes,
    clock,
    /** Moves the clock on to `t`, running every timer due by then. @param {number} t */
    at: (t) => clock.advance(t - clock.now()),
    /** A hook arriving now. @param {Record<string, any>} event */
    send: (event) => away.observe(event, clock.now()),
  };
}

describe('away: no prompt and no decision for 20 minutes while crews kept working', () => {
  test('crews working after your prompt: away from the 20-minute mark, back with your next prompt', async () => {
    const { away, changes, at, send } = watch();
    await at(1 * MINUTE);
    send(FIXTURES.UserPromptSubmit);
    await at(2 * MINUTE);
    send(FIXTURES.PreToolUse);
    await at(21 * MINUTE - 1);
    assert.deepEqual(changes, [], 'not yet: 20 minutes after your prompt');
    await at(21 * MINUTE);
    assert.deepEqual(changes, [{ since: 1 * MINUTE, until: null }], 'an open town hears of it at once, with no hook to wake it');
    assert.deepEqual(away.current(), { since: 1 * MINUTE, until: null });
    await at(50 * MINUTE);
    send(FIXTURES.PreToolUse);
    assert.equal(changes.length, 1, 'more work while you are away changes nothing');
    await at(64 * MINUTE);
    send(FIXTURES.UserPromptSubmit);
    assert.deepEqual(changes.at(-1), { since: 1 * MINUTE, until: 64 * MINUTE });
    assert.deepEqual(away.current(), { since: 1 * MINUTE, until: 64 * MINUTE });
  });

  test('a prompt within 20 minutes: never away', async () => {
    const { changes, at, send } = watch();
    send(FIXTURES.UserPromptSubmit);
    for (let minute = 1; minute <= 100; minute += 1) {
      await at(minute * MINUTE);
      send(minute % 19 === 0 ? FIXTURES.UserPromptSubmit : FIXTURES.PreToolUse);
    }
    assert.deepEqual(changes, []);
  });

  test('20 minutes without a prompt while no crew worked is no absence', async () => {
    const { away, changes, at, send } = watch();
    send(FIXTURES.UserPromptSubmit);
    await at(90 * MINUTE);
    send(FIXTURES.UserPromptSubmit);
    assert.deepEqual(changes, []);
    assert.equal(away.current(), null);
  });

  test('work that comes after 20 minutes of silence starts it at once', async () => {
    const { changes, at, send } = watch();
    send(FIXTURES.UserPromptSubmit);
    await at(30 * MINUTE);
    send(FIXTURES.Stop);
    assert.deepEqual(changes, [{ since: 0, until: null }]);
  });

  test('before your first prompt, the town\'s start counts as when you were last seen', async () => {
    const { changes, at, send } = watch();
    await at(5 * MINUTE);
    send(FIXTURES.SessionStart);
    await at(AWAY_MS);
    assert.deepEqual(changes, [{ since: 0, until: null }]);
  });

  test('a decision in the town is you; an answer in the terminal, an expiry or a release is not', async () => {
    const { away, changes, at, send } = watch();
    send(FIXTURES.PreToolUse);
    await at(10 * MINUTE);
    for (const approval of [{ status: 'resolved', decidedBy: 'terminal' }, { status: 'expired', decidedBy: 'timeout' }, { status: 'pending', held: false }]) away.approvalChanged(approval);
    await at(25 * MINUTE);
    assert.deepEqual(changes, [{ since: 0, until: null }], 'away 20 minutes after the town started');
    away.approvalChanged({ status: 'allowed', decidedBy: 'town' });
    assert.deepEqual(changes.at(-1), { since: 0, until: 25 * MINUTE });
    send(FIXTURES.PreToolUse);
    await at(40 * MINUTE);
    away.approvalChanged({ status: 'denied', decidedBy: 'town' });
    send(FIXTURES.PreToolUse);
    await at(59 * MINUTE);
    assert.equal(changes.length, 2, 'the denial was you too: away 20 minutes after it, not after the allow');
    await at(60 * MINUTE);
    assert.deepEqual(changes.at(-1), { since: 40 * MINUTE, until: null });
  });

  test('a /compact you ran is a prompt, as the dialog model reads one; an automatic one is work', async () => {
    const { changes, at, send } = watch();
    send(FIXTURES.PreToolUse);
    await at(19 * MINUTE);
    send(FIXTURES.PreCompact);
    await at(25 * MINUTE);
    assert.deepEqual(changes, [{ since: 0, until: null }], 'the agent compacting on its own is no sign of you');
    send({ ...FIXTURES.PreCompact, trigger: 'manual' });
    assert.deepEqual(changes.at(-1), { since: 0, until: 25 * MINUTE });
  });

  test('the doctor\'s probe is not a crew at work', async () => {
    const { changes, at, send } = watch();
    send({ ...FIXTURES.Notification, session_id: 'andary-doctor-1b2c' });
    await at(30 * MINUTE);
    send({ ...FIXTURES.SessionEnd, session_id: 'andary-doctor-1b2c' });
    assert.deepEqual(changes, []);
  });

  test('dispose stops the timer', async () => {
    const { away, changes, at, send, clock } = watch();
    send(FIXTURES.PreToolUse);
    assert.equal(clock.pending, 1);
    away.dispose();
    assert.equal(clock.pending, 0);
    await at(30 * MINUTE);
    assert.deepEqual(changes, []);
  });
});

describe('the town digest', () => {
  test('hooks and the broker\'s answers reach the counts and the away watch; a period counts from its bucket', async () => {
    const clock = createFakeClock(0);
    /** @type {any[]} */
    const aways = [];
    const digest = createTownDigest({ now: clock.now, onAway: (a) => aways.push(a), setTimer: (fn, ms) => clock.setTimeout(fn, ms), clearTimer: (id) => clock.clearTimeout(id) });
    digest.observe(FIXTURES.UserPromptSubmit);
    await clock.advance(1000);
    digest.observe(FIXTURES.PermissionRequest);
    await clock.advance(AWAY_MS);
    assert.deepEqual(digest.away(), { since: 0, until: null });
    digest.approvalChanged({ id: 'a1', status: 'allowed', decidedBy: 'town', held: false, sessionId: FIXTURES.Stop.session_id, agentId: null, source: 'claude', toolName: 'Bash', toolInput: {}, callKey: null, cwd: '/w', createdAt: 0, expiresAt: null, suggestions: [] });
    assert.deepEqual(aways, [{ since: 0, until: null }, { since: 0, until: AWAY_MS + 1000 }]);
    digest.observe(hook('Stop', { last_assistant_message: 'Shipped.' }));
    const [crew] = digest.summary(0).crews;
    assert.deepEqual([crew.asked, crew.answered, crew.turns, crew.lastMessage], [1, 1, 1, 'Shipped.']);
    assert.equal(digest.summary(Date.now() + 1e9).since <= clock.now(), true, 'a time after now counts from now');
    digest.dispose();
  });
});
