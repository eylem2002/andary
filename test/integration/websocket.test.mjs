import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeBrowser, connectBrowser, hookPayload, postHook, startTown, waitForMessage } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof startTown>>} */
let town;

before(async () => {
  town = await startTown();
});

after(async () => {
  await town?.stop();
});

/** @param {Promise<unknown>} attempt */
async function refusalStatus(attempt) {
  try {
    const connection = /** @type {any} */ (await attempt);
    connection.close();
    return 101;
  } catch (error) {
    return error.status;
  }
}

describe('WebSocket access control', () => {
  it('needs the sign-in subprotocol; a cookie is not enough', async () => {
    assert.equal(await refusalStatus(connectBrowser(town, { protocols: null })), 401);
    assert.equal(await refusalStatus(connectBrowser(town, { protocols: 'andary, andary.token.guess' })), 401);
    assert.equal(await refusalStatus(connectBrowser(town, { protocols: 'andary', cookie: `andary_ui=${town.uiToken}` })), 401);
  });

  it('confirms the andary subprotocol, and never echoes the token', async () => {
    const connection = await connectBrowser(town);
    assert.equal(connection.protocol, 'andary');
    connection.close();
  });

  it('needs our own Origin (or none)', async () => {
    assert.equal(await refusalStatus(connectBrowser(town, { origin: 'http://evil.example' })), 403);
    assert.equal(await refusalStatus(connectBrowser(town, { origin: 'null' })), 403);
    assert.equal(await refusalStatus(connectBrowser(town, { origin: `http://localhost:${town.port}` })), 101);
    assert.equal(await refusalStatus(connectBrowser(town, { origin: null })), 101);
  });
});

describe('WebSocket protocol', () => {
  it('replays history and pending approvals in hello, then streams sanitized envelopes', async () => {
    const secretKey = `sk-ant-${'Q'.repeat(30)}`;
    await postHook(town, hookPayload('SessionStart', { source: 'startup', model: 'claude-opus-5-5' }));
    await postHook(town, hookPayload('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf dist' } }));
    const browser = await connectBrowser(town);
    const hello = await waitForMessage(browser, (m) => m?.t === 'hello');
    assert.equal(hello.version.length > 0, true);
    assert.ok(Math.abs(hello.serverTime - Date.now()) < 5000);
    // PR and CI status is off in tests (--no-gh); whether gh is there depends on the computer.
    const { gh, ...settings } = hello.settings;
    assert.deepEqual(settings, { remoteApprovals: false, approvalTimeoutMs: 120000, notify: false, notifyLimits: false });
    assert.deepEqual([gh.on, gh.hint], [false, null]);
    const names = hello.history.map((/** @type {any} */ e) => e.event.hook_event_name);
    assert.deepEqual(names.slice(0, 2), ['SessionStart', 'PermissionRequest']);
    for (const envelope of hello.history) {
      assert.equal(typeof envelope.id, 'number');
      assert.equal(typeof envelope.ts, 'number');
      assert.equal(typeof envelope.rx, 'number');
    }
    assert.equal(hello.approvals[0].status, 'pending');
    assert.equal(hello.approvals[0].held, false);

    await postHook(town, hookPayload('PreToolUse', { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: `curl -H "x-api-key: ${secretKey}" ${'a'.repeat(3000)}` } }));
    const live = await waitForMessage(browser, (m) => m?.t === 'hook' && m.e.event.hook_event_name === 'PreToolUse');
    assert.ok(live.e.id > hello.history.at(-1).id);
    const command = live.e.event.tool_input.command;
    assert.ok(!command.includes(secretKey), 'secrets are redacted before broadcast');
    assert.ok(command.includes('[redacted]'));
    assert.match(command, /…\[\+\d+ chars\]$/);
    await closeBrowser(browser);
  });

  it('broadcasts settings changes to every browser', async () => {
    const first = await connectBrowser(town);
    const second = await connectBrowser(town);
    await waitForMessage(second, (m) => m?.t === 'hello');
    first.send(JSON.stringify({ t: 'settings', settings: { remoteApprovals: true } }));
    const update = await waitForMessage(second, (m) => m?.t === 'settings');
    const { gh: _gh, ...updated } = update.settings;
    assert.deepEqual(updated, { remoteApprovals: true, approvalTimeoutMs: 120000, notify: false, notifyLimits: false });
    first.send(JSON.stringify({ t: 'settings', settings: { remoteApprovals: false } }));
    await waitForMessage(second, (m) => m?.t === 'settings' && m.settings.remoteApprovals === false);
    await Promise.all([closeBrowser(first), closeBrowser(second)]);
  });

  it('answers bad messages with an error and keeps the connection', async () => {
    const browser = await connectBrowser(town);
    await waitForMessage(browser, (m) => m?.t === 'hello');
    browser.send('not json');
    browser.send(JSON.stringify({ t: 'launch-rockets' }));
    browser.send(JSON.stringify({ t: 'settings', settings: { remoteApprovals: 'yes' } }));
    browser.send(JSON.stringify({ t: 'decide', id: 'no-such-id', decision: 'allow' }));
    browser.send(JSON.stringify({ t: 'ping' }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const errors = browser.messages.filter((m) => m?.t === 'error').map((m) => m.message);
    assert.deepEqual(errors, ['Messages must be JSON', 'Unknown message type', 'settings.remoteApprovals and settings.gh must be true or false', 'Unknown approval']);
    assert.ok(browser.isOpen);
    await closeBrowser(browser);
  });

  it('says in hello when you were last away: never, in a town just started', async () => {
    const browser = await connectBrowser(town);
    const hello = await waitForMessage(browser, (m) => m?.t === 'hello');
    assert.equal(hello.away, null);
    await closeBrowser(browser);
  });

  it('answers { t: "digest", since } with what each crew did, to the browser that asked only', async () => {
    const crew = (/** @type {string} */ name, /** @type {Record<string, unknown>} */ extra = {}) => hookPayload(name, { session_id: 'catch-up-crew', cwd: '/work/api-server', ...extra });
    const edit = { file_path: '/work/api-server/src/app.ts', old_string: 'a', new_string: 'b' };
    for (const event of [
      crew('UserPromptSubmit', { prompt: 'Ship the fix' }),
      crew('PreToolUse', { tool_name: 'Edit', tool_use_id: 'e1', tool_input: edit }),
      crew('PostToolUse', { tool_name: 'Edit', tool_use_id: 'e1', tool_input: edit, tool_response: {} }),
      crew('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok' } }),
      crew('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b2', tool_input: { command: 'git commit -am "Fix" && git push' }, tool_response: {} }),
      crew('Stop', { last_assistant_message: 'Fixed and pushed.' }),
    ]) assert.equal((await postHook(town, event)).status, 200);
    const asker = await connectBrowser(town);
    const other = await connectBrowser(town);
    await waitForMessage(other, (m) => m?.t === 'hello');
    await waitForMessage(asker, (m) => m?.t === 'hello');
    asker.send(JSON.stringify({ t: 'digest', since: 0 }));
    const { d: digest } = await waitForMessage(asker, (m) => m?.t === 'digest');
    assert.ok(digest.since <= digest.until && Math.abs(digest.until - Date.now()) < 5000, 'times on the server\'s clock');
    const ours = digest.crews.find((/** @type {any} */ c) => c.sessionId === 'catch-up-crew');
    assert.deepEqual(
      { cwd: ours.cwd, turns: ours.turns, lastMessage: ours.lastMessage, tests: ours.tests, commits: ours.commits, pushes: ours.pushes, allPushed: ours.allPushed, files: ours.files, toolCalls: ours.toolCalls },
      { cwd: '/work/api-server', turns: 1, lastMessage: 'Fixed and pushed.', tests: 'passed', commits: 1, pushes: 1, allPushed: true, files: 1, toolCalls: 1 },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(!other.messages.some((m) => m?.t === 'digest'), 'the other browser asked nothing');
    await Promise.all([closeBrowser(asker), closeBrowser(other)]);
  });

  it('refuses a digest request without a time in milliseconds, and keeps the connection', async () => {
    const browser = await connectBrowser(town);
    await waitForMessage(browser, (m) => m?.t === 'hello');
    for (const since of ['yesterday', -1, null, true, '1700000000000']) browser.send(JSON.stringify({ t: 'digest', since }));
    browser.send(JSON.stringify({ t: 'digest' }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const errors = browser.messages.filter((m) => m?.t === 'error').map((m) => m.message);
    assert.deepEqual(errors, Array(6).fill('digest.since must be a time in milliseconds'));
    assert.ok(!browser.messages.some((m) => m?.t === 'digest'));
    assert.ok(browser.isOpen);
    await closeBrowser(browser);
  });

  it('closes a browser that floods it with messages (1008)', async () => {
    const browser = await connectBrowser(town);
    await waitForMessage(browser, (m) => m?.t === 'hello');
    const closed = new Promise((resolve) => browser.once('close', resolve));
    for (let i = 0; i < 200; i += 1) browser.send(JSON.stringify({ t: 'ping' }));
    const event = /** @type {any} */ (await closed);
    assert.equal(event.code, 1008);
  });

  it('accepts at most 16 browsers', async () => {
    const browsers = [];
    for (let i = 0; i < 16; i += 1) browsers.push(await connectBrowser(town));
    assert.equal(await refusalStatus(connectBrowser(town)), 503);
    await Promise.all(browsers.map((browser) => closeBrowser(browser)));
  });
});
