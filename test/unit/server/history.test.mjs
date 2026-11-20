import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createHistory, createRecorder, recordingPath } from '../../../server/history.mjs';

const envelope = (/** @type {number} */ id) => ({ id, ts: id, rx: id, event: { hook_event_name: 'Stop', n: id } });

describe('createHistory', () => {
  it('keeps everything until full, oldest first', () => {
    const history = createHistory({ size: 3 });
    history.push(envelope(1));
    history.push(envelope(2));
    assert.deepEqual(history.list().map((e) => e.id), [1, 2]);
    assert.equal(history.length, 2);
  });

  it('drops the oldest envelopes once full', () => {
    const history = createHistory({ size: 3 });
    for (let id = 1; id <= 7; id += 1) history.push(envelope(id));
    assert.deepEqual(history.list().map((e) => e.id), [5, 6, 7]);
    assert.equal(history.length, 3);
  });

  it('returns a copy of the list', () => {
    const history = createHistory({ size: 2 });
    history.push(envelope(1));
    history.list().push(envelope(99));
    assert.equal(history.length, 1);
  });
});

describe('createRecorder', () => {
  it('appends JSON lines to a private file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-rec-'));
    try {
      const path = recordingPath(dir, new Date('2026-11-16T10:20:30.400Z'));
      assert.equal(path, join(dir, 'recordings', 'town-2026-11-16T10-20-30-400Z.jsonl'));
      const recorder = createRecorder(path);
      recorder.write(envelope(1));
      recorder.write(envelope(2));
      await recorder.close();
      await recorder.close();
      const lines = readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      assert.deepEqual(lines.map((e) => e.id), [1, 2]);
      if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
