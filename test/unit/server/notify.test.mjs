import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODEX_IDLE_MS, PERMISSION_DELAY_MS, checkNotifyUrl, createNotifier, noteFor, savedTopicUrl } from '../../../server/notify.mjs';
import { createApprovalBroker } from '../../../server/approvals.mjs';
import { toTownPayloads } from '../../../server/adapters/index.mjs';
import { parseNotifyUrl } from '../../../server/cli/options.mjs';
import { notificationFor } from '../../../public/js/ui/notifications.js';
import { createFakeClock } from '../core/helpers.mjs';

test('noteFor picks what deserves a phone notification, and never says more than what happened', () => {
  assert.equal(noteFor({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf secret' }, cwd: '/x/secret-project' })?.kind, 'permission');
  assert.equal(noteFor({ hook_event_name: 'Notification', notification_type: 'permission_prompt' })?.kind, 'permission');
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
  const permission = noteFor({ hook_event_name: 'PermissionRequest', tool_input: { command: 'rm -rf secret' }, cwd: '/x/secret-project' });
  assert.ok(!JSON.stringify(permission).includes('secret'));
});

/**
 * A notifier on a fake clock whose timers fire at their time, posting into `posts`.
 * @param {Partial<import('../../../server/notify.mjs').NotifierOptions>} [options]
 */
function testNotifier(options = {}) {
  const clock = createFakeClock(0);
  /** @type {any[]} */
  const posts = [];
  const notifier = createNotifier({
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
  return createApprovalBroker({
    timeoutMs,
    now: clock.now,
    onChange: (approval) => notifier.approvalChanged(approval),
    timers: { set: (fn, ms) => clock.setTimeout(fn, ms), clear: (id) => clock.clearTimeout(id) },
  });
}

/** @param {string} name @param {Record<string, any>} [extra] */
const hook = (name, extra = {}) => ({ hook_event_name: name, session_id: 's1', cwd: '/work/secret-project', ...extra });
/** A permission request for `rm -rf build`. @param {Record<string, any>} [extra] */
const ask = (extra = {}) => hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, ...extra });
/** That command's result. @param {Record<string, any>} [extra] */
const ran = (extra = {}) => hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, tool_use_id: 'toolu_1', tool_response: { stdout: '' }, ...extra });
/** @param {any[]} posts */
const permissionNotes = (posts) => posts.filter((post) => post.body.includes('permission'));

test('a permission note goes out after the delay, once for its dialog, and names nothing', async () => {
  const { notifier, posts, at } = testNotifier();
  notifier.observe(ask());
  await at(PERMISSION_DELAY_MS - 1);
  assert.equal(posts.length, 0, 'nothing before the delay');
  await at(PERMISSION_DELAY_MS);
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
  await slow.at(9_500 + PERMISSION_DELAY_MS - 1);
  assert.equal(slow.posts.length, 0);
  await slow.at(9_500 + PERMISSION_DELAY_MS);
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
  await at(PERMISSION_DELAY_MS);
  assert.equal(posts.length, 1, 'a parallel call, another agent, another crew, another tool or a call about to run prove nothing');
});

test('Codex calls the adapter rewrote still prove their dialog answered', async () => {
  const codex = (/** @type {Record<string, any>} */ payload) => toTownPayloads('codex', { session_id: 'thr_1', cwd: '/work/app', ...payload });
  const patch = '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** Add File: src/b.ts\n+fresh\n*** End Patch';
  /** @type {[string, Record<string, any>, Record<string, any>][]} */
  const cases = [
    ['a patch, run as an Edit and a Write', { tool_name: 'apply_patch', tool_input: { command: patch } }, { tool_name: 'apply_patch', tool_input: { command: patch }, tool_response: { output: 'Success' } }],
    ['a command sent as a list', { tool_name: 'Bash', tool_input: { command: ['rm', '-rf', 'my build'] } }, { tool_name: 'Bash', tool_input: { command: ['rm', '-rf', 'my build'] }, tool_response: { exit_code: 0 } }],
    ['a list command that failed', { tool_name: 'Bash', tool_input: { command: ['rm', '-rf', 'my build'] } }, { tool_name: 'Bash', tool_input: { command: ['rm', '-rf', 'my build'] }, tool_response: { exit_code: 1, stderr: 'busy' } }],
  ];
  for (const [what, request, result] of cases) {
    const { notifier, posts, at } = testNotifier();
    for (const event of codex({ hook_event_name: 'PermissionRequest', ...request })) notifier.observe(event);
    await at(1_000);
    for (const event of codex({ hook_event_name: 'PostToolUse', tool_use_id: 'call_1', ...result })) notifier.observe(event);
    await at(30_000);
    assert.equal(posts.length, 0, what);
  }
});

test("the broker's own guess that the terminal answered (by tool name only) is no proof", async () => {
  const town = testNotifier();
  const broker = brokerFor(town);
  const request = ask();
  town.notifier.observe(request);
  broker.create(request, { hold: false });
  const parallel = ran({ tool_input: { command: 'ls' }, tool_use_id: 'toolu_2' });
  town.notifier.observe(parallel);
  assert.equal(broker.observe(parallel), 1, 'the broker takes it for the answer');
  await town.at(PERMISSION_DELAY_MS);
  assert.equal(town.posts.length, 1, 'the dialog may still be open');
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
    await town.at(PERMISSION_DELAY_MS);
    assert.equal(town.posts.length, 1, ending);
  }
});

test("Claude Code's permission_prompt is news only when its request never reached the town", async () => {
  const { notifier, posts, at } = testNotifier();
  // Its PermissionRequest was lost (a 429, a failed proof, a restart): the notice is all there is.
  notifier.observe(hook('Notification', { notification_type: 'permission_prompt' }));
  await at(PERMISSION_DELAY_MS);
  assert.equal(posts.length, 1);
  // The notice of a dialog already noted sends nothing more.
  await at(40_000);
  notifier.observe(ask({ session_id: 's2' }));
  await at(40_000 + PERMISSION_DELAY_MS);
  assert.equal(posts.length, 2);
  await at(55_000);
  notifier.observe(hook('Notification', { session_id: 's2', notification_type: 'permission_prompt' }));
  await at(120_000);
  assert.equal(posts.length, 2);
  // Its tool is unknown, so any tool result of that agent proves it answered.
  notifier.observe(hook('Notification', { session_id: 's3', notification_type: 'permission_prompt' }));
  await at(121_000);
  notifier.observe(ran({ session_id: 's3', tool_name: 'Read', tool_input: { file_path: '/work/a.ts' } }));
  await at(200_000);
  assert.equal(posts.length, 2);
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
  await again.at(1_000 + PERMISSION_DELAY_MS);
  assert.equal(again.posts.length, 1);
});

test('a prompt, the turn ending or the session ending proves its dialogs answered', async () => {
  const interrupt = toTownPayloads('codex', hook('Interrupt'))[0];
  /** @type {[string, Record<string, any>[], Record<string, any>, number][]} */
  const cases = [
    ['a prompt', [ask(), ask({ agent_id: 'agent-h1' })], hook('UserPromptSubmit', { prompt: 'go on' }), 0],
    ['the lead stopping', [ask()], hook('Stop'), 0],
    ['the helper stopping', [ask({ agent_id: 'agent-h1' })], hook('SubagentStop', { agent_id: 'agent-h1' }), 0],
    ['the session ending', [ask(), ask({ agent_id: 'agent-h1' })], hook('SessionEnd', { reason: 'other' }), 0],
    ['a Codex interrupt', [ask(), ask({ agent_id: 'agent-h1' })], interrupt, 0],
    ['the lead stopping, for its helper', [ask({ agent_id: 'agent-h1' })], hook('Stop'), 1],
    ['a prompt in another crew', [ask()], hook('UserPromptSubmit', { session_id: 's2' }), 1],
  ];
  for (const [what, asks, proof, notes] of cases) {
    const { notifier, posts, at } = testNotifier();
    for (const event of asks) notifier.observe(event);
    await at(1_000);
    notifier.observe(proof);
    await at(30_000);
    assert.equal(permissionNotes(posts).length, notes, what);
  }
});

test('a permission note held back by the 30 s limit goes out when the limit allows', async () => {
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
  await at(PERMISSION_DELAY_MS);
  assert.deepEqual(posts.map((post) => post.body), ['3 crews need your permission.']);
  for (const word of ['Write', '.env', 'secret']) assert.ok(!JSON.stringify(posts).includes(word), word);
});

test('past the hour\'s limit a permission note is dropped, not retried', async () => {
  const { notifier, posts, at, clock } = testNotifier();
  for (let i = 0; i < 30; i += 1) {
    notifier.observe(hook('StopFailure', { error: 'server_error' }));
    await at((i + 1) * 31_000);
  }
  assert.equal(posts.length, 30);
  notifier.observe(ask());
  await at(30 * 31_000 + PERMISSION_DELAY_MS);
  assert.equal(posts.length, 30);
  assert.equal(clock.pending, 0, 'no timer left for it');
});

test('a dialog that has had its note is forgotten after 30 minutes', async () => {
  const { notifier, posts, at } = testNotifier();
  notifier.observe(ask());
  await at(PERMISSION_DELAY_MS);
  assert.equal(posts.length, 1);
  await at(29 * 60_000);
  notifier.observe(hook('Notification', { notification_type: 'permission_prompt' }));
  await at(30 * 60_000);
  assert.equal(posts.length, 1, 'still the same dialog');
  // A crashed session sends no SessionEnd: half an hour on, its dialog is forgotten.
  await at(31 * 60_000);
  notifier.observe(hook('Notification', { notification_type: 'permission_prompt' }));
  await at(31 * 60_000 + PERMISSION_DELAY_MS);
  assert.equal(posts.length, 2);
});

test('dispose drops what is waiting, and nothing is sent or started afterwards', async () => {
  const { notifier, posts, at, clock } = testNotifier();
  notifier.observe(ask());
  notifier.observe(toTownPayloads('codex', hook('Stop', { session_id: 'thr_1' }))[0]);
  assert.equal(clock.pending, 2);
  notifier.dispose();
  assert.equal(clock.pending, 0, 'every timer is cleared');
  notifier.observe(ask({ session_id: 's2' }));
  notifier.observe(toTownPayloads('codex', hook('Stop', { session_id: 'thr_2' }))[0]);
  notifier.observe(hook('Notification', { notification_type: 'idle_prompt' }));
  notifier.observe(hook('StopFailure', { error: 'server_error' }));
  notifier.approvalChanged(/** @type {any} */ ({ id: 'a1', status: 'pending', held: true, sessionId: 's2', agentId: null }));
  assert.equal(clock.pending, 0, 'nothing starts a timer');
  await at(120_000);
  assert.equal(posts.length, 0);
  assert.equal(await notifier.test(), false);
});

test('a Codex lead that stopped gets the waiting note after a minute without a prompt', async () => {
  const codex = (/** @type {string} */ name, /** @type {Record<string, any>} */ extra = {}) => toTownPayloads('codex', hook(name, { session_id: 'thr_1', ...extra }))[0];
  const stopped = testNotifier();
  stopped.notifier.observe(codex('Stop'));
  await stopped.at(CODEX_IDLE_MS - 1);
  assert.equal(stopped.posts.length, 0);
  await stopped.at(CODEX_IDLE_MS);
  assert.deepEqual(stopped.posts.map((post) => post.body), ['A crew is waiting for your next prompt.']);
  for (const next of [codex('UserPromptSubmit', { prompt: 'next' }), codex('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/a' } }), codex('SessionEnd')]) {
    const { notifier, posts, at } = testNotifier();
    notifier.observe(codex('Stop'));
    await at(30_000);
    notifier.observe(next);
    await at(5 * CODEX_IDLE_MS);
    assert.equal(posts.length, 0, next.hook_event_name);
  }
  const others = testNotifier();
  others.notifier.observe(hook('Stop'));
  others.notifier.observe(codex('Stop', { agent_id: 'agent-h1' }));
  await others.at(5 * CODEX_IDLE_MS);
  assert.equal(others.posts.length, 0, "Claude Code's Stop (its idle_prompt says it) and a Codex helper's");
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
