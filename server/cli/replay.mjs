// `andary replay <file.jsonl>`: sends a recording (made with `start --record`) to the running
// town, keeping the original rhythm.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveHome } from '../config.mjs';
import { findRunningServer } from '../state-file.mjs';
import { postHook } from './client.mjs';
import { cliInvocation, sleep } from './io.mjs';
import { UsageError, parseSpeed } from './options.mjs';

export const REPLAY_OPTIONS = Object.freeze({ speed: { type: 'string' } });

/** Long silences in a recording (lunch breaks) are shortened to this, before --speed applies. */
export const MAX_GAP_MS = 5000;

/**
 * Reads a JSONL recording. Each line is an envelope ({ts, event}) as written by --record, or a
 * raw hook payload. Unreadable lines are skipped and counted.
 * @param {string} text
 * @returns {{ items: Array<{ ts: number|null, event: Record<string, any> }>, skipped: number }}
 */
export function parseRecording(text) {
  const items = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    const ts = Number.isFinite(value?.ts) ? value.ts : null;
    if (isObject(value?.event)) items.push({ ts, event: value.event });
    else if (isObject(value) && typeof value.hook_event_name === 'string') items.push({ ts, event: value });
    else skipped += 1;
  }
  return { items, skipped };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {Record<string, any>} values
 * @param {string[]} positionals
 * @param {import('./io.mjs').CliIo} io
 * @returns {Promise<number>}
 */
export async function runReplay(values, positionals, io) {
  const [file] = positionals;
  if (!file) throw new UsageError('replay needs a recording: andary replay <file.jsonl> [--speed N]');
  const speed = parseSpeed(values.speed);
  let text;
  try {
    text = readFileSync(resolve(io.cwd, file), 'utf8');
  } catch (error) {
    io.err(`Cannot read ${file} (${error.code ?? error.message}).`);
    return 1;
  }
  const { items, skipped } = parseRecording(text);
  if (items.length === 0) {
    io.err(`${file} contains no hook events.`);
    return 1;
  }
  const state = await findRunningServer(resolveHome(io.env));
  if (!state) {
    io.err(`Andary is not running. Start it first: ${cliInvocation()} start`);
    return 1;
  }
  io.out(`Replaying ${items.length} events at ${speed}× speed…`);
  const sent = await sendAll(state, items, speed, io);
  if (sent < 0) return 1;
  io.out(`Replayed ${sent} events${skipped ? ` (skipped ${skipped} unreadable line${skipped === 1 ? '' : 's'})` : ''}.`);
  return 0;
}

/**
 * @param {import('../state-file.mjs').ServerState} state
 * @param {Array<{ ts: number|null, event: Record<string, any> }>} items
 * @param {number} speed
 * @param {import('./io.mjs').CliIo} io
 * @returns {Promise<number>} events sent, or -1 when the server went away
 */
async function sendAll(state, items, speed, io) {
  let previous = null;
  let sent = 0;
  for (const item of items) {
    if (previous !== null && item.ts !== null) await sleep(Math.min(Math.max(0, item.ts - previous), MAX_GAP_MS) / speed);
    if (item.ts !== null) previous = item.ts;
    // Recorded permission prompts were answered long ago: do not wait for anyone to decide.
    const permission = item.event.hook_event_name === 'PermissionRequest';
    try {
      await postHook(state, item.event, { timeoutMs: permission ? 1500 : 5000 });
    } catch (error) {
      if (!permission) {
        io.err(`Lost the connection to the town: ${error.message}`);
        return -1;
      }
    }
    sent += 1;
  }
  return sent;
}
