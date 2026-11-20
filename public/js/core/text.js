// Small defensive readers and text helpers for hook data (CONTRACTS §5): values from sessions
// working in untrusted repositories may be any shape, so every reader here accepts anything and
// never throws. Shared by the event normaliser, the summaries, the store, the director and humour.
// Tables are plain objects, so lookups go through own() to keep a tool named "constructor" or
// "__proto__" from reaching Object.prototype.

/**
 * A table's own entry for a key from hook data. Inherited keys are ignored, so a tool or event
 * named "constructor" or "__proto__" cannot reach Object.prototype.
 * @template T
 * @param {Readonly<Record<string, T>>} table
 * @param {unknown} key
 * @returns {T|undefined}
 */
export function own(table, key) {
  return typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
export function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value  strings pass through, finite numbers are stringified, the rest is '' */
export function str(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** @param {unknown} value */
export function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** @param {unknown} value  collapses whitespace so a value fits on one line of a bubble or log row */
export function oneLine(value) {
  return str(value).replace(/\s+/g, ' ').trim();
}

/**
 * Cuts text to `max` characters, ending in an ellipsis when cut.
 * @param {unknown} text
 * @param {number} max
 */
export function clip(text, max) {
  const s = str(text);
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…` : s;
}

/**
 * Text from a string, an array of content blocks ([{type: 'text', text}]) or a structured
 * message ({type: 'shutdown_request', …}); payload fields like these vary between versions.
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {string}
 */
export function textOf(value, depth = 0) {
  if (typeof value === 'string') return value;
  if (value == null || depth > 3) return '';
  if (Array.isArray(value)) return value.map((item) => textOf(item, depth + 1)).filter(Boolean).join('\n');
  if (!isObject(value)) return str(value);
  for (const key of ['text', 'content', 'message', 'summary']) {
    const text = textOf(value[key], depth + 1);
    if (text) return text;
  }
  // A structured message such as {type: 'shutdown_request'} is best described by its type.
  return typeof value.type === 'string' && !('text' in value) ? value.type.replace(/_/g, ' ') : '';
}

/** @param {unknown} value */
export function listOf(value) {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------------------------
// Paths, commands and URLs, shortened for bubbles, the log and the inspector.

const HOME_PREFIX = /^(?:[A-Za-z]:)?\/(?:home|Users)\/[^/]+(?=\/|$)/;

/**
 * A path relative to the session's cwd (or "~/…" under a home folder), without clipping.
 * @param {unknown} path
 * @param {unknown} [cwd]
 */
export function relativePath(path, cwd = '') {
  const p = str(path).trim().replace(/\\/g, '/');
  if (!p) return '';
  const base = str(cwd).trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (base && p === base) return '.';
  if (base && p.startsWith(`${base}/`)) return p.slice(base.length + 1);
  return p.replace(HOME_PREFIX, '~');
}

/**
 * Like relativePath, then shortened to its last segments so it fits in a speech bubble.
 * @param {unknown} path
 * @param {unknown} [cwd]
 * @param {number} [max]
 */
export function shortPath(path, cwd = '', max = 44) {
  const rel = relativePath(path, cwd);
  if (rel.length <= max) return rel;
  const parts = rel.split('/').filter(Boolean);
  const tail = parts.slice(-2).join('/');
  if (tail.length + 2 <= max) return `…/${tail}`;
  const last = parts[parts.length - 1] ?? rel;
  return last.length + 2 <= max ? `…/${last}` : `…${last.slice(-(max - 1))}`;
}

/**
 * First line of a shell command, without a leading "cd somewhere &&", at most `max` chars.
 * @param {unknown} command
 * @param {number} [max]
 */
export function shortCommand(command, max = 60) {
  const lines = str(command).trim().split('\n');
  let first = oneLine(lines[0]).replace(/^cd\s+\S+\s*&&\s*/, '');
  if (lines.length > 1) first += ' …';
  return clip(first, max);
}

/**
 * "host/path" of a URL; anything unparsable is just clipped.
 * @param {unknown} url
 * @param {number} [max]
 */
export function hostPath(url, max = 50) {
  const raw = oneLine(url);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return clip(parsed.host + parsed.pathname.replace(/\/+$/, ''), max);
  } catch {
    return clip(raw, max);
  }
}

/** @param {unknown} url */
export function hostOf(url) {
  try {
    return new URL(oneLine(url)).host;
  } catch {
    return '';
  }
}

/** @param {unknown} text @param {number} [max] */
export function quoted(text, max = 32) {
  return `"${clip(oneLine(text), max)}"`;
}
