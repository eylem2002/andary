import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { HttpError, readBody } from '../../../server/http-util.mjs';

/** A request whose body arrives in `chunks`, with these headers. @param {Buffer[]} chunks @param {Record<string, string>} headers */
const request = (chunks, headers = {}) => Object.assign(Readable.from(chunks), { headers });

test('readBody returns a body within the limit', async () => {
  assert.equal(String(await readBody(/** @type {any} */ (request([Buffer.from('ab'), Buffer.from('cd')])), 4)), 'abcd');
});

test('readBody refuses a declared length over the limit without reading', async () => {
  await assert.rejects(readBody(/** @type {any} */ (request([Buffer.from('x')], { 'content-length': '5' })), 4), (error) => error instanceof HttpError && error.status === 413);
});

test('readBody stops as soon as a streamed body passes the limit', async () => {
  await assert.rejects(readBody(/** @type {any} */ (request([Buffer.from('abc'), Buffer.from('def')])), 4), (error) => error instanceof HttpError && error.status === 413);
});
