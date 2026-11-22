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
import { TUNNEL_TIMEOUT_MS, blockingConfig, findCloudflared, installHelp, parseAllowedMail, startQuickTunnel, supportsAllowedMail } from '../tunnel.mjs';
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
  'notify-limits': { type: 'boolean' },
  team: { type: 'boolean' },
  'team-host': { type: 'string', multiple: true },
  'share-to': { type: 'string' },
  'team-key': { type: 'string' },
  'approval-timeout': { type: 'string' },
  'tls-cert': { type: 'string' },
  'tls-key': { type: 'string' },
  tunnel: { type: 'boolean' },
  'tunnel-allowed-mail': { type: 'string', multiple: true },
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
 * @property {boolean} notifyLimits    --notify-limits: a phone note when a plan limit reaches 90%
 * @property {boolean} team            --team: host a team town
 * @property {string[]} teamHosts      --team-host: other names teammates reach it by
 * @property {{ url: string, key: string, member: string }|null} shareTo  --share-to and --team-key
 * @property {number|undefined} approvalTimeoutMs
 * @property {ReturnType<typeof parseTls>} tls  --tls-cert and --tls-key: HTTPS for other computers
 * @property {boolean} tunnel          --tunnel: a public HTTPS address through a Cloudflare Quick Tunnel
 * @property {string[]|null} tunnelAllowedMail  --tunnel-allowed-mail: only these people may open it
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
  const { tunnel, tunnelAllowedMail } = tunnelSettings(values, team);
  const notifyUrl = parseNotifyUrl(values['notify-url'] ?? io.env.ANDARY_NOTIFY_URL);
  if (values['notify-limits'] && !values.notify && !notifyUrl) throw new UsageError('--notify-limits sends phone notes: add --notify (or --notify-url).');
  return {
    port: parsePort(values.port, io.env),
    // Teammates must be able to reach a team host, so --team listens on the network unless --host
    // says where; with --tunnel they come through the tunnel, so it stays on this computer.
    host: values.host ?? (team && !tunnel ? '0.0.0.0' : DEFAULT_HOST),
    team,
    teamHosts: parseTeamHosts(values['team-host']),
    shareTo,
    open: !values['no-open'],
    remoteApprovals: Boolean(values['remote-approvals']),
    notify: Boolean(values.notify),
    notifyUrl,
    notifyLimits: Boolean(values['notify-limits']),
    approvalTimeoutMs: parseApprovalTimeout(values['approval-timeout'], (warning) => io.err(`Warning: ${warning}`)),
    tls: parseTls(values['tls-cert'] ?? io.env.ANDARY_TLS_CERT, values['tls-key'] ?? io.env.ANDARY_TLS_KEY),
    tunnel,
    tunnelAllowedMail,
    record: Boolean(values.record),
    detach: Boolean(values.detach),
    demo,
  };
}

/**
 * --tunnel (with --team only) and --tunnel-allowed-mail (with --tunnel only).
 * @param {Record<string, any>} values
 * @param {boolean} team
 * @returns {{ tunnel: boolean, tunnelAllowedMail: string[]|null }}
 */
function tunnelSettings(values, team) {
  const tunnel = Boolean(values.tunnel);
  if (tunnel && !team) throw new UsageError('--tunnel puts a team town on the internet: use it with --team.');
  if (values['tunnel-allowed-mail'] && !tunnel) throw new UsageError('--tunnel-allowed-mail only matters with --tunnel.');
  try {
    return { tunnel, tunnelAllowedMail: parseAllowedMail(values['tunnel-allowed-mail']) };
  } catch (error) {
    throw new UsageError(/** @type {Error} */ (error).message);
  }
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
  const cloudflared = settings.tunnel ? tunnelPreflight(settings, io) : null;
  if (settings.tunnel && !cloudflared) return 1;
  if (settings.detach) return startDetached(settings, home, io);
  return runForeground(settings, home, io, cloudflared);
}

/**
 * Before anything starts: cloudflared is on the PATH, no configuration file stops Quick Tunnels,
 * and it can restrict by email if asked to. Says what to do and returns null when not.
 * @param {StartSettings} settings
 * @param {import('./io.mjs').CliIo} io
 * @returns {string|null} cloudflared's path
 */
function tunnelPreflight(settings, io) {
  const bin = findCloudflared(io.env);
  if (!bin) {
    for (const line of installHelp()) io.err(line);
    return null;
  }
  const config = blockingConfig();
  if (config) {
    io.err(`Quick Tunnels do not start while ${tildify(config)} exists (Cloudflare's rule). Rename it for now, or leave out --tunnel.`);
    return null;
  }
  if (settings.tunnelAllowedMail && !supportsAllowedMail(bin)) {
    io.err('This cloudflared cannot restrict a Quick Tunnel to email addresses: --tunnel-allowed-mail needs cloudflared 2026.9.3 or newer. Update it, or leave out --tunnel-allowed-mail.');
    return null;
  }
  return bin;
}

/**
 * For tests only (CONTRACTS §8), not a setting: ANDARY_TUNNEL_TIMEOUT_MS shortens how long
 * cloudflared may take to print its address. Anything but a whole number from 100 on is ignored.
 * @param {NodeJS.ProcessEnv} env
 * @returns {number}
 */
function tunnelTimeoutMs(env) {
  const ms = Number(env.ANDARY_TUNNEL_TIMEOUT_MS);
  return Number.isInteger(ms) && ms >= 100 ? ms : TUNNEL_TIMEOUT_MS;
}

/**
 * Starts the Quick Tunnel to the server's tunnel port and points the server at its name.
 * @param {import('../app.mjs').TownServer} server
 * @param {StartSettings} settings
 * @param {string} bin
 * @param {import('./io.mjs').CliIo} io
 * @param {(message: string) => void} log
 * @returns {Promise<{ tunnel: import('../tunnel.mjs').QuickTunnel, viewUrl: string|null }|null>}
 */
async function openTunnel(server, settings, bin, io, log) {
  io.out('Opening a Cloudflare Quick Tunnel (this takes a few seconds)…');
  let tunnel;
  try {
    tunnel = await startQuickTunnel({ bin, port: /** @type {number} */ (server.tunnelPort), allowedMail: settings.tunnelAllowedMail, timeoutMs: tunnelTimeoutMs(io.env), env: io.env });
  } catch (error) {
    io.err(`The tunnel did not open: ${/** @type {Error} */ (error).message}`);
    return null;
  }
  const viewUrl = server.setTunnel({ url: tunnel.url, pid: tunnel.pid });
  let stopping = false;
  const stop = tunnel.stop;
  tunnel.stop = () => {
    stopping = true;
    return stop();
  };
  tunnel.onExit((code, signal) => {
    if (stopping) return;
    const reason = `cloudflared stopped (exit code ${code ?? signal})`;
    server.setTunnel({ url: null, error: reason });
    log(`The internet address stopped working: ${reason}. Restart Andary for a new one (the address changes).`);
  });
  return { tunnel, viewUrl };
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
const SERVER_SHAPING = new Set(['port', 'host', 'remote-approvals', 'notify', 'notify-url', 'notify-limits', 'team', 'team-host', 'share-to', 'team-key', 'approval-timeout', 'tls-cert', 'tls-key', 'tunnel', 'tunnel-allowed-mail', 'record']);

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
async function runForeground(settings, home, io, cloudflared = null) {
  warnIfExposed(settings, io);
  refreshForwarder(home);
  const log = (/** @type {string} */ message) => io.out(`[${new Date().toLocaleTimeString()}] ${message}`);
  let server;
  try {
    server = await startTownServer({
      port: settings.port,
      host: settings.host,
      home,
      remoteApprovals: settings.remoteApprovals,
      notifyUrl: settings.notifyUrl ?? (settings.notify ? savedTopicUrl(home) : null),
      notifyLimits: settings.notifyLimits,
      team: settings.team,
      teamHosts: settings.teamHosts,
      shareTo: settings.shareTo,
      approvalTimeoutMs: settings.approvalTimeoutMs,
      tls: settings.tls ? { cert: settings.tls.cert, key: settings.tls.key } : null,
      tunnel: settings.tunnel,
      record: settings.record,
      awayMs: testAwayMs(io.env),
      log,
    });
  } catch (error) {
    io.err(describeListenError(error, settings));
    return 1;
  }
  const opened = cloudflared ? await openTunnel(server, settings, cloudflared, io, log) : null;
  if (cloudflared && !opened) {
    await server.stop();
    return 1;
  }
  printBanner(server, settings, io, opened?.viewUrl ?? null);
  if (settings.open) openBrowser(linkFor(server.state, settings));
  // Listen for Ctrl+C before asking anything, so it also stops the server during the prompt.
  const shutdown = waitForShutdownSignal();
  await Promise.race([offerHookInstall(home, io), shutdown]);
  await shutdown;
  io.out('Stopping Andary…');
  // The internet first: nothing new comes in through the tunnel while the town shuts down.
  await opened?.tunnel.stop();
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
function warnIfExposed({ host, team, tls, tunnel }, io) {
  if (tunnel) warnTunnel(io);
  if (isLoopbackHost(host)) {
    if (team && !tunnel) io.err(`Warning: teammates cannot reach ${host}. Leave out --host (or use your network address) so they can.`);
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
 * @param {import('./io.mjs').CliIo} io
 */
function warnTunnel(io) {
  io.err('');
  io.err('  WARNING: --tunnel puts the team town on the internet, at a public https:// address.');
  io.err('  Anyone who has a teammate\'s invite key or the view link can reach it from anywhere: the');
  io.err('  links are what protect it, so send them privately. The view link shows every crew\'s');
  io.err('  prompts, commands, file paths and edits, yours included. Your own sign-in works on this');
  io.err(`  computer only, never through the tunnel. Revoke every key and link: ${cliInvocation()} team reset`);
  io.err('  Cloudflare\'s Quick Tunnels are for testing: no uptime guarantee, and the address');
  io.err('  changes every time Andary starts (send the new invite).');
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
 * @param {string|null} [tunnelView]  the view link at the tunnel's address
 */
function printBanner(server, settings, io, tunnelView = null) {
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
  if (notifyUrl && settings.notifyLimits) io.out('  Also when a Claude plan limit reaches 90% (with the andary-limits mod).');
  if (server.viewUrl) {
    io.out(`  Team town: on. Invite a teammate with: ${cliInvocation()} team invite <name>`);
    io.out(`  Teammates watch (view only) at ${tunnelView ?? server.viewUrl}`);
  }
  if (tunnelView) {
    io.out(`  On the internet at ${new URL(tunnelView).origin} (a Cloudflare Quick Tunnel; it changes when Andary restarts).`);
    if (settings.tunnelAllowedMail) {
      io.out(`  Only ${settings.tunnelAllowedMail.join(', ')} can open it, after an email code in their browser. A teammate's`);
      io.out('  Andary cannot pass that sign-in: with --tunnel-allowed-mail teammates can watch, not share.');
    }
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
  // With --tunnel the server is ready once cloudflared printed its address (or gave up).
  const ready = settings.tunnel ? (/** @type {import('../state-file.mjs').ServerState} */ s) => Boolean(s.tunnel) : () => true;
  const state = await waitForServer(home, child, settings.tunnel ? 15_000 + tunnelTimeoutMs(io.env) : 15_000, ready);
  if (!state) {
    io.err(`Andary did not start. Its log is in ${tildify(logPath)}.`);
    return 1;
  }
  io.out(`Andary is running in the background (pid ${state.pid}). Open it with this link:`);
  io.out(`  ${linkFor(state, settings)}`);
  if (state.tunnel?.url) io.out(`On the internet at ${state.tunnel.url}: invite teammates with ${cliInvocation()} team invite <name>`);
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
  if (settings.notifyLimits) flags.push('--notify-limits');
  if (settings.team) flags.push('--team');
  for (const name of settings.teamHosts) flags.push('--team-host', name);
  if (settings.approvalTimeoutMs !== undefined) flags.push('--approval-timeout', String(settings.approvalTimeoutMs / 1000));
  // Paths only: the background server reads the files itself.
  if (settings.tls) flags.push('--tls-cert', settings.tls.certPath, '--tls-key', settings.tls.keyPath);
  if (settings.tunnel) flags.push('--tunnel');
  for (const address of settings.tunnelAllowedMail ?? []) flags.push('--tunnel-allowed-mail', address);
  if (settings.record) flags.push('--record');
  return flags;
}

/**
 * Polls server.json until the child's server answers, the child exits, or time runs out.
 * @param {string} home
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} timeoutMs
 * @param {(state: import('../state-file.mjs').ServerState) => boolean} [ready]  more to wait for
 * @returns {Promise<import('../state-file.mjs').ServerState|null>}
 */
async function waitForServer(home, child, timeoutMs, ready = () => true) {
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !exited) {
    const state = readStateFile(home);
    if (state?.pid === child.pid && ready(state) && (await probeServer(state))) return state;
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
