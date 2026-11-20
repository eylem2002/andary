import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import { createHub, handleUpgrade } from '../../../server/browsers.mjs';
import { allowedHostHeaders } from '../../../server/security.mjs';

describe('handleUpgrade', () => {
  it('never lets an error while greeting a browser escape into the server (it would end the process)', () => {
    const logs = [];
    const ctx = /** @type {any} */ ({
      version: '0.0.0',
      uiToken: 'token',
      settings: { remoteApprovals: false, approvalTimeoutMs: 1000 },
      notifier: { on: false, url: null },
      allowedHosts: allowedHostHeaders(4747),
      hub: createHub(4),
      // A history that cannot be serialised stands in for one too large for a single string.
      history: { list: () => [{ id: 1n }] },
      broker: { list: () => [], heldCount: () => 0 },
      log: (/** @type {string} */ line) => logs.push(line),
      graceTimer: null,
    });
    const req = /** @type {any} */ ({
      method: 'GET',
      url: '/ws',
      headers: {
        host: '127.0.0.1:4747',
        upgrade: 'websocket',
        connection: 'Upgrade',
        'sec-websocket-version': '13',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'sec-websocket-protocol': 'andary, andary.token.token',
      },
    });
    const socket = new PassThrough();
    assert.doesNotThrow(() => handleUpgrade(ctx, req, socket, Buffer.alloc(0)));
    assert.equal(socket.destroyed, true);
    assert.ok(logs.some((line) => /Could not open a browser connection/.test(line)), logs.join('\n'));
  });
});
