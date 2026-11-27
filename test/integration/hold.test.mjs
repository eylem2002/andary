// "Always hold risky commands for me" end to end: the switch from a browser, the file beside
// server.json, the forwarder run as `hook.mjs hold`, and POST /api/hold (server/hold.mjs).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { HOLD_FILE } from '../../server/hold.mjs';
import { closeBrowser, connectBrowser, hookPayload, rawRequest, startTown, waitForMessage } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof startTown>>} */
let town;
/** @type {Awaited<ReturnType<typeof connectBrowser>>} */
let browser;

before(async () => {
  town = await startTown();
  browser = await connectBrowser(town);
  await waitForMessage(browser, (m) => m?.t === 'hello');
});

after(async () => {
  if (browser) await closeBrowser(browser);
  await town?.stop();
});

/** @param {string} command @param {Record<string, unknown>} [extra] */
function bash(command, extra = {}) {
  return hookPayload('PreToolUse', { session_id: 'hold-1', tool_name: 'Bash', tool_input: { command }, tool_use_id: `t-${command.length}`, cwd: '/work/app', ...extra });
}

/**
 * POST /api/hold as the forwarder does.
 * @param {unknown} event @param {{ source?: string, secret?: string|null }} [options]
 */
function postHold(event, { source, secret = town.secret } = {}) {
  const body = JSON.stringify({ v: 1, ts: Date.now(), ...(source ? { source } : {}), caps: ['truncated'], event });
  /** @type {Record<string, string|number>} */
  const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) };
  if (secret) headers['x-andary-secret'] = secret;
  return rawRequest(town.port, { method: 'POST', path: '/api/hold', headers, body });
}

/** @param {boolean} on */
async function setHold(on) {
  browser.send(JSON.stringify({ t: 'settings', settings: { holdRisky: on } }));
  await waitForMessage(browser, (m) => m?.t === 'settings' && m.settings.holdRisky === on);
}

describe('holding risky commands', () => {
  it('is off by default: the hold check exits at once and prints nothing', async () => {
    assert.equal(existsSync(join(town.home, HOLD_FILE)), false);
    const result = await town.sendHook(bash('rm -rf build'), { args: ['hold'] });
    assert.deepEqual(result, { code: 0, stdout: '', stderr: '' });
  });

  it('once on, makes Claude Code ask before a risky command, with why', async () => {
    await setHold(true);
    assert.ok(existsSync(join(town.home, HOLD_FILE)), 'kept beside server.json, so it outlasts a restart');
    const result = await town.sendHook(bash('git push --force origin main'), { args: ['hold'] });
    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(output.hookSpecificOutput), ['hookEventName', 'permissionDecision', 'permissionDecisionReason']);
    assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(output.hookSpecificOutput.permissionDecision, 'ask');
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /^Andary holds risky commands for you: rewrites remote history/);
  });

  it('lets an ordinary command, a Codex call and other hooks through untouched', async () => {
    assert.equal((await town.sendHook(bash('npm test'), { args: ['hold'] })).stdout, '');
    assert.equal((await town.sendHook(hookPayload('PreToolUse', { session_id: 'hold-1', tool_name: 'Read', tool_input: { file_path: '.env' } }), { args: ['hold'] })).stdout, '');
    // The ordinary forwarder never prints a hold, whatever the event.
    assert.equal((await town.sendHook(bash('rm -rf build'))).stdout, '');
    // Codex's PreToolUse hook cannot ask: it is never held.
    const codex = await postHold(bash('rm -rf build'), { source: 'codex' });
    assert.equal(codex.status, 200);
    assert.deepEqual(JSON.parse(codex.text), { output: null });
    assert.match(JSON.parse((await postHold(bash('rm -rf build'))).text).output.hookSpecificOutput.permissionDecisionReason, /deletes recursively/);
  });

  it('forwards nothing to the town: the ordinary PreToolUse hook reports the call', async () => {
    const before = browser.messages.filter((m) => m?.t === 'hook').length;
    await town.sendHook(bash('rm -rf dist', { session_id: 'hold-quiet' }), { args: ['hold'] });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(browser.messages.filter((m) => m?.t === 'hook').length, before);
  });

  it('needs the hook secret', async () => {
    assert.equal((await postHold(bash('rm -rf /'), { secret: null })).status, 401);
    assert.equal((await postHold(bash('rm -rf /'), { secret: 'wrong' })).status, 401);
  });

  it('turned off again, removes its file and holds nothing', async () => {
    await setHold(false);
    assert.equal(existsSync(join(town.home, HOLD_FILE)), false);
    assert.equal((await town.sendHook(bash('git reset --hard'), { args: ['hold'] })).stdout, '');
  });
});
