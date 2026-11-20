// Made-up token usage for the demo, so the cost meter has something to show without Claude Code.
// Each prompt, tool call and stop costs a plausible, repeatable amount (cache-heavy, as Claude
// Code's turns are), priced like the real thing; the 13 days before today get made-up totals.
import { messageCost } from '../core/prices.js';
import { normalizeAgentId } from '../core/events.js';

const COUNTED = new Set(['UserPromptSubmit', 'PreToolUse', 'Stop', 'SubagentStop']);

/**
 * @param {{ setUsage?: (record: unknown, days?: unknown) => void }} store
 * @param {() => number} now
 */
export function createDemoUsage(store, now) {
  /** @type {Map<string, string>} session → model */
  const models = new Map();
  /** @type {Map<string, any>} */
  const records = new Map();
  let turn = 0;
  let today = { tokens: 0, costUsd: 0 };
  const history = pastDays(now());

  /** @param {any} payload */
  return function observe(payload) {
    const session = typeof payload?.session_id === 'string' ? payload.session_id : '';
    if (!session) return;
    if (payload.hook_event_name === 'SessionStart' && typeof payload.model === 'string') models.set(session, payload.model);
    if (!COUNTED.has(payload.hook_event_name)) return;
    turn += 1;
    const agentId = normalizeAgentId(typeof payload.agent_id === 'string' ? payload.agent_id : null);
    const key = `${session}:${agentId ?? 'main'}`;
    const model = models.get(session) ?? 'claude-opus-5-5';
    const usage = {
      input_tokens: 400 + ((turn * 397) % 1800),
      output_tokens: 120 + ((turn * 211) % 900),
      cache_read_input_tokens: 14_000 + ((turn * 7919) % 30_000),
      cache_creation_input_tokens: turn % 5 === 0 ? 2500 + ((turn * 131) % 4000) : 0,
    };
    const cost = messageCost(model, usage) ?? 0;
    const record = records.get(key) ?? { sessionId: session, agentId, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, unpriced: false, model };
    record.tokens.input += usage.input_tokens;
    record.tokens.output += usage.output_tokens;
    record.tokens.cacheRead += usage.cache_read_input_tokens;
    record.tokens.cacheWrite += usage.cache_creation_input_tokens;
    record.costUsd += cost;
    records.set(key, record);
    today = { tokens: today.tokens + usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens, costUsd: today.costUsd + cost };
    store.setUsage?.({ ...record, tokens: { ...record.tokens } }, [...history, { date: dateOf(now()), ...today }]);
  };
}

/** @param {number} ms */
function dateOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Thirteen made-up days before today, quieter at weekends. @param {number} ms */
function pastDays(ms) {
  const days = [];
  for (let back = 13; back >= 1; back -= 1) {
    const date = new Date(ms - back * 86_400_000);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const costUsd = weekend ? 0.4 + ((back * 37) % 9) / 10 : 2.2 + ((back * 53) % 31) / 10;
    days.push({ date: dateOf(date.getTime()), tokens: Math.round(costUsd * 820_000), costUsd: Math.round(costUsd * 100) / 100 });
  }
  return days;
}
