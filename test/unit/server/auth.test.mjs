import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { browserCredentials, browserRole, generateToken, hasHookSecret, offersAndaryProtocol, safeEqual, signHookReply } from '../../../server/auth.mjs';

describe('generateToken', () => {
  it('returns 32 random bytes as base64url', () => {
    const token = generateToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(token, 'base64url').length, 32);
    assert.notEqual(generateToken(), token);
  });
});

describe('safeEqual', () => {
  it('compares strings of any length without throwing', () => {
    assert.ok(safeEqual('secret-value', 'secret-value'));
    assert.ok(!safeEqual('secret-valuE', 'secret-value'));
    assert.ok(!safeEqual('short', 'a much longer secret'));
    assert.ok(!safeEqual('', 'secret'));
  });

  it('rejects non-strings and an empty expected value', () => {
    assert.ok(!safeEqual(undefined, 'secret'));
    assert.ok(!safeEqual(['secret'], 'secret'));
    assert.ok(!safeEqual('', ''));
    assert.ok(!safeEqual('x', undefined));
  });
});

describe('request checks', () => {
  const req = (/** @type {Record<string, string>} */ headers) => /** @type {any} */ ({ headers });

  it('reads the sign-in from headers (pages) or subprotocols (WebSockets), never from a cookie', () => {
    assert.deepEqual(browserCredentials(req({ 'x-andary-token': 'tok', 'x-andary-view': 'v' })), { token: 'tok', view: 'v' });
    assert.deepEqual(browserCredentials(req({ 'sec-websocket-protocol': 'andary, andary.token.tok, andary.view.v' })), { token: 'tok', view: 'v' });
    assert.deepEqual(browserCredentials(req({ cookie: 'andary_ui=tok; andary_view=v' })), { token: null, view: null });
    assert.deepEqual(browserCredentials(req({ 'sec-websocket-protocol': 'andary.token.' })), { token: null, view: null });
  });

  it('knows the owner, a viewer, and nobody', () => {
    assert.equal(browserRole(req({ 'x-andary-token': 'tok' }), 'tok', 'v'), 'owner');
    assert.equal(browserRole(req({ 'sec-websocket-protocol': 'andary, andary.view.v' }), 'tok', 'v'), 'viewer');
    assert.equal(browserRole(req({ 'sec-websocket-protocol': 'andary, andary.view.v' }), 'tok', null), null, 'no view role off a team host');
    assert.equal(browserRole(req({ 'x-andary-token': 'nope' }), 'tok', null), null);
    assert.equal(browserRole(req({ cookie: 'andary_ui=tok' }), 'tok', null), null, 'an old cookie no longer signs in');
  });

  it('confirms the andary subprotocol only when it was offered', () => {
    assert.ok(offersAndaryProtocol(req({ 'sec-websocket-protocol': 'andary.token.x,andary' })));
    assert.ok(!offersAndaryProtocol(req({ 'sec-websocket-protocol': 'andary.token.x' })));
    assert.ok(!offersAndaryProtocol(req({})));
  });

  it('accepts only the right hook secret', () => {
    assert.ok(hasHookSecret(req({ 'x-andary-secret': 's3' }), 's3'));
    assert.ok(!hasHookSecret(req({ 'x-andary-secret': 's4' }), 's3'));
    assert.ok(!hasHookSecret(req({}), 's3'));
  });
});

describe('signHookReply', () => {
  it('signs nonce and body with the response key, and needs a usable nonce', () => {
    const signature = signHookReply('key', 'nonce-1', '{"output":null}');
    assert.equal(signature, createHmac('sha256', 'key').update('nonce-1\n{"output":null}').digest('base64url'));
    assert.notEqual(signHookReply('key', 'nonce-2', '{"output":null}'), signature, 'bound to the nonce');
    assert.notEqual(signHookReply('key', 'nonce-1', '{"output":{}}'), signature, 'bound to the body');
    for (const nonce of [undefined, '', 'x'.repeat(129), ['a']]) assert.equal(signHookReply('key', nonce, '{}'), null);
  });
});
