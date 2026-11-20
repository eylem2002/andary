// The server's socket with a certificate (ADR 0016): HTTPS for the network, plain HTTP for this
// computer only, time limits that work, and a shutdown that ends every connection. Needs openssl
// for a throwaway certificate.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { connect as netConnect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect as tlsConnect } from 'node:tls';
import { after, before, describe, it } from 'node:test';
import { createListener, isLoopbackAddress, isSameMachine } from '../../../server/listener.mjs';

const hasOpenssl = spawnSync('openssl', ['version']).status === 0;

describe('who counts as this computer', () => {
  it('a loopback peer, or one connecting from the address it connected to', () => {
    for (const address of ['127.0.0.1', '127.4.5.6', '::1', '::ffff:127.0.0.1']) assert.ok(isLoopbackAddress(address), address);
    for (const address of ['192.168.1.20', '::ffff:10.0.0.1', '', undefined]) assert.ok(!isLoopbackAddress(address), String(address));
    assert.ok(isSameMachine({ remoteAddress: '192.168.1.20', localAddress: '192.168.1.20' }), 'a local client of --host 192.168.1.20');
    assert.ok(isSameMachine({ remoteAddress: '::ffff:192.168.1.20', localAddress: '192.168.1.20' }));
    assert.ok(!isSameMachine({ remoteAddress: '192.168.1.30', localAddress: '192.168.1.20' }), 'another computer');
    assert.ok(!isSameMachine({ remoteAddress: undefined, localAddress: undefined }));
  });
});

describe('a listener with a certificate', { skip: hasOpenssl ? false : 'needs openssl' }, () => {
  /** @type {string} */
  let dir;
  /** @type {ReturnType<typeof createListener>} */
  let listener;
  /** @type {number} */
  let port;
  /** @type {Buffer} */
  let cert;
  /** Addresses to pretend the next connections come from (a computer on the network). */
  const pretend = { remote: /** @type {string|null} */ (null) };

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'andary-listener-'));
    const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '2',
      '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-subj', '/CN=andary-test', '-addext', 'subjectAltName=IP:127.0.0.1'], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    cert = readFileSync(join(dir, 'cert.pem'));
    listener = createListener((req, res) => res.end(/** @type {any} */ (req.socket).encrypted ? 'tls' : 'plain'), (_req, socket) => socket.destroy(), { cert, key: readFileSync(join(dir, 'key.pem')) });
    listener.front.prependListener('connection', (socket) => {
      if (pretend.remote) Object.defineProperty(socket, 'remoteAddress', { value: pretend.remote });
    });
    await new Promise((resolve) => listener.front.listen(0, '127.0.0.1', () => resolve(undefined)));
    port = /** @type {import('node:net').AddressInfo} */ (listener.front.address()).port;
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  /** @param {string} request @returns {Promise<string>} what came back before the server closed */
  const plainExchange = (request) => new Promise((resolve) => {
    const socket = netConnect(port, '127.0.0.1', () => socket.write(request));
    let text = '';
    socket.on('data', (chunk) => (text += chunk));
    socket.on('close', () => resolve(text));
  });

  it('answers HTTPS, and plain HTTP from this computer', async () => {
    const tls = await new Promise((resolve, reject) => {
      const socket = tlsConnect({ host: '127.0.0.1', port, ca: cert, servername: '' }, () => socket.write('GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
      let text = '';
      socket.on('data', (chunk) => (text += chunk));
      socket.on('close', () => resolve(text));
      socket.on('error', reject);
    });
    assert.match(String(tls), /\r\n\r\ntls$/);
    assert.match(await plainExchange('GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'), /\r\n\r\nplain$/);
  });

  it('refuses plain HTTP from another computer, and closes the connection itself', async () => {
    pretend.remote = '192.0.2.9';
    try {
      const started = Date.now();
      // The client never closes its side: the server must.
      const text = await plainExchange('GET / HTTP/1.1\r\nHost: x\r\n\r\n');
      assert.match(text, /^HTTP\/1\.1 400 [\s\S]*only answers over https/);
      assert.ok(Date.now() - started < 4000, `closed after ${Date.now() - started} ms`);
    } finally {
      pretend.remote = null;
    }
  });

  it('stops promptly even with half-open, silent and stalled connections', async () => {
    const stuck = [
      netConnect(port, '127.0.0.1', function () { this.write(Buffer.from([0x16])); }), // a handshake that never goes on
      netConnect(port, '127.0.0.1'), // silent
      netConnect(port, '127.0.0.1', function () { this.write('GET / HTTP/1.1\r\nHost: x\r\n'); }), // headers never end
      tlsConnect({ host: '127.0.0.1', port, ca: cert, servername: '' }, function () { this.write('GET / HTTP/1.1\r\nHost: x\r\n'); }),
    ];
    for (const socket of stuck) socket.on('error', () => {});
    await new Promise((resolve) => setTimeout(resolve, 300));
    const started = Date.now();
    const closed = new Promise((resolve) => listener.front.close(() => resolve(undefined)));
    listener.closeIdle();
    listener.closeAll();
    await closed;
    assert.ok(Date.now() - started < 1500, `stopping took ${Date.now() - started} ms`);
    await Promise.all(stuck.map((socket) => (socket.destroyed ? null : new Promise((resolve) => socket.on('close', resolve)))));
  });
});
