import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import { DEMO_APPROVAL_MS, createDemo, normalizeAgentId } from '../../../public/js/ui/demo-mode.js';

function fakeStore() {
  /** @type {any[]} */
  const envelopes = [];
  /** @type {any[]} */
  const approvals = [];
  return { envelopes, approvals, ingest: (e) => envelopes.push(e), setApproval: (a) => approvals.push(a) };
}

function fakeSimulation() {
  const sim = { emit: null, options: null, running: false, speed: 1, start() { sim.running = true; }, stop() { sim.running = false; }, setSpeed(n) { sim.speed = n; } };
  const create = (options) => {
    sim.options = options;
    sim.emit = options.emit;
    return sim;
  };
  return { sim, create };
}

const permission = { hook_event_name: 'PermissionRequest', session_id: 's1', agent_id: 'agent-abc', tool_name: 'Bash', tool_input: { command: 'npm publish' }, cwd: '/w/app' };

describe('demo mode', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 }));
  afterEach(() => mock.timers.reset());

  test('wraps hook payloads as envelopes with rising ids', () => {
    const store = fakeStore();
    const { sim, create } = fakeSimulation();
    createDemo({ store, createSimulation: create, seed: 7, speed: 2 }).start();
    assert.equal(sim.running, true);
    assert.deepEqual(sim.options.seed, 7);
    assert.equal(sim.emit({ hook_event_name: 'SessionStart', session_id: 's1' }), undefined);
    sim.emit({ hook_event_name: 'Stop', session_id: 's1' });
    assert.deepEqual(store.envelopes.map((e) => e.id), [1, 2]);
    assert.equal(store.envelopes[0].ts, 1_000_000);
    assert.equal(store.envelopes[0].event.hook_event_name, 'SessionStart');
  });

  test('a permission request is held until the town decides', async () => {
    const store = fakeStore();
    const { sim, create } = fakeSimulation();
    const demo = createDemo({ store, createSimulation: create });
    const answer = sim.emit(permission);
    assert.equal(store.approvals.length, 1);
    const approval = store.approvals[0];
    assert.equal(approval.status, 'pending');
    assert.equal(approval.held, true);
    assert.equal(approval.agentId, 'abc');
    assert.equal(approval.expiresAt - approval.createdAt, DEMO_APPROVAL_MS);
    assert.equal(demo.decide(approval.id, 'deny'), true);
    assert.deepEqual(await answer, { decision: 'deny' });
    assert.equal(store.approvals[1].status, 'denied');
    assert.equal(store.approvals[1].decidedBy, 'town');
    assert.equal(demo.decide(approval.id, 'allow'), false, 'a settled request cannot be decided again');
  });

  test('no answer in time expires the request and lets the story carry on', async () => {
    const store = fakeStore();
    const { sim, create } = fakeSimulation();
    createDemo({ store, createSimulation: create, speed: 4 });
    const answer = sim.emit(permission);
    assert.equal(store.approvals[0].expiresAt - store.approvals[0].createdAt, DEMO_APPROVAL_MS / 4);
    mock.timers.tick(DEMO_APPROVAL_MS / 4);
    assert.deepEqual(await answer, {});
    assert.equal(store.approvals[1].status, 'expired');
    assert.equal(store.approvals[1].decidedBy, 'timeout');
  });

  test('pause, speed and dispose reach the simulation', async () => {
    const store = fakeStore();
    const { sim, create } = fakeSimulation();
    const demo = createDemo({ store, createSimulation: create });
    demo.start();
    demo.setPaused(true);
    assert.equal(sim.running, false);
    demo.setPaused(false);
    assert.equal(sim.running, true);
    demo.setSpeed(4);
    assert.equal(sim.speed, 4);
    const answer = sim.emit(permission);
    demo.dispose();
    assert.equal(sim.running, false);
    assert.deepEqual(await answer, {});
  });

  test('pausing the demo stops the countdown of a waiting request, and resuming restarts it', async () => {
    const store = fakeStore();
    const { sim, create } = fakeSimulation();
    const demo = createDemo({ store, createSimulation: create });
    demo.start();
    const answer = sim.emit(permission);
    const id = store.approvals[0].id;
    mock.timers.tick(10_000);
    demo.setPaused(true);
    const frozen = store.approvals.at(-1);
    assert.equal(frozen.status, 'pending');
    assert.equal(frozen.expiresAt, null, 'the card shows no countdown while paused');
    mock.timers.tick(DEMO_APPROVAL_MS * 4);
    assert.equal(store.approvals.at(-1).status, 'pending', 'no expiry while the story stands still');
    demo.setPaused(false);
    const resumed = store.approvals.at(-1);
    assert.equal(resumed.expiresAt - Date.now(), DEMO_APPROVAL_MS - 10_000, 'the time left is kept');
    assert.equal(resumed.expiresAt - resumed.createdAt, DEMO_APPROVAL_MS, 'the countdown bar keeps its scale');
    mock.timers.tick(DEMO_APPROVAL_MS - 10_001);
    assert.equal(store.approvals.at(-1).status, 'pending');
    mock.timers.tick(1);
    assert.deepEqual(await answer, {});
    assert.equal(store.approvals.at(-1).status, 'expired');
    assert.equal(store.approvals.at(-1).id, id);
  });

  test('a paused demo can still be answered, and a request made while paused waits for the resume', async () => {
    const store = fakeStore();
    const { sim, create } = fakeSimulation();
    const demo = createDemo({ store, createSimulation: create });
    demo.setPaused(true);
    const answer = sim.emit(permission);
    assert.equal(store.approvals.at(-1).expiresAt, null);
    mock.timers.tick(DEMO_APPROVAL_MS * 2);
    assert.equal(store.approvals.at(-1).status, 'pending');
    assert.equal(demo.decide(store.approvals.at(-1).id, 'allow'), true);
    assert.deepEqual(await answer, { decision: 'allow' });
    demo.setPaused(false);
    assert.equal(store.approvals.at(-1).status, 'allowed', 'resuming does not bring a settled request back');
  });

  test('agent ids lose their "agent-" prefix', () => {
    assert.equal(normalizeAgentId('agent-x1'), 'x1');
    assert.equal(normalizeAgentId('x1'), 'x1');
    assert.equal(normalizeAgentId(''), null);
    assert.equal(normalizeAgentId(undefined), null);
  });
});
