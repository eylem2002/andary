// Made-up token usage for the demo, so the cost meter has something to show without Claude Code.
// Each prompt, tool call and stop costs a plausible, repeatable amount (cache-heavy, as Claude
// Code's turns are), priced like the real thing; the 13 days before today get made-up totals.
// Each agent's context grows with its steps, as a conversation does, and like the server's
// reading (server/usage.mjs) it is unknown from a compaction until the agent's next step.
import { messageCost } from '../core/prices.js';
import { localDate } from '../core/dates.js';
import { normalizeAgentId } from '../core/ids.js';

const COUNTED = new Set(['UserPromptSubmit', 'PreToolUse', 'Stop', 'SubagentStop']);
const COMPACTIONS = new Set(['PreCompact', 'PostCompact']);
/** A made-up conversation starts with the system prompt and tools; after a compaction, with its summary too. */
const CONTEXT_START = 18_000;
const CONTEXT_AFTER_COMPACT = 26_000;
/** Claude Code compacts before a 1M window fills; a demo crew may go a long time without. */
const CONTEXT_MAX = 950_000;

/**
 * @param {{ setUsage?: (record: unknown, days?: unknown) => void }} store
 * @param {() => number} now
 */
export function createDemoUsage(store, now) {
  /** @type {Map<string, string>} session → model */
  const models = new Map();
  /** @type {Map<string, any>} */
  const records = new Map();
  /** @type {Map<string, number>} agentKey → its made-up context, which the next step adds to */
  const contexts = new Map();
  let turn = 0;
  let today = { tokens: 0, costUsd: 0 };
  const history = pastDays(now());

  /** @param {string} key */
  function compacted(key) {
    contexts.set(key, CONTEXT_AFTER_COMPACT);
    const record = records.get(key);
    if (!record?.context) return;
    record.context = null;
    store.setUsage?.({ ...record, tokens: { ...record.tokens } });
  }

  /** @param {any} payload */
  return function observe(payload) {
    const session = typeof payload?.session_id === 'string' ? payload.session_id : '';
    if (!session) return;
    if (payload.hook_event_name === 'SessionStart' && typeof payload.model === 'string') models.set(session, payload.model);
    const agentId = normalizeAgentId(typeof payload.agent_id === 'string' ? payload.agent_id : null);
    const key = `${session}:${agentId ?? 'main'}`;
    if (COMPACTIONS.has(payload.hook_event_name)) compacted(key);
    if (!COUNTED.has(payload.hook_event_name)) return;
    turn += 1;
    const model = models.get(session) ?? 'claude-opus-5-5';
    const usage = {
      input_tokens: 400 + ((turn * 397) % 1800),
      output_tokens: 120 + ((turn * 211) % 900),
      cache_read_input_tokens: 14_000 + ((turn * 7919) % 30_000),
      cache_creation_input_tokens: turn % 5 === 0 ? 2500 + ((turn * 131) % 4000) : 0,
    };
    const cost = messageCost(model, usage) ?? 0;
    const record = records.get(key) ?? { sessionId: session, agentId, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, unpriced: false, model, context: null };
    record.tokens.input += usage.input_tokens;
    record.tokens.output += usage.output_tokens;
    record.tokens.cacheRead += usage.cache_read_input_tokens;
    record.tokens.cacheWrite += usage.cache_creation_input_tokens;
    record.costUsd += cost;
    const context = Math.min(CONTEXT_MAX, (contexts.get(key) ?? CONTEXT_START) + 600 + ((turn * 4111) % 3000));
    contexts.set(key, context);
    record.context = { tokens: context, at: now() };
    records.set(key, record);
    today = { tokens: today.tokens + usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens, costUsd: today.costUsd + cost };
    store.setUsage?.({ ...record, tokens: { ...record.tokens } }, [...history, { date: localDate(now()), ...today }]);
  };
}


/** Thirteen made-up days before today, quieter at weekends. @param {number} ms */
function pastDays(ms) {
  const days = [];
  for (let back = 13; back >= 1; back -= 1) {
    const date = new Date(ms);
    date.setDate(date.getDate() - back);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const costUsd = weekend ? 0.4 + ((back * 37) % 9) / 10 : 2.2 + ((back * 53) % 31) / 10;
    days.push({ date: localDate(date.getTime()), tokens: Math.round(costUsd * 820_000), costUsd: Math.round(costUsd * 100) / 100 });
  }
  return days;
}
