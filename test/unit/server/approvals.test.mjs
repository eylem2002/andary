import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DENY_MESSAGE, createApprovalBroker, decisionOutput, offeredSuggestions } from '../../../server/approvals.mjs';
import { withCallKey } from '../../../server/hook-steps.mjs';
import { sanitize } from '../../../server/sanitize.mjs';
import { ORDER_SLACK_MS, inputKey } from '../../../public/js/core/dialogs.js';
import { normalizeAgentId } from '../../../public/js/core/ids.js';

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

  it('keeps a reason on one line, without control characters', async () => {
    const { broker } = setup();
    const { approval, response } = broker.create(request(), { hold: true });
    broker.decide(approval.id, 'deny', 'not\nthis\u0007 one\u001b[31m');
    const output = /** @type {any} */ (await response);
    assert.equal(output.hookSpecificOutput.decision.message, `${DENY_MESSAGE}: not this one [31m`);
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

  it("settles a Codex approval when the tool runs under the town's name for it (apply_patch → Edit)", () => {
    const { broker } = setup();
    broker.create(request({ tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch' } }), { hold: false });
    assert.equal(broker.observe({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Edit', andary_tool: 'apply_patch' }), 1);
    assert.equal(broker.list()[0].status, 'resolved');
  });

  it('never resolves held approvals from terminal events', () => {
    const { broker } = setup();
    broker.create(request(), { hold: true });
    assert.equal(broker.observe({ hook_event_name: 'SessionEnd', session_id: 's1' }), 0);
    assert.equal(broker.observe({ hook_event_name: 'Notification', session_id: 's1' }), 0);
  });
});

describe('the dialog model decides what the terminal answered (core/dialogs.js)', () => {
  /** Events as the broker gets them: stamped with their call key by ingest. @param {Record<string, any>} event */
  const keyed = (event) => withCallKey(event);
  /** @param {string} command @param {Record<string, any>} [extra] */
  const ask = (command, extra = {}) => keyed(request({ tool_input: { command }, ...extra }));
  /** @param {string} name @param {string} command @param {Record<string, any>} [extra] */
  const result = (name, command, extra = {}) => keyed({ hook_event_name: name, session_id: 's1', tool_name: 'Bash', tool_input: { command }, tool_use_id: 't', ...extra });
  /** @param {ReturnType<typeof setup>['broker']} broker */
  const states = (broker) => Object.fromEntries(broker.list().map((a) => [/** @type {any} */ (a.toolInput)?.command ?? a.toolName, [a.status, a.proof ?? null]]));

  it('parallel calls of one tool finishing out of order resolve their own approval', () => {
    const { broker } = setup();
    broker.create(ask('cat a'), { hold: false });
    broker.create(ask('cat b'), { hold: false });
    assert.equal(broker.observe(result('PostToolUse', 'cat b')), 1);
    assert.deepEqual(states(broker), { 'cat a': ['pending', null], 'cat b': ['resolved', 'ran'] });
    assert.equal(broker.observe(result('PostToolUseFailure', 'cat a', { error: 'No such file' })), 1);
    assert.deepEqual(states(broker), { 'cat a': ['resolved', 'ran'], 'cat b': ['resolved', 'ran'] });
  });

  it('your prompt after a "No" resolves what the terminal showed, whoever asked, so a reload does not bring it back', () => {
    const { broker } = setup();
    broker.create(ask('npm publish'), { hold: false });
    broker.create(ask('git push', { agent_id: 'agent-h1' }), { hold: false });
    broker.create(ask('npm run deploy', { agent_id: 'agent-h2' }), { hold: true });
    // "No" in the terminal sends nothing; you can type your next prompt only once nothing shows there.
    const prompt = keyed({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: 'do it differently' });
    assert.equal(broker.observe(prompt), 2);
    assert.deepEqual(states(broker), { 'npm publish': ['resolved', 'stopped'], 'git push': ['resolved', 'stopped'], 'npm run deploy': ['pending', null] }, 'held in the town: still waiting');
    assert.ok(broker.list().filter((a) => a.status === 'resolved').every((a) => a.decidedBy === 'terminal'));
    // Handed back to the terminal, it shows there: the next prompt answers it.
    broker.releaseAll();
    assert.equal(broker.observe(prompt), 1);
    assert.deepEqual(states(broker)['npm run deploy'], ['resolved', 'stopped']);
  });

  it('a plan asked again shows the older one was answered', () => {
    const { broker, advance } = setup();
    const plan = (/** @type {string} */ text) => ({ session_id: 's1', tool_name: 'ExitPlanMode', tool_input: { plan: text } });
    broker.observe(keyed({ hook_event_name: 'PreToolUse', ...plan('v1') }));
    broker.create(keyed(request(plan('v1'))), { hold: false });
    // "No, keep planning" sends nothing; the next plan does.
    advance(5_000);
    assert.equal(broker.observe(keyed({ hook_event_name: 'PreToolUse', ...plan('v2') })), 1);
    broker.create(keyed(request(plan('v2'))), { hold: false });
    assert.deepEqual(broker.list().map((a) => [/** @type {any} */ (a.toolInput).plan, a.status, a.proof ?? null]), [['v2', 'pending', null], ['v1', 'resolved', 'stopped']]);
    // Without its PreToolUse (not seen, or not sent), the second plan's request shows it too.
    const unseen = setup();
    unseen.broker.create(keyed(request(plan('v1'))), { hold: false });
    unseen.advance(5_000);
    unseen.broker.create(keyed(request(plan('v2'))), { hold: false });
    assert.deepEqual(unseen.broker.list().map((a) => [/** @type {any} */ (a.toolInput).plan, a.status, a.proof ?? null]), [['v2', 'pending', null], ['v1', 'resolved', 'stopped']]);
  });

  it('proof says what showed the terminal answered', () => {
    /** @type {[Record<string, any>, string][]} */
    const cases = [
      [result('PostToolUse', 'x'), 'ran'],
      [result('PostToolUseFailure', 'x', { error: 'Exit code 1' }), 'ran'],
      [result('PermissionDenied', 'x', { reason: 'not in auto mode' }), 'denied'],
      [keyed({ hook_event_name: 'Stop', session_id: 's1' }), 'stopped'],
      [keyed({ hook_event_name: 'StopFailure', session_id: 's1', error: 'server_error' }), 'stopped'],
      [keyed({ hook_event_name: 'PreCompact', session_id: 's1', trigger: 'manual' }), 'stopped'],
      [keyed({ hook_event_name: 'SessionEnd', session_id: 's1', reason: 'other' }), 'stopped'],
    ];
    for (const [event, proof] of cases) {
      const { broker } = setup();
      broker.create(ask('x'), { hold: false });
      assert.equal(broker.observe(event), 1, event.hook_event_name);
      assert.equal(broker.list()[0].proof, proof, event.hook_event_name);
    }
  });

  it("a question's request joins the question, and its answer resolves it whatever its input became", () => {
    const { broker } = setup();
    const asked = { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which port?' }] } };
    assert.equal(broker.observe(keyed({ hook_event_name: 'PreToolUse', session_id: 's1', ...asked })), 0);
    broker.create(keyed(request(asked)), { hold: false });
    const answered = { ...asked, tool_input: { ...asked.tool_input, answers: { 'Which port?': '8080' } } };
    assert.equal(broker.observe(keyed({ hook_event_name: 'PostToolUse', session_id: 's1', ...answered, tool_response: {} })), 1);
    assert.equal(broker.list()[0].proof, 'ran');
  });

  it("a decision in the town closes its request's dialog", () => {
    const { broker } = setup();
    const held = broker.create(ask('npm test'), { hold: true }).approval;
    broker.decide(held.id, 'allow');
    // The same command asked again, answered in the terminal: its run is not taken for the first.
    broker.create(ask('npm test'), { hold: false });
    assert.equal(broker.observe(result('PostToolUse', 'npm test')), 1);
    assert.deepEqual(broker.list().map((a) => [a.status, a.decidedBy]), [['resolved', 'terminal'], ['allowed', 'town']]);
  });

  it('an expired request stays expired; a released one resolves when its call runs', () => {
    const expired = setup();
    expired.broker.create(ask('npm test'), { hold: true });
    expired.fireTimers();
    assert.equal(expired.broker.observe(result('PostToolUse', 'npm test')), 0);
    assert.equal(expired.broker.list()[0].status, 'expired');
    const released = setup();
    const { approval } = released.broker.create(ask('npm test'), { hold: true });
    released.broker.release(approval.id);
    assert.equal(released.broker.observe(result('PostToolUse', 'npm test')), 1);
    assert.deepEqual([released.broker.list()[0].status, released.broker.list()[0].proof], ['resolved', 'ran']);
  });

  it('an approval carries its call key, so the town finds its own dialog', () => {
    const { broker } = setup();
    const { approval } = broker.create(ask('cat ../a'), { hold: false });
    assert.equal(approval.callKey, inputKey({ command: 'cat ../a' }));
    assert.equal(broker.create(request(), { hold: false }).approval.callKey, null, 'unstamped: no key');
  });

  it("goes by each hook's own time: a plan's request that overtook its PreToolUse stays pending", () => {
    // The request is sent at once, the PreToolUse in the background: here it lands 15 ms later.
    const { broker, advance } = setup();
    const plan = (/** @type {string} */ text) => ({ session_id: 's1', tool_name: 'ExitPlanMode', tool_input: { plan: text } });
    broker.observe(keyed({ hook_event_name: 'PreToolUse', ...plan('v1') }), 1_000);
    broker.create(keyed(request(plan('v1'))), { hold: false, at: 1_000 });
    // "No, keep planning"; the revised plan's request (sent at 9,995) arrives before its start (9,990).
    advance(9_000);
    broker.create(keyed(request(plan('v2'))), { hold: false, at: 9_995 });
    advance(15);
    assert.equal(broker.observe(keyed({ hook_event_name: 'PreToolUse', ...plan('v2') }), 9_990), 0, 'its own start answers nothing');
    assert.deepEqual(broker.list().map((a) => [/** @type {any} */ (a.toolInput).plan, a.status, a.proof ?? null]), [['v2', 'pending', null], ['v1', 'resolved', 'stopped']]);
    // "No" again; the next plan arrives in the same order: v2 was answered, v3 waits.
    advance(10_000);
    broker.create(keyed(request(plan('v3'))), { hold: false, at: 20_005 });
    assert.equal(broker.observe(keyed({ hook_event_name: 'PreToolUse', ...plan('v3') }), 20_000), 0);
    assert.deepEqual(broker.list().map((a) => [/** @type {any} */ (a.toolInput).plan, a.status]), [['v3', 'pending'], ['v2', 'resolved'], ['v1', 'resolved']]);
    assert.equal(broker.observe(keyed({ hook_event_name: 'PostToolUse', ...plan('v3'), tool_response: {} }), 22_000), 1);
    assert.equal(broker.list()[0].proof, 'ran');
    // A request that was slow to arrive is still older than the next plan's start.
    const slow = setup();
    slow.advance(10_000);
    slow.broker.create(keyed(request(plan('v1'))), { hold: false, at: 1_000 });
    assert.equal(slow.broker.observe(keyed({ hook_event_name: 'PreToolUse', ...plan('v2') }), 6_000), 1);
    assert.deepEqual([slow.broker.list()[0].status, slow.broker.list()[0].proof], ['resolved', 'stopped']);
  });

  it(`a plan's PreToolUse and request stamped within ${ORDER_SLACK_MS} ms either way round are one dialog, in either arrival order`, () => {
    // Each hook's forwarder stamps its own time; one started a millisecond later may stamp first.
    const plan = (/** @type {string} */ text) => ({ session_id: 's1', tool_name: 'ExitPlanMode', tool_input: { plan: text } });
    for (const [requestAt, startAt] of [[10_001, 10_000], [10_000, 10_001]]) {
      for (const requestFirst of [true, false]) {
        const { broker, advance } = setup();
        broker.observe(keyed({ hook_event_name: 'PreToolUse', ...plan('v1') }), 1_000);
        broker.create(keyed(request(plan('v1'))), { hold: false, at: 1_000 });
        advance(9_100);
        const label = `request at ${requestAt}, start at ${startAt}, ${requestFirst ? 'request' : 'start'} first`;
        const start = () => broker.observe(keyed({ hook_event_name: 'PreToolUse', ...plan('v2') }), startAt);
        const create = () => broker.create(keyed(request(plan('v2'))), { hold: false, at: requestAt });
        if (requestFirst) {
          create();
          assert.equal(start(), 0, `${label}: its own start answers nothing`);
        } else {
          assert.equal(start(), 1, `${label}: a new plan answers the older one`);
          create();
        }
        assert.deepEqual(broker.list().map((a) => [/** @type {any} */ (a.toolInput).plan, a.status]), [['v2', 'pending'], ['v1', 'resolved']], label);
        assert.equal(broker.observe(keyed({ hook_event_name: 'PostToolUse', ...plan('v2'), tool_response: {} }), 12_000), 1, label);
        assert.equal(broker.list()[0].proof, 'ran', label);
      }
    }
  });

  it("a question's PreToolUse held back ten minutes by sleep still finds its own dialog", () => {
    const { broker, advance } = setup();
    const question = { session_id: 's1', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which port?' }] } };
    broker.create(keyed(request(question)), { hold: false, at: 1_000 });
    advance(10 * 60_000);
    assert.equal(broker.observe(keyed({ hook_event_name: 'PreToolUse', ...question }), 995), 0, 'its own start answers nothing');
    assert.equal(broker.list()[0].status, 'pending');
  });

  it("a held request whose turn or session ended meanwhile is answered once it goes back to the terminal", () => {
    /** @type {[string, Record<string, any>][]} */
    const ends = [
      ['Stop', { hook_event_name: 'Stop' }],
      ["Codex's interrupt", { hook_event_name: 'Stop', stop_reason: 'interrupted' }],
      ['SessionEnd', { hook_event_name: 'SessionEnd', reason: 'other' }],
    ];
    for (const [name, end] of ends) {
      const { broker } = setup();
      const { approval } = broker.create(ask('npm publish'), { hold: true });
      assert.equal(broker.observe(keyed({ session_id: 's1', ...end })), 0, `${name}: the town still holds it`);
      broker.release(approval.id);
      assert.deepEqual([broker.list()[0].status, broker.list()[0].proof], ['resolved', 'stopped'], name);
    }
    const { broker } = setup();
    const { approval } = broker.create(ask('npm publish'), { hold: true });
    broker.release(approval.id);
    assert.deepEqual([broker.list()[0].status, broker.list()[0].held], ['pending', false], 'one still open waits in the terminal');
  });

  it('a request that timed out in the town shows in the terminal: your prompt answers it, and the same command asked again is its own', () => {
    const { broker, advance, fireTimers } = setup();
    broker.create(ask('npm publish'), { hold: true });
    fireTimers();
    // "No" in the terminal, then a prompt; the agent asks for the same command again.
    advance(5_000);
    assert.equal(broker.observe(keyed({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: 'publish it after all' })), 0);
    advance(5_000);
    broker.create(ask('npm publish'), { hold: false });
    advance(5_000);
    assert.equal(broker.observe(result('PostToolUse', 'npm publish')), 1);
    assert.deepEqual(broker.list().map((a) => a.status), ['resolved', 'expired']);
  });

  it("Codex's request, the only hook with the command's description, is answered by its call's result", () => {
    const { broker } = setup();
    broker.create(ask('git push', { tool_input: { command: ['git', 'push'], description: 'Push the branch' }, andary_source: 'codex' }), { hold: false });
    assert.equal(broker.observe(keyed({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Bash', tool_input: { command: 'git push' }, tool_response: {}, andary_source: 'codex' })), 1);
    assert.deepEqual([broker.list()[0].status, broker.list()[0].proof], ['resolved', 'ran']);
  });

  it("two parallel MCP calls that differ only in their description are each answered by their own result", () => {
    const { broker } = setup();
    const issue = (/** @type {string} */ description) => ({ session_id: 's1', tool_name: 'mcp__gh__create_issue', tool_input: { repo: 'a/b', title: 'Flaky test', description } });
    broker.create(keyed(request(issue('Seen on CI'))), { hold: false });
    broker.create(keyed(request(issue('Seen locally'))), { hold: false });
    assert.equal(broker.observe(keyed({ hook_event_name: 'PostToolUse', ...issue('Seen locally'), tool_response: {} })), 1);
    assert.deepEqual(broker.list().map((a) => [/** @type {any} */ (a.toolInput).description, a.status]), [['Seen on CI', 'pending'], ['Seen locally', 'resolved']]);
  });

  it('says which agent asked, so a Codex card can say what Allow may grant', () => {
    const { broker } = setup();
    assert.equal(broker.create(ask('ls'), { hold: false }).approval.source, 'claude');
    assert.equal(broker.create(ask('ls', { andary_source: 'codex' }), { hold: false }).approval.source, 'codex');
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

/** A permission rule suggestion as Claude Code sends one. @param {Record<string, unknown>} [extra] */
const rule = (extra = {}) => ({ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings', ...extra });

/** A request with suggestions, raw and as the town sees it, and its offers. @param {unknown[]} suggestions @param {Record<string, any>} [extra] */
function suggesting(suggestions, extra = {}) {
  const raw = request({ tool_input: { command: 'npm test' }, permission_suggestions: suggestions, ...extra });
  const sanitized = sanitize(raw);
  return { raw, sanitized, offers: offeredSuggestions(raw, sanitized) };
}

describe('allow always: what a request offers', () => {
  it('offers local allow rules at their place in the list, keeping the suggestion as it arrived', () => {
    const suggestions = [rule({ destination: 'userSettings' }), rule(), { type: 'setMode', mode: 'acceptEdits', destination: 'session' }, rule({ destination: 'session' })];
    const { offers } = suggesting(suggestions);
    assert.deepEqual(offers.map(({ index, destination }) => [index, destination]), [[1, 'localSettings'], [3, 'session']]);
    assert.equal(offers[0].saved, suggestions[1], 'the very object Claude Code sent');
    assert.deepEqual(offers[0].rules, [{ toolName: 'Bash', ruleContent: 'npm test:*' }]);
  });

  it('offers nothing that sanitizing changed: the card must show the rule it saves', () => {
    const secret = rule({ rules: [{ toolName: 'Bash', ruleContent: 'curl -H "Authorization: Bearer abcdefghijklmnop" https://api.example.com:*' }] });
    const long = rule({ rules: [{ toolName: 'Bash', ruleContent: `echo ${'a'.repeat(2100)}` }] });
    const { sanitized, offers } = suggesting([secret, long, rule()]);
    assert.notDeepEqual(sanitized.permission_suggestions[0], secret, 'redacted');
    assert.deepEqual(offers.map((offer) => offer.index), [2]);
  });

  it('offers nothing past what sanitizing keeps of a long list', () => {
    const many = Array.from({ length: 60 }, (_, i) => rule({ rules: [{ toolName: 'Bash', ruleContent: `step-${i}` }] }));
    const { offers } = suggesting(many);
    assert.equal(offers.length, 50);
    assert.ok(offers.every((offer) => offer.index < 50));
  });

  it('offers no rule that allows more than it reads', () => {
    /** @param {Record<string, unknown>} one */
    const only = (one) => rule({ rules: [one] });
    const { offers } = suggesting([
      only({ toolName: 'Bash', ruleContent: '' }),
      only({ toolName: 'Bash', ruleContent: '*' }),
      only({ toolName: 'Bash' }),
      only({ toolName: 'Bash', ruleContent: 'rm -f *.log' }),
      only({ toolName: 'Read', ruleContent: '/home/me/project/**' }),
      only({ toolName: 'Bash', ruleContent: 'npm test' }),
    ]);
    assert.deepEqual(offers.map((offer) => offer.index), [5], 'empty, star, whole-tool and glob rules are never offered');
  });

  it('offers nothing for Codex, which sends no suggestions of its own', () => {
    const raw = request({ permission_suggestions: [rule()] });
    assert.deepEqual(offeredSuggestions(raw, sanitize({ ...raw, andary_source: 'codex' })), []);
  });

  it('sends browsers the offers, never the suggestions themselves', () => {
    const { broker, changes } = setup();
    const { offers, sanitized } = suggesting([rule({ destination: 'projectSettings' }), rule()]);
    const { approval } = broker.create(sanitized, { hold: true, offers });
    const expected = [{ index: 1, rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], destination: 'localSettings' }];
    assert.deepEqual(approval.suggestions, expected);
    assert.deepEqual(changes[0].suggestions, expected);
    assert.deepEqual(broker.list()[0].suggestions, expected);
    assert.equal(JSON.stringify(broker.list()).includes('addRules'), false);
  });

  it('lists no suggestions for a request that offers none', () => {
    const { broker } = setup();
    assert.deepEqual(broker.create(request(), { hold: true }).approval.suggestions, []);
  });
});

describe('allow always: the decision', () => {
  it('saves the chosen suggestion, as it arrived, with the allow', async () => {
    const { broker, changes } = setup();
    const suggestions = [rule({ destination: 'userSettings' }), rule()];
    const { offers, sanitized } = suggesting(suggestions);
    const { approval, response } = broker.create(sanitized, { hold: true, offers });
    assert.deepEqual(broker.decide(approval.id, 'allow', undefined, 1), { ok: true });
    const output = /** @type {any} */ (await response);
    assert.deepEqual(output, decisionOutput('allow', '', suggestions[1]));
    assert.equal(output.hookSpecificOutput.decision.updatedPermissions[0], suggestions[1]);
    const decided = changes.at(-1);
    assert.deepEqual([decided.status, decided.decidedBy], ['allowed', 'town']);
    assert.deepEqual(decided.always, { rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], destination: 'localSettings', at: 1_000 });
  });

  it('refuses anything but an allow with an offered place, and changes nothing', async () => {
    const { broker, changes } = setup();
    const { offers, sanitized } = suggesting([rule({ destination: 'userSettings' }), rule()]);
    const { approval, response } = broker.create(sanitized, { hold: true, offers });
    for (const [why, decision, always] of /** @type {[string, string, unknown][]} */ ([
      ['with a denial', 'deny', 1],
      ['a suggestion the town does not offer', 'allow', 0],
      ['past the end of the list', 'allow', 2],
      ['a place given as text', 'allow', '1'],
      ['no place at all', 'allow', null],
      ['a fraction', 'allow', 1.5],
    ])) {
      const result = broker.decide(approval.id, decision, undefined, always);
      assert.equal(result.ok, false, why);
      assert.match(result.error ?? '', /Allow always/, why);
    }
    assert.equal(await peek(response), 'pending', 'the hook still waits');
    assert.equal(changes.length, 1, 'no change was published');
    assert.equal(broker.list()[0].status, 'pending');
    assert.deepEqual(broker.decide(approval.id, 'allow'), { ok: true }, 'a plain allow works as before');
    assert.deepEqual(await response, decisionOutput('allow'));
    assert.equal(changes.at(-1).always, undefined);
  });

  it('refuses allow always where a plain answer is refused too', () => {
    const { broker } = setup();
    const { offers, sanitized } = suggesting([rule()]);
    const free = broker.create(sanitized, { hold: false, offers }).approval;
    assert.match(broker.decide(free.id, 'allow', undefined, 0).error ?? '', /terminal/);
    const held = broker.create(sanitized, { hold: true, offers }).approval;
    broker.decide(held.id, 'deny');
    assert.match(broker.decide(held.id, 'allow', undefined, 0).error ?? '', /already denied/);
  });

  it('a denial never saves a rule', () => {
    assert.deepEqual(decisionOutput('deny', 'no', rule()), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: `${DENY_MESSAGE}: no` } } });
    assert.deepEqual(decisionOutput('allow', '', rule()).hookSpecificOutput.decision, { behavior: 'allow', updatedPermissions: [rule()] });
  });
});
