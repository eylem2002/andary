import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DENY_MESSAGE, createApprovalBroker, decisionOutput, normalizeAgentId } from '../../../server/approvals.mjs';

/** A broker with a fake clock and manual timers. */
function setup({ maxPending = 50, maxSettled = 50 } = {}) {
  let now = 1_000;
  /** @type {Map<number, () => void>} */
  const timers = new Map();
  let nextTimer = 1;
  /** @type {any[]} */
  const changes = [];
  const broker = createApprovalBroker({
    timeoutMs: 120_000,
    maxPending,
    maxSettled,
    now: () => now,
    onChange: (approval) => changes.push(approval),
    timers: {
      set: (fn) => {
        timers.set(nextTimer, fn);
        return nextTimer++;
      },
      clear: (handle) => timers.delete(handle),
    },
  });
  return {
    broker,
    changes,
    advance: (/** @type {number} */ ms) => {
      now += ms;
    },
    fireTimers: () => {
      const due = [...timers.values()];
      timers.clear();
      for (const fn of due) fn();
    },
    timerCount: () => timers.size,
  };
}

const request = (/** @type {Record<string, any>} */ extra = {}) => ({
  hook_event_name: 'PermissionRequest',
  session_id: 's1',
  cwd: '/work/app',
  tool_name: 'Bash',
  tool_input: { command: 'rm -rf build' },
  ...extra,
});

/** Resolves to 'pending' if the promise has not settled yet. */
const peek = (/** @type {Promise<any>} */ promise) => Promise.race([promise, new Promise((resolve) => setImmediate(() => resolve('pending')))]);

describe('decision helpers', () => {
  it('builds the allow and deny outputs from the contract', () => {
    assert.deepEqual(decisionOutput('allow'), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
    assert.deepEqual(decisionOutput('deny'), {
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: DENY_MESSAGE } },
    });
    assert.equal(decisionOutput('deny', 'use the staging db').hookSpecificOutput.decision.message, `${DENY_MESSAGE}: use the staging db`);
  });

  it('normalises agent ids', () => {
    assert.equal(normalizeAgentId('agent-a1b2'), 'a1b2');
    assert.equal(normalizeAgentId('a1b2'), 'a1b2');
    assert.equal(normalizeAgentId(''), null);
    assert.equal(normalizeAgentId(undefined), null);
    // Same rule as the browser (public/js/core/events.js), so approvals always match their agent.
    assert.equal(normalizeAgentId('  agent-a1b2 '), 'a1b2');
    assert.equal(normalizeAgentId('agent-'), 'agent-');
  });
});

describe('held approvals', () => {
  it('waits for the town and answers allow', async () => {
    const { broker, changes } = setup();
    const { approval, response } = broker.create(request({ agent_id: 'agent-7' }), { hold: true });
    assert.equal(approval.status, 'pending');
    assert.equal(approval.held, true);
    assert.equal(approval.agentId, '7');
    assert.equal(approval.expiresAt, approval.createdAt + 120_000);
    assert.deepEqual(approval.toolInput, { command: 'rm -rf build' });
    assert.equal(await peek(response), 'pending');
    assert.deepEqual(broker.decide(approval.id, 'allow'), { ok: true });
    assert.deepEqual(await response, decisionOutput('allow'));
    assert.deepEqual(
      changes.map((a) => [a.status, a.decidedBy]),
      [
        ['pending', undefined],
        ['allowed', 'town'],
      ],
    );
  });

  it('answers deny with the typed reason, trimmed to 500 characters', async () => {
    const { broker } = setup();
    const { approval, response } = broker.create(request(), { hold: true });
    broker.decide(approval.id, 'deny', `  ${'n'.repeat(600)}  `);
    const output = /** @type {any} */ (await response);
    assert.equal(output.hookSpecificOutput.decision.behavior, 'deny');
    assert.equal(output.hookSpecificOutput.decision.message, `${DENY_MESSAGE}: ${'n'.repeat(500)}`);
    assert.equal(broker.list()[0].message, 'n'.repeat(500));
  });

  it('expires after the timeout and answers null', async () => {
    const { broker, fireTimers, changes } = setup();
    const { response } = broker.create(request(), { hold: true });
    fireTimers();
    assert.equal(await response, null);
    assert.deepEqual([changes.at(-1).status, changes.at(-1).decidedBy], ['expired', 'timeout']);
  });

  it('refuses unknown ids, bad decisions, double decisions and non-held approvals', () => {
    const { broker } = setup();
    const held = broker.create(request(), { hold: true }).approval;
    const free = broker.create(request(), { hold: false }).approval;
    assert.equal(broker.decide('nope', 'allow').ok, false);
    assert.equal(broker.decide(held.id, 'maybe').ok, false);
    assert.equal(broker.decide(free.id, 'allow').ok, false);
    assert.equal(broker.decide(held.id, 'allow').ok, true);
    assert.match(broker.decide(held.id, 'deny').error ?? '', /already allowed/);
  });

  it('releases a held approval to the terminal and stops its timer', async () => {
    const { broker, timerCount, changes } = setup();
    const { approval, response } = broker.create(request(), { hold: true });
    broker.release(approval.id);
    assert.equal(await response, null);
    assert.equal(timerCount(), 0);
    const latest = changes.at(-1);
    assert.deepEqual([latest.status, latest.held, latest.expiresAt], ['pending', false, null]);
    assert.equal(broker.decide(approval.id, 'allow').ok, false);
  });

  it('releaseAll hands every held approval back', async () => {
    const { broker } = setup();
    const a = broker.create(request(), { hold: true });
    const b = broker.create(request({ session_id: 's2' }), { hold: true });
    assert.equal(broker.heldCount(), 2);
    broker.releaseAll();
    assert.deepEqual(await Promise.all([a.response, b.response]), [null, null]);
    assert.equal(broker.heldCount(), 0);
  });
});

describe('terminal resolution of non-held approvals', () => {
  it('answers null at once and resolves on the next result for the same tool', async () => {
    const { broker, changes } = setup();
    const { approval, response } = broker.create(request(), { hold: false });
    assert.equal(await response, null);
    assert.equal(approval.expiresAt, null);
    assert.equal(broker.observe({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Read' }), 0);
    assert.equal(broker.observe({ hook_event_name: 'PostToolUse', session_id: 's2', tool_name: 'Bash' }), 0);
    assert.equal(broker.observe({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Bash', agent_id: 'x' }), 0);
    assert.equal(broker.observe({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Bash' }), 1);
    assert.deepEqual([changes.at(-1).status, changes.at(-1).decidedBy], ['resolved', 'terminal']);
  });

  it('resolves the oldest matching approval per tool result', () => {
    const { broker } = setup();
    const first = broker.create(request(), { hold: false }).approval;
    const second = broker.create(request(), { hold: false }).approval;
    broker.observe({ hook_event_name: 'PostToolUseFailure', session_id: 's1', tool_name: 'Bash' });
    const byId = Object.fromEntries(broker.list().map((a) => [a.id, a.status]));
    assert.deepEqual([byId[first.id], byId[second.id]], ['resolved', 'pending']);
  });

  it('matches agents with or without the agent- prefix, and PermissionDenied', () => {
    const { broker } = setup();
    broker.create(request({ agent_id: 'agent-42', tool_name: 'Write' }), { hold: false });
    assert.equal(broker.observe({ hook_event_name: 'PermissionDenied', session_id: 's1', agent_id: '42', tool_name: 'Write' }), 1);
  });

  it('resolves everything for an agent on Stop/SubagentStop and for a session on SessionEnd', () => {
    const { broker } = setup();
    broker.create(request(), { hold: false });
    broker.create(request({ tool_name: 'Edit' }), { hold: false });
    broker.create(request({ agent_id: 'sub-1' }), { hold: false });
    broker.create(request({ session_id: 's2' }), { hold: false });
    assert.equal(broker.observe({ hook_event_name: 'Stop', session_id: 's1' }), 2);
    assert.equal(broker.observe({ hook_event_name: 'SubagentStop', session_id: 's1', agent_id: 'sub-1' }), 1);
    assert.equal(broker.observe({ hook_event_name: 'SessionEnd', session_id: 's2' }), 1);
    assert.ok(broker.list().every((a) => a.status === 'resolved'));
  });

  it('never resolves held approvals from terminal events', () => {
    const { broker } = setup();
    broker.create(request(), { hold: true });
    assert.equal(broker.observe({ hook_event_name: 'SessionEnd', session_id: 's1' }), 0);
    assert.equal(broker.observe({ hook_event_name: 'Notification', session_id: 's1' }), 0);
  });
});

describe('limits and listing', () => {
  it('keeps at most maxPending pending approvals by expiring the oldest', async () => {
    const { broker } = setup({ maxPending: 3 });
    const first = broker.create(request(), { hold: true });
    for (let i = 0; i < 3; i += 1) broker.create(request(), { hold: true });
    assert.equal(await first.response, null);
    const pending = broker.list().filter((a) => a.status === 'pending');
    assert.equal(pending.length, 3);
    const expired = broker.list().find((a) => a.id === first.approval.id);
    assert.equal(expired?.status, 'expired');
    assert.equal(expired?.message, 'Too many pending approvals');
  });

  it('lists pending first (oldest first), then settled (newest first), capped', () => {
    const { broker, advance } = setup({ maxSettled: 2 });
    const ids = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push(broker.create(request(), { hold: true }).approval.id);
      advance(1);
    }
    broker.decide(ids[0], 'allow');
    broker.decide(ids[1], 'deny');
    broker.decide(ids[2], 'allow');
    assert.deepEqual(
      broker.list().map((a) => a.id),
      [ids[3], ids[4], ids[2], ids[1]],
    );
  });

  it('returns copies, so callers cannot change its state', () => {
    const { broker } = setup();
    const { approval } = broker.create(request(), { hold: true });
    approval.status = 'allowed';
    broker.list()[0].held = false;
    assert.equal(broker.list()[0].status, 'pending');
    assert.equal(broker.list()[0].held, true);
  });
});
