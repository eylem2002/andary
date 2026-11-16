// Serves the UI from public/. The files hold no user data, so no login is needed, but the handler
// must never reach outside public/ (traversal, symlinks) or reveal dotfiles.
import { promises as fsp } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { gzip as gzipCallback } from 'node:zlib';

const gzip = promisify(gzipCallback);

/** @type {Readonly<Record<string, string>>} */
export const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
});

/**
 * @param {string} filePath
 * @returns {string}
 */
export function contentTypeFor(filePath) {
  const ext = extname(filePath).toLowerCase();
  // Extension-less files in public/ are licence texts (vendor/three/LICENSE).
  if (ext === '') return 'text/plain; charset=utf-8';
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Text formats shrink well; images, fonts and audio are compressed already.
 * @param {string} contentType
 * @returns {boolean}
 */
export function isCompressible(contentType) {
  return /^(?:text\/|application\/(?:json|manifest\+json|wasm)|image\/svg\+xml|model\/gltf\+json)/.test(contentType);
}

/**
 * Maps a URL path to a file inside `root`, or null if it must not be served: undecodable
 * escapes, NUL bytes, backslashes, any segment starting with "." (dotfiles, "." and ".."), or a
 * result outside root. Pure: does not touch the file system.
 * @param {string} root absolute path of public/
 * @param {string} urlPath the URL's pathname, still percent-encoded
 * @returns {string|null}
 */
export function resolveStaticPath(root, urlPath) {
  if (typeof urlPath !== 'string' || !urlPath.startsWith('/')) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment.startsWith('.'))) return null;
  if (decoded.endsWith('/')) segments.push('index.html');
  const base = resolve(root);
  const target = resolve(base, ...segments);
  return target.startsWith(base + sep) ? target : null;
}

/**
 * @param {string|undefined} header
 * @returns {boolean}
 */
export function acceptsGzip(header) {
  if (typeof header !== 'string') return false;
  return header.split(',').some((part) => {
    const [coding, ...params] = part.trim().toLowerCase().split(';');
    if (coding !== 'gzip' && coding !== '*') return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return q === undefined || Number(q.slice(2)) > 0;
  });
}

/**
 * Weak comparison of an If-None-Match header against our ETag.
 * @param {string|undefined} header
 * @param {string} etag
 * @returns {boolean}
 */
export function etagMatches(header, etag) {
  if (typeof header !== 'string') return false;
  const bare = (/** @type {string} */ tag) => tag.trim().replace(/^W\//, '');
  return header.split(',').some((tag) => tag.trim() === '*' || bare(tag) === bare(etag));
}

/**
 * @typedef {object} StaticOptions
 * @property {string} root  absolute path of the folder to serve
 * @property {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void} notFound
 */

/**
 * @param {StaticOptions} options
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, pathname: string) => Promise<void>}
 */
export function createStaticHandler({ root, notFound }) {
  const base = resolve(root);
  /** @type {Map<string, { key: string, body: Buffer }>} gzip results, keyed by path; key = size + mtime */
  const gzipCache = new Map();
  /** @type {Promise<string>|null} */
  let realRoot = null;

  async function locate(pathname) {
    const candidate = resolveStaticPath(base, pathname);
    if (!candidate) return null;
    realRoot ??= fsp.realpath(base);
    try {
      // realpath defeats symlinks inside public/ that point outside it.
      const real = await fsp.realpath(candidate);
      if (!real.startsWith((await realRoot) + sep)) return null;
      const stat = await fsp.stat(real);
      return stat.isFile() ? { path: real, stat } : null;
    } catch {
      return null;
    }
  }

  async function gzipped(path, stat) {
    const key = `${stat.size}:${stat.mtimeMs}`;
    const hit = gzipCache.get(path);
    if (hit && hit.key === key) return hit.body;
    const body = await gzip(await fsp.readFile(path));
    gzipCache.set(path, { key, body });
    return body;
  }

  return async function serveStatic(req, res, pathname) {
    const file = await locate(pathname);
    if (!file) return notFound(req, res);
    const type = contentTypeFor(file.path);
    const compress = isCompressible(type) && file.stat.size > 1024 && acceptsGzip(req.headers['accept-encoding']);
    const etag = `W/"${file.stat.size.toString(16)}-${Math.floor(file.stat.mtimeMs).toString(16)}${compress ? '-gz' : ''}"`;
    res.setHeader('Content-Type', type);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', cacheControlFor(pathname, type));
    if (isCompressible(type)) res.setHeader('Vary', 'Accept-Encoding');
    if (etagMatches(req.headers['if-none-match'], etag)) {
      res.writeHead(304);
      res.end();
      return;
    }
    const body = compress ? await gzipped(file.path, file.stat) : await fsp.readFile(file.path);
    if (compress) res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', body.length);
    res.writeHead(200);
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}

/**
 * HTML and app modules revalidate every time (cheap 304s on localhost, never stale after an
 * edit); generated vendor files change only when three.js or the fonts are re-vendored.
 * @param {string} pathname
 * @param {string} contentType
 * @returns {string}
 */
function cacheControlFor(pathname, contentType) {
  if (contentType.startsWith('text/html')) return 'no-cache';
  return pathname.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-cache';
}
