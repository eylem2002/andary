import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allowedHostsFor, browserCredentials, browserRole, generateToken, hasHookSecret, isTunnelled, markTunnelled, offersAndaryProtocol, proveServer, safeEqual, signHookReply } from '../../../server/auth.mjs';

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

  it("treats a request through a Cloudflare tunnel as from the internet, whatever its socket says (ADR 0019)", () => {
    const loopback = { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1' };
    assert.equal(isTunnelled(/** @type {any} */ ({ headers: {}, socket: loopback })), false);
    for (const headers of [{ 'cf-connecting-ip': '203.0.113.9' }, { 'cf-ray': '8f0e-AMS' }, { 'cf-visitor': '{"scheme":"https"}' }, { 'cdn-loop': 'cloudflare; loops=1' }]) {
      assert.equal(isTunnelled(/** @type {any} */ ({ headers, socket: loopback })), true, JSON.stringify(headers));
    }
    const onTunnelPort = req({});
    markTunnelled(onTunnelPort);
    assert.equal(isTunnelled(onTunnelPort), true, 'every request on the tunnel port, Cloudflare headers or not');
    assert.equal(isTunnelled(req({ 'cdn-loop': 'other-cdn' })), false);
  });

  it("never takes the owner's token through the tunnel, but still a viewer's", () => {
    const owner = { 'x-andary-token': 'tok', 'cf-connecting-ip': '203.0.113.9' };
    assert.equal(browserRole(req(owner), 'tok', 'v'), null);
    assert.equal(browserRole(req({ ...owner, 'sec-websocket-protocol': 'andary, andary.token.tok, andary.view.v' }), 'tok', 'v'), 'viewer');
    const marked = req({ 'sec-websocket-protocol': 'andary, andary.token.tok' });
    markTunnelled(marked);
    assert.equal(browserRole(marked, 'tok', 'v'), null, 'even from 127.0.0.1 with no Cloudflare header');
  });

  it("allows a tunnelled request only the tunnel's own Host names", () => {
    const hosts = { allowedHosts: new Set(['127.0.0.1:4747']), tunnelHosts: new Set(['words.trycloudflare.com']) };
    assert.equal(allowedHostsFor(req({}), hosts), hosts.allowedHosts);
    assert.equal(allowedHostsFor(req({ 'cf-ray': 'x' }), hosts), hosts.tunnelHosts);
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

describe('proveServer', () => {
  it('answers the forwarder\'s challenge with a proof no signed reply can stand in for', () => {
    const nonce = 'n0nce-abcdefghijklm';
    assert.equal(proveServer('key', nonce), createHmac('sha256', 'key').update(`andary-proof\n${nonce}`).digest('base64url'));
    assert.notEqual(proveServer('key', nonce), signHookReply('key', nonce, 'andary-proof'));
    for (const bad of [undefined, '', 'short', 'has space in it here', 'x'.repeat(129), 'line\nbreak-abcdefghijk']) assert.equal(proveServer('key', bad), null, String(bad));
  });
});
