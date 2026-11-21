// Browsers connect over /ws (CONTRACTS §4.5). This module accepts them (after the Host, Origin and
// sign-in checks), sends the hello snapshot, and handles their decide/settings/digest/ping messages.
// On a team host (§4.11) a browser is either the owner (signed in) or a teammate watching with
// the view link: viewers get the town but not the owner's prompts, costs, settings or topic.
import { WS_PROTOCOL, browserRole, offersAndaryProtocol } from './auth.mjs';
import { LIMITS } from './config.mjs';
import { createTokenBucket } from './rate-limit.mjs';
import { isAllowedHost, isAllowedOrigin } from './security.mjs';
import { acceptUpgrade, rejectUpgrade, validateUpgradeRequest } from './websocket.mjs';
import { CLOSE_CODE } from './ws-frame.mjs';

/** @typedef {'owner'|'viewer'} BrowserRole */

/** Places kept free for the owner: viewers can never fill the town's last few connections. */
const OWNER_RESERVE = 4;

/**
 * The set of connected browsers and who each one is.
 * @param {number} maxClients
 */
export function createHub(maxClients) {
  /** @type {Map<import('./websocket.mjs').WsConnection, BrowserRole>} */
  const clients = new Map();
  const count = (/** @type {BrowserRole} */ role) => [...clients.values()].filter((r) => r === role).length;
  return {
    get size() {
      return clients.size;
    },
    /** Signed-in browsers: only they can answer prompts. */
    get owners() {
      return count('owner');
    },
    /** @param {BrowserRole} [role] */
    full(role = 'owner') {
      if (clients.size >= maxClients) return true;
      return role === 'viewer' && count('viewer') >= maxClients - OWNER_RESERVE;
    },
    /**
     * @param {import('./websocket.mjs').WsConnection} connection
     * @param {BrowserRole} [role]
     */
    add(connection, role = 'owner') {
      clients.set(connection, role);
      connection.once('close', () => clients.delete(connection));
    },
    /** @param {import('./websocket.mjs').WsConnection} connection */
    roleOf(connection) {
      return clients.get(connection) ?? null;
    },
    /** @param {(connection: import('./websocket.mjs').WsConnection, role: BrowserRole) => void} fn */
    each(fn) {
      for (const [connection, role] of clients) fn(connection, role);
    },
    /** @param {object} message for signed-in browsers only (prompts, costs, settings) */
    broadcastOwners(message) {
      if (clients.size === 0) return;
      const text = JSON.stringify(message);
      for (const [connection, role] of clients) if (role === 'owner') connection.send(text);
    },
    /**
     * @param {import('./websocket.mjs').WsConnection} connection
     * @param {object} message
     */
    send(connection, message) {
      connection.send(JSON.stringify(message));
    },
    /** @param {object} message serialised once for every browser */
    broadcast(message) {
      if (clients.size === 0) return;
      this.broadcastText(JSON.stringify(message));
    },
    /** @param {string} text an already serialised message */
    broadcastText(text) {
      for (const connection of clients.keys()) connection.send(text);
    },
    /**
     * @param {number} code
     * @param {string} reason
     */
    closeAll(code, reason) {
      for (const connection of clients.keys()) connection.close(code, reason);
    },
    terminateAll() {
      for (const connection of clients.keys()) connection.terminate();
    },
  };
}

/** @typedef {ReturnType<typeof createHub>} Hub */

/**
 * @param {import('./app.mjs').TownContext} ctx
 * @returns {{ remoteApprovals: boolean, approvalTimeoutMs: number, notify: boolean }}
 */
export function publicSettings(ctx) {
  // Whether phone notifications are on, never the topic: /api/hello answers without signing in.
  return { remoteApprovals: ctx.settings.remoteApprovals, approvalTimeoutMs: ctx.settings.approvalTimeoutMs, notify: ctx.notifier.on };
}

/**
 * The team part of a browser's settings, null when this server is not a team host.
 * @param {import('./app.mjs').TownContext} ctx
 * @param {BrowserRole} role
 */
export function teamSettings(ctx, role) {
  return ctx.team ? { role, members: ctx.team.members() } : null;
}

/**
 * Settings as one browser may see them: a viewer never sees the owner's approval or phone settings.
 * @param {import('./app.mjs').TownContext} ctx
 * @param {BrowserRole} role
 */
function settingsFor(ctx, role) {
  const settings = role === 'owner' ? publicSettings(ctx) : { remoteApprovals: false, approvalTimeoutMs: ctx.settings.approvalTimeoutMs, notify: false };
  return ctx.team ? { ...settings, team: teamSettings(ctx, role) } : settings;
}

/**
 * Tells every browser who is in the team town (a teammate's first events just arrived).
 * @param {import('./app.mjs').TownContext} ctx
 */
export function announceTeam(ctx) {
  ctx.hub.each((connection, role) => ctx.hub.send(connection, { t: 'settings', settings: { team: teamSettings(ctx, role) } }));
}

/**
 * Handles an HTTP upgrade request on the server.
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:stream').Duplex} socket
 * @param {Buffer} head
 */
export function handleUpgrade(ctx, req, socket, head) {
  socket.on('error', () => socket.destroy());
  // This runs in the server's 'upgrade' event: anything thrown here would end the process.
  try {
    upgrade(ctx, req, socket, head);
  } catch (error) {
    ctx.log(`Could not open a browser connection (${error?.code ?? error?.name ?? 'unknown'})`);
    socket.destroy();
  }
}

/**
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:stream').Duplex} socket
 * @param {Buffer} head
 */
function upgrade(ctx, req, socket, head) {
  const role = browserRole(req, ctx.uiToken, ctx.team?.view ?? null);
  const verdict = checkUpgrade(ctx, req, role);
  if (!verdict.ok) {
    rejectUpgrade(socket, verdict.status, verdict.message, verdict.headers);
    return;
  }
  const connection = acceptUpgrade(socket, verdict.key, head, {
    protocol: offersAndaryProtocol(req) ? WS_PROTOCOL : null,
    maxMessageBytes: LIMITS.wsMessageBytes,
    maxBufferedBytes: LIMITS.wsBufferedBytes,
    heartbeatMs: LIMITS.wsHeartbeatMs,
  });
  // checkUpgrade refuses a browser without a role.
  attachBrowser(ctx, connection, /** @type {BrowserRole} */ (role));
}

/**
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('node:http').IncomingMessage} req
 * @param {BrowserRole|null} role
 * @returns {import('./websocket.mjs').UpgradeVerdict}
 */
function checkUpgrade(ctx, req, role) {
  if (!isAllowedHost(req.headers.host, ctx.allowedHosts)) return { ok: false, status: 403, message: 'Forbidden host' };
  if (pathOf(req.url) !== '/ws') return { ok: false, status: 404, message: 'Not found' };
  const handshake = validateUpgradeRequest(req);
  if (!handshake.ok) return handshake;
  if (!isAllowedOrigin(req.headers.origin, ctx.allowedHosts)) return { ok: false, status: 403, message: 'Forbidden origin' };
  if (!role) return { ok: false, status: 401, message: 'Sign in with the link printed by andary start' };
  if (ctx.hub.full(role)) return { ok: false, status: 503, message: 'Too many browser connections' };
  return handshake;
}

/**
 * @param {string|undefined} rawUrl
 * @returns {string|null}
 */
function pathOf(rawUrl) {
  try {
    return new URL(rawUrl ?? '/', 'http://localhost').pathname;
  } catch {
    return null;
  }
}

/**
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('./websocket.mjs').WsConnection} connection
 * @param {BrowserRole} role
 */
function attachBrowser(ctx, connection, role) {
  ctx.hub.add(connection, role);
  const owner = role === 'owner';
  if (owner) cancelRelease(ctx);
  ctx.log(`${owner ? 'Browser' : 'Team viewer'} connected (${ctx.hub.size} open)`);
  ctx.hub.send(connection, {
    t: 'hello',
    version: ctx.version,
    serverTime: Date.now(),
    settings: settingsFor(ctx, role),
    history: ctx.history.list(),
    approvals: owner ? ctx.broker.list() : [],
    usage: owner ? ctx.usage.snapshot() : { agents: [], days: [] },
    progress: ctx.progress.snapshot(),
    notifyUrl: owner ? ctx.notifier.url : null,
    // The latest time the owner was away: a page opened after one offers to catch up.
    away: owner ? ctx.digest.away() : null,
  });
  const limiter = createTokenBucket({ ratePerSecond: LIMITS.wsMessagesPerSecond, burst: LIMITS.wsMessageBurst });
  connection.on('message', (text) => {
    if (!limiter.take()) {
      connection.close(CLOSE_CODE.POLICY_VIOLATION, 'Too many messages');
      return;
    }
    handleBrowserMessage(ctx, connection, text);
  });
  connection.on('close', () => {
    ctx.log(`${owner ? 'Browser' : 'Team viewer'} disconnected (${ctx.hub.size} open)`);
    if (ctx.hub.owners === 0) scheduleRelease(ctx);
  });
}

/**
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('./websocket.mjs').WsConnection} connection
 * @param {string} text
 */
function handleBrowserMessage(ctx, connection, text) {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    sendError(ctx, connection, 'Messages must be JSON');
    return;
  }
  if (ctx.hub.roleOf(connection) === 'viewer' && message?.t !== 'ping') {
    sendError(ctx, connection, 'Viewers can only watch: the team town\'s host answers prompts and changes settings.');
    return;
  }
  switch (message?.t) {
    case 'decide': {
      const result = ctx.broker.decide(message.id, message.decision, message.message, message.always);
      if (!result.ok) sendError(ctx, connection, result.error);
      return;
    }
    case 'settings':
      applySettings(ctx, connection, message.settings);
      return;
    case 'notify-test':
      void ctx.notifier.test().then((ok) => ctx.hub.send(connection, { t: 'notify-test', ok }));
      return;
    case 'digest':
      sendDigest(ctx, connection, message.since);
      return;
    case 'ping':
      return;
    default:
      sendError(ctx, connection, 'Unknown message type');
  }
}

/**
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('./websocket.mjs').WsConnection} connection
 * @param {any} settings
 */
function applySettings(ctx, connection, settings) {
  if (typeof settings?.remoteApprovals !== 'boolean') {
    sendError(ctx, connection, 'settings.remoteApprovals must be true or false');
    return;
  }
  if (ctx.settings.remoteApprovals !== settings.remoteApprovals) {
    ctx.settings.remoteApprovals = settings.remoteApprovals;
    ctx.log(`Remote approvals turned ${settings.remoteApprovals ? 'on' : 'off'} from the town`);
  }
  ctx.hub.broadcastOwners({ t: 'settings', settings: publicSettings(ctx) });
  // Nobody may answer from the town any more: give waiting prompts back to the terminal.
  if (!settings.remoteApprovals) ctx.broker.releaseAll();
}

/**
 * Answers `{ t: 'digest', since }` with what each of the owner's crews did since then, to the
 * browser that asked only (a viewer never gets this far). `since` is a time in milliseconds on
 * the server's clock; 0 asks for everything kept.
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('./websocket.mjs').WsConnection} connection
 * @param {unknown} since
 */
function sendDigest(ctx, connection, since) {
  if (typeof since !== 'number' || !Number.isFinite(since) || since < 0) {
    sendError(ctx, connection, 'digest.since must be a time in milliseconds');
    return;
  }
  ctx.hub.send(connection, { t: 'digest', d: ctx.digest.summary(since) });
}

/**
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('./websocket.mjs').WsConnection} connection
 * @param {string} message
 */
function sendError(ctx, connection, message) {
  ctx.hub.send(connection, { t: 'error', message });
}

/**
 * With no browser left, held prompts would block Claude until the timeout. A short grace period
 * lets a reloading page reconnect before they are handed back to the terminal.
 * @param {import('./app.mjs').TownContext} ctx
 */
function scheduleRelease(ctx) {
  if (ctx.broker.heldCount() === 0 || ctx.graceTimer) return;
  ctx.graceTimer = setTimeout(() => {
    ctx.graceTimer = null;
    if (ctx.hub.owners === 0) ctx.broker.releaseAll();
  }, LIMITS.browserGraceMs);
  ctx.graceTimer.unref?.();
}

/** @param {import('./app.mjs').TownContext} ctx */
function cancelRelease(ctx) {
  if (ctx.graceTimer) clearTimeout(ctx.graceTimer);
  ctx.graceTimer = null;
}
