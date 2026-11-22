// Small helpers for writing responses and reading bounded request bodies.

/** An error that maps to an HTTP status. */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   */
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
export function sendJson(res, status, body, headers = {}) {
  if (res.headersSent || res.destroyed) return;
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(res.req?.method === 'HEAD' ? undefined : text);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} body
 * @param {Record<string, string>} [headers]
 */
export function sendText(res, status, body, headers = {}) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(res.req?.method === 'HEAD' ? undefined : body);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} html a fixed page: never put request data in it
 */
export function sendHtml(res, status, html) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-cache',
  });
  res.end(res.req?.method === 'HEAD' ? undefined : html);
}

/**
 * Builds a minimal static page. No inline styles or scripts: the CSP forbids them.
 * @param {string} title
 * @param {string[]} paragraphs
 * @returns {string}
 */
function page(title, paragraphs) {
  const body = paragraphs.map((p) => `<p>${p}</p>`).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Andary</title></head>
<body>
<main>
<h1>${title}</h1>
${body}
</main>
</body>
</html>
`;
}

export const NOT_FOUND_PAGE = page('Not found', [
  'There is nothing at this address.',
  '<a href="/">Back to the town</a>',
]);

export const BAD_TOKEN_PAGE = page('This sign-in link is not valid', [
  'Andary makes a new sign-in link every time it starts, so older links stop working.',
  'Open the newest link from the terminal where you ran <code>andary start</code>, ' +
    'or run <code>andary status</code> to print it again.',
]);

/** The owner's sign-in link opened through the tunnel (ADR 0019). */
export const LOCAL_SIGN_IN_PAGE = page('Sign in on your own computer', [
  'This address reaches the town over the internet, where only teammates\' view links work.',
  'Open the sign-in link that <code>andary start</code> printed on the computer that runs it.',
]);

/**
 * Reads a request body of at most `limit` bytes.
 * Rejects with HttpError 413 when larger (checked against Content-Length first, then while
 * streaming), or 400 when the stream fails.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<Buffer>}
 */
export function readBody(req, limit) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    return Promise.reject(new HttpError(413, 'Request body too large'));
  }
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    const onData = (/** @type {Buffer} */ chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.off('data', onData);
        req.resume();
        reject(new HttpError(413, 'Request body too large'));
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => reject(new HttpError(400, 'Request body could not be read')));
  });
}
