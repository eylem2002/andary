import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { decisionOutput } from '../../server/approvals.mjs';
import { closeBrowser, connectBrowser, startTown, waitForMessage } from './helpers.mjs';

const CLI = fileURLToPath(new URL('../../bin/andary.mjs', import.meta.url));

/** A Codex hook payload (Codex uses Claude Code's field names). @param {string} event @param {Record<string, any>} [extra] */
const codex = (event, extra = {}) => ({
  session_id: 'thr_42',
  transcript_path: '/home/dev/.codex/sessions/2026/11/20/rollout-42.jsonl',
  cwd: '/home/dev/code/app',
  hook_event_name: event,
  model: 'gpt-5.3-codex',
  permission_mode: 'default',
  ...extra,
});

describe('Codex', () => {
  /** @type {Awaited<ReturnType<typeof startTown>>} */
  let town;
  before(async () => {
    town = await startTown({ remoteApprovals: true, args: ['--approval-timeout', '20'] });
  });
  after(async () => {
    await town?.stop();
  });

  it('a Codex session reaches the town through the same forwarder, translated', async () => {
    const browser = await connectBrowser(town);
    await waitForMessage(browser, (m) => m?.t === 'hello');
    await town.sendHook(codex('SessionStart', { source: 'startup' }), { args: ['codex'] });
    const patch = '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** Add File: src/b.ts\n+fresh\n*** End Patch';
    await town.sendHook(codex('PostToolUse', { turn_id: 't1', tool_name: 'apply_patch', tool_use_id: 'call_1', tool_input: { command: patch }, tool_response: { output: 'Success' } }), { args: ['codex'] });
    const edit = await waitForMessage(browser, (m) => m?.t === 'hook' && m.e.event.tool_name === 'Edit');
    const write = await waitForMessage(browser, (m) => m?.t === 'hook' && m.e.event.tool_name === 'Write');
    assert.equal(edit.e.event.andary_source, 'codex');
    assert.equal(edit.e.event.tool_input.file_path, join('/home/dev/code/app', 'src/a.ts'));
    assert.equal(write.e.event.tool_use_id, 'call_1#2');
    const start = await waitForMessage(browser, (m) => m?.t === 'hook' && m.e.event.hook_event_name === 'SessionStart');
    assert.equal(start.e.event.andary_source, 'codex');
    await closeBrowser(browser);
  });

  it('a Codex permission request can be answered from the town, in the decision format Codex reads', async () => {
    const browser = await connectBrowser(town);
    await waitForMessage(browser, (m) => m?.t === 'hello');
    const hook = town.sendHook(codex('PermissionRequest', { session_id: 'thr_ask', turn_id: 't2', tool_name: 'Bash', tool_input: { command: 'git push' } }), { args: ['codex'] });
    const pending = await waitForMessage(browser, (m) => m?.t === 'approval' && m.a.sessionId === 'thr_ask' && m.a.status === 'pending', 10_000);
    assert.deepEqual(pending.a.toolInput, { command: 'git push' }, 'shown exactly as Codex asked');
    browser.send(JSON.stringify({ t: 'decide', id: pending.a.id, decision: 'deny' }));
    const result = await hook;
    const printed = JSON.parse(result.stdout);
    assert.deepEqual(printed.hookSpecificOutput.hookEventName, 'PermissionRequest');
    assert.equal(printed.hookSpecificOutput.decision.behavior, 'deny');
    assert.deepEqual(Object.keys(printed.hookSpecificOutput.decision).sort(), ['behavior', 'message']);
    assert.equal(JSON.stringify(decisionOutput('allow')), '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}');
    await closeBrowser(browser);
  });

  it('andary install codex writes ~/.codex/hooks.json, and status lists it', () => {
    const root = mkdtempSync(join(tmpdir(), 'andary-codex-cli-'));
    try {
      const env = { ...process.env, ANDARY_HOME: join(root, 'home'), CLAUDE_CONFIG_DIR: join(root, 'claude'), CODEX_HOME: join(root, 'codex') };
      const install = spawnSync(process.execPath, [CLI, 'install', 'codex'], { env, encoding: 'utf8', cwd: root });
      assert.equal(install.status, 0, install.stderr);
      assert.match(install.stdout, /Andary hooks installed in .*hooks\.json \(Codex, user scope\)/);
      assert.match(install.stdout, /trust them/);
      const hooks = JSON.parse(readFileSync(join(root, 'codex', 'hooks.json'), 'utf8')).hooks;
      assert.match(hooks.Stop[0].hooks[0].command, /hook\.mjs" codex # andary$/);
      assert.ok(existsSync(join(root, 'home', 'hook.mjs')), 'the forwarder is copied');
      const status = spawnSync(process.execPath, [CLI, 'status'], { env, encoding: 'utf8', cwd: root });
      assert.match(status.stdout, /Codex, user scope: installed/);
      assert.match(status.stdout, /Claude Code, user scope: not installed/);
      const bad = spawnSync(process.execPath, [CLI, 'install', 'codex', '--scope', 'local'], { env, encoding: 'utf8', cwd: root });
      assert.equal(bad.status, 2);
      const removed = spawnSync(process.execPath, [CLI, 'uninstall', 'codex'], { env, encoding: 'utf8', cwd: root });
      assert.match(removed.stdout, /Removed \d+ Andary hook entries/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
