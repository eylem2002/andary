// `andary start`, `demo` and `stop`.
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { startTownServer } from '../app.mjs';
import { CLI_PATH, DEFAULT_HOST, readVersion, resolveHome } from '../config.mjs';
import { applyHooksChange, inspectInstallations, planHooksChange, refreshForwarder, settingsPathFor } from '../installer.mjs';
import { openBrowser } from '../open-browser.mjs';
import { hostWithPort, isLoopbackHost, isWildcardHost } from '../security.mjs';
import { lanAddresses } from '../team.mjs';
import { savedTopicUrl } from '../notify.mjs';
import { ensureHome, findRunningServer, loginUrl, probeServer, readStateFile, removeStateFileIfOwned } from '../state-file.mjs';
import { cliInvocation, sleep, tildify } from './io.mjs';
import { UsageError, parseApprovalTimeout, parseNotifyUrl, parsePort, parseShareTo, parseTeamHosts, parseTls } from './options.mjs';

/** Options shared by start and demo (parseArgs format). */
export const START_OPTIONS = Object.freeze({
  port: { type: 'string', short: 'p' },
  host: { type: 'string' },
  'no-open': { type: 'boolean' },
  'remote-approvals': { type: 'boolean' },
  notify: { type: 'boolean' },
  'notify-url': { type: 'string' },
  team: { type: 'boolean' },
  'team-host': { type: 'string', multiple: true },
  'share-to': { type: 'string' },
  'team-key': { type: 'string' },
  'approval-timeout': { type: 'string' },
  'tls-cert': { type: 'string' },
  'tls-key': { type: 'string' },
  record: { type: 'boolean' },
  detach: { type: 'boolean' },
});

/**
 * @typedef {object} StartSettings
 * @property {number} port
 * @property {string} host
 * @property {boolean} open
 * @property {boolean} remoteApprovals
 * @property {boolean} notify          --notify: a private ntfy.sh topic kept in ANDARY_HOME
 * @property {string|null} notifyUrl   --notify-url or ANDARY_NOTIFY_URL
 * @property {boolean} team            --team: host a team town
 * @property {string[]} teamHosts      --team-host: other names teammates reach it by
 * @property {{ url: string, key: string, member: string }|null} shareTo  --share-to and --team-key
 * @property {number|undefined} approvalTimeoutMs
 * @property {ReturnType<typeof parseTls>} tls  --tls-cert and --tls-key: HTTPS for other computers
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
  const team = Boolean(values.team);
  const shareTo = parseShareTo(values['share-to'] ?? io.env.ANDARY_SHARE_TO, values['team-key'] ?? io.env.ANDARY_TEAM_KEY);
  if (team && shareTo) throw new UsageError('A town either hosts the team (--team) or shares with one (--share-to), not both.');
  if (values['team-host'] && !team) throw new UsageError('--team-host only matters with --team.');
  return {
    port: parsePort(values.port, io.env),
    // Teammates must be able to reach a team host, so --team listens on the network unless --host says where.
    host: values.host ?? (team ? '0.0.0.0' : DEFAULT_HOST),
    team,
    teamHosts: parseTeamHosts(values['team-host']),
    shareTo,
    open: !values['no-open'],
    remoteApprovals: Boolean(values['remote-approvals']),
    notify: Boolean(values.notify),
    notifyUrl: parseNotifyUrl(values['notify-url'] ?? io.env.ANDARY_NOTIFY_URL),
    approvalTimeoutMs: parseApprovalTimeout(values['approval-timeout'], (warning) => io.err(`Warning: ${warning}`)),
    tls: parseTls(values['tls-cert'] ?? io.env.ANDARY_TLS_CERT, values['tls-key'] ?? io.env.ANDARY_TLS_KEY),
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
const SERVER_SHAPING = new Set(['port', 'host', 'remote-approvals', 'notify', 'notify-url', 'team', 'team-host', 'share-to', 'team-key', 'approval-timeout', 'tls-cert', 'tls-key', 'record']);

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
  warnIfExposed(settings, io);
  refreshForwarder(home);
  let server;
  try {
    server = await startTownServer({
      port: settings.port,
      host: settings.host,
      home,
      remoteApprovals: settings.remoteApprovals,
      notifyUrl: settings.notifyUrl ?? (settings.notify ? savedTopicUrl(home) : null),
      team: settings.team,
      teamHosts: settings.teamHosts,
      shareTo: settings.shareTo,
      approvalTimeoutMs: settings.approvalTimeoutMs,
      tls: settings.tls ? { cert: settings.tls.cert, key: settings.tls.key } : null,
      record: settings.record,
      awayMs: testAwayMs(io.env),
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
 * For tests only (CONTRACTS §8), not a setting: ANDARY_AWAY_MS shortens how long without you counts
 * as away (server/digest.mjs), so a test can start an absence in a second. Anything but a whole
 * number of milliseconds from 100 on is ignored.
 * @param {NodeJS.ProcessEnv} env
 * @returns {number|undefined}
 */
function testAwayMs(env) {
  const ms = Number(env.ANDARY_AWAY_MS);
  return Number.isInteger(ms) && ms >= 100 ? ms : undefined;
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
 * @param {StartSettings} settings
 * @param {import('./io.mjs').CliIo} io
 */
function warnIfExposed({ host, team, tls }, io) {
  if (isLoopbackHost(host)) {
    if (team) io.err(`Warning: teammates cannot reach ${host}. Leave out --host (or use your network address) so they can.`);
    if (tls) io.err('Note: --tls-cert only matters when other computers connect (--team or --host): this computer uses plain HTTP on 127.0.0.1.');
    return;
  }
  io.err('');
  io.err(`  WARNING: ${team ? 'the team town listens on your network' : `--host ${host} makes Andary reachable from other machines`}.`);
  io.err('  Hook events contain your prompts, commands and file paths, and with remote approvals');
  io.err('  anyone who gets the sign-in link can approve tool calls. Use this only on a network you trust.');
  if (tls) {
    io.err('  Other computers must use https:// (your certificate); plain HTTP is answered on this computer only.');
  } else {
    io.err('  Traffic is plain HTTP. Add --tls-cert and --tls-key to encrypt it (for example with');
    io.err('  "tailscale cert"), or connect through a private network such as Tailscale.');
  }
  io.err('');
}

/**
 * With a certificate and a network address, the sign-in link for another computer: https at the
 * name on the certificate (the first --team-host), else the bound or network address.
 * @param {import('../state-file.mjs').ServerState} state
 * @param {StartSettings} settings
 * @returns {string|null}
 */
function remoteLink(state, settings) {
  if (!settings.tls || isLoopbackHost(settings.host)) return null;
  const name = settings.teamHosts[0] ?? (isWildcardHost(settings.host) ? lanAddresses()[0] : settings.host);
  if (!name) return null;
  const query = new URLSearchParams({ token: state.uiToken, ...(settings.demo ? { demo: '1' } : {}) });
  return `https://${hostWithPort(name, state.port)}/?${query}`;
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
  const remote = remoteLink(server.state, settings);
  if (remote) io.out(`  From another computer: ${remote}`);
  io.out('');
  io.out(`  Remote approvals: ${settings.remoteApprovals ? 'on' : 'off (switch them on in the town, or start with --remote-approvals)'}`);
  const { notifyUrl } = server;
  io.out(notifyUrl ? `  Phone notifications: on. In the free ntfy app, subscribe to ${notifyUrl}` : '  Phone notifications: off (start with --notify to get them in the free ntfy app)');
  if (server.viewUrl) {
    io.out(`  Team town: on. Invite a teammate with: ${cliInvocation()} team invite <name>`);
    io.out(`  Teammates watch (view only) at ${server.viewUrl}`);
  }
  if (settings.shareTo) {
    io.out(`  Sharing your sessions with the team town at ${settings.shareTo.url} as ${settings.shareTo.member}.`);
    const how = settings.shareTo.url.startsWith('https:') ? 'over HTTPS' : 'over plain HTTP';
    io.out(`  Everyone with the team's view link sees their prompts, commands and file paths, sent ${how}.`);
  }
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
  io.out('No agent is reporting to the town yet: its hooks are not installed.');
  io.out(`For Claude Code:  ${cliInvocation()} install`);
  io.out(`For Codex:        ${cliInvocation()} install codex`);
  if (!io.interactive) return;
  const answer = await io.ask(`Install the Claude Code hooks now in your user settings (${tildify(settingsPathFor('user', { env: io.env }))})? [y/N] `);
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
      env: childEnv(settings, io.env),
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
 * The background server's environment. The team key and the ntfy topic go this way, not as
 * arguments, which other users of the computer could read in ps.
 * @param {StartSettings} settings
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
function childEnv(settings, env) {
  const out = { ...env };
  if (settings.shareTo) Object.assign(out, { ANDARY_SHARE_TO: settings.shareTo.url, ANDARY_TEAM_KEY: settings.shareTo.key });
  if (settings.notifyUrl) out.ANDARY_NOTIFY_URL = settings.notifyUrl;
  return out;
}

/**
 * @param {StartSettings} settings
 * @returns {string[]}
 */
function forwardedFlags(settings) {
  const flags = ['--port', String(settings.port), '--host', settings.host];
  if (settings.remoteApprovals) flags.push('--remote-approvals');
  if (settings.notify) flags.push('--notify');
  if (settings.team) flags.push('--team');
  for (const name of settings.teamHosts) flags.push('--team-host', name);
  if (settings.approvalTimeoutMs !== undefined) flags.push('--approval-timeout', String(settings.approvalTimeoutMs / 1000));
  // Paths only: the background server reads the files itself.
  if (settings.tls) flags.push('--tls-cert', settings.tls.certPath, '--tls-key', settings.tls.keyPath);
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
 * `andary stop`: asks the running server to shut down (SIGTERM) and waits for it. Windows has no
 * SIGTERM: the server is ended at once and cannot remove its server.json, so stop does.
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
      removeStateFileIfOwned(home, { pid: state.pid, secret: state.secret });
      io.out('Andary stopped.');
      return 0;
    }
    await sleep(100);
  }
  io.err(`Andary (pid ${state.pid}) is still running.`);
  return 1;
}
