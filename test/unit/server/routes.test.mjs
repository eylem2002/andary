import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpError } from '../../../server/http-util.mjs';
import { parseHookBody } from '../../../server/routes.mjs';

const body = (/** @type {unknown} */ value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));

describe('parseHookBody', () => {
  it('accepts the forwarder format', () => {
    assert.deepEqual(parseHookBody(body({ v: 1, ts: 123, event: { hook_event_name: 'Stop' } })), {
      ts: 123,
      source: 'claude',
      event: { hook_event_name: 'Stop' },
    });
    assert.equal(parseHookBody(body({ v: 1, ts: 1, source: 'codex', event: {} })).source, 'codex');
    assert.equal(parseHookBody(body({ v: 1, ts: 1, source: 'other', event: {} })).source, 'claude', 'unknown sources read as Claude Code');
  });

  it('uses the receive time when ts is missing or not a number', () => {
    const before = Date.now();
    const { ts } = parseHookBody(body({ v: 1, ts: 'soon', event: {} }));
    assert.ok(ts >= before);
  });

  it('rejects bodies that are not the forwarder format with 400', () => {
    for (const bad of ['not json', '[]', 'null', { v: 2, event: {} }, { v: 1 }, { v: 1, event: [] }, { v: 1, event: 'x' }]) {
      assert.throws(() => parseHookBody(body(bad)), (error) => error instanceof HttpError && error.status === 400, JSON.stringify(bad));
    }
  });
});
