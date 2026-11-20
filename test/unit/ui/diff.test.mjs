import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffStats, lineDiff } from '../../../public/js/ui/diff.js';
import { changeHunks, createStore } from '../../../public/js/core/store.js';
import { CWD, envelope, hook } from '../core/helpers.mjs';

test('lineDiff keeps shared lines and marks the rest', () => {
  assert.deepEqual(lineDiff('a\nb\nc\n', 'a\nB\nc\nd'), [
    { op: 'same', text: 'a' },
    { op: 'del', text: 'b' },
    { op: 'add', text: 'B' },
    { op: 'same', text: 'c' },
    { op: 'add', text: 'd' },
  ]);
  assert.deepEqual(lineDiff('', 'x'), [{ op: 'add', text: 'x' }]);
  assert.deepEqual(lineDiff('x\r\ny', 'x\ny'), [{ op: 'same', text: 'x' }, { op: 'same', text: 'y' }]);
  assert.deepEqual(lineDiff('', ''), []);
});

test('lineDiff compares very long texts as one block instead of building a huge table', () => {
  const big = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
  const out = lineDiff(big, 'short');
  assert.equal(out.length, 501);
  assert.equal(out.filter((l) => l.op === 'del').length, 500);
});

test('diffStats counts added and removed lines over every hunk', () => {
  assert.deepEqual(diffStats([{ before: 'a\nb', after: 'a\nc\nd' }, { before: '', after: 'z' }]), { added: 3, removed: 1 });
});

test('changeHunks reads Edit, MultiEdit, Write and NotebookEdit, and ignores other tools', () => {
  assert.deepEqual(changeHunks('Edit', { old_string: 'a', new_string: 'b' }), { whole: false, list: [{ before: 'a', after: 'b' }] });
  assert.deepEqual(changeHunks('MultiEdit', { edits: [{ old_string: 'x', new_string: 'y' }, null] }), { whole: false, list: [{ before: 'x', after: 'y' }] });
  assert.deepEqual(changeHunks('Write', { content: 'hello' }), { whole: true, list: [{ before: '', after: 'hello' }] });
  assert.deepEqual(changeHunks('NotebookEdit', { new_source: 'print(1)' }), { whole: true, list: [{ before: '', after: 'print(1)' }] }, 'a cell is written whole');
  const long = changeHunks('Edit', { old_string: 'a', new_string: 'b'.repeat(5000) });
  assert.equal(long?.list[0].after.length, 4000);
  assert.equal(long?.list[0].cut, true, 'a cut edit says so');
  assert.equal(changeHunks('Read', { file_path: 'x' }), null);
  assert.equal(changeHunks('Edit', { old_string: 5, new_string: 'b' })?.list[0].before, '');
});

test('the store keeps an agent\'s finished edits, newest last, with paths relative to the crew', () => {
  let t = 1_000_000;
  const store = createStore({ localHour: () => 12, now: () => t });
  const send = (/** @type {any} */ p) => store.ingest(envelope(p, (t += 10)));
  send(hook('SessionStart', { source: 'startup', model: 'claude-opus-5-5' }));
  const input = { file_path: `${CWD}/src/lib/clock.ts`, old_string: 'Date.now()', new_string: 'clock.now()' };
  send(hook('PreToolUse', { tool_name: 'Edit', tool_input: input, tool_use_id: 'e1' }));
  assert.equal(store.getState().agents[Object.keys(store.getState().agents)[0]].changes.length, 0, 'not before it finished');
  send(hook('PostToolUse', { tool_name: 'Edit', tool_input: input, tool_response: {}, tool_use_id: 'e1', duration_ms: 5 }));
  send(hook('PostToolUse', { tool_name: 'Read', tool_input: { file_path: `${CWD}/a.ts` }, tool_response: {}, tool_use_id: 'r1', duration_ms: 5 }));
  for (let i = 0; i < 25; i += 1) send(hook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: `${CWD}/f${i}.ts`, content: 'x' }, tool_response: {}, tool_use_id: `w${i}`, duration_ms: 5 }));
  const lead = Object.values(store.getState().agents)[0];
  assert.equal(lead.changes.length, 20, 'only the last 20 are kept');
  assert.equal(lead.changes.at(-1).path, 'f24.ts');
  assert.equal(lead.changes.at(-1).whole, true);
  const fresh = createStore({ localHour: () => 12, now: () => t });
  fresh.ingest(envelope(hook('PostToolUse', { tool_name: 'Edit', tool_input: input, tool_response: {}, tool_use_id: 'e1', duration_ms: 5 }), t));
  assert.deepEqual(Object.values(fresh.getState().agents)[0].changes[0].hunks, [{ before: 'Date.now()', after: 'clock.now()' }]);
  assert.equal(Object.values(fresh.getState().agents)[0].changes[0].path, 'src/lib/clock.ts');
});
