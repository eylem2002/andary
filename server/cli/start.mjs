// `andary start`, `demo` and `stop`.
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { startTownServer } from '../app.mjs';
import { CLI_PATH, DEFAULT_HOST, readVersion, resolveHome } from '../config.mjs';
import { applyHooksChange, inspectInstallations, planHooksChange, refreshForwarder, settingsPathFor } from '../installer.mjs';
import { openBrowser } from '../open-browser.mjs';
import { isLoopbackHost } from '../security.mjs';
import { ensureHome, findRunningServer, loginUrl, probeServer, readStateFile } from '../state-file.mjs';
import { cliInvocation, sleep, tildify } from './io.mjs';
import { parseApprovalTimeout, parsePort } from './options.mjs';

/** Options shared by start and demo (parseArgs format). */
export const START_OPTIONS = Object.freeze({
  port: { type: 'string', short: 'p' },
  host: { type: 'string' },
  'no-open': { type: 'boolean' },
  'remote-approvals': { type: 'boolean' },
  'approval-timeout': { type: 'string' },
  record: { type: 'boolean' },
  detach: { type: 'boolean' },
});

/**
 * @typedef {object} StartSettings
 * @property {number} port
 * @property {string} host
 * @property {boolean} open
 * @property {boolean} remoteApprovals
 * @property {number|undefined} approvalTimeoutMs
 * @property {boolean} record
 * @property {boolean} detach
 * @property {boolean} demo
 */

/**
 * @param {Record<string, any>} values parsed flags
 * @param {import('./io.mjs').CliIo} io
 * @param {boolean} demo
 * @returns {StartSettings}
 */
function startSettings(values, io, demo) {
  return {
    port: parsePort(values.port, io.env),
    host: values.host ?? DEFAULT_HOST,
    open: !values['no-open'],
    remoteApprovals: Boolean(values['remote-approvals']),
    approvalTimeoutMs: parseApprovalTimeout(values['approval-timeout'], (warning) => io.err(`Warning: ${warning}`)),
    record: Boolean(values.record),
    detach: Boolean(values.detach),
    demo,
  };
}

/**
 * @param {Record<string, any>} values
 * @param {string[]} _positionals
 * @param {import('./io.mjs').CliIo} io
 * @param {{ demo?: boolean }} [mode]
 * @returns {Promise<number>} exit code
 */
export async function runStart(values, _positionals, io, { demo = false } = {}) {
  const settings = startSettings(values, io, demo);
  const home = resolveHome(io.env);
  const running = await findRunningServer(home);
  if (running) return reportRunning(running, settings, io, Object.keys(values).some((name) => SERVER_SHAPING.has(name)));
  if (settings.detach) return startDetached(settings, home, io);
  return runForeground(settings, home, io);
}

/**
 * @param {import('../state-file.mjs').ServerState} state
 * @param {StartSettings} settings
 * @returns {string}
 */
function linkFor(state, settings) {
  return loginUrl(state, settings.demo ? { demo: '1' } : {});
}

/** Flags that only matter when a new server starts. */
const SERVER_SHAPING = new Set(['port', 'host', 'remote-approvals', 'approval-timeout', 'record']);

/**
 * @param {import('../state-file.mjs').ServerState} state
 * @param {StartSettings} settings
 * @param {import('./io.mjs').CliIo} io
 * @param {boolean} ignoredFlags whether server options were passed that a running server cannot take
 * @returns {number}
 */
function reportRunning(state, settings, io, ignoredFlags) {
  io.out(`Andary is already running (pid ${state.pid}). Open it with this link:`);
  io.out(`  ${linkFor(state, settings)}`);
  if (ignoredFlags) io.out(`The server options you passed apply to a new server only: run "${cliInvocation()} stop" first to change them.`);
  if (settings.open) openBrowser(linkFor(state, settings));
  return 0;
}

/**
 * Runs the server in this process until Ctrl+C / SIGTERM.
 * @param {StartSettings} settings
 * @param {string} home
 * @param {import('./io.mjs').CliIo} io
 * @returns {Promise<number>}
 */
async function runForeground(settings, home, io) {
  warnIfExposed(settings.host, io);
  refreshForwarder(home);
  let server;
  try {
    server = await startTownServer({
      port: settings.port,
      host: settings.host,
      home,
      remoteApprovals: settings.remoteApprovals,
      approvalTimeoutMs: settings.approvalTimeoutMs,
      record: settings.record,
      log: (message) => io.out(`[${new Date().toLocaleTimeString()}] ${message}`),
    });
  } catch (error) {
    io.err(describeListenError(error, settings));
    return 1;
  }
  printBanner(server, settings, io);
  if (settings.open) openBrowser(linkFor(server.state, settings));
  // Listen for Ctrl+C before asking anything, so it also stops the server during the prompt.
  const shutdown = waitForShutdownSignal();
  await Promise.race([offerHookInstall(home, io), shutdown]);
  await shutdown;
  io.out('Stopping Andary…');
  await server.stop();
  return 0;
}

/**
 * @param {any} error
 * @param {StartSettings} settings
 * @returns {string}
 */
function describeListenError(error, settings) {
  if (error?.code === 'EADDRINUSE') {
    return `Port ${settings.port} is already in use by another program. Pick another one with --port <number>, or --port 0 for any free port.`;
  }
  if (error?.code === 'EADDRNOTAVAIL' || error?.code === 'ENOTFOUND') {
    return `Cannot listen on ${settings.host}: this machine has no such address.`;
  }
  if (error?.code === 'EACCES') return `Not allowed to listen on port ${settings.port}. Try a port above 1024.`;
  return `Andary could not start: ${error?.message ?? error}`;
}

/**
 * @param {string} host
 * @param {import('./io.mjs').CliIo} io
 */
function warnIfExposed(host, io) {
  if (isLoopbackHost(host)) return;
  io.err('');
  io.err(`  WARNING: --host ${host} makes Andary reachable from other machines.`);
  io.err('  Hook events contain your prompts, commands and file paths, and with remote approvals');
  io.err('  anyone who gets the sign-in link can approve tool calls. Use this only on a network you trust.');
  io.err('');
}

/**
 * @param {import('../app.mjs').TownServer} server
 * @param {StartSettings} settings
 * @param {import('./io.mjs').CliIo} io
 */
function printBanner(server, settings, io) {
  io.out(`Andary ${readVersion()} is running on ${server.origin}`);
  io.out('');
  io.out('  Open this link to sign in (it contains your private token, so do not share it):');
  io.out(`  ${linkFor(server.state, settings)}`);
  io.out('');
  io.out(`  Remote approvals: ${settings.remoteApprovals ? 'on' : 'off (switch them on in the town, or start with --remote-approvals)'}`);
  if (server.recordingPath) {
    io.out(`  Recording to ${tildify(server.recordingPath)} (it will contain your prompts and commands)`);
  }
  io.out('  Press Ctrl+C to stop.');
}

/**
 * Prints how to install the hooks when nothing reports to the town; asks to do it when a person
 * is at the terminal.
 * @param {string} home
 * @param {import('./io.mjs').CliIo} io
 */
async function offerHookInstall(home, io) {
  if (inspectInstallations({ dir: io.cwd, env: io.env, home }).installed) return;
  io.out('');
  io.out('Claude Code is not reporting to the town yet: its hooks are not installed.');
  io.out(`Install them with:  ${cliInvocation()} install`);
  if (!io.interactive) return;
  const answer = await io.ask(`Install them now in your user settings (${tildify(settingsPathFor('user', { env: io.env }))})? [y/N] `);
  if (!/^y(?:es)?$/i.test(answer.trim())) return;
  try {
    const plan = planHooksChange({ action: 'install', scope: 'user', home, env: io.env, dir: io.cwd });
    const { backupPath } = applyHooksChange(plan);
    io.out(`Installed in ${tildify(plan.settingsPath)}${backupPath ? ` (backup: ${tildify(backupPath)})` : ''}.`);
    io.out('New Claude Code sessions will show up in the town.');
  } catch (error) {
    io.err(error.message);
  }
}

/**
 * Resolves on the first SIGINT, SIGTERM or SIGHUP; a second Ctrl+C exits at once.
 * @returns {Promise<string>}
 */
function waitForShutdownSignal() {
  const signals = /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP']);
  return new Promise((resolve) => {
    const onSignal = (/** @type {string} */ signal) => {
      for (const name of signals) process.off(name, onSignal);
      process.once('SIGINT', () => process.exit(130));
      resolve(signal);
    };
    for (const name of signals) process.on(name, onSignal);
  });
}

/**
 * Starts the server as a detached background process (used by the /town plugin command) and
 * returns once it answers.
 * @param {StartSettings} settings
 * @param {string} home
 * @param {import('./io.mjs').CliIo} io
 * @returns {Promise<number>}
 */
async function startDetached(settings, home, io) {
  ensureHome(home);
  const logPath = join(home, 'server.log');
  const logFd = openSync(logPath, 'w', 0o600);
  let child;
  try {
    child = spawn(process.execPath, [CLI_PATH, 'start', '--no-open', ...forwardedFlags(settings)], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: io.env,
      cwd: io.cwd,
      windowsHide: true,
    });
  } finally {
    closeSync(logFd);
  }
  child.unref();
  const state = await waitForServer(home, child, 15_000);
  if (!state) {
    io.err(`Andary did not start. Its log is in ${tildify(logPath)}.`);
    return 1;
  }
  io.out(`Andary is running in the background (pid ${state.pid}). Open it with this link:`);
  io.out(`  ${linkFor(state, settings)}`);
  io.out(`Stop it with: ${cliInvocation()} stop`);
  if (settings.open) openBrowser(linkFor(state, settings));
  await offerHookInstall(home, io);
  return 0;
}

/**
 * @param {StartSettings} settings
 * @returns {string[]}
 */
function forwardedFlags(settings) {
  const flags = ['--port', String(settings.port), '--host', settings.host];
  if (settings.remoteApprovals) flags.push('--remote-approvals');
  if (settings.approvalTimeoutMs !== undefined) flags.push('--approval-timeout', String(settings.approvalTimeoutMs / 1000));
  if (settings.record) flags.push('--record');
  return flags;
}

/**
 * Polls server.json until the child's server answers, the child exits, or time runs out.
 * @param {string} home
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} timeoutMs
 * @returns {Promise<import('../state-file.mjs').ServerState|null>}
 */
async function waitForServer(home, child, timeoutMs) {
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !exited) {
    const state = readStateFile(home);
    if (state?.pid === child.pid && (await probeServer(state))) return state;
    await sleep(100);
  }
  return null;
}

/**
 * `andary stop`: asks the running server to shut down (SIGTERM) and waits for it.
 * @param {Record<string, any>} _values
 * @param {string[]} _positionals
 * @param {import('./io.mjs').CliIo} io
 * @returns {Promise<number>}
 */
export async function runStop(_values, _positionals, io) {
  const home = resolveHome(io.env);
  const state = await findRunningServer(home);
  if (!state) {
    io.out('Andary is not running.');
    return 0;
  }
  try {
    process.kill(state.pid, 'SIGTERM');
  } catch (error) {
    io.err(`Could not stop Andary (pid ${state.pid}): ${error.code ?? error.message}`);
    return 1;
  }
  for (let waited = 0; waited < 5000; waited += 100) {
    if (!(await probeServer(state, 500))) {
      io.out('Andary stopped.');
      return 0;
    }
    await sleep(100);
  }
  io.err(`Andary (pid ${state.pid}) is still running.`);
  return 1;
}
