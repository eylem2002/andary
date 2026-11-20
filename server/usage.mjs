// Tokens and estimated cost per agent, read from Claude Code's own transcripts (CONTRACTS §4.8).
// Hooks carry the transcript's path; each assistant message there records its token usage. The
// tracker reads only what was appended since its last look, counts every message once (one
// message is often split over several lines), and prices it with the API list prices below.
// It reads only files inside <Claude config>/projects, and keeps the day totals and how far it
// read each file in <ANDARY_HOME>/usage.json, so a restart does not count anything twice.
import { closeSync, existsSync, openSync, readFileSync, readSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';
import { messageCost } from '../public/js/core/prices.js';

/**
 * @typedef {{ input: number, output: number, cacheRead: number, cacheWrite: number }} Tokens
 * @typedef {object} UsageRecord   one agent's totals since Andary started
 * @property {string} sessionId
 * @property {string|null} agentId
 * @property {Tokens} tokens
 * @property {number} costUsd      estimated, at API list prices
 * @property {boolean} unpriced    some messages came from a model without a known price
 * @property {string|null} model   the last model seen
 * @typedef {{ date: string, tokens: number, costUsd: number }} UsageDay
 */

const MAX_READ_BYTES = 16 * 1024 * 1024;
const MAX_SEEN_IDS = 4000;
const MAX_FILES = 2000;
const MAX_AGENTS = 1000;
const DAYS_KEPT = 30;

/** @param {unknown} n */
function count(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The local calendar day of a timestamp, as YYYY-MM-DD.
 * @param {number} ms
 */
export function dayOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Where a subagent's own transcript lives, next to its session's.
 * @param {string} sessionTranscript
 * @param {string} agentId
 */
export function subagentTranscript(sessionTranscript, agentId) {
  return join(sessionTranscript.replace(/\.jsonl$/, ''), 'subagents', `agent-${agentId.replace(/^agent-/, '')}.jsonl`);
}

/**
 * True when `file` is a .jsonl file inside `root` once symlinks are resolved.
 * @param {string} file
 * @param {string} root
 */
export function isInside(file, root) {
  if (!isAbsolute(file) || !file.endsWith('.jsonl')) return false;
  try {
    const real = realpathSync(file);
    const base = realpathSync(root);
    return real.startsWith(base + sep) && statSync(real).isFile();
  } catch {
    return false;
  }
}

/**
 * One transcript line's usage: an assistant message's id, model, tokens, estimated cost and time.
 * Null for any other line.
 * @param {string} line
 * @returns {{ id: string, model: string, tokens: Tokens, cost: number|null, ts: number|null }|null}
 */
export function readUsageLine(line) {
  if (!line.includes('"usage"')) return null;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  const message = entry?.message;
  const usage = message?.usage;
  if (entry?.type !== 'assistant' || !usage || typeof usage !== 'object') return null;
  const model = typeof message.model === 'string' ? message.model : '';
  if (model === '<synthetic>') return null;
  const ts = Date.parse(entry.timestamp);
  return {
    id: String(message.id ?? entry.requestId ?? entry.uuid ?? ''),
    model,
    tokens: {
      input: count(usage.input_tokens),
      output: count(usage.output_tokens),
      cacheRead: count(usage.cache_read_input_tokens),
      cacheWrite: count(usage.cache_creation_input_tokens),
    },
    cost: messageCost(model, usage),
    ts: Number.isFinite(ts) ? ts : null,
  };
}

/**
 * What was appended to a file since `state.offset` (at most 16 MB), or null.
 * @param {string} file
 * @param {{ offset: number }} state
 * @returns {string|null}
 */
function readAppended(file, state) {
  try {
    const size = statSync(file).size;
    if (size < state.offset) state.offset = 0; // the file was replaced
    const length = Math.min(size - state.offset, MAX_READ_BYTES);
    if (length <= 0) return null;
    const buffer = Buffer.alloc(length);
    const fd = openSync(file, 'r');
    try {
      readSync(fd, buffer, 0, length, state.offset);
    } finally {
      closeSync(fd);
    }
    return buffer.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * @typedef {object} UsageOptions
 * @property {string} claudeDir     Claude Code's config folder (CLAUDE_CONFIG_DIR or ~/.claude)
 * @property {string|null} stateFile  where day totals and read offsets are kept (null: memory only)
 * @property {(record: UsageRecord, days: UsageDay[]) => void} onChange
 * @property {number} [debounceMs]
 * @property {() => number} [now]
 */

/** @param {UsageOptions} options */
export function createUsageTracker({ claudeDir, stateFile, onChange, debounceMs = 800, now = Date.now }) {
  const projects = join(claudeDir, 'projects');
  /** @type {Map<string, { offset: number, seen: string[] }>} */
  const files = new Map();
  /** @type {Map<string, UsageRecord>} agentKey → totals */
  const agents = new Map();
  /** @type {Map<string, UsageDay>} */
  const days = new Map();
  /** @type {Map<string, NodeJS.Timeout>} */
  const pending = new Map();
  /** @type {NodeJS.Timeout|null} */
  let saveTimer = null;
  load();

  function load() {
    if (!stateFile || !existsSync(stateFile)) return;
    try {
      const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
      for (const day of Array.isArray(saved.days) ? saved.days : []) {
        if (typeof day?.date === 'string') days.set(day.date, { date: day.date, tokens: count(day.tokens), costUsd: count(day.costUsd) });
      }
      for (const [file, offset] of Object.entries(saved.offsets ?? {})) files.set(file, { offset: count(offset), seen: [] });
    } catch {
      // a damaged file starts over
    }
  }

  function writeState() {
    if (!stateFile) return;
    const offsets = Object.fromEntries([...files].slice(-MAX_FILES).map(([file, state]) => [file, state.offset]));
    try {
      writeFileSync(`${stateFile}.tmp`, JSON.stringify({ v: 1, days: dayList(), offsets }), { mode: 0o600 });
      renameSync(`${stateFile}.tmp`, stateFile);
    } catch {
      // the totals stay in memory
    }
  }

  function save() {
    if (!stateFile || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      writeState();
    }, 2000);
    saveTimer.unref?.();
  }

  /** @returns {UsageDay[]} oldest first, the last 30 days */
  function dayList() {
    return [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-DAYS_KEPT);
  }

  /**
   * Looks at a hook event: schedules a read of the transcript it points to.
   * @param {Record<string, any>} event  the raw (unsanitized) hook payload
   */
  function observe(event) {
    const sessionId = typeof event?.session_id === 'string' ? event.session_id : '';
    const transcript = typeof event?.transcript_path === 'string' ? event.transcript_path : '';
    if (!sessionId || !transcript) return;
    const agentId = typeof event.agent_id === 'string' && event.agent_id ? event.agent_id.replace(/^agent-/, '') : null;
    const file = agentId
      ? (typeof event.agent_transcript_path === 'string' && event.agent_transcript_path) || subagentTranscript(transcript, agentId)
      : transcript;
    const key = `${sessionId}:${agentId ?? 'main'}`;
    if (pending.has(key)) return;
    pending.set(key, setTimeout(() => {
      pending.delete(key);
      scan(file, sessionId, agentId);
    }, debounceMs));
    pending.get(key)?.unref?.();
  }

  /**
   * Reads what was appended to a transcript and adds its usage to the agent and the day.
   * @param {string} file
   * @param {string} sessionId
   * @param {string|null} agentId
   */
  function scan(file, sessionId, agentId) {
    if (!isInside(file, projects)) return;
    const state = files.get(file) ?? { offset: 0, seen: [] };
    files.delete(file);
    files.set(file, state);
    if (files.size > MAX_FILES) files.delete(files.keys().next().value ?? '');
    const text = readAppended(file, state);
    if (text === null) return;
    // Only whole lines: a line still being written is read next time.
    const end = text.lastIndexOf('\n');
    if (end < 0) return;
    state.offset += Buffer.byteLength(text.slice(0, end + 1));
    const key = `${sessionId}:${agentId ?? 'main'}`;
    const record = agents.get(key) ?? { sessionId, agentId, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, unpriced: false, model: null };
    let changed = false;
    for (const line of text.slice(0, end).split('\n')) {
      if (addLine(line, state, record)) changed = true;
    }
    if (!changed) {
      save();
      return;
    }
    agents.delete(key);
    agents.set(key, record);
    if (agents.size > MAX_AGENTS) agents.delete(agents.keys().next().value ?? '');
    save();
    onChange(record, dayList());
  }

  /**
   * @param {string} line
   * @param {{ seen: string[] }} state
   * @param {UsageRecord} record
   * @returns {boolean} whether it counted something
   */
  function addLine(line, state, record) {
    const seen = readUsageLine(line);
    if (!seen || (seen.id && state.seen.includes(seen.id))) return false;
    if (seen.id) {
      state.seen.push(seen.id);
      if (state.seen.length > MAX_SEEN_IDS) state.seen.shift();
    }
    for (const part of /** @type {(keyof Tokens)[]} */ (['input', 'output', 'cacheRead', 'cacheWrite'])) record.tokens[part] += seen.tokens[part];
    if (seen.cost === null) record.unpriced = true;
    else record.costUsd += seen.cost;
    if (seen.model) record.model = seen.model;
    const date = dayOf(seen.ts ?? now());
    const day = days.get(date) ?? { date, tokens: 0, costUsd: 0 };
    day.tokens += seen.tokens.input + seen.tokens.output + seen.tokens.cacheRead + seen.tokens.cacheWrite;
    day.costUsd += seen.cost ?? 0;
    days.set(date, day);
    return true;
  }

  return {
    observe,
    /** Every agent's totals and the day totals, for a browser that just connected. */
    snapshot: () => ({ agents: [...agents.values()], days: dayList() }),
    /** Stops pending reads and writes what is kept (server shutdown). */
    dispose() {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        writeState();
      }
    },
  };
}

/**
 * Claude Code's config folder: CLAUDE_CONFIG_DIR or ~/.claude.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function claudeConfigDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR ? env.CLAUDE_CONFIG_DIR : join(homedir(), '.claude');
}

