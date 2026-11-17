import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { signHookReply, UI_COOKIE, generateToken, hasHookSecret, hasUiCookie, loginCookie, parseCookies, safeEqual } from '../../../server/auth.mjs';

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

describe('parseCookies', () => {
  it('parses several cookies with spaces, quotes and encoding', () => {
    assert.deepEqual({ ...parseCookies('a=1; andary_ui=abc-_123 ;b="quoted"; c=caf%C3%A9') }, { a: '1', andary_ui: 'abc-_123', b: 'quoted', c: 'café' });
  });

  it('keeps the first of duplicate names and skips malformed pairs', () => {
    assert.deepEqual({ ...parseCookies('andary_ui=first; junk; =novalue; andary_ui=second; bad=%E0%A4%A') }, { andary_ui: 'first', bad: '%E0%A4%A' });
  });

  it('handles missing headers and is safe with __proto__', () => {
    assert.deepEqual({ ...parseCookies(undefined) }, {});
    const cookies = parseCookies('__proto__=x');
    assert.equal(cookies.__proto__, 'x');
    assert.equal(/** @type {any} */ ({}).x, undefined);
  });
});

describe('request checks', () => {
  const req = (/** @type {Record<string, string>} */ headers) => /** @type {any} */ ({ headers });

  it('builds the login cookie the contract asks for', () => {
    assert.equal(loginCookie('tok'), `${UI_COOKIE}=tok; HttpOnly; SameSite=Strict; Path=/`);
  });

  it('accepts only the right UI cookie and hook secret', () => {
    assert.ok(hasUiCookie(req({ cookie: 'other=1; andary_ui=tok' }), 'tok'));
    assert.ok(!hasUiCookie(req({ cookie: 'andary_ui=nope' }), 'tok'));
    assert.ok(!hasUiCookie(req({}), 'tok'));
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
