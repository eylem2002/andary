// `andary doctor`: checks every link of the chain Claude Code → hook → server → browser and
// says how to fix what is broken.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { HOOK_SOURCE, resolveHome } from '../config.mjs';
import { runHookScript } from '../hook-runner.mjs';
import { forwarderPath, inspectInstallations } from '../installer.mjs';
import { probeServer, readStateFile, serverOrigin } from '../state-file.mjs';
import { connectWebSocket, waitForMessage } from '../ws-client.mjs';
import { describeScope } from './status.mjs';
import { cliInvocation, tildify } from './io.mjs';
import { DOCTOR_SESSION_PREFIX } from '../../public/js/core/ids.js';

const SYMBOLS = { ok: '✔', warn: '!', fail: '✖' };

/**
 * @typedef {(status: 'ok'|'warn'|'fail', title: string, detail?: string) => void} Report
 */

/**
 * @param {Record<string, any>} _values
 * @param {string[]} _positionals
 * @param {import('./io.mjs').CliIo} io
 * @returns {Promise<number>} 1 if any check failed
 */
export async function runDoctor(_values, _positionals, io) {
  const home = resolveHome(io.env);
  const tally = { ok: 0, warn: 0, fail: 0 };
  /** @type {Report} */
  const report = (status, title, detail) => {
    tally[status] += 1;
    io.out(`${SYMBOLS[status]} ${title}`);
    if (detail) io.out(`    ${detail}`);
  };
  checkNodeVersion(report);
  checkNodeOnPath(report, io.env);
  const installs = checkHooks(report, home, io);
  checkForwarderCopy(report, home, installs);
  const state = await checkServer(report, home);
  if (state) await checkRoundTrip(report, home, io);
  io.out('');
  io.out(tally.fail === 0 ? `All good${tally.warn ? ` (${tally.warn} warning${tally.warn === 1 ? '' : 's'})` : ''}.` : `${tally.fail} problem${tally.fail === 1 ? '' : 's'} found.`);
  return tally.fail === 0 ? 0 : 1;
}

/** @param {Report} report */
function checkNodeVersion(report) {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) report('ok', `Node.js ${process.versions.node}`);
  else report('fail', `Node.js ${process.versions.node} is too old`, 'Andary needs Node.js 20 or newer.');
}

/**
 * Hooks run `node` through Claude Code's shell, so it must be on that PATH, not just this one.
 * @param {Report} report
 * @param {NodeJS.ProcessEnv} env
 */
function checkNodeOnPath(report, env) {
  const result = spawnSync('node --version', { shell: true, encoding: 'utf8', env, timeout: 10_000, windowsHide: true });
  const version = result.status === 0 ? result.stdout.trim() : '';
  if (!version) {
    report('fail', '`node` is not on the PATH', 'Hooks run `node`; install Node.js so that `node --version` works in a new terminal.');
    return;
  }
  const major = Number(version.replace(/^v/, '').split('.')[0]);
  if (major < 18) report('warn', `\`node\` on the PATH is ${version}`, 'The hook forwarder needs Node.js 18 or newer.');
  else report('ok', `\`node\` on the PATH is ${version}`);
}

/**
 * @param {Report} report
 * @param {string} home
 * @param {import('./io.mjs').CliIo} io
 * @returns {ReturnType<typeof inspectInstallations>}
 */
function checkHooks(report, home, io) {
  const installs = inspectInstallations({ dir: io.cwd, env: io.env, home });
  const inSettings = installs.scopes.filter((scope) => scope.events.length > 0);
  for (const scope of installs.scopes.filter((s) => s.error)) report('warn', describeScope(scope), scope.error ?? undefined);
  if (!installs.installed) {
    report('fail', 'No hooks are installed', `Run: ${cliInvocation()} install (Claude Code) or ${cliInvocation()} install codex`);
    return installs;
  }
  for (const scope of inSettings) report(scope.complete ? 'ok' : 'warn', `Hooks: ${describeScope(scope)}`);
  if (installs.plugin) report('ok', 'Hooks: the Andary plugin is enabled');
  if (installs.plugin && inSettings.length > 0) {
    report('warn', 'Hooks are registered by both the plugin and settings', `Every event would arrive twice. Remove one: ${cliInvocation()} uninstall`);
  }
  // Claude Code and Codex side by side are fine; one agent registered twice is not.
  for (const id of new Set(inSettings.map((scope) => scope.client.id))) {
    const files = inSettings.filter((scope) => scope.client.id === id);
    if (files.length > 1) report('warn', `${files[0].client.name} hooks are registered in more than one file`, 'Sessions in this folder will send every event more than once.');
  }
  return installs;
}

/**
 * @param {Report} report
 * @param {string} home
 * @param {ReturnType<typeof inspectInstallations>} installs
 */
function checkForwarderCopy(report, home, installs) {
  if (!installs.scopes.some((scope) => scope.events.length > 0)) return;
  const target = forwarderPath(home);
  if (!existsSync(target)) {
    report('fail', `The hook forwarder is missing (${tildify(target)})`, `Run: ${cliInvocation()} install`);
  } else if (readFileSync(target, 'utf8') !== readFileSync(HOOK_SOURCE, 'utf8')) {
    report('warn', 'The installed hook forwarder is from another version', `Run: ${cliInvocation()} install (or start the server, which refreshes it)`);
  } else {
    report('ok', `Hook forwarder: ${tildify(target)}`);
  }
}

/**
 * @param {Report} report
 * @param {string} home
 * @returns {Promise<import('../state-file.mjs').ServerState|null>}
 */
async function checkServer(report, home) {
  const state = readStateFile(home);
  if (!state) {
    report('fail', 'The Andary server is not running', `Start it with: ${cliInvocation()} start`);
    return null;
  }
  if (!(await probeServer(state))) {
    report('fail', `Nothing answers on ${serverOrigin(state)} (left over from a server that is gone)`, `Start it with: ${cliInvocation()} start`);
    return null;
  }
  report('ok', `Server running on ${serverOrigin(state)} (pid ${state.pid})`);
  return state;
}

/**
 * Sends a synthetic event through the installed forwarder (or the bundled one when only the
 * plugin is used) and watches for it on a WebSocket, exactly as a browser would.
 * @param {Report} report
 * @param {string} home
 * @param {import('./io.mjs').CliIo} io
 */
async function checkRoundTrip(report, home, io) {
  const state = readStateFile(home);
  const script = existsSync(forwarderPath(home)) ? forwarderPath(home) : HOOK_SOURCE;
  // The browser ignores this prefix (DOCTOR_SESSION_PREFIX in public/js/core/events.js), so the
  // probe proves delivery without leaving a crew in the town.
  const sessionId = `${DOCTOR_SESSION_PREFIX}${randomUUID()}`;
  const env = { ...io.env, ANDARY_HOME: home };
  const base = { session_id: sessionId, cwd: io.cwd, transcript_path: '', permission_mode: 'default' };
  let socket = null;
  try {
    socket = await connectWebSocket(`${serverOrigin(state).replace(/^http/, 'ws')}/ws`, {
      headers: { Cookie: `andary_ui=${state.uiToken}` },
    });
    await waitForMessage(socket, (m) => m?.t === 'hello', 5000);
    const payload = { ...base, hook_event_name: 'Notification', notification_type: 'andary_doctor', message: 'Andary doctor: the hook pipeline works' };
    const run = await runHookScript({ script, payload, env });
    if (run.code !== 0 || run.stdout !== '' || run.stderr !== '') {
      report('fail', 'The hook forwarder misbehaved', `exit code ${run.code}, ${run.stdout.length + run.stderr.length} bytes of unexpected output`);
      return;
    }
    await waitForMessage(socket, (m) => m?.t === 'hook' && m.e?.event?.session_id === sessionId, 5000);
    report('ok', 'A test event went through the hook forwarder and reached the town');
    // Let the doctor's visitor leave the town again.
    await runHookScript({ script, payload: { ...base, hook_event_name: 'SessionEnd', reason: 'other' }, env });
  } catch (error) {
    report('fail', 'A test event did not reach the town', error.message);
  } finally {
    socket?.close();
  }
}
