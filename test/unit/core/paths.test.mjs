// Paths as the town compares them (core/paths.js): absolute, with forward slashes, without `.` and
// `..`, a relative one joined to the folder it was given in. Nothing else is guessed: case and
// links stay as given.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { baseName, insideAny, isInside, nestedWorkTree, normalizePath, sameWorkTree, workTreeOf } from '../../../public/js/core/paths.js';

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

  test('Git Bash writes a drive as a folder: /c/work is C:/work beside a folder on a drive', () => {
    assert.equal(normalizePath('/c/work/a.ts', 'C:\\Users\\dev'), 'C:/work/a.ts');
    assert.equal(normalizePath('/d', 'C:/x'), 'D:/');
    assert.equal(normalizePath('/c/work/a.ts', '/home/dev'), '/c/work/a.ts', 'not on a drive: as written');
    assert.equal(normalizePath('/cd/work', 'C:/x'), '/cd/work', 'one letter only');
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
  test('insideAny: inside one of many folders, by its own folders', () => {
    const folders = new Set(['/repo/src', '/repo/lib/a.ts', 'C:/', '//server/share']);
    assert.equal(insideAny('/repo/src/deep/a.ts', folders), true);
    assert.equal(insideAny('/repo/lib/a.ts', folders), true);
    assert.equal(insideAny('/repo/lib/b.ts', folders), false);
    assert.equal(insideAny('/repo/srcx/a.ts', folders), false, 'by whole parts');
    assert.equal(insideAny('C:/work/a.ts', folders), true, 'a drive');
    assert.equal(insideAny('//server/share/x', folders), true);
    assert.equal(insideAny('/a.ts', new Set(['/'])), true, 'the root');
    assert.equal(insideAny('/a.ts', new Set()), false);
  });

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

  test("without the server's answer its top is a guess: such a worktree, else the crew's session folder when it holds the folder, else the folder", () => {
    const guess = (/** @type {string} */ folder, /** @type {string} */ session = '') => workTreeOf(folder, session);
    assert.deepEqual(guess(`${repo}/packages/web`, repo), { root: repo, exact: false });
    assert.deepEqual(guess(`${tree}/src`, repo), { root: tree, exact: false });
    assert.deepEqual(guess('/srv/other', repo), { root: '/srv/other', exact: false });
    assert.deepEqual(guess(`${repo}/packages/web`), { root: `${repo}/packages/web`, exact: false });
  });

  test('the top the server found holds for any folder in it, but a worktree Claude Code made there', () => {
    assert.deepEqual(workTreeOf(`${repo}/packages/web`, '/home/dev', `${repo}/packages`), { root: `${repo}/packages`, exact: true });
    assert.deepEqual(workTreeOf(`${tree}/src`, repo, tree), { root: tree, exact: true });
    assert.deepEqual(workTreeOf(`${tree}/src`, repo, repo), { root: tree, exact: false }, 'a worktree inside it is its own');
    assert.deepEqual(workTreeOf('/srv/other', repo, repo), { root: '/srv/other', exact: false }, 'outside it: guessed');
  });
});
