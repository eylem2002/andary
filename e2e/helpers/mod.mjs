// Runs the andary-limits mod (mods/andary-limits/hooks/register.js) the way Claude Code would, for
// tests: its session.measure hook gets a `$` whose files, environment and network are this
// process's own, and whose session reports the usage the test gives. So a test sends limits
// through the mod's real code (the proof, the secret, the body) to a real server.
import { readFile } from 'node:fs/promises';
import { register, settled } from '../../mods/andary-limits/hooks/register.js';

/**
 * @param {{ env: Record<string, string|undefined>, usage: unknown, sessionId?: string, version?: string }} options
 * @returns {Promise<void>} once the report has been sent (or given up)
 */
export async function measureWithMod({ env, usage, sessionId = 'mod-session', version = '2.1.330' }) {
  /** @type {Function|null} */
  let hook = null;
  register((/** @type {string} */ _event, /** @type {Function} */ fn) => {
    hook = fn;
  });
  const $ = {
    env: { get: async (/** @type {string} */ name) => env[name] },
    fs: { read: (/** @type {string} */ path) => readFile(path, 'utf8') },
    session: { usage: async () => usage, id: async () => sessionId, version: async () => ({ version }) },
    http: {
      fetch: async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
        const response = await fetch(url, { method: init.method ?? 'GET', headers: init.headers, body: init.body, redirect: 'manual' });
        return { status: response.status, ok: response.ok, headers: Object.fromEntries(response.headers), text: await response.text() };
      },
    },
  };
  await /** @type {any} */ (hook)($, {}, async () => ({ changed: ['rateLimits'] }));
  await settled();
}
