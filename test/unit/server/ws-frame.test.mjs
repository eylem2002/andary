import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_FRAGMENTS,
  CLOSE_CODE,
  OPCODE,
  WsProtocolError,
  applyMask,
  createFrameParser,
  decodeClosePayload,
  encodeClosePayload,
  encodeFrame,
  isValidCloseCode,
} from '../../../server/ws-frame.mjs';

const MASK = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
const serverParser = (maxMessageBytes = 1 << 20) => createFrameParser({ maxMessageBytes, expectMasked: true });
const clientParser = (maxMessageBytes = 1 << 20) => createFrameParser({ maxMessageBytes, expectMasked: false });

/** @param {() => unknown} fn @param {number} code */
function assertProtocolError(fn, code) {
  assert.throws(fn, (error) => error instanceof WsProtocolError && error.code === code);
}

describe('encodeFrame', () => {
  it('encodes the RFC 6455 example "Hello" unmasked and masked', () => {
    assert.deepEqual(encodeFrame(OPCODE.TEXT, 'Hello'), Buffer.from([0x81, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f]));
    assert.deepEqual(
      encodeFrame(OPCODE.TEXT, 'Hello', { maskKey: MASK }),
      Buffer.from([0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58]),
    );
  });

  it('uses 7-bit, 16-bit and 64-bit lengths at the right boundaries', () => {
    const header = (/** @type {number} */ length) => encodeFrame(OPCODE.BINARY, Buffer.alloc(length)).subarray(0, 10);
    assert.equal(header(0)[1], 0);
    assert.equal(header(125)[1], 125);
    assert.equal(header(126)[1], 126);
    assert.equal(header(126).readUInt16BE(2), 126);
    assert.equal(header(65535)[1], 126);
    assert.equal(header(65535).readUInt16BE(2), 65535);
    assert.equal(header(65536)[1], 127);
    assert.equal(header(65536).readUInt32BE(2), 0);
    assert.equal(header(65536).readUInt32BE(6), 65536);
  });

  it('sets FIN only on final frames and generates a mask key when asked', () => {
    assert.equal(encodeFrame(OPCODE.TEXT, 'a', { fin: false })[0], 0x01);
    const masked = encodeFrame(OPCODE.TEXT, 'abc', { mask: true });
    assert.equal(masked[1] & 0x80, 0x80);
    assert.equal(masked.length, 2 + 4 + 3);
  });

  it('masking is its own inverse', () => {
    const data = Buffer.from('round trip ✓');
    assert.deepEqual(applyMask(applyMask(data, MASK), MASK), data);
  });
});

describe('createFrameParser', () => {
  it('round-trips text of every length class, masked from a client', () => {
    for (const length of [0, 1, 125, 126, 65535, 65536, 70000]) {
      const text = 'x'.repeat(length);
      const parser = serverParser();
      assert.deepEqual(parser.push(encodeFrame(OPCODE.TEXT, text, { mask: true })), [{ type: 'text', data: text }]);
    }
  });

  it('parses unmasked server frames on the client side', () => {
    assert.deepEqual(clientParser().push(encodeFrame(OPCODE.TEXT, 'hi')), [{ type: 'text', data: 'hi' }]);
  });

  it('handles frames split across chunks, one byte at a time', () => {
    const parser = serverParser();
    const bytes = encodeFrame(OPCODE.TEXT, 'é'.repeat(200), { mask: true });
    const messages = [];
    for (const byte of bytes) messages.push(...parser.push(Buffer.from([byte])));
    assert.deepEqual(messages, [{ type: 'text', data: 'é'.repeat(200) }]);
  });

  it('returns several messages from one chunk', () => {
    const chunk = Buffer.concat([encodeFrame(OPCODE.TEXT, 'one', { mask: true }), encodeFrame(OPCODE.TEXT, 'two', { mask: true })]);
    assert.deepEqual(
      serverParser().push(chunk).map((m) => m.type === 'text' && m.data),
      ['one', 'two'],
    );
  });

  it('reassembles fragmented messages, with control frames in between', () => {
    const parser = serverParser();
    const frames = [
      encodeFrame(OPCODE.TEXT, 'Hel', { fin: false, mask: true }),
      encodeFrame(OPCODE.PING, 'ping!', { mask: true }),
      encodeFrame(OPCODE.CONTINUATION, 'lo, ', { fin: false, mask: true }),
      encodeFrame(OPCODE.CONTINUATION, 'world', { mask: true }),
    ];
    const messages = frames.flatMap((frame) => parser.push(frame));
    assert.equal(messages.length, 2);
    assert.equal(messages[0].type, 'ping');
    assert.deepEqual(messages[1], { type: 'text', data: 'Hello, world' });
  });

  it('validates UTF-8 only once the fragmented message is complete', () => {
    const euro = Buffer.from('€');
    const parser = serverParser();
    assert.deepEqual(parser.push(encodeFrame(OPCODE.TEXT, euro.subarray(0, 1), { fin: false, mask: true })), []);
    assert.deepEqual(parser.push(encodeFrame(OPCODE.CONTINUATION, euro.subarray(1), { mask: true })), [{ type: 'text', data: '€' }]);
  });

  it('reports binary messages as binary', () => {
    const [message] = serverParser().push(encodeFrame(OPCODE.BINARY, Buffer.from([1, 2, 3]), { mask: true }));
    assert.equal(message.type, 'binary');
  });

  it('parses close frames with code and reason, and without a code', () => {
    const withCode = serverParser().push(encodeFrame(OPCODE.CLOSE, encodeClosePayload(1000, 'bye'), { mask: true }));
    assert.deepEqual(withCode, [{ type: 'close', code: 1000, reason: 'bye' }]);
    const empty = serverParser().push(encodeFrame(OPCODE.CLOSE, Buffer.alloc(0), { mask: true }));
    assert.deepEqual(empty, [{ type: 'close', code: CLOSE_CODE.NO_STATUS, reason: '' }]);
  });

  it('rejects unmasked client frames and masked server frames (1002)', () => {
    assertProtocolError(() => serverParser().push(encodeFrame(OPCODE.TEXT, 'x')), CLOSE_CODE.PROTOCOL_ERROR);
    assertProtocolError(() => clientParser().push(encodeFrame(OPCODE.TEXT, 'x', { mask: true })), CLOSE_CODE.PROTOCOL_ERROR);
  });

  it('rejects messages over the size limit before buffering them (1009)', () => {
    const parser = serverParser(1000);
    // Only the header of a huge frame: the parser must refuse without waiting for the payload.
    const header = encodeFrame(OPCODE.TEXT, Buffer.alloc(70000), { mask: true }).subarray(0, 14);
    assertProtocolError(() => parser.push(header), CLOSE_CODE.MESSAGE_TOO_BIG);
  });

  it('counts every fragment towards the size limit', () => {
    const parser = serverParser(10);
    parser.push(encodeFrame(OPCODE.TEXT, '123456', { fin: false, mask: true }));
    assertProtocolError(() => parser.push(encodeFrame(OPCODE.CONTINUATION, '7890a', { mask: true })), CLOSE_CODE.MESSAGE_TOO_BIG);
  });

  it('rejects a message split into too many fragments, even empty ones (1009)', () => {
    const parser = serverParser(1000);
    parser.push(encodeFrame(OPCODE.TEXT, 'a', { fin: false, mask: true }));
    const empty = encodeFrame(OPCODE.CONTINUATION, '', { fin: false, mask: true });
    for (let i = 1; i < MAX_FRAGMENTS; i += 1) parser.push(empty);
    assertProtocolError(() => parser.push(empty), CLOSE_CODE.MESSAGE_TOO_BIG);
  });

  it('rejects invalid UTF-8 in text messages and close reasons (1007)', () => {
    const bad = Buffer.from([0xc3, 0x28]);
    assertProtocolError(() => serverParser().push(encodeFrame(OPCODE.TEXT, bad, { mask: true })), CLOSE_CODE.INVALID_PAYLOAD);
    const closeBad = Buffer.concat([Buffer.from([0x03, 0xe8]), bad]);
    assertProtocolError(() => serverParser().push(encodeFrame(OPCODE.CLOSE, closeBad, { mask: true })), CLOSE_CODE.INVALID_PAYLOAD);
  });

  it('rejects reserved bits, unknown opcodes and bad control frames (1002)', () => {
    const cases = [
      encodeFrame(OPCODE.TEXT, 'x', { mask: true, rsv: 4 }),
      encodeFrame(0x3, 'x', { mask: true }),
      encodeFrame(0xb, 'x', { mask: true }),
      encodeFrame(OPCODE.PING, 'x', { fin: false, mask: true }),
      encodeFrame(OPCODE.PING, Buffer.alloc(126), { mask: true }),
      // A close payload of one byte, and the reserved code 1005 sent on the wire.
      encodeFrame(OPCODE.CLOSE, Buffer.from([0x03]), { mask: true }),
      encodeFrame(OPCODE.CLOSE, Buffer.from([0x03, 0xed]), { mask: true }),
    ];
    for (const frame of cases) assertProtocolError(() => serverParser().push(frame), CLOSE_CODE.PROTOCOL_ERROR);
  });

  it('rejects continuation frames without a message and new messages inside a fragmented one', () => {
    assertProtocolError(() => serverParser().push(encodeFrame(OPCODE.CONTINUATION, 'x', { mask: true })), CLOSE_CODE.PROTOCOL_ERROR);
    const parser = serverParser();
    parser.push(encodeFrame(OPCODE.TEXT, 'a', { fin: false, mask: true }));
    assertProtocolError(() => parser.push(encodeFrame(OPCODE.TEXT, 'b', { mask: true })), CLOSE_CODE.PROTOCOL_ERROR);
  });

  it('rejects 64-bit lengths with the most significant bit set', () => {
    const frame = Buffer.alloc(14);
    frame[0] = 0x81;
    frame[1] = 0x80 | 127;
    frame.writeUInt32BE(0x80000000, 2);
    assertProtocolError(() => serverParser().push(frame), CLOSE_CODE.PROTOCOL_ERROR);
  });
});

describe('close payloads', () => {
  it('accepts application and registered codes, refuses reserved ones', () => {
    for (const code of [1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 3000, 4999]) assert.ok(isValidCloseCode(code), String(code));
    for (const code of [0, 999, 1004, 1005, 1006, 1015, 1016, 2999, 5000]) assert.ok(!isValidCloseCode(code), String(code));
  });

  it('round-trips code and reason, and keeps reasons inside the 125-byte limit', () => {
    assert.deepEqual(decodeClosePayload(encodeClosePayload(1001, 'going away')), { code: 1001, reason: 'going away' });
    assert.ok(encodeClosePayload(1000, 'x'.repeat(500)).length <= 125);
    assert.equal(encodeClosePayload(undefined).length, 0);
  });
});
