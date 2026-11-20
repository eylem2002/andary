// The Andary server: composes the HTTP routes, the WebSocket hub, the approval broker and the
// history, and owns the lifecycle (listen, server.json, shutdown).
import { createServer } from 'node:http';
import { join } from 'node:path';
import { generateToken } from './auth.mjs';
import { createApprovalBroker } from './approvals.mjs';
import { claudeConfigDir, createUsageTracker } from './usage.mjs';
import { createProgress } from './progress.mjs';
import { createNotifier } from './notify.mjs';
import { announceTeam, createHub, handleUpgrade } from './browsers.mjs';
import { createTeamHost, createTeamRelay, lanAddresses, teamSecret } from './team.mjs';
import { DEFAULT_APPROVAL_TIMEOUT_MS, DEFAULT_HOST, DEFAULT_PORT, LIMITS, PUBLIC_DIR, readVersion, resolveHome } from './config.mjs';
import { createHistory, createRecorder, recordingPath } from './history.mjs';
import { NOT_FOUND_PAGE, sendHtml, sendText } from './http-util.mjs';
import { createTokenBucket } from './rate-limit.mjs';
import { handleRequest } from './routes.mjs';
import { sanitize } from './sanitize.mjs';
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
 * @property {string} [claudeDir]          Claude Code's config folder, for reading token usage from transcripts
 * @property {boolean} [team]              host a team town: teammates' Andarys may send their events here
 * @property {string[]} [teamHosts]        names teammates reach a team host by (a VPN name), besides its addresses
 * @property {{ url: string, key: string }|null} [shareTo]  send this town's events to a team host
 * @property {number} [approvalTimeoutMs]
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
 * @property {import('./browsers.mjs').Hub} hub
 * @property {ReturnType<typeof createTeamHost>|null} team    set on a team host
 * @property {ReturnType<typeof createTeamRelay>|null} relay  set when sharing to a team host
 * @property {import('./rate-limit.mjs').TokenBucket} hookLimiter
 * @property {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, pathname: string) => Promise<void>} serveStatic
 * @property {ReturnType<typeof createRecorder>|null} recorder
 * @property {(body: { ts: number, event: object }) => import('./history.mjs').Envelope & { event: Record<string, any> }} ingest
 * @property {(message: string) => void} log
 * @property {{ events: number }} counts
 * @property {NodeJS.Timeout|null} graceTimer
 * @property {NodeJS.Timeout|null} [hostTimer]  a team host's refresh of its network names
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

/**
 * Starts a server and writes server.json. Rejects if the port cannot be bound (EADDRINUSE…).
 * @param {ServerOptions} [options]
 * @returns {Promise<TownServer>}
 */
export async function startTownServer(options = {}) {
  const config = withDefaults(options);
  const ctx = createContext(config, options);
  const server = createHttpServer(ctx);
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
    viewUrl: ctx.team ? `http://${hostWithPort(extraHosts[0] ?? connectHost(config.host), port)}/?view=${ctx.team.view}` : null,
    browserCount: () => ctx.hub.size,
    stop: once(() => stopServer(ctx, server, config)),
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
 * The HTTP server: routes, WebSocket upgrades and request time limits.
 * @param {TownContext} ctx
 */
function createHttpServer(ctx) {
  const server = createServer((req, res) => {
    handleRequest(ctx, req, res).catch((error) => {
      // Name and code only: an error message could quote request data.
      ctx.log(`Internal error while answering a request (${error?.code ?? error?.name ?? 'unknown'})`);
      sendText(res, 500, 'Internal error\n');
    });
  });
  server.on('upgrade', (req, socket, head) => handleUpgrade(ctx, req, socket, head));
  // Bodies are small and local; a slow upload is not a real client. Held hook responses are not
  // affected: these limits cover receiving the request, not answering it.
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}

/**
 * @param {{ home: string, publicDir: string, approvalTimeoutMs: number, writeState: boolean, log: (message: string) => void }} config
 * @param {ServerOptions} options
 * @returns {TownContext}
 */
function createContext(config, options) {
  const hub = createHub(LIMITS.wsClients);
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
      onChange: (approval) => hub.broadcastOwners({ t: 'approval', a: approval }),
    }),
    hub,
    team: options.team
      ? createTeamHost({
          secret: /** @type {string} */ (teamSecret(config.home)),
          onMember: (members) => {
            config.log(`Team town: ${members.at(-1)} is sharing now (${members.length} teammate${members.length === 1 ? '' : 's'})`);
            announceTeam(ctx);
          },
        })
      : null,
    relay: options.shareTo ? createTeamRelay({ url: options.shareTo.url, key: options.shareTo.key, log: config.log }) : null,
    usage: createUsageTracker({
      claudeDir: options.claudeDir ?? claudeConfigDir(),
      stateFile: config.writeState ? join(config.home, 'usage.json') : null,
      onChange: (record, days) => hub.broadcastOwners({ t: 'usage', u: record, days }),
    }),
    notifier: createNotifier({ url: options.notifyUrl ?? null, log: config.log }),
    progress: createProgress({
      stateFile: config.writeState ? join(config.home, 'progress.json') : null,
      onChange: (progress) => hub.broadcast({ t: 'progress', p: progress }),
    }),
    hookLimiter: createTokenBucket({ ratePerSecond: LIMITS.hookRatePerSecond, burst: LIMITS.hookBurst }),
    serveStatic: createStaticHandler({ root: config.publicDir, notFound: (_req, res) => sendHtml(res, 404, NOT_FOUND_PAGE) }),
    recorder: options.record ? createRecorder(recordingPath(config.home)) : null,
    ingest: (body) => ingest(ctx, body),
    log: config.log,
    counts: { events: 0 },
    graceTimer: null,
  };
  return ctx;
}

/**
 * Sanitizes a hook payload into an envelope, keeps it, records it (with --record) and sends it
 * to every browser.
 * @param {TownContext} ctx
 * @param {{ ts: number, event: object }} body
 */
function ingest(ctx, { ts, event }) {
  ctx.counts.events += 1;
  const envelope = { id: ctx.counts.events, ts, rx: Date.now(), event: sanitize(event) };
  if (envelope.id === 1) ctx.log('Receiving hook events from Claude Code');
  // Serialised once: its length is the envelope's share of the history budget.
  const text = JSON.stringify(envelope);
  ctx.history.push(envelope, text.length);
  ctx.recorder?.write(envelope);
  ctx.hub.broadcastText(`{"t":"hook","e":${text}}`);
  return envelope;
}

/**
 * @param {import('node:http').Server} server
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
 * @param {import('node:http').Server} server
 * @param {{ home: string, writeState: boolean }} config
 */
async function stopServer(ctx, server, config) {
  if (ctx.graceTimer) clearTimeout(ctx.graceTimer);
  if (ctx.hostTimer) clearInterval(ctx.hostTimer);
  ctx.broker.releaseAll();
  // Last events to the team host, but never hold up shutdown for long.
  if (ctx.relay) await Promise.race([ctx.relay.flush(), new Promise((resolve) => setTimeout(resolve, 1500).unref())]);
  ctx.relay?.dispose();
  ctx.usage.dispose();
  ctx.progress.dispose();
  ctx.hub.closeAll(CLOSE_CODE.GOING_AWAY, 'Andary is shutting down');
  const closed = new Promise((resolve) => server.close(() => resolve(undefined)));
  server.closeIdleConnections();
  const force = setTimeout(() => {
    server.closeAllConnections();
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
