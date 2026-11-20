// HTTP calls the CLI makes to a running server (replay, simulate).
import { serverOrigin } from '../state-file.mjs';
import { sleep } from './io.mjs';

/**
 * Posts a raw hook payload the way the forwarder does. Retries briefly when rate-limited. A
 * recorded Codex event is sent as Codex's again, so it keeps its mark (its adapter leaves events
 * it already translated as they are).
 * @param {import('../state-file.mjs').ServerState} state
 * @param {object} payload
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ status: number, output: any }>}
 */
export async function postHook(state, payload, { timeoutMs = 5000 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(`${serverOrigin(state)}/api/hook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-andary-secret': state.secret },
      body: JSON.stringify({ v: 1, ts: Date.now(), ...sourceOf(payload), event: payload }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json().catch(() => null);
    if (res.status !== 429 || attempt >= 3) return { status: res.status, output: body?.output ?? null };
    await sleep(1000);
  }
}

/**
 * @param {object} payload
 * @returns {{ source?: 'codex' }}
 */
function sourceOf(payload) {
  return /** @type {Record<string, unknown>} */ (payload).andary_source === 'codex' ? { source: 'codex' } : {};
}
