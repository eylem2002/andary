import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { runSimulate } from '../../server/cli/simulate.mjs';
import { ROOT_DIR, readVersion } from '../../server/config.mjs';
import { probeServer, readStateFile } from '../../server/state-file.mjs';
import { closeBrowser, connectBrowser, hookPayload, postHook, startTown, waitForMessage } from './helpers.mjs';

const CLI = join(ROOT_DIR, 'bin', 'andary.mjs');

/** @type {string} */
let scratch;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tt-cli-'));
});
after(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * Waits until the recording in `dir` holds `lines` complete lines (the server writes it through
 * a stream, so the last write may still be in flight when the HTTP response arrives).
 * @param {string} dir
 * @param {number} lines
 * @returns {Promise<string>}
 */
async function readRecording(dir, lines) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [file] = existsSync(dir) ? readdirSync(dir) : [];
    const text = file ? readFileSync(join(dir, file), 'utf8') : '';
    if (text.split('\n').length > lines) return text;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`The recording in ${dir} did not reach ${lines} lines`);
}

/** A fresh, empty ANDARY_HOME + Claude config folder + working folder. */
function sandbox(name) {
  const root = join(scratch, name);
  const env = { ANDARY_HOME: join(root, 'home'), CLAUDE_CONFIG_DIR: join(root, 'claude') };
  mkdirSync(join(root, 'work'), { recursive: true });
  return { root, cwd: join(root, 'work'), env };
}

/**
 * Runs bin/andary.mjs and collects its output.
 * @param {string[]} args
 * @param {{ env?: Record<string, string>, cwd?: string, timeoutMs?: number }} [options]
 * @returns {Promise<{ code: number|null, stdout: string, stderr: string }>}
 */
function runCli(args, { env = {}, cwd = scratch, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, ...env };
    delete childEnv.ANDARY_PORT;
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe('CLI basics', () => {
  it('prints the version and help', async () => {
    assert.equal((await runCli(['--version'])).stdout.trim(), readVersion());
    const help = await runCli(['--help']);
    assert.equal(help.code, 0);
    for (const command of ['start', 'demo', 'install', 'uninstall', 'status', 'doctor', 'replay', 'simulate']) assert.match(help.stdout, new RegExp(`\\b${command}\\b`));
    const startHelp = await runCli(['start', '--help']);
    for (const flag of ['--port', '--host', '--no-open', '--remote-approvals', '--approval-timeout', '--record']) assert.ok(startHelp.stdout.includes(flag), flag);
    const installHelp = await runCli(['install', '-h']);
    for (const flag of ['--scope', '--dir', '--dry-run', '--print']) assert.ok(installHelp.stdout.includes(flag), flag);
  });

  it('exits 2 on usage errors', async () => {
    for (const args of [['bogus'], ['start', '--port', 'abc'], ['install', '--scope', 'galaxy'], ['status', '--loud'], ['replay']]) {
      const result = await runCli(args, sandbox(`usage-${args.join('-')}`));
      assert.equal(result.code, 2, args.join(' '));
      assert.ok(result.stderr.length > 0);
    }
  });

  it('stays quiet when its reader goes away early (andary status | head -1)', async () => {
    const { env, cwd } = sandbox('closed-pipe');
    for (const [args, expected] of /** @type {const} */ ([[['--help'], 0], [['install', '--dry-run'], 0], [['status'], 1]])) {
      const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
        // Closing our end before the CLI writes turns its first write into EPIPE.
        child.stdout.destroy();
        let stderr = '';
        child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stderr }));
      });
      assert.equal(result.code, expected, args.join(' '));
      assert.doesNotMatch(result.stderr, /EPIPE|node:events/, args.join(' '));
    }
  });
});

describe('server lifecycle', () => {
  it('writes a private server.json and removes it on SIGTERM', async () => {
    const town = await startTown();
    const statePath = join(town.home, 'server.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.deepEqual(Object.keys(state).sort(), ['approvalTimeoutMs', 'host', 'pid', 'port', 'responseKey', 'secret', 'startedAt', 'uiToken', 'version']);
    assert.equal(state.host, '127.0.0.1');
    assert.match(state.secret, /^[A-Za-z0-9_-]{43}$/);
    assert.match(state.uiToken, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(state.secret, state.uiToken);
    if (process.platform !== 'win32') {
      assert.equal(statSync(statePath).mode & 0o777, 0o600);
      assert.equal(statSync(town.home).mode & 0o777, 0o700);
    }
    const output = await town.waitForOutput(/Press Ctrl\+C to stop/);
    assert.match(output, new RegExp(`http://127\\.0\\.0\\.1:${town.port}/\\?token=${town.uiToken}`));
    assert.ok(!output.includes(town.secret), 'the hook secret is never printed');
    const home = town.home;
    const stateBefore = readStateFile(home);
    await town.stop();
    assert.ok(stateBefore);
    assert.ok(!existsSync(statePath));
    assert.equal(await probeServer(/** @type {any} */ (stateBefore), 500), null);
  });

  it('reuses a running server: prints its link and exits 0', async () => {
    const town = await startTown();
    try {
      const result = await runCli(['start', '--no-open'], { env: { ANDARY_HOME: town.home } });
      assert.equal(result.code, 0);
      assert.match(result.stdout, /already running/);
      assert.ok(result.stdout.includes(town.loginUrl));
      const demo = await runCli(['demo', '--no-open'], { env: { ANDARY_HOME: town.home } });
      assert.ok(demo.stdout.includes(`${town.loginUrl}&demo=1`));
    } finally {
      await town.stop();
    }
  });

  it('reports a busy port clearly', async () => {
    const town = await startTown();
    try {
      const box = sandbox('busy-port');
      const result = await runCli(['start', '--no-open', '--port', String(town.port)], box);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /already in use/);
    } finally {
      await town.stop();
    }
  });

  it('status and stop work against a running server', async () => {
    const town = await startTown();
    const env = { ANDARY_HOME: town.home, CLAUDE_CONFIG_DIR: join(town.home, '..', 'claude') };
    const status = await runCli(['status'], { env });
    assert.equal(status.code, 0);
    assert.match(status.stdout, /running on http:\/\/127\.0\.0\.1/);
    assert.ok(status.stdout.includes(town.loginUrl));
    assert.match(status.stdout, /user scope: not installed/);
    const stop = await runCli(['stop'], { env });
    assert.equal(stop.code, 0);
    assert.match(stop.stdout, /stopped/);
    const after = await runCli(['status'], { env });
    assert.equal(after.code, 1);
    assert.match(after.stdout, /not running/);
    await town.stop();
  });

  it('starts in the background with --detach and returns', async () => {
    const box = sandbox('detach');
    const result = await runCli(['start', '--detach', '--no-open', '--port', '0'], box);
    try {
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /running in the background/);
      const state = readStateFile(box.env.ANDARY_HOME);
      assert.ok(state && (await probeServer(state)));
      assert.ok(result.stdout.includes(`/?token=${state?.uiToken}`));
    } finally {
      const stop = await runCli(['stop'], box);
      assert.equal(stop.code, 0);
    }
  });
});

describe('recording and replay', () => {
  it('writes nothing to disk by default', async () => {
    const town = await startTown();
    try {
      await postHook(town, hookPayload('UserPromptSubmit', { prompt: 'private prompt' }));
      assert.deepEqual(readdirSync(town.home), ['server.json']);
    } finally {
      await town.stop();
    }
  });

  it('--record appends sanitized envelopes, and replay sends them to a running town', async () => {
    const recorder = await startTown({ args: ['--record'] });
    const secret = `ghp_${'A1b2C3'.repeat(6)}`;
    await postHook(recorder, hookPayload('UserPromptSubmit', { session_id: 'rec-1', prompt: `deploy with ${secret}` }));
    await postHook(recorder, hookPayload('Stop', { session_id: 'rec-1' }));
    await recorder.waitForOutput(/Recording to .*town-.*\.jsonl/);
    const recorded = await readRecording(join(recorder.home, 'recordings'), 2);
    const recording = join(scratch, 'replay.jsonl');
    writeFileSync(recording, `${recorded}not json\n`);
    await recorder.stop();
    const lines = readFileSync(recording, 'utf8').trim().split('\n');
    assert.equal(JSON.parse(lines[0]).event.prompt, 'deploy with [redacted]');
    assert.ok(!readFileSync(recording, 'utf8').includes(secret));

    const town = await startTown();
    try {
      const browser = await connectBrowser(town);
      await waitForMessage(browser, (m) => m?.t === 'hello');
      const result = await runCli(['replay', recording, '--speed', '20'], { env: { ANDARY_HOME: town.home } });
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /Replayed 2 events \(skipped 1 unreadable line\)/);
      await waitForMessage(browser, (m) => m?.t === 'hook' && m.e.event.hook_event_name === 'Stop' && m.e.event.session_id === 'rec-1');
      await closeBrowser(browser);
    } finally {
      await town.stop();
    }
  });

  it('replay explains when no server is running', async () => {
    const recording = join(scratch, 'one.jsonl');
    writeFileSync(recording, `${JSON.stringify(hookPayload('Stop'))}\n`);
    const result = await runCli(['replay', recording], sandbox('replay-offline'));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /not running/);
  });
});

describe('simulate', () => {
  it('runs a simulation module against the town and passes decisions back', async () => {
    const town = await startTown({ remoteApprovals: true });
    const stub = join(scratch, 'stub-simulation.mjs');
    writeFileSync(
      stub,
      `export function createSimulation({ seed, speed, emit }) {
        return {
          running: false,
          start() {
            this.running = true;
            globalThis.__ttSim = { seed, speed };
            (async () => {
              await emit({ hook_event_name: 'SessionStart', session_id: 'sim-' + seed, cwd: '/sim', source: 'startup' });
              globalThis.__ttSim.decision = await emit({ hook_event_name: 'PermissionRequest', session_id: 'sim-' + seed, cwd: '/sim', tool_name: 'Bash', tool_input: { command: 'ls' } });
            })();
          },
          stop() { this.running = false; globalThis.__ttSim.stopped = true; },
          setSpeed() {},
        };
      }\n`,
    );
    const browser = await connectBrowser(town);
    const lines = [];
    const io = { out: (l = '') => lines.push(l), err: (l = '') => lines.push(l), env: { ...process.env, ANDARY_HOME: town.home }, cwd: scratch, interactive: false, ask: async () => '' };
    const stop = new AbortController();
    const run = runSimulate({ speed: '3', seed: '7' }, [], io, { modulePath: stub, signal: stop.signal });
    try {
      const pending = await waitForMessage(browser, (m) => m?.t === 'approval' && m.a.sessionId === 'sim-7');
      browser.send(JSON.stringify({ t: 'decide', id: pending.a.id, decision: 'deny' }));
      const sim = /** @type {any} */ (globalThis).__ttSim;
      for (let i = 0; i < 100 && !sim.decision; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(sim.decision, { decision: 'deny' });
      assert.deepEqual([sim.seed, sim.speed], [7, 3]);
    } finally {
      stop.abort();
      assert.equal(await run, 0);
      await closeBrowser(browser);
      await town.stop();
    }
    assert.equal(/** @type {any} */ (globalThis).__ttSim.stopped, true);
    assert.match(lines.join('\n'), /Simulating Claude Code sessions .* \(seed 7\)/);
  });

  it('explains a missing simulation module instead of crashing', async () => {
    const lines = [];
    const io = { out: (l = '') => lines.push(l), err: (l = '') => lines.push(l), env: process.env, cwd: scratch, interactive: false, ask: async () => '' };
    const code = await runSimulate({}, [], io, { modulePath: join(scratch, 'missing', 'simulation.js') });
    assert.equal(code, 1);
    assert.match(lines.join('\n'), /simulation is not available/);
  });
});

describe('install, uninstall and doctor', () => {
  it('--print and --dry-run write nothing', async () => {
    const box = sandbox('print');
    const printed = await runCli(['install', '--print'], box);
    assert.equal(printed.code, 0);
    assert.ok(JSON.parse(printed.stdout).hooks.PermissionRequest);
    const dry = await runCli(['install', '--dry-run'], box);
    assert.equal(dry.code, 0);
    assert.match(dry.stdout, /Nothing was written/);
    assert.ok(!existsSync(box.env.CLAUDE_CONFIG_DIR));
    assert.ok(!existsSync(box.env.ANDARY_HOME));
  });

  it('refuses to touch a malformed settings file', async () => {
    const box = sandbox('malformed');
    mkdirSync(box.env.CLAUDE_CONFIG_DIR, { recursive: true });
    writeFileSync(join(box.env.CLAUDE_CONFIG_DIR, 'settings.json'), '{ "model": "opus", }');
    const result = await runCli(['install'], box);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /not valid JSON.*nothing was changed/);
    assert.equal(readFileSync(join(box.env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8'), '{ "model": "opus", }');
  });

  it('doctor finds missing hooks, then passes once they are installed', async () => {
    const town = await startTown();
    const env = { ANDARY_HOME: town.home, CLAUDE_CONFIG_DIR: join(town.home, '..', 'doctor-claude') };
    const cwd = join(town.home, '..');
    try {
      const before = await runCli(['doctor'], { env, cwd });
      assert.equal(before.code, 1);
      assert.match(before.stdout, /hooks are not installed/);
      assert.match(before.stdout, /A test event went through the hook forwarder and reached the town/);

      const install = await runCli(['install'], { env, cwd });
      assert.equal(install.code, 0, install.stderr);
      assert.match(install.stdout, /hooks installed/);
      const after = await runCli(['doctor'], { env, cwd });
      assert.equal(after.code, 0, after.stdout);
      assert.match(after.stdout, /Hooks: user scope: installed/);
      assert.match(after.stdout, /reached the town/);

      const uninstall = await runCli(['uninstall'], { env, cwd });
      assert.equal(uninstall.code, 0);
      assert.match(uninstall.stdout, /Removed 19 Andary hook entries/);
    } finally {
      await town.stop();
    }
  });

  it('start prints the install command when no hooks are registered', async () => {
    const town = await startTown();
    try {
      await town.waitForOutput(/hooks are not installed[\s\S]*install/);
    } finally {
      await town.stop();
    }
  });
});
