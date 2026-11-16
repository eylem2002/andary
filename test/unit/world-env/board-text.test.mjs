import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampLines, cleanText, layoutBoard, wrapText } from '../../../public/js/world/env/board-text.js';

// One unit per character keeps the expectations readable.
const measure = (s) => Array.from(s).length;

test('cleanText strips control characters and collapses whitespace', () => {
  assert.equal(cleanText('  fix\tthe\nlogin\u0007  bug '), 'fix the login bug');
  assert.equal(cleanText(42), '');
  assert.equal(cleanText('x'.repeat(1000)).length, 240);
});

test('wrapText wraps on word boundaries', () => {
  assert.deepEqual(wrapText('write the unit tests first', 10, measure), ['write the', 'unit tests', 'first']);
});

test('wrapText splits words longer than a line', () => {
  assert.deepEqual(wrapText('see src/components/Header.tsx now', 10, measure), ['see', 'src/compon', 'ents/Heade', 'r.tsx now']);
});

test('wrapText returns no lines for empty text', () => {
  assert.deepEqual(wrapText('   ', 10, measure), []);
});

test('clampLines ends with an ellipsis that fits', () => {
  const out = clampLines(['aaaaaaaaaa', 'bbbbbbbbbb', 'cccc'], 2, 10, measure);
  assert.deepEqual(out, ['aaaaaaaaaa', 'bbbbbbbbb…']);
  assert.deepEqual(clampLines(['one'], 2, 10, measure), ['one']);
});

test('layoutBoard keeps order, caps items at two lines and summarises progress', () => {
  const layout = layoutBoard(
    /** @type {any} */ ([
      { text: 'Plan the refactor', status: 'completed' },
      { text: 'Rewrite the authentication middleware so it validates tokens', status: 'in_progress' },
      { text: 'Ship it', status: 'pending' },
    ]),
    { title: 'Sprint', maxWidth: 20, maxLines: 10, measure },
  );
  assert.equal(layout.title, 'Sprint');
  assert.equal(layout.summary, '1 of 3 done');
  assert.equal(layout.rows.length, 3);
  assert.equal(layout.rows[1].lines.length, 2);
  assert.ok(layout.rows[1].lines[1].endsWith('…'));
  assert.equal(layout.more, 0);
});

test('layoutBoard reports items that do not fit and keeps a line for the "+N more" note', () => {
  const items = /** @type {any} */ (Array.from({ length: 8 }, (_, i) => ({ text: `task ${i}`, status: 'pending' })));
  const layout = layoutBoard(items, { maxWidth: 20, maxLines: 4, measure });
  assert.equal(layout.rows.length, 3);
  assert.equal(layout.more, 5);
  assert.equal(layout.title, 'Goals');
});

test('layoutBoard tolerates bad input', () => {
  const layout = layoutBoard(
    /** @type {any} */ ([{ text: 'ok', status: 'weird' }, null, { text: '', status: 'pending' }]),
    { maxWidth: 20, maxLines: 4, measure },
  );
  assert.equal(layout.rows.length, 1);
  assert.equal(layout.rows[0].status, 'pending');
  assert.equal(layoutBoard(undefined, { maxWidth: 20, maxLines: 4, measure }).summary, 'No goals yet');
});
