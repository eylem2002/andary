// RFC 6455 framing: encoding frames and an incremental parser that turns a byte stream into
// complete messages. Kept free of sockets and timers so every rule can be unit-tested directly.
import { randomBytes } from 'node:crypto';

export const OPCODE = Object.freeze({
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
});

export const CLOSE_CODE = Object.freeze({
  NORMAL: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,
  UNSUPPORTED_DATA: 1003,
  NO_STATUS: 1005,
  ABNORMAL: 1006,
  INVALID_PAYLOAD: 1007,
  POLICY_VIOLATION: 1008,
  MESSAGE_TOO_BIG: 1009,
  INTERNAL_ERROR: 1011,
});

/** @type {Set<number>} */
const KNOWN_OPCODES = new Set(Object.values(OPCODE));
const MAX_CONTROL_PAYLOAD = 125;
/**
 * Fragments per message. Empty continuation frames add nothing to the size limit, so without a
 * count a peer could grow the list of parts forever. Browsers send text messages in one frame.
 */
export const MAX_FRAGMENTS = 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** A violation of the protocol; `code` is the close code to send before dropping the connection. */
export class WsProtocolError extends Error {
  /**
   * @param {string} message
   * @param {number} code
   */
  constructor(message, code = CLOSE_CODE.PROTOCOL_ERROR) {
    super(message);
    this.name = 'WsProtocolError';
    this.code = code;
  }
}

/**
 * XORs `data` with the 4-byte mask key into a new buffer (masking and unmasking are the same).
 * @param {Buffer} data
 * @param {Buffer} maskKey
 * @returns {Buffer}
 */
export function applyMask(data, maskKey) {
  const out = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i += 1) out[i] = data[i] ^ maskKey[i & 3];
  return out;
}

/**
 * Encodes one frame. Clients must mask (pass `mask: true` or an explicit `maskKey`); servers must not.
 * @param {number} opcode
 * @param {Buffer|string} payload
 * @param {{ fin?: boolean, mask?: boolean, maskKey?: Buffer, rsv?: number }} [options]
 * @returns {Buffer}
 */
export function encodeFrame(opcode, payload, { fin = true, mask = false, maskKey, rsv = 0 } = {}) {
  const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const key = maskKey ?? (mask ? randomBytes(4) : null);
  const length = data.length;
  const lengthBytes = length < 126 ? 0 : length < 65536 ? 2 : 8;
  const header = Buffer.alloc(2 + lengthBytes + (key ? 4 : 0));
  header[0] = (fin ? 0x80 : 0) | ((rsv & 0x7) << 4) | (opcode & 0x0f);
  if (lengthBytes === 0) {
    header[1] = length;
  } else if (lengthBytes === 2) {
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header[1] = 127;
    header.writeUInt32BE(Math.floor(length / 2 ** 32), 2);
    header.writeUInt32BE(length >>> 0, 6);
  }
  if (!key) return Buffer.concat([header, data]);
  header[1] |= 0x80;
  key.copy(header, 2 + lengthBytes);
  return Buffer.concat([header, applyMask(data, key)]);
}

/**
 * Payload of a close frame: 2-byte code + UTF-8 reason (trimmed to fit the 125-byte limit).
 * @param {number} [code]
 * @param {string} [reason]
 * @returns {Buffer}
 */
export function encodeClosePayload(code, reason = '') {
  if (code === undefined || code === CLOSE_CODE.NO_STATUS) return Buffer.alloc(0);
  let text = Buffer.from(reason, 'utf8');
  if (text.length > MAX_CONTROL_PAYLOAD - 2) text = Buffer.from(reason.slice(0, 40), 'utf8');
  const out = Buffer.alloc(2 + text.length);
  out.writeUInt16BE(code, 0);
  text.copy(out, 2);
  return out;
}

/**
 * Codes a peer may legitimately put in a close frame (1004–1006 and 1015 are reserved for
 * local use; 3000–4999 are for libraries and applications).
 * @param {number} code
 * @returns {boolean}
 */
export function isValidCloseCode(code) {
  return (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1014) || (code >= 3000 && code <= 4999);
}

/**
 * @param {Buffer} payload
 * @returns {{ code: number, reason: string }}
 */
export function decodeClosePayload(payload) {
  if (payload.length === 0) return { code: CLOSE_CODE.NO_STATUS, reason: '' };
  if (payload.length === 1) throw new WsProtocolError('Close frame with a 1-byte payload');
  const code = payload.readUInt16BE(0);
  if (!isValidCloseCode(code)) throw new WsProtocolError(`Invalid close code ${code}`);
  return { code, reason: decodeUtf8(payload.subarray(2)) };
}

/**
 * @param {Buffer} data
 * @returns {string}
 */
function decodeUtf8(data) {
  try {
    return utf8.decode(data);
  } catch {
    throw new WsProtocolError('Text is not valid UTF-8', CLOSE_CODE.INVALID_PAYLOAD);
  }
}

/**
 * @typedef {{ type: 'text', data: string }
 *   | { type: 'binary', data: Buffer }
 *   | { type: 'close', code: number, reason: string }
 *   | { type: 'ping', data: Buffer }
 *   | { type: 'pong', data: Buffer }} WsMessage
 */

/**
 * @typedef {object} FrameParser
 * @property {(chunk: Buffer) => WsMessage[]} push  Feeds bytes; returns the messages completed by them.
 *   Throws WsProtocolError on any violation; the connection must then be closed with error.code.
 */

/**
 * @param {{ maxMessageBytes: number, expectMasked: boolean }} options
 *   expectMasked: true on the server (clients must mask), false on the client.
 * @returns {FrameParser}
 */
export function createFrameParser({ maxMessageBytes, expectMasked }) {
  /** @type {Buffer} */
  let buffer = Buffer.alloc(0);
  /** @type {{ opcode: number, parts: Buffer[], size: number } | null} */
  let fragmented = null;

  /** @returns {{ fin: boolean, opcode: number, payload: Buffer } | null} */
  function readFrame() {
    if (buffer.length < 2) return null;
    const header = readHeader(buffer, expectMasked);
    if (!header) return null;
    const { fin, opcode, length, offset, masked } = header;
    const isControl = opcode >= 0x8;
    if (!isControl && (fragmented?.size ?? 0) + length > maxMessageBytes) {
      throw new WsProtocolError('Message too big', CLOSE_CODE.MESSAGE_TOO_BIG);
    }
    const start = offset + (masked ? 4 : 0);
    if (buffer.length < start + length) return null;
    const raw = buffer.subarray(start, start + length);
    const payload = masked ? applyMask(raw, buffer.subarray(offset, offset + 4)) : Buffer.from(raw);
    buffer = buffer.subarray(start + length);
    return { fin, opcode, payload };
  }

  /** @returns {WsMessage|null} */
  function handleFrame({ fin, opcode, payload }) {
    switch (opcode) {
      case OPCODE.TEXT:
      case OPCODE.BINARY:
        if (fragmented) throw new WsProtocolError('New message started inside a fragmented message');
        if (fin) return toMessage(opcode, payload);
        fragmented = { opcode, parts: [payload], size: payload.length };
        return null;
      case OPCODE.CONTINUATION: {
        if (!fragmented) throw new WsProtocolError('Continuation frame without a message to continue');
        if (fragmented.parts.length >= MAX_FRAGMENTS) throw new WsProtocolError('Message split into too many fragments', CLOSE_CODE.MESSAGE_TOO_BIG);
        fragmented.parts.push(payload);
        fragmented.size += payload.length;
        if (!fin) return null;
        const done = toMessage(fragmented.opcode, Buffer.concat(fragmented.parts));
        fragmented = null;
        return done;
      }
      case OPCODE.CLOSE:
        return { type: 'close', ...decodeClosePayload(payload) };
      case OPCODE.PING:
        return { type: 'ping', data: payload };
      default:
        return { type: 'pong', data: payload };
    }
  }

  return {
    push(chunk) {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
      /** @type {WsMessage[]} */
      const messages = [];
      for (let frame = readFrame(); frame; frame = readFrame()) {
        const message = handleFrame(frame);
        if (message) messages.push(message);
      }
      return messages;
    },
  };
}

/**
 * Parses and validates a frame header. Returns null when more bytes are needed.
 * @param {Buffer} buffer
 * @param {boolean} expectMasked
 * @returns {{ fin: boolean, opcode: number, length: number, offset: number, masked: boolean } | null}
 */
function readHeader(buffer, expectMasked) {
  const fin = (buffer[0] & 0x80) !== 0;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  // No extension is ever negotiated, so the RSV bits must be clear.
  if (buffer[0] & 0x70) throw new WsProtocolError('Reserved bits set without an extension');
  if (!KNOWN_OPCODES.has(opcode)) throw new WsProtocolError(`Unknown opcode ${opcode}`);
  if (masked !== expectMasked) {
    throw new WsProtocolError(expectMasked ? 'Client frames must be masked' : 'Server frames must not be masked');
  }
  if (opcode >= 0x8 && (!fin || length > MAX_CONTROL_PAYLOAD)) {
    throw new WsProtocolError('Control frames must be unfragmented and at most 125 bytes');
  }
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const high = buffer.readUInt32BE(2);
    if (high & 0x80000000) throw new WsProtocolError('64-bit length with the top bit set');
    length = high * 2 ** 32 + buffer.readUInt32BE(6);
    offset = 10;
  }
  return { fin, opcode, length, offset, masked };
}

/**
 * @param {number} opcode
 * @param {Buffer} payload
 * @returns {WsMessage}
 */
function toMessage(opcode, payload) {
  return opcode === OPCODE.TEXT ? { type: 'text', data: decodeUtf8(payload) } : { type: 'binary', data: payload };
}
