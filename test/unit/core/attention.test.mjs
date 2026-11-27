import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CODEX_IDLE_MS, READY_MS, RISK_MS, STALE_DIALOG_MS, attentionItems, countedItems } from '../../../public/js/core/attention.js';
import { CONFLICT_MS } from '../../../public/js/core/conflicts.js';
import { createStore } from '../../../public/js/core/store.js';
import { CODEX_IDLE_MS as PHONE_CODEX_IDLE_MS } from '../../../server/notify.mjs';
import { CWD, SESSION, envelope, hook } from './helpers.mjs';

const T0 = 1_000_000;
const LEAD = `${SESSION}:main`;

/** A store fed hook payloads at given times. */
function town() {
  const store = createStore({ now: () => T0 });
  return {
    store,
    /** @param {string} name @param {Record<string, any>} [extra] @param {number} [ts] @param {Record<string, any>} [who] */
    send(name, extra = {}, ts = T0, who = {}) {
      store.ingest(envelope(hook(name, extra, who), ts));
    },
    /** @param {number} [now] @param {Set<string>} [dismissed] */
    items(now = T0, dismissed) {
      return attentionItems(store.getState(), now, { dismissed });
    },
    lead: () => store.getState().agents[LEAD],
  };
}

/** @type {(fields?: Partial<import('../../../public/js/core/store.js').Approval>) => import('../../../public/js/core/store.js').Approval} */
const approvalOf = (fields = {}) => ({ id: 'a1', status: 'pending', held: true, sessionId: SESSION, agentId: null, toolName: 'Bash', toolInput: { command: 'npm publish' }, createdAt: T0, expiresAt: T0 + 120_000, ...fields });

describe('open dialogs, in the order the hooks really come', () => {
  test('the hook comes first, then its request: one item that becomes answerable in the town', () => {
    const t = town();
    t.send('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm publish' } }, T0);
    const [before] = t.items();
    assert.deepEqual([before.kind, before.settled], ['terminal', false], 'it may still be held: not final yet');
    t.store.setApproval(approvalOf());
    const [after] = t.items();
    assert.deepEqual([after.kind, after.approvalId, after.settled], ['approval', 'a1', true]);
    assert.equal(after.id, before.id, 'one episode, one id: one notification');
    t.store.setApproval(approvalOf({ status: 'expired', held: false, decidedBy: 'timeout' }));
    assert.deepEqual(t.items().map((i) => [i.kind, i.id]), [['terminal', before.id]], 'back in the terminal: still waiting');
    t.send('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm publish' }, tool_response: {} }, T0 + 5000);
    assert.deepEqual(t.items(), []);
  });

  test('parallel calls: each request waits for its own answer', () => {
    const t = town();
    t.send('PermissionRequest', { tool_name: 'WebFetch', tool_input: { url: 'https://a.example' } }, T0);
    t.send('PermissionRequest', { tool_name: 'WebFetch', tool_input: { url: 'https://b.example' } }, T0 + 1);
    t.store.setApproval(approvalOf({ id: 'A', toolName: 'WebFetch', toolInput: { url: 'https://a.example' } }));
    t.store.setApproval(approvalOf({ id: 'B', toolName: 'WebFetch', toolInput: { url: 'https://b.example' } }));
    t.store.setApproval(approvalOf({ id: 'B', toolName: 'WebFetch', toolInput: { url: 'https://b.example' }, status: 'allowed', decidedBy: 'town' }));
    t.send('PostToolUse', { tool_name: 'Read', tool_input: { file_path: 'x' }, tool_response: {} }, T0 + 2);
    t.store.setApproval(approvalOf({ id: 'A', toolName: 'WebFetch', toolInput: { url: 'https://a.example' }, status: 'expired', held: false }));
    assert.deepEqual(t.items().map((i) => [i.kind, i.text]), [['terminal', 'Answer in your terminal: Fetch a.example']]);
  });

  test('a reconnect replays history, then the approvals as they ended: the agent still waiting stays', () => {
    const t = town();
    t.store.reset();
    t.send('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } }, T0);
    t.send('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm publish' } }, T0 + 1);
    t.send('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: {} }, T0 + 2);
    t.store.setApproval(approvalOf({ id: 'B', status: 'expired', held: false, toolInput: { command: 'npm publish' } }));
    t.store.setApproval(approvalOf({ id: 'A', status: 'allowed', decidedBy: 'town', toolInput: { command: 'npm test' } }));
    assert.deepEqual(t.items().map((i) => i.text), ['Answer in your terminal: $ npm publish']);
  });

  test('a question keeps its words when Claude Code also asks permission for it', () => {
    const t = town();
    t.send('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which database?' }] }, tool_use_id: 'q1' });
    t.send('PermissionRequest', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which database?' }] } }, T0 + 1);
    t.store.setApproval(approvalOf({ toolName: 'AskUserQuestion', toolInput: { questions: [{ question: 'Which database?' }] }, held: false, message: 'Questions are answered in the terminal' }));
    assert.deepEqual(t.items().map((i) => [i.kind, i.text]), [['question', 'Asks: Which database?']]);
    t.send('PostToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which database?' }], answers: { 'Which database?': 'Postgres' } }, tool_use_id: 'q1', tool_response: {} }, T0 + 2);
    assert.deepEqual(t.items(), [], 'answered, though your answer changed its input');
    t.send('PreToolUse', { tool_name: 'ExitPlanMode', tool_input: { plan: 'x' }, tool_use_id: 'p1' }, T0 + 3);
    assert.deepEqual(t.items().map((i) => [i.kind, i.text]), [['plan', 'Waits for you to approve its plan']]);
    t.send('UserPromptSubmit', { prompt: 'go on' }, T0 + 4);
    assert.deepEqual(t.items(), []);
  });

  test("a helper's request is one item: the session's own notice about it lands nowhere else", () => {
    const t = town();
    const helper = { agent: { id: 'agent-h1', type: 'general-purpose' } };
    t.send('SubagentStart', { agent_id: 'agent-h1', agent_type: 'general-purpose' }, T0, helper);
    t.send('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm run lint -- --fix' } }, T0 + 1, helper);
    t.send('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }, T0 + 2);
    assert.deepEqual(t.items().map((i) => i.agentKey), [`${SESSION}:h1`]);
    t.send('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm run lint -- --fix' }, tool_response: {} }, T0 + 3, helper);
    assert.deepEqual(t.items(), []);
    // A notice the town knows nothing else about still counts, until the lead moves on.
    t.send('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }, T0 + 4);
    assert.deepEqual(t.items().map((i) => [i.kind, i.text]), [['terminal', 'Answer in your terminal: Claude needs your permission to use Bash']]);
    t.send('PostToolUse', { tool_name: 'Read', tool_input: { file_path: 'x' }, tool_response: {} }, T0 + 5);
    assert.equal(t.items().length, 1, 'any tool result is no proof for a dialog nobody can name');
    t.send('Stop', {}, T0 + 6);
    assert.deepEqual(t.items().map((i) => i.kind), ['finished']);
  });
});

describe('hooks that arrive out of order go by their own time', () => {
  // A permission request is sent at once; every other hook in the background, each on its own.
  // "After" means more than ORDER_SLACK_MS (250 ms) later: two forwarders' stamps may swap.
  test("a plan's request that overtook its PreToolUse stays one item: the PreToolUse joins it", () => {
    const t = town();
    const plan = { tool_name: 'ExitPlanMode', tool_input: { plan: 'Ship it' } };
    t.send('PermissionRequest', plan, T0 + 20);
    t.store.setApproval(approvalOf({ toolName: 'ExitPlanMode', toolInput: plan.tool_input, held: false, createdAt: T0 + 25 }));
    const [before] = t.items();
    t.send('PreToolUse', { ...plan, tool_use_id: 'p1' }, T0 + 10);
    assert.deepEqual(t.items().map((i) => [i.kind, i.id]), [['plan', before.id]], 'one dialog: one notification');
    assert.equal(t.store.getState().dialogs.length, 1);
    t.send('PostToolUse', { ...plan, tool_use_id: 'p1', tool_response: {} }, T0 + 30);
    assert.deepEqual(t.items(), []);
  });

  test("a question's request that overtook its PreToolUse keeps its words; asking again replaces it", () => {
    const t = town();
    const asked = (question) => ({ tool_name: 'AskUserQuestion', tool_input: { questions: [{ question }] } });
    t.send('PermissionRequest', asked('Which database?'), T0 + 20);
    const [before] = t.items();
    t.send('PreToolUse', { ...asked('Which database?'), tool_use_id: 'q1' }, T0 + 10);
    assert.deepEqual(t.items().map((i) => [i.kind, i.text, i.id]), [['question', 'Asks: Which database?', before.id]]);
    t.send('PreToolUse', { ...asked('Which port?'), tool_use_id: 'q2' }, T0 + 5_000);
    assert.deepEqual(t.items().map((i) => i.text), ['Asks: Which port?'], 'it cannot ask again while one waits');
  });

  test("a session's notice stays when the call started before it arrives late; a call started after it ends it", () => {
    const t = town();
    t.send('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }, T0 + 20);
    t.send('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'curl https://example.com' }, tool_use_id: 'b1' }, T0 + 10);
    assert.deepEqual(t.items().map((i) => i.kind), ['terminal'], 'the call it asks about started before it');
    t.send('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'x' }, tool_use_id: 'r1' }, T0 + 5_000);
    assert.deepEqual(t.items(), []);
  });

  test('a late PreToolUse of the turn does not end its finished wait', () => {
    const t = town();
    t.send('Stop', { last_assistant_message: 'Done.' }, T0 + 20);
    t.send('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'x' }, tool_use_id: 'r1' }, T0 + 10);
    assert.equal(t.lead().wait?.kind, 'finished');
    t.send('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'y' }, tool_use_id: 'r2' }, T0 + 30);
    assert.equal(t.lead().wait, null, 'a call started after it: the agent moved on');
  });

  test('a Stop that arrives after the prompt you queued behind it starts no wait', () => {
    const t = town();
    t.send('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'x' }, tool_use_id: 'r1' }, T0);
    t.send('UserPromptSubmit', { prompt: 'and the docs too' }, T0 + 21);
    t.send('Stop', { last_assistant_message: 'Done.' }, T0 + 20);
    assert.equal(t.lead().wait, null, 'it ended the turn before your prompt');
    t.send('StopFailure', { error: 'server_error' }, T0 + 15);
    assert.equal(t.lead().wait, null, 'nor does an older failure');
    t.send('Stop', { last_assistant_message: 'Docs too.' }, T0 + 50);
    assert.equal(t.lead().wait?.text, 'Finished: Docs too.');
  });
});

describe('what each agent waits for (AgentState.wait)', () => {
  test('a finished turn waits; idle_prompt marks when nobody answered', () => {
    const t = town();
    t.send('Stop', { last_assistant_message: 'All tests pass.' }, T0);
    assert.deepEqual([t.lead().wait?.kind, t.lead().wait?.text, t.lead().wait?.idleAt], ['finished', 'Finished: All tests pass.', null]);
    t.send('Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' }, T0 + 60_000);
    assert.equal(t.lead().wait?.idleAt, T0 + 60_000);
    assert.equal(t.lead().wait?.since, T0, 'still waiting since the turn ended');
  });

  test('a helper finishing is not waiting for you; a failed turn is', () => {
    const t = town();
    const helper = { agent: { id: 'agent-h1', type: 'Explore' } };
    t.send('SubagentStart', { agent_id: 'agent-h1', agent_type: 'Explore' }, T0, helper);
    t.send('Stop', {}, T0 + 1, helper);
    assert.equal(t.store.getState().agents[`${SESSION}:h1`]?.wait ?? null, null);
    t.send('StopFailure', { error: 'rate_limit' }, T0 + 2);
    assert.deepEqual([t.lead().wait?.kind, t.lead().wait?.text, t.lead().wait?.cause], ['stopped', 'Rate limited', 'rate_limit']);
  });

  test('moving on ends a wait: a prompt, a tool call, a new session, a helper finishing, /compact', () => {
    for (const [name, extra] of /** @type {const} */ ([
      ['UserPromptSubmit', { prompt: 'go on' }],
      ['PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'x' }, tool_use_id: 'r1' }],
      ['SessionStart', { source: 'resume' }],
      ['SubagentStop', { agent_type: 'Explore' }],
      ['PreCompact', { trigger: 'manual' }],
    ])) {
      const t = town();
      t.send('StopFailure', { error: 'server_error' }, T0);
      t.send(name, extra, T0 + 1);
      assert.equal(t.lead().wait, null, name);
    }
    const t = town();
    t.send('StopFailure', { error: 'server_error' }, T0);
    t.send('PreCompact', { trigger: 'auto' }, T0 + 1);
    assert.equal(t.lead().wait?.kind, 'stopped', 'Claude Code compacting by itself is not you');
  });

  test("a teammate going idle ends only its own wait, never the lead's", () => {
    const t = town();
    t.send('StopFailure', { error: 'rate_limit' }, T0);
    t.send('TeammateIdle', { teammate_name: 'nobody-known', team_name: 'core' }, T0 + 1);
    assert.equal(t.lead().wait?.kind, 'stopped');
  });

  test("an MCP server's form waits until the lead moves on, not on a tool result (it names no tool)", () => {
    const t = town();
    t.send('Notification', { notification_type: 'elicitation_dialog', message: 'The GitHub server needs input' }, T0);
    assert.deepEqual(t.items().map((i) => [i.kind, i.text]), [['question', 'The GitHub server needs input']]);
    t.send('PostToolUse', { tool_name: 'Read', tool_input: { file_path: 'x' }, tool_response: {} }, T0 + 1);
    assert.equal(t.items().length, 1, 'a parallel call finishing proves nothing');
    t.send('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'y' }, tool_use_id: 'r2' }, T0 + 2_000);
    assert.deepEqual(t.items(), []);
  });
});

describe('attentionItems', () => {
  test('a held request is answered in the town; once handed back, in the terminal, still counted', () => {
    const t = town();
    t.send('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm publish' } }, T0);
    /** @type {import('../../../public/js/core/store.js').Approval} */
    const approval = { id: 'a1', status: 'pending', held: true, sessionId: SESSION, agentId: null, toolName: 'Bash', toolInput: { command: 'npm publish' }, createdAt: T0, expiresAt: T0 + 120_000 };
    t.store.setApproval(approval);
    let [item] = t.items();
    assert.deepEqual([item.kind, item.level, item.counted, item.approvalId], ['approval', 'blocked', true, 'a1']);
    assert.match(item.text, /npm publish/);
    t.store.setApproval({ ...approval, status: 'expired', held: false, decidedBy: 'timeout' });
    [item] = t.items();
    assert.deepEqual([item.kind, item.counted, item.approvalId], ['terminal', true, null]);
    assert.match(item.text, /^Answer in your terminal: /);
  });

  test('a finished turn is listed at once, counted after idle_prompt, for 30 minutes', () => {
    const t = town();
    t.send('Stop', { last_assistant_message: 'Done.' }, T0);
    let [item] = t.items(T0 + 1000);
    assert.deepEqual([item.kind, item.level, item.counted], ['finished', 'ready', false], 'you may be reading it in the terminal');
    t.send('Notification', { notification_type: 'idle_prompt' }, T0 + 60_000);
    [item] = t.items(T0 + 61_000);
    assert.deepEqual([item.counted, item.countedSince], [true, T0 + 60_000]);
    [item] = t.items(T0 + READY_MS + 1);
    assert.equal(item.counted, false, 'after half an hour it is probably done for now');
  });

  test('a finished Codex turn counts after a minute without a prompt (Codex has no idle_prompt)', () => {
    const t = town();
    t.store.ingest(envelope({ ...hook('Stop', {}), andary_source: 'codex' }, T0));
    assert.equal(t.items(T0 + CODEX_IDLE_MS - 1)[0].counted, false);
    assert.equal(t.items(T0 + CODEX_IDLE_MS)[0].counted, true);
    assert.equal(CODEX_IDLE_MS, PHONE_CODEX_IDLE_MS, 'the town and the phone agree on the minute');
  });

  test('most urgent first: blocked, then stopped, then ready; the longest waiting first within a level', () => {
    const t = town();
    t.send('Stop', {}, T0, { session: 's-ready' });
    t.send('StopFailure', { error: 'server_error' }, T0 + 1, { session: 's-stopped' });
    t.send('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: {}, tool_use_id: 'q' }, T0 + 3, { session: 's-q2' });
    t.send('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: {}, tool_use_id: 'q' }, T0 + 2, { session: 's-q1' });
    assert.deepEqual(t.items(T0 + 10).map((i) => i.sessionId), ['s-q1', 's-q2', 's-stopped', 's-ready']);
  });

  test('crews stopped by one rate limit together are one item', () => {
    const t = town();
    for (const [i, session] of ['s1', 's2', 's3'].entries()) t.send('StopFailure', { error: 'rate_limit' }, T0 + i * 1000, { session });
    t.send('StopFailure', { error: 'server_error' }, T0, { session: 's4' });
    const stopped = t.items(T0 + 5000).filter((i) => i.level === 'stopped');
    assert.equal(stopped.length, 2);
    const shared = stopped.find((i) => i.crews === 3);
    assert.equal(shared?.text, 'Rate limited: 3 crews stopped');
    assert.equal(shared?.sessionId, 's1', 'it shows the first crew that stopped');
  });

  test('dismissed items stay away until a new episode; blocked ones cannot be dismissed', () => {
    const t = town();
    t.send('Stop', {}, T0);
    t.send('Notification', { notification_type: 'idle_prompt' }, T0 + 60_000);
    t.send('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: {}, tool_use_id: 'q' }, T0, { session: 's-q' });
    const items = t.items(T0 + 61_000);
    const dismissed = new Set(items.map((i) => i.id));
    assert.deepEqual(t.items(T0 + 61_000, dismissed).map((i) => i.kind), ['question']);
    t.send('UserPromptSubmit', { prompt: 'next' }, T0 + 70_000);
    t.send('Stop', {}, T0 + 80_000);
    assert.equal(t.items(T0 + 81_000, dismissed).filter((i) => i.kind === 'finished').length, 1, 'a new turn is a new item');
  });

  test('an agent that seems stuck is an alert: counted, and set aside until its next episode', () => {
    const t = town();
    /** @param {number} ts */
    const red = (ts) => t.send('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: `t${ts}`, error: 'Exit code 1\nTypeError: token is undefined', is_interrupt: false }, ts);
    red(T0);
    red(T0 + 1);
    assert.deepEqual(t.items(T0 + 10), []);
    red(T0 + 2);
    let [item] = t.items(T0 + 10);
    assert.deepEqual(
      [item.kind, item.level, item.counted, item.dismissable, item.since, item.id, item.text],
      ['stuck', 'alert', true, true, T0 + 2, `stuck:${LEAD}:${T0 + 2}`, 'Seems stuck: `npm test` failed 3 times, nothing changed'],
    );
    assert.deepEqual([item.agentKeys, item.settled], [[LEAD], true], 'its own agent, and nothing left to change its kind');
    const dismissed = new Set([item.id]);
    red(T0 + 3);
    assert.deepEqual(t.items(T0 + 10, dismissed), [], 'still the same episode: still set aside');
    t.send('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: '/home/dev/code/api-server/src/auth/login.ts', old_string: 'a', new_string: 'b' }, tool_response: {}, tool_use_id: 'e1' }, T0 + 4);
    assert.deepEqual(t.items(T0 + 10), [], 'a change ends it');
    red(T0 + 5);
    assert.deepEqual(t.items(T0 + 10), []);
    red(T0 + 6);
    [item] = t.items(T0 + 10, dismissed);
    assert.deepEqual(
      [item?.kind, item?.since, item?.text],
      ['stuck', T0 + 6, 'Seems stuck: `npm test` failed 6 times with the same error'],
      'four failures before the change and two after, all alike: stuck again, a new item',
    );
  });

  test('a stuck agent that asks you something has both items, the question first', () => {
    const t = town();
    for (const ts of [T0, T0 + 1, T0 + 2]) t.send('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: `t${ts}`, error: 'Exit code 1', is_interrupt: false }, ts);
    t.send('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Skip the flaky test?' }] }, tool_use_id: 'q1' }, T0 + 3);
    assert.deepEqual(t.items(T0 + 10).map((i) => [i.kind, i.level]), [['question', 'blocked'], ['stuck', 'alert']]);
    assert.equal(countedItems(t.items(T0 + 10)).length, 2);
  });

  test("teammates' crews and ended crews are not yours to answer", () => {
    const t = town();
    t.store.ingest(envelope({ ...hook('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: {}, tool_use_id: 'q' }), andary_member: 'sam', session_id: 'sam~s9' }, T0));
    t.send('Stop', {}, T0, { session: 's-ended' });
    t.send('SessionEnd', { reason: 'prompt_input_exit' }, T0 + 1, { session: 's-ended' });
    assert.deepEqual(t.items(T0 + 10), []);
  });

  test('countedItems keeps only what counts', () => {
    const t = town();
    t.send('Stop', {}, T0);
    t.send('PreToolUse', { tool_name: 'ExitPlanMode', tool_input: {}, tool_use_id: 'p' }, T0, { session: 's-plan' });
    assert.deepEqual(countedItems(t.items(T0 + 1)).map((i) => i.kind), ['plan']);
  });
});

describe('open dialogs: the cases a second review found', () => {
  test("a Codex patch answered in the terminal reports back renamed, and closes its request", () => {
    const t = town();
    t.store.ingest(envelope({ ...hook('PermissionRequest', { tool_name: 'apply_patch', tool_input: { patch: '*** Begin Patch' } }), andary_source: 'codex' }, T0));
    assert.equal(t.items().length, 1);
    t.store.ingest(envelope({ ...hook('PostToolUse', { tool_name: 'Edit', andary_tool: 'apply_patch', tool_input: { file_path: 'a.js', old_string: 'x', new_string: 'y' }, tool_response: {} }), andary_source: 'codex' }, T0 + 1));
    assert.deepEqual(t.items(), []);
  });

  test("the server's key for a call wins over its sanitised input", () => {
    const t = town();
    t.send('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'long … [cut]' }, andary_key: 'K1' }, T0);
    t.send('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'long … [cut differently]' }, andary_key: 'K1', tool_response: {} }, T0 + 1);
    assert.deepEqual(t.items(), []);
  });

  test('a reload after "No" and a prompt: the broker resolved it, so it does not come back', () => {
    const t = town();
    t.store.reset();
    t.send('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf dist' } }, T0);
    t.send('UserPromptSubmit', { prompt: 'no, keep dist' }, T0 + 5000);
    t.store.setApproval(approvalOf({ held: false, status: 'resolved', decidedBy: 'terminal', toolInput: { command: 'rm -rf dist' } }));
    assert.deepEqual(t.items(), []);
  });

  test('the broker proving an answer closes a dialog the history no longer shows the end of', () => {
    const t = town();
    t.send('SessionStart', { source: 'startup' }, T0 - 1);
    t.store.setApproval(approvalOf({ held: false, toolInput: { command: 'npm test' } }));
    assert.equal(t.items().length, 1, 'a request older than the history: its approval opens it');
    t.store.setApproval(approvalOf({ held: false, status: 'resolved', decidedBy: 'terminal', toolInput: { command: 'npm test' } }));
    assert.deepEqual(t.items(), []);
  });

  test('a dialog the town does not hold can be set aside once it has waited a while; a held one never', () => {
    const t = town();
    t.send('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } }, T0);
    t.store.setApproval(approvalOf({ held: false, toolInput: { command: 'npm test' } }));
    assert.equal(t.items(T0 + STALE_DIALOG_MS - 1)[0].dismissable, false);
    const [stale] = t.items(T0 + STALE_DIALOG_MS);
    assert.equal(stale.dismissable, true);
    assert.deepEqual(t.items(T0 + STALE_DIALOG_MS, new Set([stale.id])), []);
    const h = town();
    h.send('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm publish' } }, T0);
    h.store.setApproval(approvalOf());
    assert.equal(h.items(T0 + 60 * 60_000)[0].dismissable, false, 'answer it in the town');
  });

  test('your prompt answers what shows in your terminal, never what the town holds', () => {
    const t = town();
    const helper = { agent: { id: 'agent-h1', type: 'general-purpose' } };
    t.send('SubagentStart', { agent_id: 'agent-h1', agent_type: 'general-purpose' }, T0, helper);
    t.send('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm publish' } }, T0 + 1, helper);
    t.store.setApproval(approvalOf({ agentId: 'agent-h1', toolInput: { command: 'npm publish' } }));
    t.send('UserPromptSubmit', { prompt: 'and update the changelog' }, T0 + 2);
    assert.deepEqual(t.items().map((i) => i.kind), ['approval'], 'held in the town: typing did not answer it');
    t.store.setApproval(approvalOf({ agentId: 'agent-h1', held: false, toolInput: { command: 'npm publish' } }));
    assert.deepEqual(t.items().map((i) => i.kind), ['terminal'], 'released: now it shows in the terminal');
    t.send('UserPromptSubmit', { prompt: 'never mind' }, T0 + 3);
    assert.deepEqual(t.items(), [], 'you typed, so nothing showed there');
  });

  test("a teammate's crew is theirs: its requests are not kept", () => {
    const t = town();
    t.store.ingest(envelope({ ...hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'x' } }), andary_member: 'sam', session_id: 'sam~s9' }, T0));
    assert.deepEqual(t.store.getState().dialogs, []);
  });

  test('a lead and its helper stopped by one limit are one crew, not a merged "1 crews" item', () => {
    const t = town();
    const helper = { agent: { id: 'agent-h1', type: 'Explore' } };
    t.send('SubagentStart', { agent_id: 'agent-h1', agent_type: 'Explore' }, T0, helper);
    t.send('StopFailure', { error: 'rate_limit' }, T0 + 1, helper);
    t.send('StopFailure', { error: 'rate_limit' }, T0 + 2);
    assert.deepEqual(t.items().map((i) => i.text), ['Rate limited', 'Rate limited']);
  });
});

describe('two agents on the same files (core/conflicts.js)', () => {
  const OTHER = '7c1d0e3f-2e5b-4d44-8f20-1b8c7d6e5f40';
  const FIRST = `${SESSION}:main`;
  const SECOND = `${OTHER}:main`;
  const file = `${CWD}/src/auth.ts`;
  /** @param {string} tool @param {Record<string, any>} input @returns {Record<string, any>} */
  const done = (tool, input) => ({ tool_name: tool, tool_input: input, tool_response: {}, tool_use_id: `${tool}-${input.file_path ?? input.command}` });
  const edit = done('Edit', { file_path: file, old_string: 'a', new_string: 'b' });
  const write = done('Write', { file_path: file, content: 'all new' });
  const other = { session: OTHER };

  test('a write over the other crew\'s change: an alert on both agents, counted and dismissable', () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('PostToolUse', write, T0 + 4 * 60_000, other);
    const [item] = t.items(T0 + 4 * 60_000);
    assert.deepEqual([item.kind, item.level, item.counted, item.dismissable, item.settled], ['conflict', 'alert', true, true, true]);
    assert.deepEqual([item.agentKey, item.agentKeys, item.sessionId, item.crews], [SECOND, [SECOND, FIRST], OTHER, 2]);
    assert.equal(item.text, 'Foreman (crew 2) wrote over src/auth.ts, which Foreman (crew 1) changed 4 min ago', 'who did it, on either row');
    assert.match(item.id, /^conflict:write:/);
  });

  test('an edit over it is a note: listed for both, counted for nothing, nothing to set aside', () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('PostToolUse', edit, T0 + 1000, other);
    const [note] = t.items(T0 + 2000);
    assert.deepEqual([note.kind, note.level, note.counted, note.dismissable, note.agentKeys], ['conflict', 'alert', false, false, [SECOND, FIRST]]);
    assert.equal(note.text, 'Foreman (crew 2) edited src/auth.ts, which Foreman (crew 1) changed just now');
    assert.deepEqual(countedItems(t.items(T0 + 2000)), []);
  });

  test('a git command over the other crew\'s changes: an alert naming both', () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('PostToolUse', done('Write', { file_path: `${CWD}/src/new.ts`, content: 'x' }), T0 + 1);
    t.send('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git add -A && git commit -m "Save"' }, tool_use_id: 'c1' }, T0 + 2, other);
    const [item] = t.items(T0 + 3);
    assert.deepEqual([item.kind, item.counted, item.agentKeys], ['conflict', true, [SECOND, FIRST]]);
    assert.equal(item.text, 'Foreman (crew 2) runs git add -A && git commit in api-server, where Foreman (crew 1) has changed 2 files');
  });

  test('a git command over several crews: one item for everyone it names', () => {
    const t = town();
    const third = '9d2e1f40-3f6c-4e55-9a31-2c9d8e7f6a51';
    t.send('PostToolUse', edit, T0);
    t.send('PostToolUse', done('Edit', { file_path: `${CWD}/src/b.ts`, old_string: 'a', new_string: 'b' }), T0 + 1, { session: third });
    t.send('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git stash' }, tool_use_id: 's1' }, T0 + 2, other);
    const items = t.items(T0 + 3);
    assert.equal(items.length, 1);
    assert.deepEqual([items[0].agentKeys, items[0].crews], [[SECOND, `${third}:main`, FIRST], 3], 'who ran it, then the latest change first');
    assert.equal(items[0].text, 'Foreman (crew 3) runs git stash in api-server, where Foreman (crew 2) and Foreman (crew 1) have changed 2 files');
  });

  test('set aside, it stays away; a new episode is a new item', () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('PostToolUse', write, T0 + 1000, other);
    const dismissed = new Set(t.items(T0 + 2000).map((i) => i.id));
    assert.deepEqual(t.items(T0 + 2000, dismissed), []);
    t.send('PostToolUse', write, T0 + 3000, other);
    assert.deepEqual(t.items(T0 + 4000, dismissed), [], 'writing again is the same episode');
    t.send('PostToolUse', edit, T0 + 5000);
    t.send('PostToolUse', write, T0 + 6000, other);
    assert.deepEqual(t.items(T0 + 7000, dismissed).filter((i) => i.counted).map((i) => i.text), ['Foreman (crew 2) wrote over src/auth.ts, which Foreman (crew 1) changed just now'], 'over a newer change');
  });

  test('it lasts half an hour, words its time from now, and ranks after what blocks or stopped', () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('PostToolUse', write, T0 + 1000, other);
    t.send('StopFailure', { error: 'server_error' }, T0 + 2000, { session: 's-stopped' });
    t.send('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: {}, tool_use_id: 'q' }, T0 + 3000, { session: 's-asks' });
    assert.deepEqual(t.items(T0 + 10 * 60_000).map((i) => i.level), ['blocked', 'stopped', 'alert']);
    assert.match(t.items(T0 + 10 * 60_000)[2].text, /changed 10 min ago$/);
    assert.equal(t.items(T0 + 1000 + CONFLICT_MS - 1).some((i) => i.kind === 'conflict'), true);
    assert.equal(t.items(T0 + 1000 + CONFLICT_MS).some((i) => i.kind === 'conflict'), false, 'without an event to end it');
  });

  test("a crew no longer in town, or an agent that finished, takes it away; teammates' crews never have any", () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('PostToolUse', write, T0 + 1000, other);
    const state = t.store.getState();
    const ended = { ...state, sessions: state.sessions.map((s) => (s.id === SESSION ? { ...s, status: /** @type {const} */ ('ended') } : s)) };
    assert.deepEqual(attentionItems(ended, T0 + 2000), []);
    const finished = { ...state, agents: { ...state.agents, [FIRST]: { ...state.agents[FIRST], status: /** @type {const} */ ('done') } } };
    assert.deepEqual(attentionItems(finished, T0 + 2000), []);
    const team = town();
    team.store.ingest(envelope({ ...hook('PostToolUse', edit), andary_member: 'sam', session_id: 'sam~s1' }, T0));
    team.send('PostToolUse', write, T0 + 1000, other);
    assert.deepEqual(team.items(T0 + 2000), []);
  });
});

describe('risky commands that ran without asking', () => {
  /** @param {ReturnType<typeof town>} t @param {string} command @param {number} ts */
  const ran = (t, command, ts) => {
    t.send('PreToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: `u${ts}` }, ts);
    t.send('PostToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: `u${ts}`, tool_response: {} }, ts + 10);
  };

  test('an allow rule let `git reset --hard` through: a notice that counts until set aside', () => {
    const t = town();
    t.send('SessionStart', { source: 'startup' }, T0 - 1000);
    ran(t, 'git reset --hard origin/main', T0);
    const [item] = t.items(T0 + 20);
    assert.deepEqual([item.kind, item.level, item.counted, item.dismissable], ['risk', 'alert', true, true]);
    assert.equal(item.text, 'Ran without asking: git reset --hard origin/main (throws away uncommitted changes (reset --hard))');
    assert.equal(countedItems(t.items(T0 + 20)).length, 1);
    assert.deepEqual(t.items(T0 + 20, new Set([item.id])), [], 'set aside, it is gone');
    assert.deepEqual(t.items(T0 + RISK_MS + 20), [], 'and it lapses after half an hour');
    const log = t.store.getState().log.filter((entry) => entry.kind === 'risk');
    assert.equal(log.length, 1);
    assert.equal(log[0].level, 'warn');
  });

  test('a risky command you were asked about is no notice; the same one run later without asking is', () => {
    const t = town();
    t.send('SessionStart', { source: 'startup' }, T0 - 1000);
    t.send('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf src' } }, T0);
    ran(t, 'rm -rf src', T0 + 100);
    assert.deepEqual(t.items(T0 + 200).filter((item) => item.kind === 'risk'), []);
    ran(t, 'rm -rf src', T0 + 500);
    assert.deepEqual(t.items(T0 + 600).filter((item) => item.kind === 'risk').map((item) => item.text), ['Ran without asking: rm -rf src (deletes recursively)']);
  });

  test('an ordinary command, or a risky one that was interrupted, is no notice', () => {
    const t = town();
    t.send('SessionStart', { source: 'startup' }, T0 - 1000);
    ran(t, 'npm test', T0);
    t.send('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, tool_use_id: 'x', error: 'Interrupted', is_interrupt: true }, T0 + 50);
    assert.deepEqual(t.items(T0 + 100).filter((item) => item.kind === 'risk'), []);
  });

  test('a crew that left takes its notices with it', () => {
    const t = town();
    t.send('SessionStart', { source: 'startup' }, T0 - 1000);
    ran(t, 'git push --force', T0);
    t.send('SessionEnd', { reason: 'other' }, T0 + 100);
    assert.deepEqual(t.items(T0 + 200).filter((item) => item.kind === 'risk'), []);
    assert.deepEqual(t.store.getState().risks, []);
  });
});

describe('risky runs: which call asked', () => {
  test('the server\'s call key ties a request to its call, also when an adapter renamed the tool', () => {
    const t = town();
    t.send('SessionStart', { source: 'startup' }, T0 - 1000);
    const patch = '*** Begin Patch\n*** Add File: /home/dev/.bashrc\n+x\n*** End Patch';
    t.send('PermissionRequest', { tool_name: 'apply_patch', tool_input: { command: patch }, andary_key: 'k-patch' }, T0);
    // Codex's patch arrives as a Write of the file it adds, with the same key.
    t.send('PostToolUse', { tool_name: 'Write', tool_input: { file_path: '/home/dev/.bashrc', content: 'x' }, tool_use_id: 'p1', andary_key: 'k-patch', andary_tool: 'apply_patch', tool_response: {} }, T0 + 100);
    assert.deepEqual(t.items(T0 + 200).filter((item) => item.kind === 'risk'), []);
  });

  test('a refused request takes its mark away, so the same command run later without asking counts', () => {
    const t = town();
    t.send('SessionStart', { source: 'startup' }, T0 - 1000);
    const input = { command: 'git push --force' };
    t.send('PermissionRequest', { tool_name: 'Bash', tool_input: input }, T0);
    t.send('PermissionDenied', { tool_name: 'Bash', tool_input: input, tool_use_id: 'd1', reason: 'no' }, T0 + 50);
    t.send('PostToolUse', { tool_name: 'Bash', tool_input: input, tool_use_id: 'd2', tool_response: {} }, T0 + 500);
    assert.equal(t.items(T0 + 600).filter((item) => item.kind === 'risk').length, 1);
  });

  test('a request denied in the town takes its mark away too', () => {
    const t = town();
    t.send('SessionStart', { source: 'startup' }, T0 - 1000);
    const input = { command: 'git reset --hard' };
    t.send('PermissionRequest', { tool_name: 'Bash', tool_input: input }, T0);
    t.store.setApproval(approvalOf({ toolInput: input }));
    t.store.setApproval(approvalOf({ toolInput: input, status: 'denied', decidedBy: 'town' }));
    t.send('PostToolUse', { tool_name: 'Bash', tool_input: input, tool_use_id: 'd3', tool_response: {} }, T0 + 500);
    assert.equal(t.items(T0 + 600).filter((item) => item.kind === 'risk').length, 1);
  });

  test('a rebuildable folder deleted without asking is no notice', () => {
    const t = town();
    t.send('SessionStart', { source: 'startup' }, T0 - 1000);
    t.send('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf node_modules dist' }, tool_use_id: 'q1', tool_response: {} }, T0);
    assert.deepEqual(t.items(T0 + 100).filter((item) => item.kind === 'risk'), []);
  });
});
