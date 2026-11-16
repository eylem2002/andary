// Helpers for the integration suites: raw HTTP (fetch cannot set Host), the hook POST, and a
// browser-like WebSocket client that sends the Cookie and Origin headers the server checks.
import { request } from 'node:http';
import { connectWebSocket, waitForMessage } from '../../server/ws-client.mjs';

export { startTown } from '../../e2e/helpers/town.mjs';
export { waitForMessage };

/**
 * @typedef {{ status: number, headers: import('node:http').IncomingHttpHeaders, raw: Buffer, text: string }} RawResponse
 */

/**
 * @param {number} port
 * @param {{ method?: string, path?: string, headers?: Record<string, string|number>, body?: string|Buffer, agent?: import('node:http').Agent|false }} [options]
 * @returns {Promise<RawResponse>}
 */
export function rawRequest(port, { method = 'GET', path = '/', headers = {}, body, agent = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method, path, agent, headers: { host: `127.0.0.1:${port}`, ...headers } },
      (res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          resolve({ status: res.statusCode ?? 0, headers: res.headers, raw, text: raw.toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * POSTs to /api/hook like the forwarder.
 * @param {{ port: number, secret: string }} town
 * @param {unknown} event
 * @param {{ secret?: string|null, rawBody?: string, agent?: import('node:http').Agent }} [options]
 * @returns {Promise<RawResponse>}
 */
export function postHook(town, event, { secret = town.secret, rawBody, agent } = {}) {
  const body = rawBody ?? JSON.stringify({ v: 1, ts: Date.now(), event });
  /** @type {Record<string, string|number>} */
  const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) };
  if (secret) headers['x-andary-secret'] = secret;
  return rawRequest(town.port, { method: 'POST', path: '/api/hook', headers, body, agent });
}

/**
 * Connects to /ws like a signed-in browser (override cookie/origin to test refusals).
 * @param {{ baseUrl: string, uiToken: string }} town
 * @param {{ cookie?: string|null, origin?: string|null }} [options]
 */
export function connectBrowser(town, { cookie = `andary_ui=${town.uiToken}`, origin = town.baseUrl } = {}) {
  /** @type {Record<string, string>} */
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  return connectWebSocket(`${town.baseUrl.replace(/^http/, 'ws')}/ws`, { headers });
}

/**
 * A hook payload with the common fields (CONTRACTS §4.2).
 * @param {string} name hook_event_name
 * @param {Record<string, unknown>} [extra]
 * @returns {Record<string, any>}
 */
export function hookPayload(name, extra = {}) {
  return {
    session_id: 'session-1',
    transcript_path: '/tmp/transcript.jsonl',
    cwd: '/work/demo-app',
    permission_mode: 'default',
    hook_event_name: name,
    ...extra,
  };
}

/**
 * Closes a client connection and waits until the server has let it go.
 * @param {import('../../server/ws-client.mjs').ClientConnection} connection
 * @returns {Promise<void>}
 */
export async function closeBrowser(connection) {
  if (connection.isClosed) return;
  const closed = new Promise((resolve) => connection.once('close', resolve));
  connection.close();
  await closed;
}
