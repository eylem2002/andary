// Tokens and estimated cost per agent, read from Claude Code's own transcripts (CONTRACTS §4.8).
// Hooks carry the transcript's path; each assistant message there records its token usage. The
// tracker reads only what was appended since its last look, counts every message once (one
// message is often split over several lines, and a forked session copies earlier messages into
// its new transcript), and prices it with the API list prices in prices.js.
// The newest message also tells how much context the agent is using. A compaction makes that
// unknown until the next message: no window size is guessed, so there is no percentage.
// It reads only regular files inside <Claude config>/projects, and keeps the day totals, how far
// it read each file (by its real path) and the ids of recent messages in <ANDARY_HOME>/usage.json,
// so a restart does not count anything twice.
import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { localDate } from '../public/js/core/dates.js';
import { agentKeyOf, normalizeAgentId } from '../public/js/core/ids.js';
import { messageCost } from '../public/js/core/prices.js';

/**
 * @typedef {{ input: number, output: number, cacheRead: number, cacheWrite: number }} Tokens
 * @typedef {{ tokens: number, at: number }} ContextReading  the context the agent's newest message
 *   used, and when that message was written (ms)
 * @typedef {object} UsageRecord   one agent's totals since Andary started
 * @property {string} sessionId
 * @property {string|null} agentId
 * @property {Tokens} tokens
 * @property {number} costUsd      estimated, at API list prices
 * @property {boolean} unpriced    some messages came from a model without a known price
 * @property {string|null} model   the last model seen
 * @property {ContextReading|null} context  null until a message is read, and again after a compaction
 * @property {number|null} compactedAt  when the agent last compacted, as far as the tracker saw
 * @typedef {{ date: string, tokens: number, costUsd: number }} UsageDay
 * @typedef {object} UsageLine     what one assistant line of a transcript says (readUsageLine)
 * @property {string} id           message id and request id: the same message, wherever it was copied
 * @property {string} model
 * @property {Tokens} tokens       every sampling iteration of the reply
 * @property {number|null} cost    every iteration, each at its own model's price; null if one has none
 * @property {number} context      the context its last executor iteration used
 * @property {number|null} ts      when it was written
 * @property {boolean} sidechain   a helper's message (older Claude Code wrote them into the session's transcript)
 */

const MAX_READ_BYTES = 16 * 1024 * 1024;
/** Messages remembered across all transcripts (and, the newest SAVED_IDS of them, restarts). */
const MAX_SEEN_IDS = 20_000;
const SAVED_IDS = 4000;
const MAX_FILES = 2000;
const MAX_AGENTS = 1000;
const DAYS_KEPT = 30;
/** Folders of `subagents/` looked through for a helper's transcript that is not directly in it. */
const MAX_SUBFOLDERS = 50;
/**
 * A reply's own sampling iterations (`usage.iterations`): the executor's, and a fallback model's
 * when it took over. Claude Code's status line reads the context from the last of these; an
 * advisor's or a compaction's iteration is a request of its own.
 */
const EXECUTOR_ITERATIONS = new Set(['message', 'fallback_message']);

/** @param {unknown} n */
function count(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}


/**
 * Where a subagent's own transcript lives, next to its session's.
 * @param {string} sessionTranscript
 * @param {string} agentId
 */
export function subagentTranscript(sessionTranscript, agentId) {
  return join(sessionTranscript.replace(/\.jsonl$/, ''), 'subagents', `agent-${normalizeAgentId(agentId)}.jsonl`);
}

/**
 * A helper's transcript that is not where it was looked for but one folder further down (Claude
 * Code keeps some helpers' transcripts in a folder of their own under `subagents/`): the real path
 * of the first `<folder>/<that name>` inside `root`, or null. Links to folders are not followed.
 * @param {string} file
 * @param {string} root
 * @returns {string|null}
 */
export function inSubfolder(file, root) {
  let entries;
  try {
    entries = readdirSync(dirname(file), { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries.filter((e) => e.isDirectory()).slice(0, MAX_SUBFOLDERS)) {
    const real = resolveInside(join(dirname(file), entry.name, basename(file)), root);
    if (real) return real;
  }
  return null;
}

/**
 * The real path of `file` when it is a .jsonl file inside `root` once symlinks are resolved,
 * else null. (Whether it is a regular file is checked on the open descriptor, see readAppended.)
 * @param {string} file
 * @param {string} root
 * @returns {string|null}
 */
export function resolveInside(file, root) {
  if (!isAbsolute(file) || !file.endsWith('.jsonl')) return null;
  try {
    const real = realpathSync(file);
    return real.startsWith(realpathSync(root) + sep) && real.endsWith('.jsonl') ? real : null;
  } catch {
    return null;
  }
}

/**
 * True when `file` is a regular .jsonl file inside `root` once symlinks are resolved.
 * @param {string} file
 * @param {string} root
 */
export function isInside(file, root) {
  const real = resolveInside(file, root);
  if (!real) return false;
  const fd = openTranscript(real);
  if (fd === null) return false;
  closeSync(fd);
  return true;
}

/** Never follow a link swapped in after the check, and never block on a FIFO. */
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0);

/**
 * Opens a transcript for reading if it is (still) a regular file.
 * @param {string} real  a real path from resolveInside
 * @returns {number|null} a file descriptor to close
 */
function openTranscript(real) {
  let fd = null;
  try {
    fd = openSync(real, OPEN_FLAGS);
    if (fstatSync(fd).isFile()) return fd;
  } catch {
    // gone, a link or unreadable
  }
  if (fd !== null) closeSync(fd);
  return null;
}

/**
 * One transcript line's usage: an assistant message's id, model, tokens, estimated cost, context
 * and time. Null for any other line, and for one Claude Code marks unmetered (it skips those too).
 * A reply can list its sampling iterations (`usage.iterations`): the executor's, a fallback
 * model's, an advisor's (billed at the advisor model's price, which it names) and a compaction's
 * (at the message's model). The top level adds up the executor's alone, each of which re-sent the
 * whole conversation; so the tokens and cost are summed over every iteration, each at its own
 * model's price, and the context is the last executor iteration's.
 * @param {string} line
 * @returns {UsageLine|null}
 */
export function readUsageLine(line) {
  const entry = meteredAssistantEntry(line);
  if (!entry) return null;
  const { message } = entry;
  const model = typeof message.model === 'string' ? message.model : '';
  if (model === '<synthetic>') return null;
  const ts = Date.parse(entry.timestamp);
  const { parts, last } = iterationsOf(message.usage);
  return {
    // A message id with its request id: the same message, wherever it was copied, is one message.
    id: message.id || entry.requestId ? `${message.id ?? ''}:${entry.requestId ?? ''}` : String(entry.uuid ?? ''),
    model,
    tokens: parts.map(tokensOf).reduce(addTokens),
    cost: costOf(parts, model),
    context: contextTokens(tokensOf(last)),
    ts: Number.isFinite(ts) ? ts : null,
    sidechain: entry.isSidechain === true,
  };
}

/**
 * A transcript line's assistant message with its usage, parsed; null for any other line and for
 * one Claude Code marks unmetered.
 * @param {string} line
 * @returns {Record<string, any>|null}
 */
function meteredAssistantEntry(line) {
  if (!line.includes('"usage"')) return null;
  try {
    const entry = JSON.parse(line);
    const usage = entry?.message?.usage;
    return entry?.type === 'assistant' && usage && typeof usage === 'object' && entry.isUnmetered !== true ? entry : null;
  } catch {
    return null;
  }
}

/**
 * A reply's sampling iterations (the reply itself when it lists none), and the one its context
 * is read from: the last executor iteration.
 * @param {Record<string, any>} usage
 * @returns {{ parts: Record<string, any>[], last: Record<string, any> }}
 */
function iterationsOf(usage) {
  const iterations = Array.isArray(usage.iterations) ? usage.iterations.filter((it) => it && typeof it === 'object') : [];
  return {
    parts: iterations.length ? iterations : [usage],
    last: iterations.filter((it) => EXECUTOR_ITERATIONS.has(it.type)).at(-1) ?? usage,
  };
}

/** @param {Record<string, any>} usage  a message's usage, or one of its iterations @returns {Tokens} */
function tokensOf(usage) {
  return {
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens),
  };
}

/** @param {Tokens} a @param {Tokens} b @returns {Tokens} */
function addTokens(a, b) {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}

/**
 * The estimated cost of a reply's iterations, each at the price of the model it names (an
 * advisor's), else of the message's; null when one of those models has no known price.
 * @param {Record<string, any>[]} parts
 * @param {string} model
 * @returns {number|null}
 */
function costOf(parts, model) {
  let total = 0;
  for (const part of parts) {
    const cost = messageCost(typeof part.model === 'string' && part.model ? part.model : model, part);
    if (cost === null) return null;
    total += cost;
  }
  return total;
}

/**
 * The context a request used: everything the model read to answer it, which Claude Code's status
 * line counts as input, cache writes and cache reads (its output is not in it yet).
 * @param {Tokens} tokens
 */
export function contextTokens(tokens) {
  return tokens.input + tokens.cacheWrite + tokens.cacheRead;
}

/**
 * The line Claude Code writes where it compacted the conversation (what came before it is now a
 * summary, so a reading from before it no longer holds), with its time; null for any other line.
 * @param {string} line
 * @returns {{ at: number|null }|null}
 */
export function readCompactBoundary(line) {
  if (!line.includes('"compact_boundary"')) return null;
  try {
    const entry = JSON.parse(line);
    if (entry?.type !== 'system' || entry.subtype !== 'compact_boundary') return null;
    const at = Date.parse(entry.timestamp);
    return { at: Number.isFinite(at) ? at : null };
  } catch {
    return null;
  }
}

/**
 * A hook that says the agent's conversation was just compacted. Not PreCompact: another hook can
 * still stop the compaction then.
 * @param {Record<string, any>} event
 */
function isCompaction(event) {
  const name = event.hook_event_name;
  return name === 'PostCompact' || (name === 'SessionStart' && event.source === 'compact');
}

/**
 * What was appended to a file since `state.offset` (at most 16 MB), or null. Only whole lines
 * count: the offset moves past the last newline read, so a line still being written is read
 * next time. A single line longer than 16 MB (no assistant message is) is skipped.
 * @param {string} real  a real path from resolveInside
 * @param {{ offset: number }} state
 * @returns {string|null} complete lines, without the last newline
 */
export function readAppended(real, state) {
  const fd = openTranscript(real);
  if (fd === null) return null;
  try {
    const size = fstatSync(fd).size;
    if (size < state.offset) state.offset = 0; // the file was replaced
    const length = Math.min(size - state.offset, MAX_READ_BYTES);
    if (length <= 0) return null;
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, state.offset);
    const end = buffer.lastIndexOf(0x0a, read - 1);
    if (end < 0) {
      if (read === MAX_READ_BYTES) state.offset += read;
      return null;
    }
    state.offset += end + 1;
    return buffer.toString('utf8', 0, end);
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/**
 * @typedef {object} UsageOptions
 * @property {string} claudeDir     Claude Code's config folder (CLAUDE_CONFIG_DIR or ~/.claude)
 * @property {string|null} stateFile  where day totals and read offsets are kept (null: memory only)
 * @property {(record: UsageRecord, days: UsageDay[]) => void} onChange
 * @property {number} [throttleMs]  an agent's transcript is read at most this often
 * @property {() => number} [now]
 */

/** @param {UsageOptions} options */
export function createUsageTracker({ claudeDir, stateFile, onChange, throttleMs = 800, now = Date.now }) {
  const projects = join(claudeDir, 'projects');
  /** @type {Map<string, { offset: number }>} real path → how far it was read */
  const files = new Map();
  /**
   * Messages already counted, oldest first: their output tokens and cost so far (a message's
   * later lines can report more output than its first).
   * @type {Map<string, { output: number, cost: number|null }>}
   */
  const seenIds = new Map();
  /** @type {Map<string, UsageRecord>} agentKey → totals */
  const agents = new Map();
  /** @type {Map<string, UsageDay>} */
  const days = new Map();
  /** @type {Map<string, NodeJS.Timeout>} */
  const pending = new Map();
  /** @type {Map<string, number>} agentKey → when it last compacted: older readings no longer hold */
  const compactions = new Map();
  /** @type {NodeJS.Timeout|null} */
  let saveTimer = null;
  loadState(stateFile, { days, files, seenIds });

  function writeState() {
    if (stateFile) saveState(stateFile, { days: dayList(), files, seenIds });
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
   * @param {number} [ts]  when the hook started (the forwarder's clock, which is this computer's)
   */
  function observe(event, ts = now()) {
    const sessionId = typeof event?.session_id === 'string' ? event.session_id : '';
    if (!sessionId) return;
    const agentId = normalizeAgentId(event.agent_id);
    const key = agentKeyOf(sessionId, agentId);
    if (isCompaction(event)) compacted(key, Math.min(ts, now()));
    const transcript = typeof event.transcript_path === 'string' ? event.transcript_path : '';
    if (!transcript || pending.has(key)) return;
    const file = agentId
      ? (typeof event.agent_transcript_path === 'string' && event.agent_transcript_path) || subagentTranscript(transcript, agentId)
      : transcript;
    pending.set(key, setTimeout(() => {
      pending.delete(key);
      scan(file, sessionId, agentId);
    }, throttleMs));
    pending.get(key)?.unref?.();
  }

  /**
   * A compaction: the agent's context is unknown until its next message. Its reading goes now,
   * and the read this hook schedules must not bring back a message from before the compaction.
   * @param {string} key
   * @param {number} at
   */
  function compacted(key, at) {
    compactions.delete(key);
    compactions.set(key, at);
    if (compactions.size > MAX_AGENTS) compactions.delete(compactions.keys().next().value ?? '');
    const record = agents.get(key);
    if (record && markCompacted(record, at)) onChange(record, dayList());
  }

  /**
   * Reads what was appended to a transcript and adds its usage to the agent and the day.
   * @param {string} file
   * @param {string} sessionId
   * @param {string|null} agentId
   */
  function scan(file, sessionId, agentId) {
    // Keyed by real path: two names for one transcript share one offset.
    const real = resolveInside(file, projects) ?? (agentId ? inSubfolder(file, projects) : null);
    if (!real) return;
    const state = files.get(real) ?? { offset: 0 };
    files.delete(real);
    files.set(real, state);
    if (files.size > MAX_FILES) files.delete(files.keys().next().value ?? '');
    const text = readAppended(real, state);
    if (text === null) {
      save();
      return;
    }
    const key = agentKeyOf(sessionId, agentId);
    const since = compactions.get(key) ?? 0;
    const record = agents.get(key) ?? { sessionId, agentId, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, unpriced: false, model: null, context: null, compactedAt: since || null };
    /** @type {LineScan} */
    const lineScan = { days, seenIds, lead: !agentId, since, now: now() };
    let changed = false;
    for (const line of text.split('\n')) {
      if (applyLine(line, record, lineScan)) changed = true;
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
 * @typedef {object} UsageMemory
 * @property {Map<string, UsageDay>} days
 * @property {Map<string, { offset: number }>} files
 * @property {Map<string, { output: number, cost: number|null }>} seenIds
 */

/**
 * What reading one agent's new transcript lines needs.
 * @typedef {object} LineScan
 * @property {UsageMemory['days']} days
 * @property {UsageMemory['seenIds']} seenIds  messages already counted, and their output so far
 * @property {boolean} lead    the session's own transcript, not a helper's
 * @property {number} since    when the agent last compacted (0: never seen): an older message's
 *   reading no longer holds
 * @property {number} now      the time of a line that has none
 */

/**
 * One transcript line into its agent's record. A message adds its usage and becomes the agent's
 * newest context reading (lines come in the order they were written, so the last one read is
 * the newest); a compaction boundary drops the reading.
 * @param {string} line
 * @param {UsageRecord} record
 * @param {LineScan} scan
 * @returns {boolean} whether the record changed
 */
function applyLine(line, record, scan) {
  const boundary = readCompactBoundary(line);
  if (boundary) return markCompacted(record, boundary.at ?? scan.now);
  const seen = readUsageLine(line);
  if (!seen) return false;
  const counted = countUsage(seen, record, scan);
  // A message counted before (a forked session's copy of it) still tells this agent's context.
  return takeContext(seen, record, scan) || counted;
}

/**
 * Counts a message once; a later line of the same message that reports more output adds only
 * the difference.
 * @param {UsageLine} seen
 * @param {UsageRecord} record
 * @param {LineScan} scan
 * @returns {boolean} whether it counted something
 */
function countUsage(seen, record, { days, seenIds, now }) {
  const before = seen.id ? seenIds.get(seen.id) : undefined;
  /** @type {Tokens} */
  let tokens = seen.tokens;
  let cost = seen.cost;
  if (before) {
    if (seen.tokens.output <= before.output) return false;
    tokens = { input: 0, output: seen.tokens.output - before.output, cacheRead: 0, cacheWrite: 0 };
    cost = seen.cost !== null && before.cost !== null ? seen.cost - before.cost : seen.cost === null ? null : 0;
  }
  if (seen.id) remember(seenIds, seen.id, { output: seen.tokens.output, cost: seen.cost });
  for (const part of /** @type {(keyof Tokens)[]} */ (['input', 'output', 'cacheRead', 'cacheWrite'])) record.tokens[part] += tokens[part];
  if (cost === null) record.unpriced = true;
  else record.costUsd += cost;
  if (seen.model) record.model = seen.model;
  const date = localDate(seen.ts ?? now);
  const day = days.get(date) ?? { date, tokens: 0, costUsd: 0 };
  day.tokens += tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  day.costUsd += cost ?? 0;
  days.set(date, day);
  return true;
}

/**
 * @param {UsageMemory['seenIds']} seenIds
 * @param {string} id
 * @param {{ output: number, cost: number|null }} entry
 */
function remember(seenIds, id, entry) {
  seenIds.delete(id);
  seenIds.set(id, entry);
  if (seenIds.size > MAX_SEEN_IDS) seenIds.delete(seenIds.keys().next().value ?? '');
}

/**
 * Makes a message's context the agent's reading. Not when the message read nothing, when it is a
 * helper's message in its lead's transcript, or when it was written before the agent's last
 * compaction (a read that was already due when the compaction ended can bring those).
 * @param {UsageLine} seen
 * @param {UsageRecord} record
 * @param {LineScan} scan
 * @returns {boolean} whether the reading changed
 */
function takeContext(seen, record, { lead, since, now }) {
  const tokens = seen.context;
  const at = seen.ts ?? now;
  if (tokens === 0 || (lead && seen.sidechain) || at <= since) return false;
  if (record.context?.tokens === tokens && record.context.at === at) return false;
  record.context = { tokens, at };
  return true;
}

/**
 * The agent compacted at `at`: its reading goes until its next message (the latest compaction
 * is the one kept; a boundary line and its PostCompact hook tell of the same one).
 * @param {UsageRecord} record
 * @param {number} at
 * @returns {boolean} whether the record changed
 */
function markCompacted(record, at) {
  const latest = Math.max(record.compactedAt ?? 0, at);
  if (!record.context && record.compactedAt === latest) return false;
  record.context = null;
  record.compactedAt = latest;
  return true;
}

/**
 * Fills the tracker's memory from usage.json; a damaged file starts over.
 * @param {string|null} stateFile
 * @param {UsageMemory} memory
 */
function loadState(stateFile, { days, files, seenIds }) {
  if (!stateFile || !existsSync(stateFile)) return;
  try {
    const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
    for (const day of Array.isArray(saved.days) ? saved.days : []) {
      if (typeof day?.date === 'string') days.set(day.date, { date: day.date, tokens: count(day.tokens), costUsd: count(day.costUsd) });
    }
    // Older files kept the path as the hook gave it: key it by its real path now.
    for (const [file, offset] of Object.entries(saved.offsets ?? {})) files.set(realOrSame(file), { offset: count(offset) });
    for (const item of Array.isArray(saved.seen) ? saved.seen : []) {
      if (Array.isArray(item) && typeof item[0] === 'string') seenIds.set(item[0], { output: count(item[1]), cost: typeof item[2] === 'number' ? item[2] : null });
    }
  } catch {
    // a damaged file starts over
  }
}

/**
 * Writes usage.json atomically (0600); on failure the totals stay in memory.
 * @param {string} stateFile
 * @param {{ days: UsageDay[], files: UsageMemory['files'], seenIds: UsageMemory['seenIds'] }} memory
 */
function saveState(stateFile, { days, files, seenIds }) {
  const offsets = Object.fromEntries([...files].slice(-MAX_FILES).map(([file, state]) => [file, state.offset]));
  const seen = [...seenIds].slice(-SAVED_IDS).map(([id, s]) => [id, s.output, s.cost]);
  try {
    writeFileSync(`${stateFile}.tmp`, JSON.stringify({ v: 1, days, offsets, seen }), { mode: 0o600 });
    renameSync(`${stateFile}.tmp`, stateFile);
  } catch {
    // the totals stay in memory
  }
}

/** @param {string} file */
function realOrSame(file) {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}
