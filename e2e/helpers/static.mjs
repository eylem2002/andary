// Serves public/ the way a static host would — no Andary server, so /api/hello is a 404 and
// the app runs its demo — but with the real server's security headers, so a CSP violation (an
// inline style, an unexpected script) shows up as a console error in the tests.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCsp, computeImportMapHashes, securityHeaders } from '../../server/security.mjs';

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/**
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ baseUrl: string, port: number, stop: () => Promise<void> }>}
 */
export async function startStatic({ root = PUBLIC_DIR } = {}) {
  const headers = securityHeaders(buildCsp(computeImportMapHashes(root)));
  const server = createServer((req, res) => {
    serve(root, req.url ?? '/').then(
      ({ status, type, body }) => {
        res.writeHead(status, { ...headers, 'Content-Type': type, 'Cache-Control': 'no-store' });
        res.end(body);
      },
      () => {
        res.writeHead(500, headers);
        res.end();
      },
    );
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    stop: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

/**
 * @param {string} root
 * @param {string} url
 */
async function serve(root, url) {
  const notFound = { status: 404, type: 'text/plain; charset=utf-8', body: 'Not found' };
  const pathname = decodeURIComponent(new URL(url, 'http://static').pathname);
  const file = resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
  // Only files inside public/, and no dotfiles.
  if (!file.startsWith(root + sep) || file.split(sep).some((part) => part.startsWith('.'))) return notFound;
  try {
    if (!(await stat(file)).isFile()) return notFound;
    return { status: 200, type: TYPES[extname(file)] ?? 'application/octet-stream', body: await readFile(file) };
  } catch {
    return notFound;
  }
}

/**
 * Collects console errors and uncaught page errors, for "no console errors" assertions.
 * @param {import('@playwright/test').Page} page
 * @param {{ ignore?: RegExp[] }} [options]  messages that are expected in this test
 * @returns {string[]} filled as the page runs
 */
export function watchConsole(page, { ignore = [] } = {}) {
  /** @type {string[]} */
  const problems = [];
  const keep = (/** @type {string} */ text) => !ignore.some((pattern) => pattern.test(text));
  page.on('console', (message) => {
    if (message.type() === 'error' && keep(message.text())) problems.push(message.text());
  });
  page.on('pageerror', (error) => {
    if (keep(error.message)) problems.push(`pageerror: ${error.message}`);
  });
  return problems;
}
