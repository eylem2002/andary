// Where a folder's git work tree starts (server/work-trees.mjs): the nearest folder up that holds
// `.git`, a folder or a linked worktree's file, kept for a few minutes for a bounded number of
// folders; and the stamp ingest puts on a local tool hook.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { MAX_FOLDERS, REFRESH_MS, createWorkTrees, withWorkTree } from '../../../server/work-trees.mjs';

describe('work trees on disk', () => {
  const home = mkdtempSync(join(tmpdir(), 'andary-trees-'));
  after(() => rmSync(home, { recursive: true, force: true }));

  test('the nearest folder holding .git: a repository, a linked worktree (a .git file), or none', () => {
    const repo = join(home, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    mkdirSync(join(repo, 'packages', 'web', 'src'), { recursive: true });
    const linked = join(repo, '.claude', 'worktrees', 'feature');
    mkdirSync(join(linked, 'src'), { recursive: true });
    writeFileSync(join(linked, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'feature')}\n`);
    mkdirSync(join(home, 'plain'), { recursive: true });
    const trees = createWorkTrees();
    // Read back with forward slashes, as the town compares folders (Windows gives backslashes).
    const slashed = (/** @type {string} */ path) => path.replace(/\\/g, '/');
    assert.equal(trees.rootOf(join(repo, 'packages', 'web', 'src')), slashed(repo));
    assert.equal(trees.rootOf(repo), slashed(repo));
    assert.equal(trees.rootOf(join(linked, 'src')), slashed(linked));
    assert.equal(trees.rootOf(join(home, 'plain')), null);
  });

  test('not a folder it can look up: nothing', () => {
    const trees = createWorkTrees({ exists: () => true });
    for (const folder of [undefined, '', 'relative/path', 42, `/${'x'.repeat(5000)}`]) assert.equal(trees.rootOf(folder), null, String(folder).slice(0, 20));
  });

  test('Windows folders are read with forward slashes, as the town compares them', () => {
    const trees = createWorkTrees({ exists: (path) => path === 'C:/r/.git' || path === '//host/share/x/.git' });
    assert.equal(trees.rootOf('C:\\r\\app\\src'), 'C:/r');
    assert.equal(trees.rootOf('C:/r/'), 'C:/r');
    assert.equal(trees.rootOf('\\\\host\\share\\x\\y'), '//host/share/x');
    assert.equal(trees.rootOf('D:\\other'), null, 'walks up to the drive and stops');
  });

  test('an answer is kept for a few minutes, for a bounded number of folders', () => {
    let now = 0;
    /** @type {string[]} */
    const looked = [];
    let repo = true;
    const trees = createWorkTrees({ now: () => now, exists: (path) => (looked.push(path), repo && path === '/w/app/.git') });
    assert.equal(trees.rootOf('/w/app/src'), '/w/app');
    const asked = looked.length;
    repo = false;
    now = REFRESH_MS - 1;
    assert.equal(trees.rootOf('/w/app/src'), '/w/app', 'kept');
    assert.equal(looked.length, asked);
    now = REFRESH_MS;
    assert.equal(trees.rootOf('/w/app/src'), null, 'looked up again: the repository is gone');
    for (let i = 0; i <= MAX_FOLDERS; i += 1) trees.rootOf(`/w/f${i}`);
    const before = looked.length;
    trees.rootOf('/w/f0');
    assert.ok(looked.length > before, 'the folder asked about the longest ago was forgotten');
  });

  test('withWorkTree: stamps tool hooks only, and never keeps a stamp it did not make', () => {
    const trees = { rootOf: () => '/w/app' };
    const tool = { hook_event_name: 'PostToolUse', cwd: '/w/app/src', tool_name: 'Edit' };
    assert.equal(withWorkTree({ ...tool, andary_root: '/x' }, trees).andary_root, '/w/app');
    assert.equal('andary_root' in withWorkTree({ ...tool, andary_root: '/x' }, null), false);
    assert.equal('andary_root' in withWorkTree({ hook_event_name: 'Stop', andary_root: '/x' }, trees), false);
    const plain = { hook_event_name: 'Stop' };
    assert.equal(withWorkTree(plain, trees), plain, 'unchanged: the same object');
    assert.equal('andary_root' in withWorkTree(tool, { rootOf: () => null }), false);
  });
});
