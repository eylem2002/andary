import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODEX_IDLE_MS, DIALOG_DELAY_MS, checkNotifyUrl, createNotifier, noteFor, savedTopicUrl } from '../../../server/notify.mjs';
import { createApprovalBroker } from '../../../server/approvals.mjs';
import { toTownPayloads } from '../../../server/adapters/index.mjs';
import { withCallKey } from '../../../server/hook-steps.mjs';
import { ORDER_SLACK_MS } from '../../../public/js/core/dialogs.js';
import { parseNotifyUrl } from '../../../server/cli/options.mjs';
import { notificationFor } from '../../../public/js/ui/notifications.js';
import { createFakeClock } from '../core/helpers.mjs';

test('noteFor picks the notes sent at once, and never says more than what happened', () => {
  // A dialog's note waits (createNotifier): nothing at once for a request or a session's notice.
  assert.equal(noteFor({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf secret' } }), null);
  assert.equal(noteFor({ hook_event_name: 'Notification', notification_type: 'permission_prompt' }), null);
  assert.equal(noteFor({ hook_event_name: 'Notification', notification_type: 'idle_prompt' })?.kind, 'waiting');
  // Codex has the same note (CODEX_IDLE_MS), so it names no agent.
  assert.equal(noteFor({ hook_event_name: 'Notification', notification_type: 'idle_prompt' })?.body, 'A crew is waiting for your next prompt.');
  assert.equal(noteFor({ hook_event_name: 'Notification', notification_type: 'auth_success' }), null);
  // A finished turn is no news by itself: idle_prompt says so a minute later if nobody answered.
  assert.equal(noteFor({ hook_event_name: 'Stop' }), null);
  assert.equal(noteFor({ hook_event_name: 'Stop', agent_id: 'a1' }), null);
  assert.equal(noteFor({ hook_event_name: 'StopFailure', error: 'rate_limit' })?.kind, 'limit');
  assert.equal(noteFor({ hook_event_name: 'StopFailure', error: 'server_error' })?.kind, 'stopped');
  assert.equal(noteFor({ hook_event_name: 'PreToolUse' }), null);
  const stopped = noteFor({ hook_event_name: 'StopFailure', error: 'rate_limit', cwd: '/x/secret-project', last_assistant_message: 'secret plan' });
  assert.ok(!JSON.stringify(stopped).includes('secret'));
});

/**
 * A notifier on a fake clock whose timers fire at their time, posting into `posts`.
 * @param {Partial<import('../../../server/notify.mjs').NotifierOptions>} [options]
 */
function testNotifier(options = {}) {
  const clock = createFakeClock(0);
  /** @type {any[]} */
  const posts = [];
  const created = createNotifier({
    url: 'https://ntfy.example/topic',
    fetchImpl: /** @type {any} */ (async (url, init) => {
      posts.push({ url, ...init, at: clock.now() });
      return { ok: true, status: 200 };
    }),
    now: clock.now,
    setTimer: (fn, ms) => clock.setTimeout(fn, ms),
    clearTimer: (id) => clock.clearTimeout(id),
    ...options,
  });
  // Every event reaches it with its call key, stamped by ingest.
  const notifier = { ...created, observe: (/** @type {Record<string, any>} */ event, /** @type {number} */ ts = clock.now()) => created.observe(withCallKey(event), ts) };
  return {
    notifier,
    posts,
    clock,
    /** Moves the clock on to `t` ms, running every timer due by then. @param {number} t */
    at: (t) => clock.advance(t - clock.now()),
  };
}

/**
 * A real approval broker on the same clock, telling the notifier about every change (as app.mjs does).
 * @param {ReturnType<typeof testNotifier>} town
 * @param {number} [timeoutMs]
 */
function brokerFor({ notifier, clock }, timeoutMs = 120_000) {
  const broker = createApprovalBroker({
    timeoutMs,
    now: clock.now,
    onChange: (approval) => notifier.approvalChanged(approval),
    timers: { set: (fn, ms) => clock.setTimeout(fn, ms), clear: (id) => clock.clearTimeout(id) },
  });
  // Events reach it with their call key, as from the route and ingest.
  return {
    ...broker,
    /** @type {typeof broker.create} */
    create: (event, options) => broker.create(withCallKey(event), options),
    /** @type {typeof broker.observe} */
    observe: (event, ts) => broker.observe(withCallKey(event), ts),
  };
}

/** @param {string} name @param {Record<string, any>} [extra] */
const hook = (name, extra = {}) => ({ hook_event_name: name, session_id: 's1', cwd: '/work/secret-project', ...extra });
/** A permission request for `rm -rf build`. @param {Record<string, any>} [extra] */
const ask = (extra = {}) => hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, ...extra });
/** That command's result. @param {Record<string, any>} [extra] */
const ran = (extra = {}) => hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, tool_use_id: 'toolu_1', tool_response: { stdout: '' }, ...extra });
/** @param {string} prompt */
const question = (prompt = 'Which port?') => ({ tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: prompt, options: [{ label: '8080' }, { label: '3000' }] }] } });
/** Codex's payloads, as its adapter makes them. @param {Record<string, any>} payload */
const codex = (payload) => toTownPayloads('codex', { session_id: 'thr_1', cwd: '/work/app', ...payload });
/** Notes about open dialogs (not the waiting note). @param {any[]} posts */
const dialogNotes = (posts) => posts.filter((post) => /permission|question|plan|need you/.test(post.body));

test('a permission note goes out after the delay, once for its dialog, and names nothing', async () => {
  const { notifier, posts, at } = testNotifier();
  notifier.observe(ask());
  await at(DIALOG_DELAY_MS - 1);
  assert.equal(posts.length, 0, 'nothing before the delay');
  await at(DIALOG_DELAY_MS);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body, 'A crew needs your permission.');
  assert.deepEqual(posts[0].headers, { Title: 'Andary', Priority: 'high', Tags: 'raised_hand' });
  // Claude Code's own notice of the same dialog adds nothing, even much later.
  notifier.observe(hook('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }));
  await at(120_000);
  assert.equal(posts.length, 1);
  for (const word of ['Bash', 'rm -rf', 'secret']) assert.ok(!JSON.stringify(posts).includes(word), word);
});

test('each request has its own deadline', async () => {
  // Answered at 2 s; a second request at 9.5 s, answered at 11 s: neither waited ten seconds.
  const quick = testNotifier();
  quick.notifier.observe(ask({ tool_input: { command: 'npm publish' } }));
  await quick.at(2_000);
  quick.notifier.observe(ran({ tool_input: { command: 'npm publish' } }));
  await quick.at(9_500);
  quick.notifier.observe(ask({ tool_input: { command: 'git push' } }));
  await quick.at(11_000);
  quick.notifier.observe(ran({ tool_input: { command: 'git push' } }));
  await quick.at(60_000);
  assert.equal(quick.posts.length, 0);
  // Unanswered, the second request gets its note ten seconds after it was made.
  const slow = testNotifier();
  slow.notifier.observe(ask({ tool_input: { command: 'npm publish' } }));
  await slow.at(2_000);
  slow.notifier.observe(ran({ tool_input: { command: 'npm publish' } }));
  await slow.at(9_500);
  slow.notifier.observe(ask({ tool_input: { command: 'git push' } }));
  await slow.at(9_500 + DIALOG_DELAY_MS - 1);
  assert.equal(slow.posts.length, 0);
  await slow.at(9_500 + DIALOG_DELAY_MS);
  assert.equal(slow.posts.length, 1);
});

test('only the same call reporting back proves its dialog answered', async () => {
  for (const name of ['PostToolUse', 'PostToolUseFailure', 'PermissionDenied']) {
    const { notifier, posts, at } = testNotifier();
    notifier.observe(ask({ agent_id: 'agent-h1' }));
    await at(1_000);
    notifier.observe(hook(name, { agent_id: 'h1', tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, tool_use_id: 'toolu_1' }));
    await at(60_000);
    assert.equal(posts.length, 0, name);
  }
  const { notifier, posts, at } = testNotifier();
  notifier.observe(ask());
  notifier.observe(ran({ tool_input: { command: 'ls' }, tool_use_id: 'toolu_2' }));
  notifier.observe(ran({ agent_id: 'agent-h1' }));
  notifier.observe(ran({ session_id: 's2' }));
  notifier.observe(ran({ tool_name: 'Read' }));
  notifier.observe(hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }));
  await at(DIALOG_DELAY_MS);
  assert.equal(posts.length, 1, 'a parallel call, another agent, another crew, another tool or a call about to run prove nothing');
});

test('parallel requests from one agent each wait for their own answer', async () => {
  // Codex asks for `cat ../a` and `cat ../b`; the town allows b at 3 s; a times out to the terminal.
  const held = testNotifier();
  const broker = brokerFor(held, 5_000);
  const ids = [];
  for (const command of ['cat ../a', 'cat ../b']) {
    const [request] = codex({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command } });
    held.notifier.observe(request);
    ids.push(broker.create(request, { hold: true }).approval.id);
  }
  await held.at(3_000);
  broker.decide(ids[1], 'allow');
  await held.at(6_000);
  assert.equal(broker.list().find((a) => a.id === ids[0])?.status, 'expired');
  await held.at(DIALOG_DELAY_MS);
  assert.equal(held.posts.length, 1, 'a still waits in the terminal');
  // Claude Code: b's hook arrives before a's; a is answered; then a notice and a Grep from the same batch.
  const terminal = testNotifier();
  terminal.notifier.observe(ask({ tool_input: { command: 'cat ../b' } }));
  terminal.notifier.observe(ask({ tool_input: { command: 'cat ../a' } }));
  await terminal.at(2_000);
  terminal.notifier.observe(ran({ tool_input: { command: 'cat ../a' } }));
  await terminal.at(3_000);
  terminal.notifier.observe(hook('Notification', { notification_type: 'permission_prompt' }));
  terminal.notifier.observe(hook('PostToolUse', { tool_name: 'Grep', tool_input: { pattern: 'TODO' }, tool_response: {} }));
  await terminal.at(DIALOG_DELAY_MS);
  assert.equal(terminal.posts.length, 1, 'b still waits');
});

test('a revised plan gets a note of its own: "No, keep planning" sends nothing else', async () => {
  const { notifier, posts, at } = testNotifier();
  const plan = (/** @type {string} */ text) => ({ tool_name: 'ExitPlanMode', tool_input: { plan: text } });
  notifier.observe(hook('PreToolUse', plan('Split the module')));
  notifier.observe(hook('PermissionRequest', plan('Split the module')));
  await at(DIALOG_DELAY_MS);
  assert.equal(posts.length, 1);
  // You said "No, keep planning" at the desk, then walked away: the revised plan waits for you.
  await at(60_000);
  notifier.observe(hook('PreToolUse', plan('Split the module, with tests')));
  notifier.observe(hook('PermissionRequest', plan('Split the module, with tests')));
  await at(60_000 + DIALOG_DELAY_MS);
  assert.deepEqual(posts.map((post) => post.body), ['A crew has a plan for you to approve.', 'A crew has a plan for you to approve.']);
  // At the desk the whole time: "No" at 4 s, the revised plan at 6 s, approved at 12 s. The first
  // plan was answered when the second came, so its ten seconds sent nothing.
  const desk = testNotifier();
  desk.notifier.observe(hook('PreToolUse', plan('Split the module')));
  desk.notifier.observe(hook('PermissionRequest', plan('Split the module')));
  await desk.at(6_000);
  desk.notifier.observe(hook('PreToolUse', plan('Split the module, with tests')));
  desk.notifier.observe(hook('PermissionRequest', plan('Split the module, with tests')));
  await desk.at(12_000);
  desk.notifier.observe(hook('PostToolUse', { ...plan('Split the module, with tests'), tool_response: {} }));
  await desk.at(120_000);
  assert.equal(desk.posts.length, 0);
});

test("an MCP server's form waits for you like a question", async () => {
  for (const notice of ['elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']) {
    const { notifier, posts, at } = testNotifier();
    notifier.observe(hook('Notification', { notification_type: notice, message: 'Sign in to the issue tracker' }));
    await at(DIALOG_DELAY_MS);
    assert.deepEqual(posts.map((post) => post.body), ['A crew has a question for you.'], notice);
  }
  // Answered when the lead moves on (its next call).
  const answered = testNotifier();
  answered.notifier.observe(hook('Notification', { notification_type: 'elicitation_dialog' }));
  await answered.at(3_000);
  answered.notifier.observe(hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/work/a.ts' } }));
  await answered.at(60_000);
  assert.equal(answered.posts.length, 0);
});

test('a question or a plan has a note of its own, and its answer closes it whatever its input became', async () => {
  // Answered at the desk: Claude Code adds the answers to the input. The request it sends joins the question.
  const answered = testNotifier();
  answered.notifier.observe(hook('PreToolUse', question()));
  answered.notifier.observe(hook('PermissionRequest', question()));
  await answered.at(5_000);
  const { tool_input: asked } = question();
  answered.notifier.observe(hook('PostToolUse', { tool_name: 'AskUserQuestion', tool_input: { ...asked, answers: { 'Which port?': '8080' } }, tool_response: {} }));
  answered.notifier.observe(hook('PreToolUse', { tool_name: 'ExitPlanMode', tool_input: { plan: 'Split the auth module' } }));
  await answered.at(6_000);
  answered.notifier.observe(hook('PostToolUse', { tool_name: 'ExitPlanMode', tool_input: { plan: 'Split the auth module, then test it' }, tool_response: {} }));
  await answered.at(60_000);
  assert.equal(answered.posts.length, 0);
  /** @type {[string, Record<string, any>[], string][]} */
  const cases = [
    ['a question', [hook('PreToolUse', question())], 'A crew has a question for you.'],
    ['a plan', [hook('PreToolUse', { tool_name: 'ExitPlanMode', tool_input: { plan: 'x' } })], 'A crew has a plan for you to approve.'],
    ['two crews with questions', [hook('PreToolUse', question()), hook('PreToolUse', { ...question(), session_id: 's2' })], '2 crews have a question for you.'],
    ['a question and a request', [hook('PreToolUse', question()), ask({ session_id: 's2' })], '2 crews need you.'],
    ['one crew asking both', [hook('PreToolUse', question()), ask()], 'A crew needs you.'],
  ];
  for (const [what, events, body] of cases) {
    const { notifier, posts, at } = testNotifier();
    for (const event of events) notifier.observe(event);
    await at(60_000);
    assert.deepEqual(posts.map((post) => [post.body, post.headers.Priority]), [[body, 'high']], what);
  }
});

test("Codex's list commands still prove their dialog answered", async () => {
  /** @type {[string, Record<string, any>][]} */
  const cases = [
    ['a command sent as a list', { tool_response: { exit_code: 0 } }],
    ['a list command that failed', { tool_response: { exit_code: 1, stderr: 'busy' } }],
  ];
  for (const [what, result] of cases) {
    const { notifier, posts, at } = testNotifier();
    const call = { tool_name: 'Bash', tool_input: { command: ['rm', '-rf', 'my build'] } };
    for (const event of codex({ hook_event_name: 'PermissionRequest', ...call })) notifier.observe(event);
    await at(1_000);
    for (const event of codex({ hook_event_name: 'PostToolUse', tool_use_id: 'call_1', ...call, ...result })) notifier.observe(event);
    await at(30_000);
    assert.equal(posts.length, 0, what);
  }
});

test("Codex's renamed calls prove their dialog answered", async () => {
  const patch = '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** Add File: src/b.ts\n+fresh\n*** End Patch';
  /** @type {[string, Record<string, any>][]} */
  const renamed = [['apply_patch', { command: patch }], ['spawn_agent', { message: 'look around' }]];
  for (const [tool, input] of renamed) {
    const { notifier, posts, at } = testNotifier();
    for (const event of codex({ hook_event_name: 'PermissionRequest', tool_name: tool, tool_input: input })) notifier.observe(event);
    await at(1_000);
    for (const event of codex({ hook_event_name: 'PostToolUse', tool_use_id: 'call_1', tool_name: tool, tool_input: input, tool_response: { output: 'ok' } })) notifier.observe(event);
    await at(30_000);
    assert.equal(posts.length, 0, tool);
  }
});

test("a Codex request with its reason for asking is answered by its call's start and result, whatever the tool", async () => {
  // Codex adds `description`, its reason, to a request only: never to the call's other hooks.
  const patch = '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** End Patch';
  /** @type {[string, Record<string, any>][]} */
  const calls = [['apply_patch', { command: patch }], ['mcp__gh__create_issue', { repo: 'a/b', title: 'Flaky test' }]];
  for (const [tool, input] of calls) {
    const town = testNotifier();
    const broker = brokerFor(town);
    const [asked] = codex({ hook_event_name: 'PermissionRequest', tool_name: tool, tool_input: { ...input, description: 'It needs to change the file' } });
    town.notifier.observe(asked);
    broker.create(asked, { hold: false });
    for (const event of codex({ hook_event_name: 'PreToolUse', tool_use_id: 'call_1', tool_name: tool, tool_input: input })) {
      town.notifier.observe(event);
      broker.observe(event);
    }
    await town.at(2_000);
    let resolved = 0;
    for (const event of codex({ hook_event_name: 'PostToolUse', tool_use_id: 'call_1', tool_name: tool, tool_input: input, tool_response: { output: 'ok' } })) {
      town.notifier.observe(event);
      resolved += broker.observe(event);
    }
    await town.at(60_000);
    assert.equal(town.posts.length, 0, `${tool}: answered in 2 s, no note`);
    assert.deepEqual([resolved, broker.list()[0].status, broker.list()[0].proof], [1, 'resolved', 'ran'], tool);
  }
});

test('the broker follows the same rules: a parallel call settles neither the note nor the request', async () => {
  const town = testNotifier();
  const broker = brokerFor(town);
  const request = ask();
  town.notifier.observe(request);
  broker.create(request, { hold: false });
  const parallel = ran({ tool_input: { command: 'ls' }, tool_use_id: 'toolu_2' });
  town.notifier.observe(parallel);
  assert.equal(broker.observe(parallel), 0, 'the request is still open in the terminal');
  await town.at(DIALOG_DELAY_MS);
  assert.equal(town.posts.length, 1, 'and so is its dialog');
});

test('a held request that expired or went back to the terminal still gets its note: the agent waits there', async () => {
  for (const ending of ['expired', 'released']) {
    const town = testNotifier();
    const broker = brokerFor(town, 3_000);
    const request = ask();
    town.notifier.observe(request);
    const { approval } = broker.create(request, { hold: true });
    if (ending === 'released') broker.release(approval.id);
    await town.at(5_000);
    assert.equal(broker.list()[0].status, ending === 'expired' ? 'expired' : 'pending');
    assert.equal(broker.heldCount(), 0, 'the terminal asks now');
    await town.at(DIALOG_DELAY_MS);
    assert.equal(town.posts.length, 1, ending);
  }
});

test("a session's own permission notice is a dialog only when nothing of that session is open", async () => {
  // Its request was lost (a 429, a failed proof, a restart): the notice is all there is.
  const lost = testNotifier();
  lost.notifier.observe(hook('Notification', { notification_type: 'permission_prompt' }));
  await lost.at(DIALOG_DELAY_MS);
  assert.deepEqual(lost.posts.map((post) => post.body), ['A crew needs your permission.']);
  // It names no tool, so no tool result answers it; your prompt or the lead's Stop does.
  /** @type {[string, Record<string, any>, number][]} */
  const cases = [
    ['a tool result', hook('PostToolUse', { tool_name: 'Read', tool_input: { file_path: '/work/a.ts' }, tool_response: {} }), 1],
    ['a prompt', hook('UserPromptSubmit', { prompt: 'go on' }), 0],
    ["the lead's Stop", hook('Stop'), 0],
    ["the lead's next call: it got past the dialog", hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/work/b.ts' } }), 0],
    ["a helper's next call", hook('PreToolUse', { agent_id: 'agent-h1', tool_name: 'Read', tool_input: { file_path: '/work/b.ts' } }), 1],
  ];
  for (const [what, proof, notes] of cases) {
    const { notifier, posts, at } = testNotifier();
    notifier.observe(hook('Notification', { notification_type: 'permission_prompt' }));
    await at(1_000);
    notifier.observe(proof);
    await at(60_000);
    assert.equal(posts.length, notes, what);
  }
});

test("a helper's dialog and its session's notice without agent_id make one note", async () => {
  for (const noticeAt of [3_000, 15_000]) {
    const { notifier, posts, at } = testNotifier();
    notifier.observe(ask({ agent_id: 'agent-h1', tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } }));
    await at(noticeAt);
    notifier.observe(hook('Notification', { notification_type: 'permission_prompt' }));
    await at(120_000);
    assert.equal(posts.length, 1, `notice at ${noticeAt} ms`);
  }
});

test('a decision in the town proves its own request answered, and no other', async () => {
  const both = testNotifier();
  const broker = brokerFor(both);
  const first = ask({ session_id: 's1' });
  both.notifier.observe(first);
  const one = broker.create(first, { hold: true }).approval;
  const second = ask({ session_id: 's2', agent_id: 'agent-h1' });
  both.notifier.observe(second);
  const two = broker.create(second, { hold: true }).approval;
  await both.at(3_000);
  broker.decide(one.id, 'allow');
  broker.decide(two.id, 'deny');
  await both.at(60_000);
  assert.equal(both.posts.length, 0, 'decided within the delay');
  // The agent asked again before its first request was decided: deciding the old one leaves the new dialog open.
  const again = testNotifier();
  const broker2 = brokerFor(again);
  const older = ask({ tool_input: { command: 'npm publish' } });
  again.notifier.observe(older);
  const old = broker2.create(older, { hold: true }).approval;
  await again.at(1_000);
  const newer = ask({ tool_input: { command: 'git push' } });
  again.notifier.observe(newer);
  broker2.create(newer, { hold: true });
  await again.at(2_000);
  broker2.decide(old.id, 'allow');
  again.notifier.approvalChanged({ ...old, id: 'someone-else', status: 'denied' });
  await again.at(1_000 + DIALOG_DELAY_MS - 1);
  assert.equal(again.posts.length, 0);
  await again.at(1_000 + DIALOG_DELAY_MS);
  assert.equal(again.posts.length, 1);
});

test('a prompt, the turn ending or the session ending proves its dialogs answered', async () => {
  const [interrupt] = toTownPayloads('codex', hook('Interrupt'));
  const helper = ask({ agent_id: 'agent-h1', tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } });
  /** @type {[string, Record<string, any>[], Record<string, any>, number][]} */
  const cases = [
    ["a prompt, for the lead's dialogs", [ask()], hook('UserPromptSubmit', { prompt: 'go on' }), 0],
    ["a prompt, for a helper's shown in the terminal (nobody types while one shows)", [helper], hook('UserPromptSubmit', { prompt: 'go on' }), 0],
    ['the lead stopping', [ask()], hook('Stop'), 0],
    ['the turn ending in an error', [ask()], hook('StopFailure', { error: 'server_error' }), 0],
    ['a teammate going idle', [helper], hook('TeammateIdle', { agent_id: 'agent-h1', teammate_name: 'frontend' }), 0],
    ['a teammate going idle, without its id', [helper], hook('TeammateIdle', { teammate_name: 'frontend' }), 1],
    ['your /compact', [ask()], hook('PreCompact', { trigger: 'manual' }), 0],
    ['a compact Claude Code made by itself', [ask()], hook('PreCompact', { trigger: 'auto' }), 1],
    ['the helper stopping', [helper], hook('SubagentStop', { agent_id: 'agent-h1' }), 0],
    ['the session ending', [ask(), helper], hook('SessionEnd', { reason: 'other' }), 0],
    ['a Codex interrupt', [ask(), helper], interrupt, 0],
    ['the lead stopping, for its helper', [helper], hook('Stop'), 1],
    ['a prompt in another crew', [ask()], hook('UserPromptSubmit', { session_id: 's2' }), 1],
  ];
  for (const [what, asks, proof, notes] of cases) {
    const { notifier, posts, at } = testNotifier();
    for (const event of asks) notifier.observe(event);
    await at(1_000);
    notifier.observe(proof);
    await at(30_000);
    assert.equal(dialogNotes(posts).length, notes, what);
  }
});

test('a prompt does not answer a request the town holds; once handed back to the terminal it does', async () => {
  const town = testNotifier();
  const broker = brokerFor(town);
  const request = ask({ agent_id: 'agent-h1', tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } });
  town.notifier.observe(request);
  const { approval } = broker.create(request, { hold: true });
  await town.at(1_000);
  town.notifier.observe(hook('UserPromptSubmit', { prompt: 'meanwhile, fix the README' }));
  await town.at(DIALOG_DELAY_MS);
  assert.equal(town.posts.length, 1, 'you may type to the lead while the town holds a helper\'s request');
  // Sent back to the terminal, it shows there: a prompt now means it was answered.
  const released = testNotifier();
  const broker2 = brokerFor(released);
  released.notifier.observe(request);
  broker2.release(broker2.create(request, { hold: true }).approval.id);
  await released.at(1_000);
  released.notifier.observe(hook('UserPromptSubmit', { prompt: 'next' }));
  await released.at(60_000);
  assert.equal(released.posts.length, 0);
  assert.equal(approval.held, true);
  // So it does once the town's wait ran out: the terminal asks now.
  const expired = testNotifier();
  const broker3 = brokerFor(expired, 1_000);
  expired.notifier.observe(request);
  broker3.create(request, { hold: true });
  await expired.at(1_000);
  expired.notifier.observe(hook('UserPromptSubmit', { prompt: 'next' }));
  await expired.at(60_000);
  assert.equal(expired.posts.length, 0);
});

test("a dialog goes by its hook's own time, whatever order the hooks arrive in", async () => {
  // A plan's request is sent at once, its PreToolUse in the background: here the request (sent at
  // 995) lands at 1 s and its start (sent at 990) only at 9 s. One dialog, due ten seconds after
  // the request was sent.
  const { notifier, posts, at } = testNotifier();
  const plan = { tool_name: 'ExitPlanMode', tool_input: { plan: 'Split the module' } };
  await at(1_000);
  notifier.observe(hook('PermissionRequest', plan), 995);
  await at(9_000);
  notifier.observe(hook('PreToolUse', plan), 990);
  await at(60_000);
  assert.deepEqual(posts.map((post) => [post.at, post.body]), [[10_995, 'A crew has a plan for you to approve.']]);
  // A sandbox's network prompt or an MCP server's form, sent at 2 s, lands before the PreToolUse
  // of the call that raised it (sent at 1.5 s): that call started before it, so it answers nothing.
  for (const notice of ['permission_prompt', 'elicitation_dialog']) {
    const net = testNotifier();
    await net.at(2_000);
    net.notifier.observe(hook('Notification', { notification_type: notice }), 2_000);
    await net.at(2_050);
    net.notifier.observe(hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'curl https://example.com' } }), 1_500);
    await net.at(60_000);
    assert.equal(net.posts.length, 1, notice);
  }
  // A time ahead of the server's clock counts as now.
  const ahead = testNotifier();
  ahead.notifier.observe(ask(), 3_600_000);
  await ahead.at(DIALOG_DELAY_MS);
  assert.equal(ahead.posts.length, 1);
});

test(`hooks stamped within ${ORDER_SLACK_MS} ms either way round keep a plan's note and a notice's`, async () => {
  // A plan's PreToolUse and its request, each stamped by its own forwarder: in either stamp order
  // and either arrival order, one dialog, one note and a request still pending.
  const plan = { tool_name: 'ExitPlanMode', tool_input: { plan: 'Split the module' } };
  for (const [requestAt, startAt] of [[1_001, 1_000], [1_000, 1_001]]) {
    for (const requestFirst of [true, false]) {
      const town = testNotifier();
      const broker = brokerFor(town);
      await town.at(1_010);
      const sendRequest = () => {
        town.notifier.observe(hook('PermissionRequest', plan), requestAt);
        broker.create(hook('PermissionRequest', plan), { hold: false, at: requestAt });
      };
      const sendStart = () => {
        town.notifier.observe(hook('PreToolUse', plan), startAt);
        broker.observe(hook('PreToolUse', plan), startAt);
      };
      for (const send of requestFirst ? [sendRequest, sendStart] : [sendStart, sendRequest]) send();
      await town.at(60_000);
      const label = `request at ${requestAt}, start at ${startAt}, ${requestFirst ? 'request' : 'start'} first`;
      const due = (requestFirst ? requestAt : startAt) + DIALOG_DELAY_MS;
      assert.deepEqual(town.posts.map((post) => [post.at, post.body]), [[due, 'A crew has a plan for you to approve.']], label);
      assert.equal(broker.list()[0].status, 'pending', label);
    }
  }
  // A call the lead started just before a notice, stamped just after it, is no proof of an answer.
  const net = testNotifier();
  await net.at(2_000);
  net.notifier.observe(hook('Notification', { notification_type: 'permission_prompt' }), 2_000);
  net.notifier.observe(hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'curl https://example.com' } }), 2_001);
  await net.at(60_000);
  assert.equal(net.posts.length, 1);
});

test("Codex's request, the only hook with the command's description, is answered by its call's result", async () => {
  const { notifier, posts, at } = testNotifier();
  const command = { tool_name: 'Bash', tool_input: { command: ['git', 'push'] } };
  notifier.observe(codex({ hook_event_name: 'PermissionRequest', ...command, tool_input: { ...command.tool_input, description: 'Push the branch' } })[0]);
  notifier.observe(codex({ hook_event_name: 'PreToolUse', ...command })[0]);
  await at(2_000);
  notifier.observe(codex({ hook_event_name: 'PostToolUse', ...command, tool_response: { exit_code: 0 } })[0]);
  await at(60_000);
  assert.equal(posts.length, 0, 'answered in 2 s: no note');
});

test('a note held back by the 30 s limit goes out when the limit allows', async () => {
  const { notifier, posts, at } = testNotifier();
  notifier.observe(ask({ session_id: 'crew-a' }));
  await at(20_000);
  notifier.observe(ask({ session_id: 'crew-b' }));
  await at(40_000 - 1);
  assert.equal(posts.length, 1);
  await at(40_000);
  assert.deepEqual(posts.map((post) => post.at), [10_000, 40_000]);
  // Answered while it was held back: nothing.
  const answered = testNotifier();
  answered.notifier.observe(ask({ session_id: 'crew-a' }));
  await answered.at(20_000);
  answered.notifier.observe(ask({ session_id: 'crew-b' }));
  await answered.at(35_000);
  answered.notifier.observe(ran({ session_id: 'crew-b' }));
  await answered.at(90_000);
  assert.equal(answered.posts.length, 1);
});

test('dialogs due together become one note, counting crews', async () => {
  const { notifier, posts, at } = testNotifier();
  notifier.observe(ask({ session_id: 's1' }));
  notifier.observe(hook('Notification', { session_id: 's1', notification_type: 'permission_prompt' }));
  notifier.observe(ask({ session_id: 's2', agent_id: 'agent-h1' }));
  notifier.observe(ask({ session_id: 's2' }));
  notifier.observe(ask({ session_id: 's3', tool_name: 'Write', tool_input: { file_path: '/work/secret-project/.env', content: 'KEY=1' } }));
  await at(DIALOG_DELAY_MS);
  assert.deepEqual(posts.map((post) => post.body), ['3 crews need your permission.']);
  for (const word of ['Write', '.env', 'secret']) assert.ok(!JSON.stringify(posts).includes(word), word);
});

test('a note covers every dialog its crews have open; a later one gets a note of its own', async () => {
  // Parallel tool calls each ask on their own, a moment apart: one note.
  const parallel = testNotifier();
  parallel.notifier.observe(ask({ tool_input: { command: 'cat ../a' } }));
  await parallel.at(500);
  parallel.notifier.observe(ask({ tool_input: { command: 'cat ../b' } }));
  await parallel.at(120_000);
  assert.deepEqual(parallel.posts.map((post) => post.at), [10_000], "b had its note with a's");
  // A request after the note is news again; it waits for the 30 s limit.
  const later = testNotifier();
  later.notifier.observe(ask({ tool_input: { command: 'cat ../a' } }));
  await later.at(20_000);
  later.notifier.observe(ask({ tool_input: { command: 'cat ../c' } }));
  await later.at(120_000);
  assert.deepEqual(later.posts.map((post) => post.at), [10_000, 40_000]);
});

test("past the hour's limit a dialog note is dropped, not retried", async () => {
  const { notifier, posts, at, clock } = testNotifier();
  for (let i = 0; i < 30; i += 1) {
    notifier.observe(hook('StopFailure', { error: 'server_error' }));
    await at((i + 1) * 31_000);
  }
  assert.equal(posts.length, 30);
  notifier.observe(ask());
  await at(30 * 31_000 + DIALOG_DELAY_MS);
  assert.equal(posts.length, 30);
  assert.equal(clock.pending, 0, 'no timer left for it');
});

test('a dialog that has had its note is forgotten after 30 minutes', async () => {
  const { notifier, posts, at } = testNotifier();
  notifier.observe(ask());
  await at(DIALOG_DELAY_MS);
  assert.equal(posts.length, 1);
  await at(29 * 60_000);
  notifier.observe(hook('Notification', { notification_type: 'permission_prompt' }));
  await at(30 * 60_000);
  assert.equal(posts.length, 1, 'still the same dialog');
  // A crashed session sends no SessionEnd: half an hour on, its dialog is forgotten.
  await at(31 * 60_000);
  notifier.observe(hook('Notification', { notification_type: 'permission_prompt' }));
  await at(31 * 60_000 + DIALOG_DELAY_MS);
  assert.equal(posts.length, 2);
});

test('open dialogs are capped at 100: the oldest give way', async () => {
  const { notifier, posts, at } = testNotifier();
  for (let i = 0; i <= 100; i += 1) notifier.observe(ask({ session_id: `crew-${i}` }));
  await at(DIALOG_DELAY_MS);
  assert.deepEqual(posts.map((post) => post.body), ['100 crews need your permission.']);
});

test('dispose drops what is waiting, and nothing is sent or started afterwards', async () => {
  const { notifier, posts, at, clock } = testNotifier();
  notifier.observe(ask());
  notifier.observe(codex(hook('Stop', { session_id: 'thr_1' }))[0]);
  assert.equal(clock.pending, 2);
  notifier.dispose();
  assert.equal(clock.pending, 0, 'every timer is cleared');
  notifier.observe(ask({ session_id: 's2' }));
  notifier.observe(codex(hook('Stop', { session_id: 'thr_2' }))[0]);
  notifier.observe(hook('Notification', { notification_type: 'idle_prompt' }));
  notifier.observe(hook('StopFailure', { error: 'server_error' }));
  notifier.approvalChanged(/** @type {any} */ ({ id: 'a1', status: 'pending', held: true, sessionId: 's2', agentId: null, toolName: 'Bash' }));
  assert.equal(clock.pending, 0, 'nothing starts a timer');
  await at(120_000);
  assert.equal(posts.length, 0);
  assert.equal(await notifier.test(), false);
});

test('a Codex lead that stopped gets the waiting note after a minute without a prompt', async () => {
  const event = (/** @type {string} */ name, /** @type {Record<string, any>} */ extra = {}) => codex({ hook_event_name: name, ...extra })[0];
  const stopped = testNotifier();
  stopped.notifier.observe(event('Stop'));
  await stopped.at(CODEX_IDLE_MS - 1);
  assert.equal(stopped.posts.length, 0);
  await stopped.at(CODEX_IDLE_MS);
  assert.deepEqual(stopped.posts.map((post) => post.body), ['A crew is waiting for your next prompt.']);
  await stopped.at(3 * CODEX_IDLE_MS);
  assert.equal(stopped.posts.length, 1, 'one note per Stop');
  // Only a prompt, or the session starting or ending, ends the wait.
  const ends = [event('UserPromptSubmit', { prompt: 'next' }), event('SessionStart', { source: 'resume' }), event('SessionEnd')];
  for (const next of ends) {
    const { notifier, posts, at } = testNotifier();
    notifier.observe(event('Stop'));
    await at(30_000);
    notifier.observe(next);
    notifier.observe(event('PostToolUse', { tool_name: 'Read', tool_input: { file_path: '/b' }, tool_response: {} }));
    await at(5 * CODEX_IDLE_MS);
    assert.equal(posts.length, 0, next.hook_event_name);
  }
  // Codex names a helper only when it starts and ends, so its tools look like the lead's: a tool
  // pauses the minute, its result or the helper's end starts it again.
  const helpers = testNotifier();
  helpers.notifier.observe(event('Stop'));
  await helpers.at(5_000);
  helpers.notifier.observe(event('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/b' } }));
  await helpers.at(5_000 + 2 * CODEX_IDLE_MS);
  assert.equal(helpers.posts.length, 0, 'paused while the tool runs');
  helpers.notifier.observe(event('PostToolUse', { tool_name: 'Read', tool_input: { file_path: '/b' }, tool_response: {} }));
  const resumed = helpers.clock.now();
  await helpers.at(resumed + 10_000);
  helpers.notifier.observe(event('SubagentStop', { agent_id: 'agent-h1' }));
  await helpers.at(resumed + 10_000 + CODEX_IDLE_MS - 1);
  assert.equal(helpers.posts.length, 0);
  await helpers.at(resumed + 10_000 + CODEX_IDLE_MS);
  assert.equal(helpers.posts.length, 1);
  // Noted: more of the crew's work does not say it again.
  helpers.notifier.observe(event('PostToolUse', { tool_name: 'Read', tool_input: { file_path: '/c' }, tool_response: {} }));
  await helpers.at(helpers.clock.now() + 2 * CODEX_IDLE_MS);
  assert.equal(helpers.posts.length, 1, 'one note per Stop');
  // The lead's next Stop is news again.
  helpers.notifier.observe(event('Stop'));
  await helpers.at(helpers.clock.now() + CODEX_IDLE_MS);
  assert.equal(helpers.posts.length, 2);
  // Anything else of the lead's leaves the minute running.
  const compacted = testNotifier();
  compacted.notifier.observe(event('Stop'));
  await compacted.at(10_000);
  compacted.notifier.observe(event('PreCompact', { trigger: 'auto' }));
  await compacted.at(CODEX_IDLE_MS);
  assert.equal(compacted.posts.length, 1);
  const others = testNotifier();
  others.notifier.observe(hook('Stop'));
  others.notifier.observe(event('Stop', { agent_id: 'agent-h1' }));
  await others.at(5 * CODEX_IDLE_MS);
  assert.equal(others.posts.length, 0, "Claude Code's Stop (its idle_prompt says it) and a Codex helper's");
  // Bounded: sessions that stopped and went quiet give way, the oldest first.
  const many = testNotifier();
  for (let i = 0; i < 150; i += 1) many.notifier.observe(event('Stop', { session_id: `thr_${i}` }));
  assert.equal(many.clock.pending, 100);
});

test('notes are posted to ntfy with a title, priority and tags, and rate-limited', async () => {
  const { notifier, posts, at } = testNotifier();
  assert.equal(notifier.on, true);
  notifier.observe(hook('Notification', { notification_type: 'idle_prompt' }));
  notifier.observe(hook('Notification', { session_id: 's2', notification_type: 'idle_prompt' }));
  await at(1);
  assert.equal(posts.length, 1, 'the same kind at most every 30 s');
  assert.equal(posts[0].method, 'POST');
  assert.equal(posts[0].url, 'https://ntfy.example/topic');
  assert.equal(posts[0].body, 'A crew is waiting for your next prompt.');
  assert.deepEqual(posts[0].headers, { Title: 'Andary', Priority: 'default', Tags: 'hourglass' });
  await at(31_000);
  notifier.observe(hook('Notification', { notification_type: 'idle_prompt' }));
  await at(31_001);
  assert.equal(posts.length, 2);
  // Test notes: one every 30 s at most, and they never use up the hour's budget.
  assert.equal(await notifier.test(), true);
  assert.equal(await notifier.test(), false, 'a second test right away is not sent');
  let t = 31_001;
  for (let i = 0; i < 40; i += 1) {
    t += 31_000;
    await at(t);
    await notifier.test();
  }
  assert.equal(posts.length, 43);
  for (let i = 0; i < 40; i += 1) {
    t += 31_000;
    await at(t);
    notifier.observe(hook('StopFailure', { error: 'server_error' }));
  }
  await at(t + 1);
  assert.equal(posts.length, 43 + 28, 'at most 30 real notes an hour, tests aside');
  const off = createNotifier({ url: null });
  off.observe(ask());
  assert.equal(await off.test(), false);
});

test('a failing ntfy is logged once and does not throw', async () => {
  const logs = [];
  const notifier = createNotifier({ url: 'https://ntfy.example/t', fetchImpl: /** @type {any} */ (async () => ({ ok: false, status: 500 })), log: (m) => logs.push(m), now: (() => { let t = 0; return () => (t += 60_000); })() });
  assert.equal(await notifier.test(), false);
  assert.equal(await notifier.test(), false);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /HTTP 500/);
});

test('the saved topic is random, private to the user and kept', () => {
  const home = join(mkdtempSync(join(tmpdir(), 'notify-')), 'home');
  const url = savedTopicUrl(home);
  assert.match(url, /^https:\/\/ntfy\.sh\/andary-[\w-]{24}$/);
  assert.equal(savedTopicUrl(home), url);
  // Windows has no POSIX modes; the user profile's permissions protect the file there.
  if (process.platform !== 'win32') assert.equal(statSync(join(home, 'notify.json')).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(join(home, 'notify.json'), 'utf8')).url, url);
});

test('--notify-url takes only an http(s) topic URL without credentials', () => {
  assert.equal(checkNotifyUrl('https://ntfy.sh/abc'), 'https://ntfy.sh/abc');
  assert.equal(checkNotifyUrl('http://192.168.1.5:8080/topic'), 'http://192.168.1.5:8080/topic');
  assert.equal(checkNotifyUrl('https://ntfy.sh/'), null);
  assert.equal(checkNotifyUrl('file:///etc/passwd'), null);
  assert.equal(checkNotifyUrl('https://user:pw@ntfy.sh/t'), null);
  assert.equal(parseNotifyUrl(undefined), null);
  assert.throws(() => parseNotifyUrl('nope'), /--notify-url takes/);
});

test('this computer\'s notifications: fresh approvals, finished turns and failures only', () => {
  const state = /** @type {any} */ ({ sessions: [{ id: 's1', project: 'api-server' }] });
  const now = 100_000;
  assert.deepEqual(notificationFor({ type: 'approval', approval: { id: 'a', status: 'pending', sessionId: 's1', toolName: 'Bash', createdAt: now } }, state, now), { title: 'Permission needed', body: 'api-server wants to use Bash.', tag: 'approval-a' });
  assert.equal(notificationFor({ type: 'approval', approval: { id: 'a', status: 'allowed', createdAt: now } }, state, now), null);
  assert.equal(notificationFor({ type: 'approval', approval: { id: 'a', status: 'pending', createdAt: 0 } }, state, now), null, 'replayed history is not news');
  assert.equal(notificationFor({ type: 'event', event: { kind: 'turn.stop', ts: now, sessionId: 's1', agentKey: 's1:main' } }, state, now)?.title, 'Turn finished');
  assert.equal(notificationFor({ type: 'event', event: { kind: 'turn.stop', ts: now, sessionId: 's1', agentKey: 's1:abc' } }, state, now), null);
  assert.equal(notificationFor({ type: 'event', event: { kind: 'turn.fail', ts: now, sessionId: 's2', agentKey: 's2:main' } }, state, now)?.body, 'A crew stopped with an error.');
  assert.equal(notificationFor({ type: 'usage' }, state, now), null);
  const team = /** @type {any} */ ({ ...state, sessions: [...state.sessions, { id: 'Lina~s3', project: 'web-app', member: 'Lina' }] });
  assert.equal(notificationFor({ type: 'event', event: { kind: 'turn.stop', ts: now, sessionId: 'Lina~s3', agentKey: 'Lina~s3:main' } }, team, now), null, 'a teammate\'s crew is theirs to watch');
});
