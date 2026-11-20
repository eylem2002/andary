// Every hook payload passes through here before it is broadcast, kept in history or recorded.
// Payloads come from sessions that read untrusted repositories and contain prompts, commands and
// file contents, so the server trims them to a size the UI can render and masks anything that
// looks like a credential. Redaction runs before truncation so a key that straddles the cut is
// still caught.

export const REDACTED = '[redacted]';
export const MAX_STRING_CHARS = 2000;
export const MAX_ARRAY_ITEMS = 50;
export const MAX_DEPTH = 8;
/** Object keys are data too: a single key can be a megabyte long, and objects can have any width. */
export const MAX_OBJECT_KEYS = 100;
export const MAX_KEY_CHARS = 200;
/** Stands in for the keys dropped past MAX_OBJECT_KEYS; its value says how many. */
export const MORE_KEYS = '…';
/** Stands in for containers nested deeper than MAX_DEPTH. */
export const DEPTH_PLACEHOLDER = '[nested too deep]';

/**
 * Patterns for credentials that are recognisable on their own (by prefix or shape).
 * Each entry is applied with String.prototype.replace, so `replace` may use $1-style groups.
 * Hook payloads can hold a megabyte of attacker-chosen text (a file Claude read), so every
 * variable-length part that the engine may have to backtrack over is bounded: unbounded runs
 * would make some inputs take quadratic time and stall the server.
 * @type {ReadonlyArray<{ name: string, pattern: RegExp, replace: string }>}
 */
export const SECRET_PATTERNS = Object.freeze([
  {
    // PEM private keys; also when the END line was cut off by an earlier truncation.
    name: 'private-key',
    pattern: /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----|$)/g,
    replace: REDACTED,
  },
  { name: 'sk-key', pattern: /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{15,}/g, replace: REDACTED },
  { name: 'stripe-key', pattern: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g, replace: REDACTED },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, replace: REDACTED },
  { name: 'github-pat', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, replace: REDACTED },
  { name: 'slack-token', pattern: /\bxox[a-z]-[A-Za-z0-9-]{10,}/g, replace: REDACTED },
  { name: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: REDACTED },
  { name: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}/g, replace: REDACTED },
  { name: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g, replace: REDACTED },
  {
    name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    replace: REDACTED,
  },
  { name: 'bearer', pattern: /\b(Bearer)[ \t]{1,10}[A-Za-z0-9._~+/=-]{8,}/gi, replace: `$1 ${REDACTED}` },
  {
    name: 'basic-auth',
    pattern: /\b(Authorization:[ \t]{0,10}Basic)[ \t]{1,10}[A-Za-z0-9+/=]{8,}/gi,
    replace: `$1 ${REDACTED}`,
  },
  {
    // https://user:secret@host — passwords and tokens embedded in URLs (git remotes, curl).
    name: 'url-credentials',
    pattern: /\b([a-z][a-z0-9+.-]{0,20}:\/\/[^\s:/?#@]{1,100}:)[^\s@/?#]{1,200}@/gi,
    replace: `$1${REDACTED}@`,
  },
  {
    // NAME=value where NAME mentions a key, secret, token or password: env vars, flags, query strings.
    name: 'named-assignment',
    pattern:
      /\b([A-Za-z0-9_.-]{0,40}?(?:key|secret|token|password|passwd)[A-Za-z0-9_.-]{0,40})=(?!=)("[^"\n]{0,500}"|'[^'\n]{0,500}'|[^\s"'&;|,]+)/gi,
    replace: `$1=${REDACTED}`,
  },
  {
    // "apiKey": "value" inside JSON text, e.g. a config file being written.
    name: 'json-field',
    pattern: /("[^"\n]{0,60}(?:key|secret|token|password|passwd)[^"\n]{0,60}"\s*:\s*)"(?:[^"\\\n]|\\.){0,4096}"/gi,
    replace: `$1"${REDACTED}"`,
  },
]);

/** Object keys whose string values are credentials whatever they look like. */
const SECRET_KEY = /(?:secret|token|password|passwd|api[-_]?key|private[-_]?key|access[-_]?key|authorization|credential|cookie)/i;

/**
 * Masks credentials inside a string.
 * @param {string} text
 * @returns {string}
 */
export function redactSecrets(text) {
  let out = text;
  for (const { pattern, replace } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, replace);
  }
  return out;
}

/**
 * Cuts a string to `max` characters and says how much was removed. Never splits a surrogate pair.
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function truncateString(text, max = MAX_STRING_CHARS) {
  if (text.length <= max) return text;
  let end = max;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…[+${text.length - end} chars]`;
}

/**
 * Returns a sanitized deep copy: secrets redacted (in keys too), strings ≤ 2,000 chars, keys
 * ≤ 200 chars, arrays ≤ 50 items, objects ≤ 100 keys, nesting ≤ 8 levels. The input is not modified.
 * @param {unknown} value
 * @param {number} [depth] nesting level of `value` (0 for the payload itself)
 * @returns {any}
 */
export function sanitize(value, depth = 0) {
  if (typeof value === 'string') return truncateString(redactSecrets(value));
  if (value === null || typeof value !== 'object') return sanitizePrimitive(value);
  if (depth >= MAX_DEPTH) return DEPTH_PLACEHOLDER;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitize(item, depth + 1));
  }
  const entries = Object.entries(value);
  // Object.fromEntries defines own properties, so a "__proto__" key cannot change the prototype.
  const kept = entries.slice(0, MAX_OBJECT_KEYS).map(([key, item]) => [
    truncateString(redactSecrets(key), MAX_KEY_CHARS),
    typeof item === 'string' && SECRET_KEY.test(key) ? REDACTED : sanitize(item, depth + 1),
  ]);
  if (entries.length > MAX_OBJECT_KEYS) kept.push([MORE_KEYS, `[+${entries.length - MAX_OBJECT_KEYS} keys]`]);
  return Object.fromEntries(kept);
}

/**
 * JSON has only finite numbers, booleans and null; anything else (undefined, functions) is dropped.
 * @param {unknown} value
 * @returns {number|boolean|null}
 */
function sanitizePrimitive(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  return null;
}
