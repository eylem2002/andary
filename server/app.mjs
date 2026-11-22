// The Andary server: composes the HTTP routes, the WebSocket hub, the approval broker and the
// history, and owns the lifecycle (listen, server.json, shutdown).
import { join } from 'node:path';
import { generateToken } from './auth.mjs';
import { createApprovalBroker } from './approvals.mjs';
import { createUsageTracker } from './usage.mjs';
import { createProgress } from './progress.mjs';
import { createNotifier } from './notify.mjs';
import { createWorkTrees } from './work-trees.mjs';
import { createTownDigest } from './digest.mjs';
import { createLimitsTracker } from './limits.mjs';
import { announcePeople, announceTeam, createHub, dropRemovedPeople, handleUpgrade } from './browsers.mjs';
import { createPeople } from './people.mjs';
import { createTeamHost, createTeamRelay, lanAddresses, teamSecret } from './team.mjs';
import { DEFAULT_APPROVAL_TIMEOUT_MS, DEFAULT_HOST, DEFAULT_PORT, LIMITS, PUBLIC_DIR, readVersion, resolveClaudeConfigDir, resolveHome } from './config.mjs';
import { createHistory, createRecorder, recordingPath } from './history.mjs';
import { NOT_FOUND_PAGE, sendHtml, sendText } from './http-util.mjs';
import { createListener } from './listener.mjs';
import { createTokenBucket } from './rate-limit.mjs';
import { handleRequest } from './routes.mjs';
import { allowedHostHeaders, buildCsp, computeImportMapHashes, connectHost, hostWithPort, isWildcardHost, securityHeaders } from './security.mjs';
import { loginUrl, removeStateFileIfOwned, serverOrigin, writeStateFile } from './state-file.mjs';
import { createStaticHandler } from './static.mjs';
import { CLOSE_CODE } from './ws-frame.mjs';

/**
 * @typedef {object} ServerOptions
 * @property {number} [port]               0 picks a free port
 * @property {string} [host]
 * @property {string} [home]               ANDARY_HOME; server.json and recordings live here
 * @property {string} [publicDir]
 * @property {boolean} [remoteApprovals]
 * @property {string|null} [notifyUrl]    ntfy topic URL for phone notifications (null: off)
 * @property {boolean} [notifyLimits]      a phone note when a plan limit reaches 90% (off by default)
 * @property {number} [notifyDelayMs]      how long a dialog's phone note waits (DIALOG_DELAY_MS); for tests, no CLI flag
 * @property {number} [awayMs]             how long without you counts as away (AWAY_MS); for tests, no CLI flag
 * @property {string} [claudeDir]          Claude Code's config folder, for reading token usage from transcripts
 * @property {boolean} [team]              host a team town: teammates' Andarys may send their events here
 * @property {string|null} [teamName]       the host's own name in a team town (--name), already cleaned
 * @property {string[]} [teamHosts]        names teammates reach a team host by (a VPN name), besides its addresses
 * @property {{ url: string, key: string }|null} [shareTo]  send this town's events to a team host
 * @property {number} [approvalTimeoutMs]
 * @property {{ cert: Buffer|string, key: Buffer|string }|null} [tls]  serve HTTPS to the network with this certificate (ADR 0016)
 * @property {boolean} [record]            append every envelope to <home>/recordings/*.jsonl
 * @property {boolean} [writeState]        write server.json (default true)
 * @property {(message: string) => void} [log]  lifecycle lines only, never payload content
 */

/**
 * @typedef {object} TownContext
 * @property {string} version
 * @property {string} secret
 * @property {string} uiToken
 * @property {string} responseKey     signs /api/hook replies (see auth.signHookReply)
 * @property {{ remoteApprovals: boolean, approvalTimeoutMs: number }} settings
 * @property {Set<string>} allowedHosts
 * @property {Record<string, string>} headers
 * @property {ReturnType<typeof createHistory>} history
 * @property {import('./approvals.mjs').ApprovalBroker} broker
 * @property {ReturnType<typeof createUsageTracker>} usage
 * @property {ReturnType<typeof createProgress>} progress
 * @property {ReturnType<typeof createNotifier>} notifier
 * @property {import('./work-trees.mjs').WorkTrees} [workTrees]  where local hooks' work trees start (andary_root)
 * @property {ReturnType<typeof createTownDigest>} digest   what your crews did while you were away
 * @property {ReturnType<typeof createLimitsTracker>} limits  plan limits from the andary-limits mod
 * @property {import('./browsers.mjs').Hub} hub
 * @property {ReturnType<typeof createTeamHost>|null} team    set on a team host
 * @property {ReturnType<typeof createTeamRelay>|null} relay  set when sharing to a team host
 * @property {import('./rate-limit.mjs').TokenBucket} hookLimiter
 * @property {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, pathname: string) => Promise<void>} serveStatic
 * @property {ReturnType<typeof createRecorder>|null} recorder
 * @property {(message: string) => void} log
 * @property {{ events: number }} counts
 * @property {NodeJS.Timeout|null} graceTimer
 * @property {NodeJS.Timeout|null} [hostTimer]  a team host's refresh of its network names
 * @property {NodeJS.Timeout|null} [peopleTimer]  a team host's look at people.json (the CLI edits it)
 */

/**
 * @typedef {object} TownServer
 * @property {number} port
 * @property {string} host
 * @property {string} origin          e.g. http://127.0.0.1:4747
 * @property {string} loginUrl        origin + /?token=…
 * @property {string} secret
 * @property {string} uiToken
 * @property {string|null} recordingPath
 * @property {import('./state-file.mjs').ServerState} state
 * @property {string|null} notifyUrl  where phone notifications go (null: off)
 * @property {string|null} viewUrl    a team host's view-only link for teammates (null: not a host)
 * @property {() => number} browserCount
 * @property {() => Promise<void>} stop
 */

/** How often a team host looks whether `andary team invite` or `remove` changed people.json. */
const PEOPLE_POLL_MS = 2000;

/**
 * Starts a server and writes server.json. Rejects if the port cannot be bound (EADDRINUSE…).
 * @param {ServerOptions} [options]
 * @returns {Promise<TownServer>}
 */
export async function startTownServer(options = {}) {
  const config = withDefaults(options);
  const ctx = createContext(config, options);
  const listener = createHttpServer(ctx, options.tls ?? null);
  const server = listener.front;
  await listen(server, config.port, config.host);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  // A team host also answers to the names given with --team-host and, listening on every
  // interface, to its network addresses (looked at again every 30 s: they can change).
  const teamHosts = ctx.team ? (options.teamHosts ?? []) : [];
  const hostNames = () => [...teamHosts, ...(ctx.team && isWildcardHost(config.host) ? lanAddresses() : [])];
  const extraHosts = hostNames();
  ctx.allowedHosts = allowedHostHeaders(port, config.host, extraHosts);
  if (ctx.team) {
    ctx.hostTimer = setInterval(() => {
      ctx.allowedHosts = allowedHostHeaders(port, config.host, hostNames());
    }, 30_000);
    ctx.hostTimer.unref();
    const people = ctx.team.people;
    ctx.peopleTimer = setInterval(() => people.poll(), PEOPLE_POLL_MS);
    ctx.peopleTimer.unref();
  }

  const state = {
    pid: process.pid,
    port,
    host: config.host,
    secret: ctx.secret,
    uiToken: ctx.uiToken,
    responseKey: ctx.responseKey,
    version: ctx.version,
    startedAt: Date.now(),
    approvalTimeoutMs: config.approvalTimeoutMs,
    ...(ctx.team ? { team: true } : {}),
    // What `andary team invite` needs to print a link that matches the certificate.
    ...(listener.tls ? { tls: true } : {}),
    ...(teamHosts.length ? { teamHosts } : {}),
  };
  if (config.writeState) writeStateFile(config.home, state);

  return {
    port,
    host: config.host,
    origin: serverOrigin(state),
    loginUrl: loginUrl(state),
    secret: ctx.secret,
    uiToken: ctx.uiToken,
    recordingPath: ctx.recorder?.path ?? null,
    state,
    notifyUrl: ctx.notifier.url,
    viewUrl: ctx.team ? `${listener.tls ? 'https' : 'http'}://${hostWithPort(extraHosts[0] ?? connectHost(config.host), port)}/?view=${ctx.team.view}` : null,
    browserCount: () => ctx.hub.size,
    stop: once(() => stopServer(ctx, listener, config)),
  };
}

/** @param {ServerOptions} options */
function withDefaults(options) {
  return {
    port: options.port ?? DEFAULT_PORT,
    host: options.host ?? DEFAULT_HOST,
    home: options.home ?? resolveHome(),
    publicDir: options.publicDir ?? PUBLIC_DIR,
    approvalTimeoutMs: options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS,
    writeState: options.writeState ?? true,
    log: options.log ?? (() => {}),
  };
}

/**
 * The server's socket (listener.mjs): routes and WebSocket upgrades, over plain HTTP, or with a
 * certificate HTTPS for the network and plain HTTP for this computer only.
 * @param {TownContext} ctx
 * @param {{ cert: Buffer|string, key: Buffer|string }|null} tls
 */
function createHttpServer(ctx, tls) {
  return createListener(
    (req, res) => {
      handleRequest(ctx, req, res).catch((error) => {
        // Name and code only: an error message could quote request data.
        ctx.log(`Internal error while answering a request (${error?.code ?? error?.name ?? 'unknown'})`);
        sendText(res, 500, 'Internal error\n');
      });
    },
    (req, socket, head) => handleUpgrade(ctx, req, socket, head),
    tls,
  );
}

/**
 * @param {{ home: string, publicDir: string, approvalTimeoutMs: number, writeState: boolean, log: (message: string) => void }} config
 * @param {ServerOptions} options
 * @returns {TownContext}
 */
function createContext(config, options) {
  const hub = createHub(LIMITS.wsClients);
  const notifier = createNotifier({
    url: options.notifyUrl ?? null,
    log: config.log,
    delayMs: options.notifyDelayMs,
    limitNotes: Boolean(options.notifyLimits),
    limitNotesFile: config.writeState ? join(config.home, 'limit-notes.json') : null,
  });
  // Your absences are yours: only signed-in browsers hear of them.
  const digest = createTownDigest({ awayMs: options.awayMs, onAway: (away) => hub.broadcastOwners({ t: 'away', away }) });
  /** @type {TownContext} */
  const ctx = {
    version: readVersion(),
    secret: generateToken(),
    uiToken: generateToken(),
    responseKey: generateToken(),
    settings: { remoteApprovals: Boolean(options.remoteApprovals), approvalTimeoutMs: config.approvalTimeoutMs },
    allowedHosts: new Set(),
    headers: securityHeaders(buildCsp(computeImportMapHashes(config.publicDir))),
    history: createHistory({ size: LIMITS.historySize, maxBytes: LIMITS.historyBytes }),
    broker: createApprovalBroker({
      timeoutMs: config.approvalTimeoutMs,
      maxPending: LIMITS.pendingApprovals,
      maxSettled: LIMITS.settledApprovals,
      onChange: (approval) => {
        hub.broadcastOwners({ t: 'approval', a: approval });
        // Links a request to its dialog; one decided in the town needs no phone note.
        notifier.approvalChanged(approval);
        // A decision in the town is you being here, and an answer for the crew's catch-up.
        digest.approvalChanged(approval);
      },
    }),
    hub,
    digest,
    team: options.team
      ? createTeamHost({
          secret: /** @type {string} */ (teamSecret(config.home)),
          log: config.log,
          people: createPeople({
            home: config.home,
            host: options.teamName ?? null,
            log: config.log,
            onChange: () => {
              dropRemovedPeople(ctx);
              announcePeople(ctx);
            },
          }),
          onMember: (members) => {
            config.log(`Team town: ${members.at(-1)} is sharing now (${members.length} teammate${members.length === 1 ? '' : 's'})`);
            announceTeam(ctx);
          },
        })
      : null,
    relay: options.shareTo ? createTeamRelay({ url: options.shareTo.url, key: options.shareTo.key, log: config.log }) : null,
    usage: createUsageTracker({
      claudeDir: options.claudeDir ?? resolveClaudeConfigDir(),
      stateFile: config.writeState ? join(config.home, 'usage.json') : null,
      onChange: (record, days) => hub.broadcastOwners({ t: 'usage', u: record, days }),
    }),
    notifier,
    workTrees: createWorkTrees(),
    // Per account, not per session: owners only, like costs; never relayed to a team host.
    limits: createLimitsTracker({
      onChange: (snapshot, account) => {
        hub.broadcastOwners({ t: 'limits', limits: snapshot });
        notifier.limitsChanged(account, snapshot.accounts.length);
      },
    }),
    progress: createProgress({
      stateFile: config.writeState ? join(config.home, 'progress.json') : null,
      onChange: (progress) => hub.broadcast({ t: 'progress', p: progress }),
    }),
    hookLimiter: createTokenBucket({ ratePerSecond: LIMITS.hookRatePerSecond, burst: LIMITS.hookBurst }),
    serveStatic: createStaticHandler({ root: config.publicDir, notFound: (_req, res) => sendHtml(res, 404, NOT_FOUND_PAGE) }),
    recorder: options.record ? createRecorder(recordingPath(config.home)) : null,
    log: config.log,
    counts: { events: 0 },
    graceTimer: null,
  };
  return ctx;
}

/**
 * @param {import('node:net').Server} server
 * @param {number} port
 * @param {string} host
 * @returns {Promise<void>}
 */
function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

/**
 * Gives held prompts back to the terminal, says goodbye to browsers, closes connections and
 * removes server.json if it is still ours.
 * @param {TownContext} ctx
 * @param {import('./listener.mjs').Listener} listener
 * @param {{ home: string, writeState: boolean }} config
 */
async function stopServer(ctx, listener, config) {
  if (ctx.graceTimer) clearTimeout(ctx.graceTimer);
  if (ctx.hostTimer) clearInterval(ctx.hostTimer);
  if (ctx.peopleTimer) clearInterval(ctx.peopleTimer);
  // First, so no phone note goes out while the server stops: whoever stops it is at the computer.
  ctx.notifier.dispose();
  ctx.digest.dispose();
  ctx.broker.releaseAll();
  // Last events to the team host, but never hold up shutdown for long.
  if (ctx.relay) await Promise.race([ctx.relay.flush(), new Promise((resolve) => setTimeout(resolve, 1500).unref())]);
  ctx.relay?.dispose();
  ctx.usage.dispose();
  ctx.progress.dispose();
  ctx.hub.closeAll(CLOSE_CODE.GOING_AWAY, 'Andary is shutting down');
  const closed = new Promise((resolve) => listener.front.close(() => resolve(undefined)));
  listener.closeIdle();
  const force = setTimeout(() => {
    listener.closeAll();
    ctx.hub.terminateAll();
  }, 1000);
  force.unref();
  await closed;
  clearTimeout(force);
  await ctx.recorder?.close();
  if (config.writeState) removeStateFileIfOwned(config.home, { secret: ctx.secret });
  ctx.log(`Stopped after ${ctx.counts.events} hook event${ctx.counts.events === 1 ? '' : 's'}`);
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {() => Promise<T>}
 */
function once(fn) {
  /** @type {Promise<T>|null} */
  let result = null;
  return () => {
    result ??= fn();
    return result;
  };
}
