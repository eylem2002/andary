import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CODEX_IDLE_MS, READY_MS, attentionItems, countedItems } from '../../../public/js/core/attention.js';
import { createStore } from '../../../public/js/core/store.js';
import { CODEX_IDLE_MS as PHONE_CODEX_IDLE_MS } from '../../../server/notify.mjs';
import { SESSION, envelope, hook } from './helpers.mjs';

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

  test("a session's own question (an MCP form) waits until a tool reports back", () => {
    const t = town();
    t.send('Notification', { notification_type: 'elicitation_dialog', message: 'The GitHub server needs input' }, T0);
    assert.deepEqual(t.items().map((i) => [i.kind, i.text]), [['question', 'The GitHub server needs input']]);
    t.send('PostToolUse', { tool_name: 'mcp__github__create_issue', tool_input: {}, tool_response: {} }, T0 + 1);
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
