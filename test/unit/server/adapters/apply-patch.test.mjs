import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePatch } from '../../../../server/adapters/apply-patch.mjs';
import { PATCH } from './fixtures.mjs';

describe('parsePatch', () => {
  it('reads added, updated (with hunks and a move) and deleted files', () => {
    const files = parsePatch(PATCH);
    assert.deepEqual(files.map((f) => [f.op, f.path, f.moveTo, f.hunks.length]), [
      ['add', 'src/new.ts', null, 1],
      ['update', 'src/app.ts', null, 2],
      ['update', 'src/old-name.ts', 'src/new-name.ts', 1],
      ['delete', 'src/gone.ts', null, 0],
    ]);
    assert.deepEqual(files[0].hunks[0], { before: '', after: 'export const a = 1;\nexport const b = 2;' });
    assert.deepEqual(files[1].hunks[0], { before: 'const x = 1;\nconst y = 2;', after: 'const x = 1;\nconst y = 3;' });
    assert.deepEqual(files[1].hunks[1], { before: 'old()', after: 'renewed()' });
  });

  it('is empty for anything that is not a patch, and copes with CRLF', () => {
    for (const bad of [undefined, 42, '', 'diff --git a/x b/x', '*** Update File: x']) assert.deepEqual(parsePatch(bad), []);
    assert.equal(parsePatch(PATCH.replace(/\n/g, '\r\n')).length, 4);
  });

  it('ends at End Patch: a trailing newline or text after it adds nothing', () => {
    const one = ['*** Begin Patch', '*** Update File: a.ts', '@@', '-old', '+new', '*** End Patch', '', 'trailing'].join('\n');
    assert.deepEqual(parsePatch(one)[0].hunks, [{ before: 'old', after: 'new' }]);
    assert.deepEqual(parsePatch(`${one}\n`)[0].hunks, [{ before: 'old', after: 'new' }]);
  });

  it('a blank line between files is not context', () => {
    const text = ['*** Begin Patch', '*** Delete File: a.ts', '', '*** Update File: b.ts', '', '@@', '-x', '+y', '*** End Patch'].join('\n');
    assert.deepEqual(parsePatch(text).map((f) => f.hunks), [[], [{ before: 'x', after: 'y' }]]);
  });
});
