// HTTPS for other computers (ADR 0016): with --tls-cert/--tls-key one port speaks TLS to the
// network and plain HTTP to this computer only. Needs openssl to make a throwaway certificate.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { lanAddresses } from '../../server/team.mjs';
import { connectWebSocket, waitForMessage } from '../../server/ws-client.mjs';
import { startTown } from './helpers.mjs';

const lan = lanAddresses()[0] ?? null;
const hasOpenssl = spawnSync('openssl', ['version']).status === 0;

/** @type {string} */
let dir;
/** @type {Buffer} */
let cert;
/** @type {Awaited<ReturnType<typeof startTown>>} */
let town;

/**
 * @param {'http'|'https'} scheme
 * @param {string} host
 * @param {number} port
 * @param {string} path
 * @param {Record<string, string>} [headers]
 * @returns {Promise<{ status: number, text: string, headers: import('node:http').IncomingHttpHeaders }>}
 */
function get(scheme, host, port, path, headers = {}) {
  const request = scheme === 'https' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request({ host, port, path, headers: { host: `${host}:${port}`, ...headers }, ...(scheme === 'https' ? { ca: cert, servername: '' } : {}) }, (res) => {
      let text = '';
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('HTTPS for other computers', { skip: !hasOpenssl || !lan ? 'needs openssl and a network address' : false }, () => {
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'andary-tls-'));
    const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '2',
      '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-subj', '/CN=andary-test', '-addext', `subjectAltName=IP:${lan},IP:127.0.0.1`], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    cert = readFileSync(join(dir, 'cert.pem'));
    town = await startTown({ args: ['--team', '--tls-cert', join(dir, 'cert.pem'), '--tls-key', join(dir, 'key.pem')] });
  });
  after(async () => {
    await town?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers the network over HTTPS, with the certificate', async () => {
    const hello = await get('https', /** @type {string} */ (lan), town.port, '/api/hello');
    assert.equal(hello.status, 200);
    assert.equal(JSON.parse(hello.text).app, 'andary');
  });

  it('signs a browser in over wss:// with an https:// Origin', async () => {
    const origin = `https://${lan}:${town.port}`;
    const socket = await connectWebSocket(`wss://${lan}:${town.port}/ws`, { ca: cert, headers: { Origin: origin, 'Sec-WebSocket-Protocol': `andary, andary.token.${town.uiToken}` } });
    assert.equal(socket.protocol, 'andary');
    await waitForMessage(socket, (m) => m?.t === 'hello');
    socket.close();
  });

  // Refusing plain HTTP from another computer is tested in test/unit/server/listener.test.mjs,
  // where a connection can pretend to come from elsewhere.

  it('keeps plain HTTP on this computer for the forwarder, the CLI and a local browser', async () => {
    const local = await get('http', '127.0.0.1', town.port, '/api/hello');
    assert.equal(local.status, 200);
    const result = await town.sendHook({ session_id: 'tls', cwd: '/w', hook_event_name: 'Stop' });
    assert.deepEqual(result, { code: 0, stdout: '', stderr: '' });
    await town.waitForOutput(/Receiving hook events/, 5000);
  });

  it('with --host <network address>, this computer still reaches it over plain HTTP at that address', async () => {
    const bound = await startTown({ args: ['--host', /** @type {string} */ (lan), '--tls-cert', join(dir, 'cert.pem'), '--tls-key', join(dir, 'key.pem')] });
    try {
      assert.equal((await get('http', /** @type {string} */ (lan), bound.port, '/api/hello')).status, 200);
      assert.equal((await get('https', /** @type {string} */ (lan), bound.port, '/api/hello')).status, 200);
      const result = await bound.sendHook({ session_id: 'tls-host', cwd: '/w', hook_event_name: 'Stop' });
      assert.deepEqual(result, { code: 0, stdout: '', stderr: '' });
      await bound.waitForOutput(/Receiving hook events/, 5000);
      assert.match(bound.output(), new RegExp(`From another computer: https://${lan.replaceAll('.', '\\.')}:${bound.port}/\\?token=`));
    } finally {
      await bound.stop();
    }
  });

  it('prints view links and invites with https and records it for the CLI', () => {
    assert.match(town.output(), /Anyone else may watch \(view only\) at https:\/\//);
    const state = JSON.parse(readFileSync(join(town.home, 'server.json'), 'utf8'));
    assert.equal(state.tls, true);
  });
});
