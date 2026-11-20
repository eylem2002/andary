import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, before, describe, it } from 'node:test';
import { decisionOutput } from '../../server/approvals.mjs';
import { closeBrowser, connectBrowser, startTown, waitForMessage } from './helpers.mjs';

const CLI = fileURLToPath(new URL('../../cli/andary.mjs', import.meta.url));
const run = promisify(execFile);

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

  it('a patch approved in the terminal settles when it runs, though the town calls it an Edit', async () => {
    const browser = await connectBrowser(town);
    await waitForMessage(browser, (m) => m?.t === 'hello');
    // Too long to show in full, so it is not held: Codex asks in its terminal.
    const patch = `*** Begin Patch\n*** Update File: src/big.ts\n@@\n-${'a'.repeat(2500)}\n+b\n*** End Patch`;
    const ask = await town.sendHook(codex('PermissionRequest', { session_id: 'thr_term', tool_name: 'apply_patch', tool_input: { command: patch } }), { args: ['codex'] });
    assert.equal(ask.stdout, '', 'left to the terminal');
    await waitForMessage(browser, (m) => m?.t === 'approval' && m.a.sessionId === 'thr_term' && m.a.status === 'pending');
    await town.sendHook(codex('PostToolUse', { session_id: 'thr_term', tool_name: 'apply_patch', tool_use_id: 'call_t', tool_input: { command: patch }, tool_response: { output: 'Success' } }), { args: ['codex'] });
    const settled = await waitForMessage(browser, (m) => m?.t === 'approval' && m.a.sessionId === 'thr_term' && m.a.status !== 'pending');
    assert.deepEqual([settled.a.status, settled.a.decidedBy], ['resolved', 'terminal']);
    await closeBrowser(browser);
  });

  it('a replayed Codex recording keeps its Codex mark', async () => {
    const root = mkdtempSync(join(tmpdir(), 'andary-codex-replay-'));
    try {
      const recording = join(root, 'codex.jsonl');
      const event = { ...codex('SessionStart', { session_id: 'thr_replay', source: 'startup' }), andary_source: 'codex' };
      writeFileSync(recording, `${JSON.stringify({ id: 1, ts: Date.now(), rx: Date.now(), event })}\n`);
      const browser = await connectBrowser(town);
      await waitForMessage(browser, (m) => m?.t === 'hello');
      await run(process.execPath, [CLI, 'replay', recording], { env: { ...process.env, ANDARY_HOME: town.home } });
      const replayed = await waitForMessage(browser, (m) => m?.t === 'hook' && m.e.event.session_id === 'thr_replay');
      assert.equal(replayed.e.event.andary_source, 'codex');
      await closeBrowser(browser);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('doctor: Codex next to the Claude Code plugin is no double registration, and its fixes name codex', () => {
    const root = mkdtempSync(join(tmpdir(), 'andary-codex-doctor-'));
    try {
      const env = { ...process.env, ANDARY_HOME: join(root, 'home'), CLAUDE_CONFIG_DIR: join(root, 'claude'), CODEX_HOME: join(root, 'codex') };
      mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
      writeFileSync(join(env.CLAUDE_CONFIG_DIR, 'settings.json'), JSON.stringify({ enabledPlugins: { 'andary@andary': true } }));
      assert.equal(spawnSync(process.execPath, [CLI, 'install', 'codex'], { env, encoding: 'utf8', cwd: root }).status, 0);
      rmSync(join(root, 'home', 'hook.mjs'));
      const doctor = spawnSync(process.execPath, [CLI, 'doctor'], { env, encoding: 'utf8', cwd: root });
      assert.doesNotMatch(doctor.stdout, /both the plugin and settings/);
      assert.match(doctor.stdout, /The hook forwarder is missing[\s\S]*install codex/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
