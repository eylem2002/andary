import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { HOOK_SOURCE } from '../../server/config.mjs';
import { runHookScript } from '../../server/hook-runner.mjs';
import { connectBrowser, hookPayload, startTown, waitForMessage } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof startTown>>} */
let town;
/** @type {Awaited<ReturnType<typeof connectBrowser>>} */
let browser;
/** @type {string} */
let scratch;

before(async () => {
  town = await startTown();
  browser = await connectBrowser(town);
  await waitForMessage(browser, (m) => m?.t === 'hello');
  scratch = mkdtempSync(join(tmpdir(), 'tt-forwarder-'));
});

after(async () => {
  browser?.close();
  await town?.stop();
  rmSync(scratch, { recursive: true, force: true });
});

/** Env for running the forwarder without the test's own ANDARY_HOME or real home folder. */
function isolatedEnv(/** @type {Record<string, string>} */ extra = {}) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, HOME: join(scratch, 'nobody'), USERPROFILE: join(scratch, 'nobody'), ...extra };
  if (!('ANDARY_HOME' in extra)) delete env.ANDARY_HOME;
  return env;
}

/** @returns {Promise<number>} a port nothing listens on */
async function closedPort() {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  await new Promise((resolve) => server.close(resolve));
  return port;
}

describe('forwarder delivery', () => {
  it('posts the event with its start time and prints nothing', async () => {
    const started = Date.now();
    const result = await town.sendHook(hookPayload('UserPromptSubmit', { session_id: 'deliver-1', prompt: 'Add a login page' }));
    assert.deepEqual(result, { code: 0, stdout: '', stderr: '' });
    const message = await waitForMessage(browser, (m) => m?.t === 'hook' && m.e.event.session_id === 'deliver-1');
    assert.equal(message.e.event.prompt, 'Add a login page');
    assert.ok(message.e.ts >= started && message.e.ts <= message.e.rx);
  });

  it('forwards stdin that is not JSON as an Unknown event with a raw preview', async () => {
    const result = await town.sendHook(undefined, { input: `garbage-start ${'z'.repeat(5000)}` });
    assert.deepEqual(result, { code: 0, stdout: '', stderr: '' });
    const message = await waitForMessage(browser, (m) => m?.t === 'hook' && m.e.event.hook_event_name === 'Unknown');
    assert.match(message.e.event.raw, /^garbage-start z+…\[\+\d+ chars\]$/);
  });

  it('shrinks payloads over the server limit instead of losing them', async () => {
    const payload = hookPayload('PostToolUse', {
      session_id: 'big-1',
      tool_name: 'Write',
      tool_input: { file_path: 'src/huge.json', content: 'x'.repeat(3 * 1024 * 1024) },
    });
    const result = await town.sendHook(payload);
    assert.equal(result.code, 0);
    const message = await waitForMessage(browser, (m) => m?.t === 'hook' && m.e.event.session_id === 'big-1');
    assert.equal(message.e.event.tool_input.file_path, 'src/huge.json');
    assert.ok(message.e.event.tool_input.content.length < 2100);
  });

  it('finds the server from its own folder when installed there', async () => {
    copyFileSync(HOOK_SOURCE, join(town.home, 'hook.mjs'));
    const result = await runHookScript({
      script: join(town.home, 'hook.mjs'),
      payload: hookPayload('Notification', { session_id: 'installed-copy', message: 'hi' }),
      env: isolatedEnv(),
    });
    assert.deepEqual(result, { code: 0, stdout: '', stderr: '' });
    await waitForMessage(browser, (m) => m?.t === 'hook' && m.e.event.session_id === 'installed-copy');
  });

  it('finds the server in ~/.andary when run from the plugin folder', { skip: process.platform === 'win32' }, async () => {
    const fakeHome = join(scratch, 'plugin-user');
    mkdirSync(fakeHome, { recursive: true });
    symlinkSync(town.home, join(fakeHome, '.andary'));
    const result = await runHookScript({
      payload: hookPayload('Notification', { session_id: 'plugin-copy', message: 'hi' }),
      env: { ...isolatedEnv(), HOME: fakeHome },
    });
    assert.deepEqual(result, { code: 0, stdout: '', stderr: '' });
    await waitForMessage(browser, (m) => m?.t === 'hook' && m.e.event.session_id === 'plugin-copy');
  });
});

describe('forwarder failure modes (always exit 0, print nothing)', () => {
  it('exits at once when there is no server.json', async () => {
    const started = Date.now();
    const result = await runHookScript({ payload: hookPayload('Stop'), env: isolatedEnv({ ANDARY_HOME: join(scratch, 'empty') }) });
    assert.deepEqual(result, { code: 0, stdout: '', stderr: '' });
    assert.ok(Date.now() - started < 2000);
  });

  it('exits quietly when server.json is unreadable', async () => {
    const home = join(scratch, 'garbled');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'server.json'), '{"port": "soon"');
    const result = await runHookScript({ payload: hookPayload('Stop'), env: isolatedEnv({ ANDARY_HOME: home }) });
    assert.deepEqual(result, { code: 0, stdout: '', stderr: '' });
  });

  it('exits quietly and quickly when the server is gone', async () => {
    const home = join(scratch, 'stale');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'server.json'), JSON.stringify({ pid: 1, port: await closedPort(), host: '127.0.0.1', secret: 's', uiToken: 'u', approvalTimeoutMs: 120000 }));
    for (const name of ['PreToolUse', 'PermissionRequest']) {
      const started = Date.now();
      const result = await runHookScript({ payload: hookPayload(name), env: isolatedEnv({ ANDARY_HOME: home }) });
      assert.deepEqual(result, { code: 0, stdout: '', stderr: '' }, name);
      assert.ok(Date.now() - started < 3000, name);
    }
  });

  it('exits quietly when the secret is wrong', async () => {
    const home = join(scratch, 'wrong-secret');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'server.json'), JSON.stringify({ pid: 1, port: town.port, host: '127.0.0.1', secret: 'not-it', uiToken: 'u' }));
    const result = await runHookScript({ payload: hookPayload('PermissionRequest', { tool_name: 'Bash' }), env: isolatedEnv({ ANDARY_HOME: home }) });
    assert.deepEqual(result, { code: 0, stdout: '', stderr: '' });
  });

  it('gives up after its timeout when the server never answers', async () => {
    const silent = createServer((socket) => socket.on('data', () => {})).listen(0, '127.0.0.1');
    await new Promise((resolve) => silent.once('listening', resolve));
    try {
      const home = join(scratch, 'silent');
      mkdirSync(home, { recursive: true });
      const { port } = /** @type {import('node:net').AddressInfo} */ (silent.address());
      writeFileSync(join(home, 'server.json'), JSON.stringify({ pid: 1, port, host: '127.0.0.1', secret: 's', uiToken: 'u' }));
      const started = Date.now();
      const result = await runHookScript({ payload: hookPayload('PreToolUse'), env: isolatedEnv({ ANDARY_HOME: home }) });
      assert.deepEqual(result, { code: 0, stdout: '', stderr: '' });
      const elapsed = Date.now() - started;
      assert.ok(elapsed >= 1400 && elapsed < 4000, `took ${elapsed} ms`);
    } finally {
      silent.close();
    }
  });
});
