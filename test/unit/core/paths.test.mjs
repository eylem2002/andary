// Paths as the town compares them (core/paths.js): absolute, with forward slashes, without `.` and
// `..`, a relative one joined to the folder it was given in. Nothing else is guessed: case and
// links stay as given.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { baseName, isInside, nestedWorkTree, normalizePath, sameWorkTree, workTreeRoot } from '../../../public/js/core/paths.js';

describe('normalizePath', () => {
  test('separators: backslashes become slashes, doubled and trailing ones go', () => {
    assert.equal(normalizePath('C:\\Users\\dev\\app\\src\\a.ts'), 'C:/Users/dev/app/src/a.ts');
    assert.equal(normalizePath('/home/dev//app///src/a.ts'), '/home/dev/app/src/a.ts');
    assert.equal(normalizePath('/home/dev/app/'), '/home/dev/app');
    assert.equal(normalizePath('  /home/dev/app/a.ts  '), '/home/dev/app/a.ts');
  });

  test('. and .. are resolved, and .. stops at the root', () => {
    assert.equal(normalizePath('/home/dev/app/./src/../lib/a.ts'), '/home/dev/app/lib/a.ts');
    assert.equal(normalizePath('/../../etc/hosts'), '/etc/hosts');
    assert.equal(normalizePath('C:\\work\\..\\..\\x.ts'), 'C:/x.ts');
    assert.equal(normalizePath('/home/dev/..'), '/home');
    assert.equal(normalizePath('/'), '/');
  });

  test("a relative path is joined to the hook's folder", () => {
    assert.equal(normalizePath('src/a.ts', '/home/dev/app'), '/home/dev/app/src/a.ts');
    assert.equal(normalizePath('../lib/b.ts', '/home/dev/app/src'), '/home/dev/app/lib/b.ts');
    assert.equal(normalizePath('.\\a.ts', 'C:\\work\\app'), 'C:/work/app/a.ts');
    assert.equal(normalizePath('/srv/a.ts', '/elsewhere'), '/srv/a.ts', 'an absolute path needs no folder');
  });

  test('a drive letter is one drive in either case; nothing else changes case', () => {
    assert.equal(normalizePath('c:/Work/App.ts'), 'C:/Work/App.ts');
    assert.equal(normalizePath('c:\\work\\a.ts'), normalizePath('C:/work/a.ts'));
    assert.notEqual(normalizePath('/home/dev/App.ts'), normalizePath('/home/dev/app.ts'), 'whether the disk ignores case is unknown');
  });

  test('a network share keeps its two slashes', () => {
    assert.equal(normalizePath('\\\\server\\share\\app\\a.ts'), '//server/share/app/a.ts');
    assert.equal(normalizePath('///srv//a.ts'), '/srv/a.ts');
  });

  test('what cannot be placed is empty: nothing, home, a variable, or relative to no folder', () => {
    /** @type {[unknown, unknown][]} */
    const cases = [['', '/x'], ['src/a.ts', ''], ['src/a.ts', 'relative/folder'], ['~/notes.md', '/x'], ['$HOME/a.ts', '/x'], ['%USERPROFILE%\\a.ts', 'C:\\x'], [null, '/x'], [{}, '/x'], [['/x/a.ts'], '/x'], ['a.ts', '~/code']];
    for (const [path, folder] of cases) assert.equal(normalizePath(path, folder), '', `${String(path)} in ${String(folder)}`);
  });
});

describe('isInside and baseName', () => {
  test('a path lies inside a folder by whole parts', () => {
    assert.equal(isInside('/repo/src/a.ts', '/repo'), true);
    assert.equal(isInside('/repo', '/repo'), true);
    assert.equal(isInside('/repository/a.ts', '/repo'), false, 'not just the same letters');
    assert.equal(isInside('/repo/a.ts', '/'), true);
    assert.equal(isInside('/repo/a.ts', ''), false);
  });

  test("a folder's name is its last part", () => {
    assert.equal(baseName('/home/dev/code/api-server'), 'api-server');
    assert.equal(baseName('C:/work'), 'work');
    assert.equal(baseName('/'), '/');
  });
});

describe('work trees', () => {
  const repo = '/home/dev/code/api';
  const tree = `${repo}/.claude/worktrees/feature`;

  test('a worktree Claude Code made inside the repository is a work tree of its own', () => {
    assert.equal(nestedWorkTree(`${tree}/src/a.ts`), tree);
    assert.equal(nestedWorkTree(tree), tree);
    assert.equal(nestedWorkTree(`${repo}/.claude/settings.json`), '');
    assert.equal(nestedWorkTree(`${tree}/.claude/worktrees/inner/x.ts`), `${tree}/.claude/worktrees/inner`, 'the innermost');
    assert.equal(sameWorkTree(`${repo}/a.ts`, `${repo}/b/c.ts`), true);
    assert.equal(sameWorkTree(`${repo}/a.ts`, `${tree}/a.ts`), false);
  });

  test("its top is a guess: such a worktree, else the crew's session folder when it holds the folder, else the folder", () => {
    assert.equal(workTreeRoot(`${repo}/packages/web`, repo), repo);
    assert.equal(workTreeRoot(`${tree}/src`, repo), tree);
    assert.equal(workTreeRoot('/srv/other', repo), '/srv/other');
    assert.equal(workTreeRoot(`${repo}/packages/web`), `${repo}/packages/web`);
  });
});
