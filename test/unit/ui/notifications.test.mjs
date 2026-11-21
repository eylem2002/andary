// This computer's notifications follow "needs you" (core/attention.js): what deserves one, in
// words that never show a command, and each item pops up once, only while the town is behind.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createStore } from '../../../public/js/core/store.js';
import { createNeedsYou } from '../../../public/js/ui/needs-you.js';
import { NEWS_MS, installNotifications, notificationFor } from '../../../public/js/ui/notifications.js';
import { SESSION, envelope, hook } from '../core/helpers.mjs';

const T0 = 1_000_000;
const OTHER = '7c1d0e3f-2e5b-4d44-8f20-1b8c7d6e5f40';
const other = { session: OTHER };

/**
 * A store fed hook payloads, and its "needs you" list, on a clock the test moves.
 * @param {{ viewOnly?: boolean }} [options]
 */
function town({ viewOnly = false } = {}) {
  let at = T0;
  const now = () => at;
  const store = createStore({ now });
  const needsYou = createNeedsYou({ storage: null, now, viewOnly: () => viewOnly });
  return {
    store,
    needsYou,
    now,
    /** @param {number} ms */
    advance(ms) {
      at += ms;
    },
    /** @param {string} name @param {Record<string, any>} [extra] @param {Record<string, any>} [who] */
    send(name, extra = {}, who = {}) {
      store.ingest(envelope(hook(name, extra, who), at));
    },
    /** @param {string} id @param {Record<string, any>} [fields] */
    ask(id, fields = {}) {
      store.setApproval({ id, status: 'pending', held: true, sessionId: SESSION, agentId: null, toolName: 'Bash', toolInput: { command: 'rm -rf secret-dir' }, createdAt: at, expiresAt: at + 120_000, ...fields });
    },
    items: () => needsYou.items(store.getState(), at),
    /** @param {number} [later] */
    notes(later = 0) {
      return needsYou.items(store.getState(), at).map((item) => notificationFor(item, store.getState(), at + later));
    },
  };
}

describe('what deserves a notification', () => {
  test('a permission request names the crew, never the command', () => {
    const t = town();
    t.send('SessionStart', { source: 'startup' });
    t.ask('a1');
    const [note] = t.notes();
    assert.deepEqual(note, { title: 'Permission needed', body: 'api-server needs your permission.', tag: t.items()[0].id });
    assert.doesNotMatch(JSON.stringify(note), /rm -rf|secret/);
    t.send('SessionStart', { source: 'startup' }, other);
    t.ask('a2', { held: false, sessionId: OTHER });
    assert.deepEqual(t.notes().map((n) => n?.body), ['api-server needs your permission.', 'api-server needs your permission in its terminal.']);
  });

  test('questions and plans are answered in the terminal', () => {
    const t = town();
    t.send('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Drop the users table?' }] }, tool_use_id: 'q1' });
    t.send('PreToolUse', { tool_name: 'ExitPlanMode', tool_input: { plan: 'Rewrite auth' }, tool_use_id: 'p1' }, other);
    assert.deepEqual(t.notes().map((n) => n?.title), ['Question for you', 'Plan to approve']);
    assert.doesNotMatch(JSON.stringify(t.notes()), /users table|Rewrite auth/);
  });

  test('stops: one crew by name, crews stopped by one rate limit as one note', () => {
    const t = town();
    t.send('StopFailure', { error: 'overloaded' });
    assert.deepEqual(t.notes()[0], { title: 'Turn stopped', body: 'api-server: Servers overloaded.', tag: t.items()[0].id });
    const limited = town();
    limited.send('StopFailure', { error: 'rate_limit' });
    limited.send('StopFailure', { error: 'rate_limit' }, other);
    assert.deepEqual(limited.notes().map((n) => [n?.title, n?.body]), [['Crews stopped', 'Rate limited: 2 crews stopped.']]);
  });

  test('an agent that seems stuck names the crew, never the step', () => {
    const t = town();
    for (const id of ['t1', 't2', 't3']) {
      t.send('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm run deploy:secret' }, tool_use_id: id, error: 'Exit code 1', is_interrupt: false });
    }
    assert.match(t.items()[0].text, /deploy:secret/, 'the HUD may show the command');
    assert.deepEqual(t.notes()[0], { title: 'Seems stuck', body: 'api-server seems stuck: the same step keeps failing.', tag: t.items()[0].id });
    assert.doesNotMatch(JSON.stringify(t.notes()), /deploy|secret|npm/);
    const repeating = town();
    for (const id of ['t1', 't2', 't3', 't4', 't5']) {
      repeating.send('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test 2>&1 | tail -40' }, tool_use_id: id, tool_response: { stdout: 'ok' } });
    }
    assert.equal(repeating.notes()[0]?.body, 'api-server seems stuck: it keeps repeating the same step.', 'a step run over and over need not fail');
  });

  test('a finished turn only once nobody answered, and only with more than one crew at work', () => {
    const t = town();
    t.send('Stop', { last_assistant_message: 'Done.' });
    assert.deepEqual(t.notes(), [null], 'listed, but not counted yet');
    t.send('Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });
    assert.deepEqual(t.notes(), [null], 'one crew: you are at its terminal');
    t.send('SessionStart', { source: 'startup' }, other);
    assert.equal(t.notes()[0]?.title, 'Turn finished');
  });

  test('only news: an item that started to count a while ago does not pop up', () => {
    const t = town();
    t.send('SessionStart', { source: 'startup' });
    t.ask('a1');
    assert.ok(t.notes(NEWS_MS)[0]);
    assert.equal(t.notes(NEWS_MS + 1)[0], null);
  });

  test('two agents in one folder: the crew by name and number, never the file, the command or the other agent', () => {
    const t = town();
    const file = '/home/dev/code/api-server/src/secret-plan.ts';
    t.send('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: file, old_string: 'a', new_string: 'b' }, tool_response: {}, tool_use_id: 'e1' });
    t.send('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: file, old_string: 'b', new_string: 'c' }, tool_response: {}, tool_use_id: 'e2' }, other);
    assert.deepEqual(t.notes(), [null], 'an edit is a note: nothing pops up');
    t.send('PostToolUse', { tool_name: 'Write', tool_input: { file_path: file, content: 'x' }, tool_response: {}, tool_use_id: 'w1' }, other);
    t.send('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git stash' }, tool_use_id: 'b1' });
    const notes = t.notes().filter(Boolean);
    assert.deepEqual(notes.map((n) => [n?.title, n?.body]), [
      ['Two agents in one folder', "api-server (crew 2) may be undoing another agent's work."],
      ['Two agents in one folder', "api-server (crew 1) may be undoing another agent's work."],
    ], 'crews in one folder share a project name: the number tells which');
    assert.doesNotMatch(JSON.stringify(notes), /secret-plan|git stash|Foreman/);
  });
});

describe('installNotifications', () => {
  /** @type {{ title: string, body: string }[]} */
  let shown = [];
  /** @type {string[]} */
  let heard = [];
  let refreshes = 0;
  /** @type {(() => void)[]} watchers to stop, even after a failed assertion (they keep a timer) */
  const watching = [];
  const saved = { document: globalThis.document, Notification: globalThis.Notification };
  const page = { hidden: false, title: '' };

  beforeEach(() => {
    shown = [];
    heard = [];
    refreshes = 0;
    page.hidden = false;
    page.title = '';
    Object.assign(globalThis, {
      document: page,
      Notification: class {
        static permission = 'granted';
        /** @param {string} title @param {{ body: string }} options */
        constructor(title, options) {
          shown.push({ title, body: options.body });
        }
      },
    });
  });
  afterEach(() => {
    for (const stop of watching.splice(0)) stop();
    Object.assign(globalThis, saved);
  });

  /** @param {ReturnType<typeof town>} t @param {Record<string, any>} [prefs] @param {number} [every] */
  function watch(t, prefs = { desktopNotify: true }, every = 60_000) {
    const announcer = { polite: (/** @type {string} */ text) => void heard.push(text) };
    const ctx = /** @type {any} */ ({ store: t.store, needsYou: t.needsYou, prefs, announcer, refresh: () => void (refreshes += 1) });
    watching.push(installNotifications(ctx, { now: t.now, every }));
  }
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  test('what you saw with the town in front never pops up later; something new behind it pops up once', async () => {
    const t = town();
    watch(t);
    t.send('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which port?' }] }, tool_use_id: 'q1' });
    await settle();
    assert.deepEqual([shown.length, page.title], [0, '(1) Andary']);
    page.hidden = true;
    t.send('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/x' }, tool_use_id: 'r1' }, other);
    await settle();
    assert.equal(shown.length, 0, 'the question was on screen before');
    t.ask('a1', { sessionId: OTHER });
    await settle();
    t.ask('a1', { sessionId: OTHER });
    await settle();
    assert.deepEqual(shown, [{ title: 'Permission needed', body: 'api-server needs your permission.' }]);
    assert.equal(page.title, '(2) Andary', 'the title counts without a render');
  });

  test('a reconnect replays history in one go: asked and answered within it is no news', async () => {
    const t = town();
    page.hidden = true;
    watch(t);
    t.store.reset();
    t.send('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
    t.send('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: {} });
    await settle();
    assert.deepEqual([shown.length, page.title], [0, 'Andary']);
  });

  test('nothing pops up with notifications off, or for someone only watching a team town', async () => {
    const off = town();
    page.hidden = true;
    watch(off, { desktopNotify: false });
    off.send('SessionStart', { source: 'startup' });
    off.ask('a1');
    await settle();
    assert.deepEqual([shown.length, page.title], [0, '(1) Andary']);
    const watcher = town({ viewOnly: true });
    watch(watcher);
    watcher.send('SessionStart', { source: 'startup' });
    watcher.ask('a1');
    await settle();
    assert.deepEqual([shown.length, page.title], [0, 'Andary'], 'nothing needs a viewer: no count either');
  });

  test('a request is not popped up before the town knows whether it holds it; then once, in the right words', async () => {
    const t = town();
    page.hidden = true;
    watch(t);
    t.send('SessionStart', { source: 'startup' });
    t.send('SessionStart', { source: 'startup' }, other);
    t.send('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf secret-dir' } });
    await settle();
    assert.deepEqual(shown, [], 'the hook came first: its request may still be held in the town');
    t.ask('a1');
    await settle();
    t.ask('a1');
    await settle();
    assert.deepEqual(shown, [{ title: 'Permission needed', body: 'api-server needs your permission.' }]);
  });

  test('screen readers hear of an agent that seems stuck, in the town\'s words: its storm is in the town only', async () => {
    const t = town();
    watch(t, { desktopNotify: false });
    for (const id of ['t1', 't2', 't3']) {
      t.send('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: id, error: 'Exit code 1', is_interrupt: false });
    }
    await settle();
    assert.deepEqual(heard, ['api-server: Seems stuck: npm test failed 3 times, nothing changed'], 'without the backticks that mark the command on screen');
    t.send('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: 't4', error: 'Exit code 1', is_interrupt: false });
    await settle();
    assert.equal(heard.length, 1, 'once per episode, though its words count on');
  });

  test('screen readers hear of a new question or stop; the HUD redraws when the clock alone changes the list', async () => {
    const t = town();
    watch(t, { desktopNotify: false }, 5);
    t.send('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which port?' }] }, tool_use_id: 'q1' });
    t.store.ingest(envelope({ ...hook('Stop', {}, other), andary_source: 'codex' }, t.now()));
    await settle();
    assert.deepEqual(heard, ['api-server: Asks: Which port?']);
    const before = refreshes;
    t.advance(60_000);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(refreshes > before, 'the Codex turn started to count with no event');
    assert.equal(page.title, '(2) Andary');
  });

  test("screen readers hear of a write over another agent's change; a note's words redraw the HUD as time goes", async () => {
    const t = town();
    watch(t, { desktopNotify: false }, 5);
    const file = '/home/dev/code/api-server/src/auth.ts';
    t.send('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: file, old_string: 'a', new_string: 'b' }, tool_response: {}, tool_use_id: 'e1' });
    t.send('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: file, old_string: 'b', new_string: 'c' }, tool_response: {}, tool_use_id: 'e2' }, other);
    await settle();
    assert.deepEqual(heard, [], 'a note is no news');
    const before = refreshes;
    t.advance(60_000);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(refreshes > before, '"just now" became "1 min ago" with no event');
    t.send('PostToolUse', { tool_name: 'Write', tool_input: { file_path: file, content: 'x' }, tool_response: {}, tool_use_id: 'w1' }, other);
    await settle();
    assert.deepEqual(heard, ['api-server: Foreman (crew 2) wrote over src/auth.ts, which Foreman (crew 1) changed 1 min ago']);
  });
});
