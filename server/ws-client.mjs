// A small WebSocket client on top of node:http, for `andary doctor` and the test suites.
// Node's global WebSocket (Node ≥ 22 only) cannot send the Cookie and Origin headers the server
// checks, so this client lets callers set any handshake header.
import { request } from 'node:http';
import { WsConnection, acceptKeyFor, generateClientKey } from './websocket.mjs';

/**
 * @typedef {WsConnection & { messages: any[] }} ClientConnection
 *   `messages` collects every parsed JSON message, in arrival order.
 */

/**
 * Opens a WebSocket. Rejects with an Error carrying `status` when the server refuses the upgrade.
 * @param {string} url ws:// URL
 * @param {{ headers?: Record<string, string>, timeoutMs?: number, maxMessageBytes?: number }} [options]
 * @returns {Promise<ClientConnection>}
 */
export function connectWebSocket(url, { headers = {}, timeoutMs = 5000, maxMessageBytes = 256 * 1024 * 1024 } = {}) {
  const target = new URL(url);
  const key = generateClientKey();
  return new Promise((resolve, reject) => {
    const req = request({
      host: target.hostname.replace(/^\[|\]$/g, ''),
      port: target.port,
      path: `${target.pathname}${target.search}`,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': key,
        ...headers,
      },
    });
    const timer = setTimeout(() => req.destroy(new Error('WebSocket handshake timed out')), timeoutMs);
    req.on('upgrade', (res, socket, head) => {
      clearTimeout(timer);
      if (res.headers['sec-websocket-accept'] !== acceptKeyFor(key)) {
        socket.destroy();
        reject(new Error('Bad Sec-WebSocket-Accept from server'));
        return;
      }
      const connection = /** @type {ClientConnection} */ (new WsConnection(socket, { role: 'client', maxMessageBytes }));
      connection.messages = [];
      connection.on('message', (text) => {
        try {
          connection.messages.push(JSON.parse(text));
        } catch {
          connection.messages.push(text);
        }
      });
      if (head.length > 0) connection.receive(head);
      resolve(connection);
    });
    req.on('response', (res) => {
      clearTimeout(timer);
      res.resume();
      reject(Object.assign(new Error(`WebSocket upgrade refused with HTTP ${res.statusCode}`), { status: res.statusCode }));
    });
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.end();
  });
}

/**
 * Resolves with the first collected message (already received or arriving later) that matches.
 * @param {ClientConnection} connection
 * @param {(message: any) => boolean} predicate
 * @param {number} [timeoutMs]
 * @returns {Promise<any>}
 */
export function waitForMessage(connection, predicate, timeoutMs = 5000) {
  const existing = connection.messages.find(predicate);
  if (existing !== undefined) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const onMessage = () => {
      const found = connection.messages.find(predicate);
      if (found === undefined) return;
      cleanup();
      resolve(found);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('WebSocket closed before the expected message arrived'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for a WebSocket message'));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      connection.off('message', onMessage);
      connection.off('close', onClose);
    }
    // Registered after the collector, so the message is in `messages` when this runs.
    connection.on('message', onMessage);
    connection.on('close', onClose);
  });
}
