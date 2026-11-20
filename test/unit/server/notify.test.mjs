import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkNotifyUrl, createNotifier, noteFor, savedTopicUrl } from '../../../server/notify.mjs';
import { parseNotifyUrl } from '../../../server/cli/options.mjs';
import { notificationFor } from '../../../public/js/ui/notifications.js';

test('noteFor picks what deserves a phone notification, and never says more than what happened', () => {
  assert.equal(noteFor({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf secret' }, cwd: '/x/secret-project' })?.kind, 'permission');
  assert.equal(noteFor({ hook_event_name: 'Notification', notification_type: 'permission_prompt' })?.kind, 'permission');
  assert.equal(noteFor({ hook_event_name: 'Notification', notification_type: 'idle_prompt' })?.kind, 'waiting');
  assert.equal(noteFor({ hook_event_name: 'Notification', notification_type: 'auth_success' }), null);
  assert.equal(noteFor({ hook_event_name: 'Stop' })?.kind, 'finished');
  assert.equal(noteFor({ hook_event_name: 'Stop', agent_id: 'a1' }), null, 'a helper finishing is not news');
  assert.equal(noteFor({ hook_event_name: 'StopFailure', error: 'rate_limit' })?.kind, 'limit');
  assert.equal(noteFor({ hook_event_name: 'StopFailure', error: 'server_error' })?.kind, 'stopped');
  assert.equal(noteFor({ hook_event_name: 'PreToolUse' }), null);
  const permission = noteFor({ hook_event_name: 'PermissionRequest', tool_input: { command: 'rm -rf secret' }, cwd: '/x/secret-project' });
  assert.ok(!JSON.stringify(permission).includes('secret'));
});

test('notifications are posted to ntfy with a title, priority and tags, and rate-limited', async () => {
  let now = 0;
  /** @type {any[]} */
  const posts = [];
  const fetchImpl = /** @type {any} */ (async (url, init) => {
    posts.push({ url, ...init });
    return { ok: true, status: 200 };
  });
  const notifier = createNotifier({ url: 'https://ntfy.example/topic', fetchImpl, now: () => now });
  assert.equal(notifier.on, true);
  notifier.observe({ hook_event_name: 'PermissionRequest' });
  notifier.observe({ hook_event_name: 'PermissionRequest' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(posts.length, 1, 'the same kind at most every 30 s');
  assert.equal(posts[0].method, 'POST');
  assert.equal(posts[0].body, 'A crew needs your permission.');
  assert.equal(posts[0].headers.Priority, 'high');
  now = 31_000;
  notifier.observe({ hook_event_name: 'PermissionRequest' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(posts.length, 2);
  // Test notes: one every 30 s at most, and they never use up the hour's budget.
  assert.equal(await notifier.test(), true);
  assert.equal(await notifier.test(), false, 'a second test right away is not sent');
  for (let i = 0; i < 40; i += 1) {
    now += 31_000;
    await notifier.test();
  }
  assert.equal(posts.length, 43);
  for (let i = 0; i < 40; i += 1) {
    now += 31_000;
    notifier.observe({ hook_event_name: 'PermissionRequest' });
  }
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(posts.length, 43 + 28, 'at most 30 real notes an hour, tests aside');
  assert.equal(await createNotifier({ url: null }).test(), false);
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
