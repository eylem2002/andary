// Minimal RFC 6455 WebSocket: the server handshake and a connection object shared by the server
// (browsers) and the tiny client used by `andary doctor` and the tests. Text messages only,
// no extensions, no subprotocols.
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { STATUS_CODES } from 'node:http';
import { CLOSE_CODE, OPCODE, WsProtocolError, createFrameParser, encodeClosePayload, encodeFrame } from './ws-frame.mjs';

export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
/** How long to wait for the peer's close frame (or for the TCP close) before cutting the socket. */
const CLOSE_TIMEOUT_MS = 2000;

/**
 * @param {string} key the client's Sec-WebSocket-Key
 * @returns {string} the matching Sec-WebSocket-Accept value
 */
export function acceptKeyFor(key) {
  return createHash('sha1').update(key + WS_GUID).digest('base64');
}

/** @returns {string} a fresh Sec-WebSocket-Key */
export function generateClientKey() {
  return randomBytes(16).toString('base64');
}

/**
 * @typedef {object} UpgradeVerdict
 * @property {boolean} ok
 * @property {string} [key]                       the validated Sec-WebSocket-Key (when ok)
 * @property {number} [status]                    HTTP status for the refusal (when not ok)
 * @property {string} [message]
 * @property {Record<string, string>} [headers]
 */

/**
 * Checks the handshake headers of an upgrade request.
 * @param {import('node:http').IncomingMessage} req
 * @returns {UpgradeVerdict}
 */
export function validateUpgradeRequest(req) {
  const header = (/** @type {string} */ name) => String(req.headers[name] ?? '');
  if (req.method !== 'GET') return { ok: false, status: 405, message: 'WebSocket handshakes use GET' };
  if (header('upgrade').toLowerCase() !== 'websocket') {
    return { ok: false, status: 400, message: 'Expected Upgrade: websocket' };
  }
  const connection = header('connection').toLowerCase().split(',').map((token) => token.trim());
  if (!connection.includes('upgrade')) return { ok: false, status: 400, message: 'Expected Connection: Upgrade' };
  if (header('sec-websocket-version') !== '13') {
    return { ok: false, status: 426, message: 'Unsupported WebSocket version', headers: { 'Sec-WebSocket-Version': '13' } };
  }
  const key = header('sec-websocket-key').trim();
  if (!/^[A-Za-z0-9+/]{22}==$/.test(key)) return { ok: false, status: 400, message: 'Invalid Sec-WebSocket-Key' };
  return { ok: true, key };
}

/**
 * Answers a refused upgrade with a plain HTTP response and closes the socket.
 * @param {import('node:stream').Duplex} socket
 * @param {number} status
 * @param {string} message
 * @param {Record<string, string>} [headers]
 */
export function rejectUpgrade(socket, status, message, headers = {}) {
  if (socket.destroyed) return;
  const body = `${message}\n`;
  const lines = [
    `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? 'Error'}`,
    'Connection: close',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body)}`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
  ];
  socket.end(`${lines.join('\r\n')}\r\n\r\n${body}`);
  setTimeout(() => socket.destroy(), CLOSE_TIMEOUT_MS).unref();
}

/**
 * @typedef {object} ConnectionOptions
 * @property {'server'|'client'} role       servers expect masked frames; clients mask their own
 * @property {number} maxMessageBytes        larger incoming messages close the connection (1009)
 * @property {number} [maxBufferedBytes]     a peer that stops reading is cut off past this backlog
 * @property {number} [heartbeatMs]          ping interval; a peer silent for a whole interval is dropped
 */

/**
 * Completes the server side of the handshake and returns the open connection.
 * @param {import('node:stream').Duplex} socket
 * @param {string} key validated Sec-WebSocket-Key
 * @param {Buffer} head bytes that arrived with the upgrade request
 * @param {Omit<ConnectionOptions, 'role'>} options
 * @returns {WsConnection}
 */
export function acceptUpgrade(socket, key, head, options) {
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKeyFor(key)}\r\n\r\n`,
  );
  const connection = new WsConnection(socket, { ...options, role: 'server' });
  if (head && head.length > 0) connection.receive(head);
  return connection;
}


/**
 * An open WebSocket. Events: 'message' (text: string), 'close' ({ code, reason }), 'pong'.
 */
export class WsConnection extends EventEmitter {
  /**
   * @param {import('node:stream').Duplex} socket
   * @param {ConnectionOptions} options
   */
  constructor(socket, options) {
    super();
    this.socket = socket;
    this.role = options.role;
    this.maxBufferedBytes = options.maxBufferedBytes ?? Infinity;
    /** @type {'open'|'closing'|'closed'} */
    this.state = 'open';
    this.parser = createFrameParser({ maxMessageBytes: options.maxMessageBytes, expectMasked: options.role === 'server' });
    /** Set whenever the peer sends anything; the heartbeat clears it and drops a silent peer. */
    this.alive = true;
    /** @type {NodeJS.Timeout|null} */
    this.heartbeat = null;
    /** @type {NodeJS.Timeout|null} */
    this.closeTimer = null;
    /** @type {number|undefined} the code from the closing handshake, reported in the 'close' event */
    this.closeCode = undefined;
    this.closeReason = '';

    if ('setNoDelay' in socket && typeof socket.setNoDelay === 'function') socket.setNoDelay(true);
    socket.on('data', (chunk) => this.receive(chunk));
    socket.on('error', () => this.finish());
    socket.on('close', () => this.finish());
    if (options.heartbeatMs) this.startHeartbeat(options.heartbeatMs);
  }

  get isOpen() {
    return this.state === 'open';
  }

  get isClosed() {
    return this.state === 'closed';
  }

  /**
   * Sends a text message. Returns false if the connection is not open (the message is dropped).
   * @param {string} text
   * @returns {boolean}
   */
  send(text) {
    if (this.state !== 'open') return false;
    // A peer that stopped reading is cut off rather than letting its backlog grow without bound.
    // Checked before writing, so one large message (the hello with its history) always goes out.
    if (this.socket.writableLength > this.maxBufferedBytes) {
      this.terminate();
      return false;
    }
    this.writeFrame(OPCODE.TEXT, Buffer.from(text, 'utf8'));
    return true;
  }

  /** @param {Buffer} [data] */
  ping(data = Buffer.alloc(0)) {
    if (this.state === 'open') this.writeFrame(OPCODE.PING, data);
  }

  /**
   * Starts the closing handshake; the socket is cut if the peer does not answer in time.
   * @param {number} [code]
   * @param {string} [reason]
   */
  close(code = CLOSE_CODE.NORMAL, reason = '') {
    if (this.state !== 'open') return;
    this.state = 'closing';
    this.closeCode = code;
    this.closeReason = reason;
    this.writeFrame(OPCODE.CLOSE, encodeClosePayload(code, reason));
    this.closeTimer = setTimeout(() => this.terminate(), CLOSE_TIMEOUT_MS);
    this.closeTimer.unref?.();
  }

  /** Drops the connection without a closing handshake. */
  terminate() {
    this.socket.destroy();
    this.finish();
  }

  /**
   * Feeds received bytes through the parser. Public so the bytes that arrived together with the
   * upgrade request can be replayed.
   * @param {Buffer} chunk
   */
  receive(chunk) {
    if (this.state === 'closed') return;
    this.alive = true;
    let messages;
    try {
      messages = this.parser.push(chunk);
    } catch (error) {
      this.failConnection(error instanceof WsProtocolError ? error.code : CLOSE_CODE.PROTOCOL_ERROR, error.message);
      return;
    }
    for (const message of messages) {
      // An earlier message in this chunk may have closed the connection.
      if (this.isClosed) return;
      this.dispatch(message);
    }
  }

  /** @param {import('./ws-frame.mjs').WsMessage} message */
  dispatch(message) {
    switch (message.type) {
      case 'text':
        if (this.state === 'open') this.emit('message', message.data);
        break;
      case 'binary':
        this.failConnection(CLOSE_CODE.UNSUPPORTED_DATA, 'Only text messages are supported');
        break;
      case 'ping':
        if (this.state === 'open') this.writeFrame(OPCODE.PONG, message.data);
        break;
      case 'pong':
        this.emit('pong');
        break;
      default:
        this.handleCloseFrame(message.code, message.reason);
    }
  }

  /**
   * The peer sent a close frame: echo it (unless we started the handshake), then end TCP.
   * @param {number} code
   * @param {string} reason
   */
  handleCloseFrame(code, reason) {
    if (this.state === 'open') {
      this.closeCode = code;
      this.closeReason = reason;
      this.writeFrame(OPCODE.CLOSE, encodeClosePayload(code === CLOSE_CODE.NO_STATUS ? undefined : code));
    }
    this.endSocket();
    this.finish();
  }

  /**
   * Protocol violation: send the error code, then drop the connection.
   * @param {number} code
   * @param {string} reason
   */
  failConnection(code, reason) {
    if (this.state === 'open') this.writeFrame(OPCODE.CLOSE, encodeClosePayload(code, reason));
    this.closeCode = code;
    this.closeReason = reason;
    this.endSocket();
    this.finish();
  }

  /** Half-closes TCP after queued frames are flushed, with a hard stop if the peer lingers. */
  endSocket() {
    this.socket.end();
    const timer = setTimeout(() => this.socket.destroy(), CLOSE_TIMEOUT_MS);
    timer.unref?.();
  }

  /**
   * @param {number} opcode
   * @param {Buffer} payload
   */
  writeFrame(opcode, payload) {
    if (this.socket.destroyed || !this.socket.writable) return;
    this.socket.write(encodeFrame(opcode, payload, { mask: this.role === 'client' }));
  }

  /** @param {number} intervalMs */
  startHeartbeat(intervalMs) {
    this.heartbeat = setInterval(() => {
      if (!this.alive) {
        this.terminate();
        return;
      }
      this.alive = false;
      this.ping();
    }, intervalMs);
    this.heartbeat.unref?.();
  }

  /** Final state change; emits 'close' exactly once. */
  finish() {
    if (this.state === 'closed') return;
    this.state = 'closed';
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.emit('close', { code: this.closeCode ?? CLOSE_CODE.ABNORMAL, reason: this.closeReason });
  }
}
