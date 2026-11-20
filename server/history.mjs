// Recent events for browsers that connect late, and the optional on-disk recording.
// Envelopes hold prompts and commands, so they stay in memory unless the user passes --record.
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {{ id: number, ts: number, rx: number, event: object }} Envelope
 */

/**
 * The most recent envelopes, oldest first, bounded by count and by size: a browser that joins
 * late gets all of them in one message, and events can be large (up to the 1 MiB hook limit), so
 * a count alone would let history grow to gigabytes.
 * @param {{ size: number, maxBytes?: number }} options  maxBytes counts JSON characters
 * @returns {{ push: (envelope: Envelope, bytes?: number) => void, list: () => Envelope[], readonly length: number, readonly bytes: number }}
 */
export function createHistory({ size, maxBytes = Infinity }) {
  /** @type {Array<{ envelope: Envelope, bytes: number }>} */
  const items = [];
  let total = 0;
  return {
    push(envelope, bytes = 0) {
      items.push({ envelope, bytes });
      total += bytes;
      // The newest envelope always stays, even when it alone is over the budget.
      while (items.length > size || (total > maxBytes && items.length > 1)) total -= /** @type {{ bytes: number }} */ (items.shift()).bytes;
    },
    list() {
      return items.map((item) => item.envelope);
    },
    get length() {
      return items.length;
    },
    get bytes() {
      return total;
    },
  };
}

/**
 * @param {string} home
 * @param {Date} [now]
 * @returns {string} <home>/recordings/town-<UTC timestamp>.jsonl
 */
export function recordingPath(home, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return join(home, 'recordings', `town-${stamp}.jsonl`);
}

/**
 * Appends envelopes as JSON lines to a file only the owner can read.
 * @param {string} filePath
 * @returns {{ path: string, write: (envelope: Envelope) => void, close: () => Promise<void> }}
 */
export function createRecorder(filePath) {
  mkdirSync(join(filePath, '..'), { recursive: true, mode: 0o700 });
  const stream = createWriteStream(filePath, { flags: 'a', mode: 0o600 });
  // A full disk must not take the server down; recording simply stops.
  stream.on('error', () => {});
  return {
    path: filePath,
    write(envelope) {
      if (!stream.destroyed) stream.write(`${JSON.stringify(envelope)}\n`);
    },
    close() {
      return new Promise((resolve) => {
        if (stream.destroyed || stream.writableEnded) {
          resolve();
          return;
        }
        stream.end(() => resolve());
      });
    },
  };
}
