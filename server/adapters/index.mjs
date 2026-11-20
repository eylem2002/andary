// Source adapters (CONTRACTS §4.12): every agent that feeds the town is translated here into the
// town's one event contract, the Claude Code hook payload (§4.2). Adding an agent means adding an
// adapter; nothing after the server's ingest needs to know where an event came from, apart from
// the `andary_source` mark it may carry for display.
import { fromCodex } from './codex.mjs';

/** @typedef {'claude'|'codex'} Source */

/** @type {Record<Source, (payload: Record<string, any>) => Record<string, any>[]>} */
const ADAPTERS = Object.freeze({
  claude: (payload) => [payload],
  codex: fromCodex,
});

/**
 * @param {unknown} value  the `source` the forwarder sent (absent for Claude Code)
 * @returns {Source}
 */
export function sourceOf(value) {
  return value === 'codex' ? 'codex' : 'claude';
}

/**
 * The town payloads for one hook payload from a source. Fields only the server may set (every
 * `andary_` field) are dropped from what arrived first: a session cannot name its team member,
 * claim another source or settle someone else's approval.
 * @param {Source} source
 * @param {Record<string, any>} payload
 * @returns {Record<string, any>[]}
 */
export function toTownPayloads(source, payload) {
  const clean = Object.fromEntries(Object.entries(payload).filter(([key]) => !key.startsWith('andary_')));
  return ADAPTERS[source](clean);
}
