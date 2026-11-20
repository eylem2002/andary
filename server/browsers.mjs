// Browsers connect over /ws (CONTRACTS §4.5). This module accepts them (after the Host, Origin and
// cookie checks), sends the hello snapshot, and handles their decide/settings/ping messages.
import { hasUiCookie } from './auth.mjs';
import { LIMITS } from './config.mjs';
import { createTokenBucket } from './rate-limit.mjs';
import { isAllowedHost, isAllowedOrigin } from './security.mjs';
import { acceptUpgrade, rejectUpgrade, validateUpgradeRequest } from './websocket.mjs';
import { CLOSE_CODE } from './ws-frame.mjs';

/**
 * The set of connected browsers.
 * @param {number} maxClients
 */
export function createHub(maxClients) {
  /** @type {Set<import('./websocket.mjs').WsConnection>} */
  const clients = new Set();
  return {
    get size() {
      return clients.size;
    },
    get full() {
      return clients.size >= maxClients;
    },
    /** @param {import('./websocket.mjs').WsConnection} connection */
    add(connection) {
      clients.add(connection);
      connection.once('close', () => clients.delete(connection));
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
      for (const connection of clients) connection.send(text);
    },
    /**
     * @param {number} code
     * @param {string} reason
     */
    closeAll(code, reason) {
      for (const connection of clients) connection.close(code, reason);
    },
    terminateAll() {
      for (const connection of clients) connection.terminate();
    },
  };
}

/** @typedef {ReturnType<typeof createHub>} Hub */

/**
 * @param {import('./app.mjs').TownContext} ctx
 * @returns {{ remoteApprovals: boolean, approvalTimeoutMs: number }}
 */
export function publicSettings(ctx) {
  return { remoteApprovals: ctx.settings.remoteApprovals, approvalTimeoutMs: ctx.settings.approvalTimeoutMs };
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
  const verdict = checkUpgrade(ctx, req);
  if (!verdict.ok) {
    rejectUpgrade(socket, verdict.status, verdict.message, verdict.headers);
    return;
  }
  const connection = acceptUpgrade(socket, verdict.key, head, {
    maxMessageBytes: LIMITS.wsMessageBytes,
    maxBufferedBytes: LIMITS.wsBufferedBytes,
    heartbeatMs: LIMITS.wsHeartbeatMs,
  });
  attachBrowser(ctx, connection);
}

/**
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('node:http').IncomingMessage} req
 * @returns {import('./websocket.mjs').UpgradeVerdict}
 */
function checkUpgrade(ctx, req) {
  if (!isAllowedHost(req.headers.host, ctx.allowedHosts)) return { ok: false, status: 403, message: 'Forbidden host' };
  if (pathOf(req.url) !== '/ws') return { ok: false, status: 404, message: 'Not found' };
  const handshake = validateUpgradeRequest(req);
  if (!handshake.ok) return handshake;
  if (!isAllowedOrigin(req.headers.origin, ctx.allowedHosts)) return { ok: false, status: 403, message: 'Forbidden origin' };
  if (!hasUiCookie(req, ctx.uiToken)) return { ok: false, status: 401, message: 'Sign in with the link printed by andary start' };
  if (ctx.hub.full) return { ok: false, status: 503, message: 'Too many browser connections' };
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
 */
function attachBrowser(ctx, connection) {
  ctx.hub.add(connection);
  cancelRelease(ctx);
  ctx.log(`Browser connected (${ctx.hub.size} open)`);
  ctx.hub.send(connection, {
    t: 'hello',
    version: ctx.version,
    serverTime: Date.now(),
    settings: publicSettings(ctx),
    history: ctx.history.list(),
    approvals: ctx.broker.list(),
    usage: ctx.usage.snapshot(),
    progress: ctx.progress.snapshot(),
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
    ctx.log(`Browser disconnected (${ctx.hub.size} open)`);
    if (ctx.hub.size === 0) scheduleRelease(ctx);
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
  switch (message?.t) {
    case 'decide': {
      const result = ctx.broker.decide(message.id, message.decision, message.message);
      if (!result.ok) sendError(ctx, connection, result.error);
      return;
    }
    case 'settings':
      applySettings(ctx, connection, message.settings);
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
  ctx.hub.broadcast({ t: 'settings', settings: publicSettings(ctx) });
  // Nobody may answer from the town any more: give waiting prompts back to the terminal.
  if (!settings.remoteApprovals) ctx.broker.releaseAll();
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
    if (ctx.hub.size === 0) ctx.broker.releaseAll();
  }, LIMITS.browserGraceMs);
  ctx.graceTimer.unref?.();
}

/** @param {import('./app.mjs').TownContext} ctx */
function cancelRelease(ctx) {
  if (ctx.graceTimer) clearTimeout(ctx.graceTimer);
  ctx.graceTimer = null;
}
