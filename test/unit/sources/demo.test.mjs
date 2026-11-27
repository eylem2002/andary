import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import { DEMO_APPROVAL_MS, createDemo } from '../../../public/js/sources/demo.js';

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
const SUGGESTION = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm publish' }], behavior: 'allow', destination: 'localSettings' };

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
    demo.close();
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

  test('a card in view holds the countdown while the story goes on; out of view it runs again', async () => {
    const store = fakeStore();
    const { sim, create } = fakeSimulation();
    const demo = createDemo({ store, createSimulation: create });
    demo.start();
    const answer = sim.emit(permission);
    mock.timers.tick(5_000);
    demo.holdApprovals(true);
    assert.equal(store.approvals.at(-1).expiresAt, null, 'no countdown while the card is read');
    assert.equal(sim.running, true, 'the story itself goes on');
    // A request that arrives while a card is in view waits too.
    const second = sim.emit({ ...permission, tool_input: { command: 'rm -rf dist' } });
    assert.equal(store.approvals.at(-1).expiresAt, null);
    mock.timers.tick(DEMO_APPROVAL_MS * 4);
    assert.ok(store.approvals.filter((a) => a.status === 'expired').length === 0, 'nothing expires meanwhile');
    // Pausing and resuming the story while the card is in view keeps the countdowns held.
    demo.setPaused(true);
    demo.setPaused(false);
    assert.equal(store.approvals.at(-1).expiresAt, null);
    demo.holdApprovals(false);
    const first = store.approvals.findLast((a) => a.id === 'demo-1');
    assert.equal(first.expiresAt - Date.now(), DEMO_APPROVAL_MS - 5_000, 'the time left is kept');
    mock.timers.tick(DEMO_APPROVAL_MS);
    assert.deepEqual(await answer, {});
    assert.deepEqual(await second, {});
  });

  test('a card in view and a pause both hold: the countdown runs again only when neither does', () => {
    const store = fakeStore();
    const { sim, create } = fakeSimulation();
    const demo = createDemo({ store, createSimulation: create });
    demo.start();
    sim.emit(permission);
    demo.setPaused(true);
    demo.holdApprovals(true);
    demo.holdApprovals(false);
    assert.equal(store.approvals.at(-1).expiresAt, null, 'still paused');
    demo.setPaused(false);
    assert.ok(store.approvals.at(-1).expiresAt > Date.now());
  });

  test('a permission request offers the rules the server would offer', () => {
    const store = fakeStore();
    const { sim, create } = fakeSimulation();
    createDemo({ store, createSimulation: create });
    sim.emit({ ...permission, permission_suggestions: [{ ...SUGGESTION, destination: 'userSettings' }, SUGGESTION] });
    assert.deepEqual(store.approvals[0].suggestions, [{ index: 1, rules: SUGGESTION.rules, destination: 'localSettings' }]);
    sim.emit(permission);
    assert.deepEqual(store.approvals[1].suggestions, [], 'none suggested, none offered');
  });

  test('"Allow always" allows, records the rule, and hands it back to the story like a hook decision', async () => {
    const store = fakeStore();
    const { sim, create } = fakeSimulation();
    const demo = createDemo({ store, createSimulation: create });
    const answer = sim.emit({ ...permission, permission_suggestions: [SUGGESTION] });
    const { id } = store.approvals[0];
    assert.equal(demo.decide(id, 'allow', undefined, 0), true);
    assert.deepEqual(await answer, { decision: 'allow', updatedPermissions: [SUGGESTION] });
    const decided = store.approvals.at(-1);
    assert.deepEqual([decided.status, decided.decidedBy], ['allowed', 'town']);
    assert.deepEqual(decided.always, { rules: SUGGESTION.rules, destination: 'localSettings', at: 1_000_000 });
  });

  test('"Allow always" is refused like the server: only with an allow and an offered rule', async () => {
    const store = fakeStore();
    const { sim, create } = fakeSimulation();
    const demo = createDemo({ store, createSimulation: create });
    const answer = sim.emit({ ...permission, permission_suggestions: [{ ...SUGGESTION, destination: 'projectSettings' }, SUGGESTION] });
    const { id } = store.approvals[0];
    assert.equal(demo.decide(id, 'deny', undefined, 1), false);
    assert.equal(demo.decide(id, 'allow', undefined, 0), false, 'a suggestion the town does not offer');
    assert.equal(demo.decide(id, 'allow', undefined, 2), false, 'no such suggestion');
    assert.equal(store.approvals.length, 1, 'nothing changed');
    assert.equal(demo.decide(id, 'allow'), true);
    assert.deepEqual(await answer, { decision: 'allow' });
    assert.equal(store.approvals.at(-1).always, undefined);
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

  test('catch me up: the demo answers as the server would, from the story\'s own crews', async () => {
    const store = fakeStore();
    const { sim, create } = fakeSimulation();
    /** @type {any[]} */
    const digests = [];
    const demo = createDemo({ store, createSimulation: create, onDigest: (d) => digests.push(d) });
    sim.emit({ hook_event_name: 'Stop', session_id: 's1', cwd: '/w/app', last_assistant_message: 'Done.' });
    const answer = sim.emit(permission);
    demo.decide(store.approvals[0].id, 'allow');
    await answer;
    assert.equal(demo.requestDigest(0), true);
    assert.equal(digests.length, 0, 'answered a moment later, like the server');
    await Promise.resolve();
    const [crew] = digests[0].crews;
    assert.deepEqual([crew.sessionId, crew.cwd, crew.turns, crew.lastMessage, crew.asked, crew.answered], ['s1', '/w/app', 1, 'Done.', 1, 1]);
    assert.equal(digests[0].until, Date.now());
  });
});
