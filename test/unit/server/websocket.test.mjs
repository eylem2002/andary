import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { after, afterEach, before, describe, it } from 'node:test';
import { acceptKeyFor, acceptUpgrade, rejectUpgrade, validateUpgradeRequest } from '../../../server/websocket.mjs';
import { connectWebSocket, waitForMessage } from '../../../server/ws-client.mjs';
import { CLOSE_CODE, OPCODE, createFrameParser, encodeClosePayload, encodeFrame } from '../../../server/ws-frame.mjs';

/** @type {import('node:http').Server} */
let server;
let port = 0;
/** @type {Array<(connection: import('../../../server/websocket.mjs').WsConnection) => void>} */
const pendingServerSides = [];
const options = { maxMessageBytes: 1024, heartbeatMs: 0 };

before(async () => {
  server = createServer((_req, res) => res.end('plain http'));
  server.on('upgrade', (req, socket, head) => {
    const verdict = validateUpgradeRequest(req);
    if (!verdict.ok) {
      rejectUpgrade(socket, verdict.status, verdict.message, verdict.headers);
      return;
    }
    const heartbeatMs = Number(req.headers['x-heartbeat'] ?? 0);
    const connection = acceptUpgrade(socket, verdict.key, head, { ...options, heartbeatMs });
    connection.on('message', (text) => connection.send(`echo:${text}`));
    pendingServerSides.shift()?.(connection);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

/** @returns {Promise<import('../../../server/websocket.mjs').WsConnection>} */
function nextServerSide() {
  return new Promise((resolve) => pendingServerSides.push(resolve));
}

/** Raw sockets opened by a test; destroyed after each one, so a failed assertion cannot hang the run. */
const openSockets = new Set();
afterEach(() => {
  for (const socket of openSockets) socket.destroy();
  openSockets.clear();
});

/** @param {import('node:net').Socket} socket */
function track(socket) {
  openSockets.add(socket);
  socket.on('error', () => {});
  return socket;
}

/**
 * Waits for the first frame of a type, instead of sleeping and hoping it has arrived.
 * @param {{ frames: () => Array<any> }} raw @param {string} type @param {number} [timeoutMs]
 */
async function frameOf(raw, type, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const frame = raw.frames().find((f) => f.type === type);
    if (frame) return frame;
    if (Date.now() > deadline) throw new Error(`no ${type} frame within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * Opens a raw TCP connection that has completed the handshake, to send hand-made frames.
 * @returns {Promise<{ socket: import('node:net').Socket, frames: () => Array<any>, closed: Promise<void> }>}
 */
async function rawClient() {
  const socket = track(connect(port, '127.0.0.1'));
  await once(socket, 'connect');
  const key = Buffer.alloc(16, 7).toString('base64');
  socket.write(
    `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`,
  );
  const parser = createFrameParser({ maxMessageBytes: 1 << 20, expectMasked: false });
  /** @type {any[]} */
  const received = [];
  let handshake = Buffer.alloc(0);
  let upgraded = false;
  /** @type {(value?: unknown) => void} */
  let onUpgraded = () => {};
  const upgradedNow = new Promise((resolve) => (onUpgraded = resolve));
  socket.on('data', (chunk) => {
    if (upgraded) {
      received.push(...parser.push(chunk));
      return;
    }
    handshake = Buffer.concat([handshake, chunk]);
    const end = handshake.indexOf('\r\n\r\n');
    if (end < 0) return;
    assert.match(handshake.subarray(0, end).toString(), new RegExp(`Sec-WebSocket-Accept: ${acceptKeyFor(key).replace(/[+/]/g, '\\$&')}`));
    upgraded = true;
    const rest = handshake.subarray(end + 4);
    if (rest.length) received.push(...parser.push(rest));
    onUpgraded();
  });
  const closed = once(socket, 'close').then(() => undefined);
  await upgradedNow;
  return { socket, frames: () => received, closed };
}

describe('handshake', () => {
  it('computes the RFC 6455 accept key', () => {
    assert.equal(acceptKeyFor('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });

  it('validates the upgrade headers', () => {
    const base = { upgrade: 'websocket', connection: 'keep-alive, Upgrade', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' };
    const check = (/** @type {object} */ headers, method = 'GET') => validateUpgradeRequest(/** @type {any} */ ({ method, headers: { ...base, ...headers } }));
    assert.deepEqual(check({}), { ok: true, key: 'dGhlIHNhbXBsZSBub25jZQ==' });
    assert.equal(check({}, 'POST').status, 405);
    assert.equal(check({ upgrade: 'h2c' }).status, 400);
    assert.equal(check({ connection: 'keep-alive' }).status, 400);
    assert.equal(check({ 'sec-websocket-version': '8' }).status, 426);
    assert.deepEqual(check({ 'sec-websocket-version': '8' }).headers, { 'Sec-WebSocket-Version': '13' });
    assert.equal(check({ 'sec-websocket-key': 'short' }).status, 400);
  });

  it('refuses a bad handshake with a plain HTTP error', async () => {
    await assert.rejects(
      connectWebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { 'Sec-WebSocket-Version': '12' } }),
      (/** @type {any} */ error) => error.status === 426,
    );
  });
});

describe('WsConnection', () => {
  it('exchanges text messages both ways', async () => {
    const client = await connectWebSocket(`ws://127.0.0.1:${port}/ws`);
    client.send(JSON.stringify({ hello: 'town' }));
    const reply = await waitForMessage(client, (m) => typeof m === 'string' && m.startsWith('echo:'));
    assert.equal(reply, 'echo:{"hello":"town"}');
    client.close();
  });

  it('completes the closing handshake and reports the code on both sides', async () => {
    const serverSide = nextServerSide();
    const client = await connectWebSocket(`ws://127.0.0.1:${port}/ws`);
    const serverConnection = await serverSide;
    const serverClosed = once(serverConnection, 'close');
    const clientClosed = once(client, 'close');
    client.close(CLOSE_CODE.GOING_AWAY, 'tab closed');
    const [[serverEvent], [clientEvent]] = await Promise.all([serverClosed, clientClosed]);
    assert.deepEqual(serverEvent, { code: CLOSE_CODE.GOING_AWAY, reason: 'tab closed' });
    assert.equal(clientEvent.code, CLOSE_CODE.GOING_AWAY);
    assert.equal(client.send('late'), false);
  });

  it('answers pings with pongs carrying the same data', async () => {
    const raw = await rawClient();
    raw.socket.write(encodeFrame(OPCODE.PING, 'are you there', { mask: true }));
    const pong = await frameOf(raw, 'pong');
    assert.equal(pong.data.toString(), 'are you there');
  });

  it('assembles fragmented messages from the client', async () => {
    const raw = await rawClient();
    raw.socket.write(encodeFrame(OPCODE.TEXT, 'frag', { fin: false, mask: true }));
    raw.socket.write(encodeFrame(OPCODE.CONTINUATION, 'mented', { mask: true }));
    assert.deepEqual(await frameOf(raw, 'text'), { type: 'text', data: 'echo:fragmented' });
  });

  it('closes with 1002 when a client sends unmasked frames', async () => {
    const raw = await rawClient();
    raw.socket.write(encodeFrame(OPCODE.TEXT, 'not masked'));
    await raw.closed;
    assert.equal(raw.frames().find((f) => f.type === 'close')?.code, CLOSE_CODE.PROTOCOL_ERROR);
  });

  it('closes with 1009 when a message is over the limit', async () => {
    const raw = await rawClient();
    raw.socket.write(encodeFrame(OPCODE.TEXT, 'x'.repeat(2000), { mask: true }));
    await raw.closed;
    assert.equal(raw.frames().find((f) => f.type === 'close')?.code, CLOSE_CODE.MESSAGE_TOO_BIG);
  });

  it('closes with 1003 on binary messages and 1007 on invalid UTF-8', async () => {
    const binary = await rawClient();
    binary.socket.write(encodeFrame(OPCODE.BINARY, Buffer.from([1, 2]), { mask: true }));
    await binary.closed;
    assert.equal(binary.frames().find((f) => f.type === 'close')?.code, CLOSE_CODE.UNSUPPORTED_DATA);

    const invalid = await rawClient();
    invalid.socket.write(encodeFrame(OPCODE.TEXT, Buffer.from([0xff, 0xfe]), { mask: true }));
    await invalid.closed;
    assert.equal(invalid.frames().find((f) => f.type === 'close')?.code, CLOSE_CODE.INVALID_PAYLOAD);
  });

  it('echoes a client close frame and ends the TCP connection', async () => {
    const raw = await rawClient();
    raw.socket.write(encodeFrame(OPCODE.CLOSE, encodeClosePayload(1000, 'done'), { mask: true }));
    await raw.closed;
    assert.deepEqual(raw.frames().find((f) => f.type === 'close'), { type: 'close', code: 1000, reason: '' });
  });

  it('closes the server side when the peer half-closes without a close frame', async () => {
    const serverSide = nextServerSide();
    const raw = await rawClient();
    const connection = await serverSide;
    const closed = once(connection, 'close');
    raw.socket.end();
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('still open 2 s after the peer sent FIN')), 2000).unref());
    await Promise.race([closed, timeout]);
    await raw.closed;
  });

  it('drops a peer that stops answering heartbeats', async () => {
    const serverSide = nextServerSide();
    await rawClientWithHeaders({ 'x-heartbeat': '40' });
    const connection = await serverSide;
    // The raw client never answers pings, so the second heartbeat tick terminates it.
    const [event] = await once(connection, 'close');
    assert.equal(event.code, CLOSE_CODE.ABNORMAL);
  });
});

/**
 * @param {Record<string, string>} headers
 * @returns {Promise<import('node:net').Socket>}
 */
async function rawClientWithHeaders(headers) {
  const socket = track(connect(port, '127.0.0.1'));
  await once(socket, 'connect');
  const extra = Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`).join('');
  socket.write(
    `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${Buffer.alloc(16, 9).toString('base64')}\r\n${extra}\r\n`,
  );
  socket.on('data', () => {});
  return socket;
}
