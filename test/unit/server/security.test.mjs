import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import {
  allowedHostHeaders,
  buildCsp,
  computeImportMapHashes,
  connectHost,
  cspHash,
  extractImportMaps,
  hostWithPort,
  isAllowedHost,
  isAllowedOrigin,
  isLoopbackHost,
  securityHeaders,
} from '../../../server/security.mjs';

const MAP = '{"imports":{"three":"./vendor/three/three.module.js","three/addons/":"./vendor/three/addons/"}}';
const page = (/** @type {string} */ map) => `<!DOCTYPE html><head><script type="importmap">${map}</script><script type="module" src="./js/main.js"></script></head>`;

describe('CSP', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tt-csp-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('hashes exactly the import map text', () => {
    assert.deepEqual(extractImportMaps(page(MAP)), [MAP]);
    assert.equal(cspHash(MAP), `'sha256-${createHash('sha256').update(MAP).digest('base64')}'`);
    assert.deepEqual(extractImportMaps("<script type='importmap' >\n{}\n</script >"), ['\n{}\n']);
    assert.deepEqual(extractImportMaps('<script type="module">{}</script>'), []);
  });

  it('collects one hash per distinct map across every page', () => {
    writeFileSync(join(dir, 'index.html'), page(MAP));
    writeFileSync(join(dir, 'world-lab.html'), page(MAP));
    writeFileSync(join(dir, 'other.html'), page('{"imports":{}}'));
    writeFileSync(join(dir, 'notes.txt'), page('{"ignored":true}'));
    assert.deepEqual(computeImportMapHashes(dir).sort(), [cspHash(MAP), cspHash('{"imports":{}}')].sort());
    assert.deepEqual(computeImportMapHashes(join(dir, 'missing')), []);
  });

  it('whitelists the import map of the real public/index.html', () => {
    const publicDir = fileURLToPath(new URL('../../../public', import.meta.url));
    const [map] = extractImportMaps(readFileSync(join(publicDir, 'index.html'), 'utf8'));
    assert.ok(map, 'public/index.html has an import map');
    assert.ok(computeImportMapHashes(publicDir).includes(cspHash(map)));
  });

  it('builds the policy from CONTRACTS §4.4', () => {
    const csp = buildCsp(["'sha256-abc='"]);
    assert.equal(
      csp,
      "default-src 'self'; script-src 'self' 'sha256-abc='; style-src 'self'; font-src 'self'; " +
        "img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; " +
        "frame-ancestors 'none'; form-action 'none'",
    );
    const headers = securityHeaders(csp);
    assert.equal(headers['X-Frame-Options'], 'DENY');
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(headers['Referrer-Policy'], 'no-referrer');
    assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin');
    assert.equal(headers['Cross-Origin-Resource-Policy'], 'same-origin');
    assert.match(headers['Permissions-Policy'], /camera=\(\).*microphone=\(\).*geolocation=\(\)/);
  });
});

describe('Host and Origin checks', () => {
  const allowed = allowedHostHeaders(4747);

  it('accepts only loopback names on our port', () => {
    for (const host of ['127.0.0.1:4747', 'localhost:4747', 'LOCALHOST:4747', '[::1]:4747']) assert.ok(isAllowedHost(host, allowed), host);
    for (const host of ['evil.example:4747', '127.0.0.1:4748', '127.0.0.1', 'localhost', '0.0.0.0:4747', '', undefined]) {
      assert.ok(!isAllowedHost(host, allowed), String(host));
    }
  });

  it('adds an explicitly bound host but not a wildcard', () => {
    assert.ok(isAllowedHost('192.168.1.5:4747', allowedHostHeaders(4747, '192.168.1.5')));
    assert.ok(!isAllowedHost('192.168.1.5:4747', allowedHostHeaders(4747, '0.0.0.0')));
    assert.ok(isAllowedHost('[fe80::1]:4747', allowedHostHeaders(4747, 'fe80::1')));
  });

  it('accepts the default port without a number', () => {
    assert.ok(isAllowedHost('localhost', allowedHostHeaders(80)));
  });

  it('accepts our own origins and a missing Origin, nothing else', () => {
    assert.ok(isAllowedOrigin(undefined, allowed));
    assert.ok(isAllowedOrigin('http://127.0.0.1:4747', allowed));
    assert.ok(isAllowedOrigin('http://localhost:4747', allowed));
    // Only this server can answer on its own host and port, over HTTPS too (ADR 0016).
    assert.ok(isAllowedOrigin('https://127.0.0.1:4747', allowed));
    for (const origin of ['null', 'http://evil.example', 'https://evil.example', 'http://127.0.0.1:9999', 'ftp://127.0.0.1:4747', 'http://127.0.0.1:4747/path', '']) {
      assert.ok(!isAllowedOrigin(origin, allowed), origin);
    }
  });
});

describe('address helpers', () => {
  it('recognises loopback addresses', () => {
    for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]']) assert.ok(isLoopbackHost(host), host);
    for (const host of ['0.0.0.0', '192.168.1.5', '::', 'example.com']) assert.ok(!isLoopbackHost(host), host);
  });

  it('formats host:port and picks a connectable address', () => {
    assert.equal(hostWithPort('::1', 80), '[::1]:80');
    assert.equal(hostWithPort('[::1]', 80), '[::1]:80');
    assert.equal(hostWithPort('127.0.0.1', 4747), '127.0.0.1:4747');
    assert.equal(connectHost('0.0.0.0'), '127.0.0.1');
    assert.equal(connectHost('::'), '127.0.0.1');
    assert.equal(connectHost('[::1]'), '::1');
    assert.equal(connectHost('192.168.1.5'), '192.168.1.5');
  });
});
