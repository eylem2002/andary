// Recent events for browsers that connect late, and the optional on-disk recording.
// Envelopes hold prompts and commands, so they stay in memory unless the user passes --record.
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {{ id: number, ts: number, rx: number, event: object }} Envelope
 */

/**
 * Fixed-size ring buffer of envelopes, oldest first.
 * @param {{ size: number }} options
 * @returns {{ push: (envelope: Envelope) => void, list: () => Envelope[], readonly length: number }}
 */
export function createHistory({ size }) {
  /** @type {Envelope[]} */
  const items = [];
  let start = 0;
  return {
    push(envelope) {
      if (items.length < size) {
        items.push(envelope);
        return;
      }
      items[start] = envelope;
      start = (start + 1) % size;
    },
    list() {
      return start === 0 ? items.slice() : items.slice(start).concat(items.slice(0, start));
    },
    get length() {
      return items.length;
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
