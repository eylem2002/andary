// Starts a real Andary server for tests (CONTRACTS §8): the actual CLI on a free port, with a
// throw-away ANDARY_HOME and Claude config folder, so nothing touches the user's own files.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHookScript } from '../../server/hook-runner.mjs';
import { loginUrl, probeServer, readStateFile, serverOrigin } from '../../server/state-file.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'cli', 'andary.mjs');
const START_TIMEOUT_MS = 15_000;

/**
 * @typedef {object} Town
 * @property {string} baseUrl     e.g. http://127.0.0.1:41234
 * @property {string} loginUrl    baseUrl + /?token=…
 * @property {number} port
 * @property {string} home        the temporary ANDARY_HOME
 * @property {string} secret      hook secret
 * @property {string} uiToken     browser token
 * @property {string} responseKey signs the server's answers to the forwarder
 * @property {number} pid
 * @property {() => string} output  everything the server printed so far
 * @property {(pattern: RegExp, timeoutMs?: number) => Promise<string>} waitForOutput
 *   resolves with the output once it matches `pattern`
 * @property {(payload: unknown, options?: { input?: string, timeoutMs?: number, args?: string[] }) => Promise<{ code: number|null, stdout: string, stderr: string }>} sendHook
 *   runs the real hooks/hook.mjs with the payload on stdin (args ['codex']: as Codex runs it)
 * @property {() => Promise<void>} stop  stops the server and deletes the temporary folders
 */

/**
 * @param {{ remoteApprovals?: boolean, args?: string[], env?: Record<string, string> }} [options]
 * @returns {Promise<Town>}
 */
export async function startTown({ remoteApprovals = false, args = [], env = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'andary-test-'));
  const home = join(root, 'home');
  const claudeDir = join(root, 'claude');
  mkdirSync(claudeDir, { recursive: true });
  /** @type {NodeJS.ProcessEnv} */
  const childEnv = { ...process.env, ANDARY_HOME: home, CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: join(root, 'codex'), ...env };
  delete childEnv.ANDARY_PORT;
  const cliArgs = [CLI, 'start', '--port', '0', '--no-open', ...(remoteApprovals ? ['--remote-approvals'] : []), ...args];
  const child = spawn(process.execPath, cliArgs, { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    output += chunk;
  });
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit));

  const cleanup = () => rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  /** @type {(pattern: RegExp, timeoutMs?: number) => Promise<string>} */
  const waitForOutput = async (pattern, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    while (!pattern.test(output)) {
      if (Date.now() > deadline) throw new Error(`Server output did not match ${pattern}:\n${output}`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    return output;
  };
  let state;
  try {
    state = await waitForServer(home, child.pid, exited);
    // The server answers a moment before the CLI prints its banner.
    await waitForOutput(/\?token=/, START_TIMEOUT_MS);
  } catch (error) {
    child.kill('SIGKILL');
    cleanup();
    throw new Error(`${error.message}\n--- server output ---\n${output}`, { cause: error });
  }

  let stopped = false;
  return {
    baseUrl: serverOrigin(state),
    loginUrl: loginUrl(state),
    port: state.port,
    home,
    secret: state.secret,
    uiToken: state.uiToken,
    responseKey: String(state.responseKey ?? ''),
    pid: state.pid,
    output: () => output,
    waitForOutput,
    sendHook: (payload, options = {}) => runHookScript({ payload, env: { ...childEnv }, ...options }),
    async stop() {
      if (stopped) return;
      stopped = true;
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        await exited;
        clearTimeout(timer);
      }
      cleanup();
    },
  };
}

/**
 * Waits until server.json names this process and the server answers.
 * @param {string} home
 * @param {number|undefined} pid
 * @param {Promise<unknown>} exited
 * @returns {Promise<import('../../server/state-file.mjs').ServerState>}
 */
async function waitForServer(home, pid, exited) {
  let gone = false;
  exited.then(() => {
    gone = true;
  });
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (gone) throw new Error('The Andary server exited during startup');
    const state = readStateFile(home);
    if (state?.pid === pid && (await probeServer(state))) return state;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error('The Andary server did not start in time');
}
