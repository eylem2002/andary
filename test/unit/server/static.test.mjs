import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { after, before, describe, it } from 'node:test';
import { acceptsGzip, contentTypeFor, createStaticHandler, etagMatches, isCompressible, resolveStaticPath } from '../../../server/static.mjs';
import { CANNOT_SYMLINK } from './helpers.mjs';

describe('contentTypeFor', () => {
  it('maps the file types the app ships', () => {
    const cases = {
      'index.html': 'text/html; charset=utf-8',
      'js/main.js': 'text/javascript; charset=utf-8',
      'tool.mjs': 'text/javascript; charset=utf-8',
      'css/app.css': 'text/css; charset=utf-8',
      'fonts/overpass.woff2': 'font/woff2',
      'icon.svg': 'image/svg+xml',
      'shot.PNG': 'image/png',
      'data.json': 'application/json; charset=utf-8',
      'vendor/three/LICENSE': 'text/plain; charset=utf-8',
      'archive.tar': 'application/octet-stream',
    };
    for (const [file, type] of Object.entries(cases)) assert.equal(contentTypeFor(file), type, file);
  });

  it('compresses text formats only', () => {
    assert.ok(isCompressible('text/javascript; charset=utf-8'));
    assert.ok(isCompressible('image/svg+xml'));
    assert.ok(isCompressible('application/json; charset=utf-8'));
    assert.ok(!isCompressible('font/woff2'));
    assert.ok(!isCompressible('image/png'));
  });
});

describe('resolveStaticPath', () => {
  const root = resolve('/srv/public');

  it('maps URL paths inside the root', () => {
    assert.equal(resolveStaticPath(root, '/'), join(root, 'index.html'));
    assert.equal(resolveStaticPath(root, '/js/main.js'), join(root, 'js', 'main.js'));
    assert.equal(resolveStaticPath(root, '/vendor/'), join(root, 'vendor', 'index.html'));
    assert.equal(resolveStaticPath(root, '/a%20b.css'), join(root, 'a b.css'));
  });

  it('refuses traversal, dotfiles, backslashes, NUL bytes and bad escapes', () => {
    const attacks = [
      '/../package.json',
      '/%2e%2e/package.json',
      '/js/../../package.json',
      '/js/%2e%2e%2f%2e%2e%2fpackage.json',
      '/..%5cpackage.json',
      '/js\\..\\..\\package.json',
      '/.git/config',
      '/.env',
      '/vendor/.hidden/x.js',
      '/./index.html',
      '/index.html%00.js',
      '/%E0%A4%A',
      'index.html',
      '',
    ];
    for (const attack of attacks) assert.equal(resolveStaticPath(root, attack), null, attack);
  });

  it('always stays strictly inside the root', () => {
    for (const path of ['/a', '/a/b/c.js', '/x%2Fy.js']) {
      const resolved = resolveStaticPath(root, path);
      assert.ok(resolved?.startsWith(root + sep), path);
    }
  });
});

describe('header helpers', () => {
  it('reads Accept-Encoding with q-values', () => {
    assert.ok(acceptsGzip('gzip, deflate, br'));
    assert.ok(acceptsGzip('br;q=1.0, gzip;q=0.5'));
    assert.ok(acceptsGzip('*'));
    assert.ok(!acceptsGzip('gzip;q=0'));
    assert.ok(!acceptsGzip('br'));
    assert.ok(!acceptsGzip(undefined));
  });

  it('compares ETags weakly and understands lists and *', () => {
    assert.ok(etagMatches('W/"a-1"', 'W/"a-1"'));
    assert.ok(etagMatches('"a-1"', 'W/"a-1"'));
    assert.ok(etagMatches('"x", W/"a-1"', 'W/"a-1"'));
    assert.ok(etagMatches('*', 'W/"a-1"'));
    assert.ok(!etagMatches('W/"a-2"', 'W/"a-1"'));
    assert.ok(!etagMatches(undefined, 'W/"a-1"'));
  });
});

describe('createStaticHandler', () => {
  /** @type {string} */
  let dir;
  /** @type {string} */
  let root;
  /** @type {ReturnType<typeof createStaticHandler>} */
  let serve;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'tt-static-'));
    root = join(dir, 'public');
    mkdirSync(join(root, 'js'), { recursive: true });
    mkdirSync(join(root, 'vendor'), { recursive: true });
    writeFileSync(join(root, 'index.html'), '<!DOCTYPE html><title>town</title>');
    writeFileSync(join(root, 'js', 'big.js'), `export const x = '${'y'.repeat(5000)}';\n`);
    writeFileSync(join(root, 'vendor', 'lib.js'), 'export {};\n');
    writeFileSync(join(root, '.env'), 'SECRET=1');
    writeFileSync(join(dir, 'outside.txt'), 'outside');
    if (!CANNOT_SYMLINK) symlinkSync(join(dir, 'outside.txt'), join(root, 'link.txt'));
    serve = createStaticHandler({ root, notFound: (_req, res) => res.writeHead(404).end('nf') });
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  /**
   * @param {string} path
   * @param {Record<string, string>} [headers]
   * @param {string} [method]
   */
  async function get(path, headers = {}, method = 'GET') {
    /** @type {Record<string, any>} */
    const sent = {};
    let status = 0;
    let body = Buffer.alloc(0);
    const res = /** @type {any} */ ({
      setHeader: (name, value) => (sent[name.toLowerCase()] = value),
      writeHead(code) {
        status = code;
        return res;
      },
      end(data) {
        if (data) body = Buffer.from(data);
      },
    });
    await serve(/** @type {any} */ ({ method, headers }), res, path);
    return { status, headers: sent, body };
  }

  it('serves files with type, ETag and cache headers', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'no-cache');
    assert.match(res.headers.etag, /^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    assert.equal(res.body.toString(), '<!DOCTYPE html><title>town</title>');
    assert.equal((await get('/vendor/lib.js')).headers['cache-control'], 'public, max-age=86400');
  });

  it('gzips large text files when the browser accepts it', async () => {
    const res = await get('/js/big.js', { 'accept-encoding': 'gzip' });
    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.equal(res.headers.vary, 'Accept-Encoding');
    assert.match(gunzipSync(res.body).toString(), /^export const x/);
    assert.match(res.headers.etag, /-gz"$/);
    const plain = await get('/js/big.js');
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.headers['content-length'], plain.body.length);
  });

  it('answers 304 when the ETag matches, and HEAD without a body', async () => {
    const first = await get('/js/big.js');
    const again = await get('/js/big.js', { 'if-none-match': first.headers.etag });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
    const head = await get('/js/big.js', {}, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
  });

  it('returns 404 for dotfiles, directories, missing files and symlinks leaving the root', async () => {
    for (const path of ['/.env', '/js', '/missing.js', '/link.txt', '/../outside.txt']) {
      assert.equal((await get(path)).status, 404, path);
    }
  });
});
