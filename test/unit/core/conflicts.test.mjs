// Two agents on the same files (core/conflicts.js): an edit over another active agent's recent
// change is a note, a write over it or a git command over others' changes an alert; each lasts half
// an hour or until its agents finish. The rules on their own, then as the store feeds them.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CONFLICT_MS, MAX_AGENTS_PER_PATH, MAX_HAZARDS, MAX_PATHS, createConflicts, hazardText } from '../../../public/js/core/conflicts.js';
import { gitAddsOf, gitHazardOf } from '../../../public/js/core/git-commands.js';
import { createStore } from '../../../public/js/core/store.js';
import { CWD, envelope, hook } from './helpers.mjs';

const T0 = 1_000_000;
const A = 'crew-a:main';
const B = 'crew-b:main';
const C = 'crew-c:main';
const FILE = `${CWD}/src/auth.ts`;

/** The rules, and short ways to report a file change or a git command to them. */
function rules() {
  const c = createConflicts();
  /** @param {string} agent @param {number} at @param {{ lead?: string|null, since?: number }} [helper] */
  const actor = (agent, at, helper = {}) => ({ agent, session: agent.split(':')[0], at, lead: helper.lead ?? null, since: helper.since ?? 0 });
  return {
    c,
    /**
     * @param {string} agent @param {string} tool @param {string} path @param {number} at @param {string} [folder]
     * @param {{ lead?: string|null, since?: number, created?: boolean }} [more]  created: a Write that made the file
     */
    change: (agent, tool, path, at, folder = CWD, more = {}) => c.changed({ ...actor(agent, at, more), tool, path, folder, created: more.created }),
    /**
     * @param {string} agent @param {string} command  a command line, read by git-commands.js
     * @param {number} at @param {string} [folder]
     * @param {{ lead?: string|null, since?: number, sessionFolder?: string, root?: string, toolUseId?: string }} [more]
     */
    run(agent, command, at, folder = CWD, more = {}) {
      const git = gitHazardOf(command, { folder, sessionFolder: more.sessionFolder ?? CWD, root: more.root }, { staged: c.staged(agent), known: (path) => c.knows(path) });
      assert.ok(git, `a git hazard: ${command}`);
      return c.command({ ...actor(agent, at, more), ...git, toolUseId: more.toolUseId ?? null, callKey: null });
    },
  };
}

/** A commit's scope, as git-commands.js reports one. @param {string[]} paths @param {Partial<import('../../../public/js/core/git-commands.js').GitCommit>} [more] */
const commit = (paths, more = {}) => ({ folder: CWD, root: CWD, exact: false, tracked: false, clears: true, paths, ...more });

describe('same file', () => {
  test("an edit over another agent's change is a note; a write over it an alert that replaces the note", () => {
    const r = rules();
    assert.deepEqual(r.change(A, 'Edit', FILE, T0), [], 'nobody else changed it');
    const [note] = r.change(B, 'Edit', FILE, T0 + 60_000);
    assert.deepEqual([note.kind, note.agentKey, note.others, note.path, note.at], ['edit', B, [{ key: A, sessionId: 'crew-a', files: 1, at: T0 }], FILE, T0 + 60_000]);
    const [alert] = r.change(B, 'Write', FILE, T0 + 120_000);
    assert.deepEqual([alert.kind, alert.others[0].key, alert.others[0].at], ['write', A, T0]);
    assert.notEqual(alert.id, note.id, 'a new episode, a new id');
    assert.deepEqual(r.c.list().map((h) => h.kind), ['write']);
  });

  test("an agent's own changes never count, nor another file", () => {
    const r = rules();
    r.change(A, 'Edit', FILE, T0);
    assert.deepEqual(r.change(A, 'Write', FILE, T0 + 1), []);
    assert.deepEqual(r.change(B, 'Write', `${CWD}/src/other.ts`, T0 + 2), []);
    assert.deepEqual(r.change(B, 'Read', FILE, T0 + 3), [], 'reading changes nothing');
  });

  test('only a change in the last 30 minutes counts', () => {
    const r = rules();
    r.change(A, 'Edit', FILE, T0);
    assert.deepEqual(r.change(B, 'Write', FILE, T0 + CONFLICT_MS + 1), []);
    const s = rules();
    s.change(A, 'Edit', FILE, T0);
    assert.equal(s.change(B, 'Write', FILE, T0 + CONFLICT_MS).length, 1);
  });

  test('the same pair on the same file is one episode, until the other agent changes it again', () => {
    const r = rules();
    r.change(A, 'Edit', FILE, T0);
    const [first] = r.change(B, 'Write', FILE, T0 + 1000);
    assert.deepEqual(r.change(B, 'Write', FILE, T0 + 2000), [], 'writing again is the same episode');
    const [back] = r.change(A, 'Edit', FILE, T0 + 4000);
    assert.deepEqual([back.agentKey, back.others[0].key, back.kind], [A, B, 'edit'], 'the other way round is a pair of its own');
    const [again] = r.change(B, 'Write', FILE, T0 + 5000);
    assert.equal(again.others[0].at, T0 + 4000, 'over the newer change');
    assert.notEqual(again.id, first.id);
    assert.deepEqual(r.c.list().map((h) => [h.agentKey, h.kind]), [[A, 'edit'], [B, 'write']]);
  });

  test('a counted alert stays counted until it ends: edits after it, even over newer changes, add nothing', () => {
    const r = rules();
    r.change(A, 'Edit', FILE, T0);
    const [alert] = r.change(B, 'Write', FILE, T0 + 1000);
    r.change(A, 'Edit', FILE, T0 + 2000);
    assert.deepEqual(r.change(B, 'Edit', FILE, T0 + 3000), []);
    assert.deepEqual(r.c.list().filter((h) => h.agentKey === B).map((h) => [h.id, h.kind]), [[alert.id, 'write']]);
  });

  test('every other agent on the file is a pair of its own', () => {
    const r = rules();
    r.change(A, 'Edit', FILE, T0);
    r.change(C, 'Edit', FILE, T0 + 1);
    assert.deepEqual(r.change(B, 'Write', FILE, T0 + 2).map((h) => h.others[0].key).sort(), [A, C]);
  });

  test("paths are compared normalised: a relative path is the hook folder's, backslashes and dots go", () => {
    const r = rules();
    r.change(A, 'Edit', `${CWD}/src/./lib/../auth.ts`, T0);
    const [hazard] = r.change(B, 'Write', 'src\\auth.ts', T0 + 1);
    assert.equal(hazard?.path, FILE);
    assert.deepEqual(r.change(C, 'Write', '~/auth.ts', T0 + 2), [], 'a path it cannot place is no change');
  });

  test('a helper changing what its lead changed before it started is a hand-off, not a conflict', () => {
    const r = rules();
    const helper = 'crew-a:h1';
    r.change(A, 'Write', FILE, T0);
    assert.deepEqual(r.change(helper, 'Write', FILE, T0 + 2000, CWD, { lead: A, since: T0 + 1000 }), []);
    assert.deepEqual(r.change(helper, 'Edit', FILE, T0 + 3000, CWD, { lead: A, since: T0 + 1000 }), []);
    r.change(A, 'Edit', FILE, T0 + 4000);
    assert.equal(r.change(helper, 'Write', FILE, T0 + 5000, CWD, { lead: A, since: T0 + 1000 }).length, 1, 'a change the lead made after it started still counts');
  });

  test('a hazard ends when either agent finishes, or its crew leaves; their changes are forgotten', () => {
    const r = rules();
    r.change(A, 'Edit', FILE, T0);
    r.change(B, 'Write', FILE, T0 + 1);
    assert.equal(r.c.finished(A), true);
    assert.deepEqual(r.c.list(), []);
    assert.deepEqual(r.change(C, 'Write', FILE, T0 + 2).map((h) => h.others[0].key), [B], "A's change is gone, B's is not");
    assert.equal(r.c.ended('crew-c'), true);
    assert.deepEqual(r.c.list(), []);
    assert.equal(r.c.ended('crew-c'), false, 'nothing more to end');
  });

  test('a hazard ends 30 minutes after it started', () => {
    const r = rules();
    r.change(A, 'Edit', FILE, T0);
    r.change(B, 'Write', FILE, T0 + 1000);
    assert.equal(r.c.expire(T0 + 1000 + CONFLICT_MS - 1), false);
    assert.equal(r.c.expire(T0 + 1000 + CONFLICT_MS), true);
    assert.deepEqual(r.c.list(), []);
    assert.equal(r.c.expire(T0), false, 'an older time changes nothing');
  });
});

describe('git hazards', () => {
  test('one alert per command, naming every other agent with changes there, and how many', () => {
    const r = rules();
    for (const [i, file] of ['src/a.ts', 'src/b.ts', 'README.md'].entries()) r.change(A, 'Edit', `${CWD}/${file}`, T0 + i);
    r.change(A, 'Write', `${CWD}/src/a.ts`, T0 + 10);
    r.change(C, 'Edit', `${CWD}/src/c.ts`, T0 + 11);
    const found = r.run(B, 'git stash', T0 + 60_000);
    assert.equal(found.length, 1);
    assert.deepEqual([found[0].kind, found[0].agentKey, found[0].command, found[0].folder], ['git', B, 'git stash', CWD]);
    assert.deepEqual(found[0].others, [{ key: A, sessionId: 'crew-a', files: 3, at: T0 + 10 }, { key: C, sessionId: 'crew-c', files: 1, at: T0 + 11 }]);
  });

  test('only what its pathspecs name', () => {
    const r = rules();
    r.change(A, 'Edit', `${CWD}/src/b.ts`, T0);
    for (const command of ['git restore src/a.ts', 'git checkout -- src/a.ts', 'git stash push -- src/a.ts', 'git clean -f docs']) assert.deepEqual(r.run(B, command, T0 + 1), [], command);
    assert.equal(r.run(B, 'git checkout -- src', T0 + 2).length, 1, 'a folder holds its files');
    assert.equal(r.run(B, 'git restore src/b.ts', T0 + 3).length, 1);
  });

  test('a monorepo: the whole work tree from a package, up to the folder the crew started in', () => {
    const r = rules();
    r.change(A, 'Edit', `${CWD}/packages/api/server.ts`, T0, `${CWD}/packages/api`);
    assert.equal(r.run(B, 'git stash', T0 + 1, `${CWD}/packages/web`, { sessionFolder: CWD }).length, 1, 'stash takes the sibling package too');
    assert.deepEqual(r.run(B, 'git clean -fd', T0 + 2, `${CWD}/packages/web`, { sessionFolder: CWD }), [], 'clean stays in its folder');
    assert.deepEqual(r.run(B, 'git reset --hard', T0 + 3, '/home/dev/code/billing', { sessionFolder: '/home/dev/code/billing' }), [], 'another repository');
    const s = rules();
    s.change(A, 'Edit', `${CWD}/README.md`, T0);
    assert.equal(s.run(B, 'git stash', T0 + 1, `${CWD}/packages/web`, { sessionFolder: `${CWD}/packages/web` }).length, 1, 'a crew started in a package: the folder the other agent worked in holds it');
  });

  test('a worktree Claude Code made inside the repository is a work tree of its own, both ways', () => {
    const tree = `${CWD}/.claude/worktrees/feature`;
    const r = rules();
    r.change(A, 'Edit', `${CWD}/src/a.ts`, T0);
    r.change(C, 'Edit', `${tree}/src/a.ts`, T0 + 1, tree);
    assert.deepEqual(r.run(B, 'git commit -am wip', T0 + 2, tree).map((h) => h.others.map((o) => o.key)), [[C]], 'from the worktree: only the worktree');
    assert.deepEqual(r.run('crew-d:main', 'git stash', T0 + 3, CWD).map((h) => h.others.map((o) => o.key)), [[A]], 'from the checkout: not the worktree');
  });

  test('changes older than 30 minutes, or after the command started, do not count', () => {
    const r = rules();
    r.change(A, 'Edit', FILE, T0);
    assert.deepEqual(r.run(B, 'git stash', T0 + CONFLICT_MS + 1), []);
    const s = rules();
    s.change(A, 'Edit', FILE, T0 + 10);
    assert.deepEqual(s.run(B, 'git stash', T0), []);
  });

  test('run again, the same command alerts again only for newer changes; another command alerts anew', () => {
    const r = rules();
    r.change(A, 'Edit', FILE, T0);
    assert.equal(r.run(B, 'git add -A && git commit -m x', T0 + 1000).length, 1);
    assert.deepEqual(r.run(B, 'git add -A && git commit -m y', T0 + 2000), [], 'what it swept up was seen');
    r.change(A, 'Edit', `${CWD}/src/b.ts`, T0 + 3000);
    assert.equal(r.run(B, 'git add -A && git commit -m z', T0 + 4000)[0]?.others[0].files, 1, 'only the newer change');
    assert.equal(r.run(B, 'git reset --hard', T0 + 5000)[0]?.others[0].files, 2);
  });

  test("a commit that went through takes its committer's changes out: all for -a, else what it named", () => {
    const r = rules();
    r.change(A, 'Edit', `${CWD}/src/a.ts`, T0);
    r.change(A, 'Edit', `${CWD}/src/b.ts`, T0 + 1);
    r.c.committed({ agent: A, ...commit([`${CWD}/src/a.ts`]) });
    assert.equal(r.run(B, 'git commit -am wip', T0 + 600_000)[0]?.others[0].files, 1, 'b.ts is still uncommitted');
    r.c.committed({ agent: A, ...commit([]) });
    assert.deepEqual(r.run(C, 'git commit -am wip', T0 + 600_001), []);
    assert.deepEqual(r.change(C, 'Write', `${CWD}/src/b.ts`, T0 + 600_002), [], 'nor a write over it');
  });

  test('a helper commits what its lead handed it; throwing that away still counts', () => {
    const r = rules();
    const helper = { lead: A, since: T0 + 1000 };
    r.change(A, 'Edit', FILE, T0);
    assert.deepEqual(r.run('crew-a:h1', 'git add -A && git commit -m done', T0 + 2000, CWD, helper), []);
    assert.equal(r.run('crew-a:h1', 'git stash', T0 + 3000, CWD, helper).length, 1);
  });

  test('when one of the agents it names finishes, it goes on about the others', () => {
    const r = rules();
    r.change(A, 'Edit', `${CWD}/a.ts`, T0);
    r.change(C, 'Edit', `${CWD}/c.ts`, T0 + 1);
    r.run(B, 'git stash', T0 + 2);
    assert.equal(r.c.finished(A), true);
    assert.deepEqual(r.c.list().map((h) => h.others.map((o) => o.key)), [[C]]);
    r.c.ended('crew-c');
    assert.deepEqual(r.c.list(), []);
  });

  test('git clean takes only files agents made; a stash, a checkout and commit -a only tracked ones', () => {
    const r = rules();
    r.change(A, 'Edit', `${CWD}/src/a.ts`, T0);
    r.change(A, 'Write', `${CWD}/src/new.ts`, T0 + 1, CWD, { created: true });
    r.change(A, 'Edit', `${CWD}/src/new.ts`, T0 + 2);
    assert.deepEqual(r.run(B, 'git clean -fd', T0 + 10).map((h) => h.others[0].files), [1], 'new.ts, still new after an edit');
    assert.deepEqual(r.run(B, 'git stash', T0 + 11).map((h) => h.others[0].files), [1], 'a.ts: a stash leaves new files');
    assert.deepEqual(r.run('crew-e:main', 'git stash -u', T0 + 12).map((h) => h.others[0].files), [2]);
    assert.deepEqual(r.run(C, 'git commit -am wip', T0 + 13).map((h) => h.others[0].files), [1]);
    r.c.committed({ agent: A, ...commit([], { tracked: true }) });
    assert.deepEqual(r.run(C, 'git clean -f', T0 + 14).map((h) => h.others[0].files), [1], 'commit -a takes no new file in');
    r.c.committed({ agent: A, ...commit([]) });
    assert.deepEqual(r.run('crew-d:main', 'git clean -f', T0 + 15), [], 'a whole-tree add does');
  });

  test('a commit counts what the agent staged in an earlier call; its own commit takes that in', () => {
    const r = rules();
    const place = { folder: CWD, sessionFolder: CWD };
    r.change(A, 'Edit', FILE, T0);
    r.c.added(B, 'crew-b', gitAddsOf('git add -A', place));
    const [swept] = r.run(B, 'git commit -m "$(cat <<\'EOF\'\nSave\nEOF\n)"', T0 + 1000);
    assert.deepEqual([swept?.command, swept?.others[0].key], ['git commit after git add -A', A]);
    r.c.added(A, 'crew-a', gitAddsOf('git add src/auth.ts', place));
    assert.equal(r.c.staged(A).length, 1);
    r.c.committed({ agent: A, ...commit([FILE]) });
    assert.deepEqual(r.c.staged(A), [], 'committed: nothing staged there any more');
    assert.deepEqual(r.run(C, 'git reset --hard', T0 + 2000), [], 'and its work is safe');
  });

  test("git checkout <path> without --: a path when an agent changed it", () => {
    const r = rules();
    r.change(A, 'Edit', FILE, T0);
    assert.equal(r.c.knows(FILE), true);
    assert.equal(r.c.knows(`${CWD}/src`), true, 'a folder holding it');
    assert.equal(r.c.knows(`${CWD}/lib`), false);
    assert.deepEqual(r.run(B, 'git checkout src/auth.ts', T0 + 1).map((h) => h.command), ['git checkout src/auth.ts']);
  });

  test("the top the server found on disk: a sibling repository's files are not this one's", () => {
    const mono = '/home/dev/workspace';
    const r = rules();
    r.change(A, 'Edit', `${mono}/billing/src/a.ts`, T0, `${mono}/billing`);
    assert.deepEqual(r.run(B, 'git stash', T0 + 1, `${mono}/api`, { sessionFolder: mono, root: `${mono}/api` }), [], 'api is a repository of its own');
    assert.equal(r.run(B, 'git stash', T0 + 2, `${mono}/api`, { sessionFolder: mono }).length, 1, 'guessed: the whole workspace');
    assert.deepEqual(r.run(C, 'git add ../billing/src && git commit -m x', T0 + 3, `${mono}/api`, { sessionFolder: mono, root: `${mono}/api` }), [], 'outside the work tree: git refuses it');
  });

  test('a refused command ends its alert, found by its call', () => {
    const r = rules();
    r.change(A, 'Edit', FILE, T0);
    r.run(B, 'git stash', T0 + 1, CWD, { toolUseId: 'call-1' });
    assert.equal(r.c.refused({ agent: B, toolUseId: 'call-2' }), false, 'another call');
    assert.equal(r.c.refused({ agent: A, toolUseId: 'call-1' }), false, 'another agent');
    assert.equal(r.c.refused({ agent: B, toolUseId: 'call-1' }), true);
    assert.deepEqual(r.c.list(), []);
    assert.deepEqual(r.change(C, 'Edit', `${CWD}/src/late.ts`, T0), [], 'a late change finds no refused command');
  });

  test(`many pathspecs over a full memory stay cheap: ${MAX_PATHS} files of ${MAX_AGENTS_PER_PATH} agents`, () => {
    const r = rules();
    for (let file = 0; file < MAX_PATHS; file += 1) {
      for (let agent = 0; agent < MAX_AGENTS_PER_PATH; agent += 1) r.change(`crew-${agent}:main`, 'Edit', `${CWD}/src/dir${file % 40}/f${file}.ts`, T0 + file);
    }
    const specs = (/** @type {number} */ count) => Array.from({ length: count }, (_, i) => `src/dir${i % 40}/f${i}.ts`).join(' ');
    for (const [i, line] of [`git add ${specs(60)} && git commit -m x`, `git add ${specs(200)} && git commit -m x`, `git restore ${specs(60)}`].entries()) {
      const started = performance.now();
      const found = r.run(`crew-x${i}:main`, line, T0 + MAX_PATHS);
      assert.ok(performance.now() - started < 150, `${line.length} characters in ${Math.round(performance.now() - started)} ms`);
      assert.equal(found.length, 1);
    }
  });
});

describe('a helper that finishes leaves its work to its lead', () => {
  const H1 = 'crew-a:h1';
  const H2 = 'crew-a:h2';

  test("its changes stay in harm's way, as its lead's", () => {
    const r = rules();
    r.change(H1, 'Edit', FILE, T0, CWD, { lead: A, since: 0 });
    r.change(H1, 'Write', `${CWD}/src/new.ts`, T0 + 1, CWD, { lead: A, since: 0, created: true });
    r.c.finished(H1, A);
    assert.deepEqual(r.change(B, 'Write', FILE, T0 + 2).map((h) => [h.others[0].key, h.others[0].at]), [[A, T0]], "a write over it is over the lead's");
    assert.deepEqual(r.run(C, 'git clean -f', T0 + 3).map((h) => h.others[0].key), [A], 'the file it made is still new');
    assert.deepEqual(r.change(A, 'Write', FILE, T0 + 4).map((h) => h.others[0].key), [B], "the lead's own write over it is silent; only B's counts");
  });

  test('a later helper of the same lead is handed it; throwing it away still counts', () => {
    const r = rules();
    r.change(H1, 'Edit', FILE, T0, CWD, { lead: A, since: 0 });
    r.c.finished(H1, A);
    assert.deepEqual(r.change(H2, 'Write', FILE, T0 + 2000, CWD, { lead: A, since: T0 + 1000 }), []);
    assert.equal(r.run(H2, 'git checkout -- src/auth.ts', T0 + 3000, CWD, { lead: A, since: T0 + 1000 }).length, 1);
  });

  test('hazards about its work now name the lead; those it did end, and so do the ones the lead did over it', () => {
    const r = rules();
    r.change(H1, 'Edit', FILE, T0, CWD, { lead: A, since: 0 });
    r.change(B, 'Write', FILE, T0 + 1);
    r.change(H1, 'Edit', `${CWD}/b.ts`, T0 + 2, CWD, { lead: A, since: 0 });
    r.change(A, 'Write', `${CWD}/b.ts`, T0 + 3);
    r.change(C, 'Edit', `${CWD}/c.ts`, T0 + 4);
    r.change(H1, 'Write', `${CWD}/c.ts`, T0 + 5, CWD, { lead: A, since: 0 });
    r.run('crew-d:main', 'git stash', T0 + 6);
    assert.equal(r.c.finished(H1, A), true);
    assert.deepEqual(r.c.list().map((h) => [h.kind, h.agentKey, h.others.map((o) => [o.key, o.files])]), [
      ['write', B, [[A, 1]]],
      ['git', 'crew-d:main', [[A, 4], [C, 1], [B, 1]]],
    ]);
    assert.deepEqual(r.c.list()[1].others.find((o) => o.key === A)?.at, T0 + 5, "the lead's latest change of them");
  });

  test('what it staged waits for the lead to commit it', () => {
    const r = rules();
    r.c.added(H1, 'crew-a', gitAddsOf('git add src/auth.ts', { folder: CWD, sessionFolder: CWD }));
    r.c.finished(H1, A);
    assert.deepEqual(r.c.staged(A).map((add) => add.command), ['git add src/auth.ts']);
    assert.deepEqual(r.c.staged(H1), []);
  });
});

describe('hooks that arrive out of order', () => {
  test('an older change arriving after a newer write is the other way round: the write is over it', () => {
    const r = rules();
    assert.deepEqual(r.change(B, 'Write', FILE, T0 + 2000), []);
    const [alert] = r.change(A, 'Edit', FILE, T0 + 1000);
    assert.deepEqual([alert?.kind, alert?.agentKey, alert?.others[0].key, alert?.at, alert?.others[0].at], ['write', B, A, T0 + 2000, T0 + 1000]);
    const s = rules();
    s.change(B, 'Edit', FILE, T0 + 2000);
    assert.deepEqual(s.change(A, 'Write', FILE, T0 + 1000).map((h) => [h.kind, h.agentKey]), [['edit', B]], "a newer edit over it: B's note");
  });

  test("an agent's older change arriving late leaves its newer one standing", () => {
    const r = rules();
    r.change(A, 'Edit', FILE, T0 + 5000);
    r.change(A, 'Edit', FILE, T0 + 1000);
    assert.deepEqual(r.change(B, 'Write', FILE, T0 + 6000).map((h) => h.others[0].at), [T0 + 5000]);
  });

  test('a change arriving after a git command that started later counts for it: in its alert, or a new one', () => {
    const r = rules();
    r.change(C, 'Edit', `${CWD}/c.ts`, T0);
    const [first] = r.run(B, 'git stash', T0 + 2000);
    assert.deepEqual(r.change(A, 'Edit', FILE, T0 + 1000), [], 'joins the alert there is');
    assert.deepEqual(r.c.list().find((h) => h.id === first.id)?.others.map((o) => o.key), [A, C], 'the latest first');
    const s = rules();
    assert.deepEqual(s.run(B, 'git reset --hard', T0 + 2000), []);
    assert.deepEqual(s.change(A, 'Edit', FILE, T0 + 1000).map((h) => [h.kind, h.agentKey, h.command, h.others[0].key]), [['git', B, 'git reset --hard', A]]);
    assert.deepEqual(s.change(A, 'Edit', `${CWD}/x.ts`, T0 + 3000), [], 'a change after the command is none of its business');
  });
});

describe('memory bounds', () => {
  test(`at most ${MAX_PATHS} files: the one changed the longest ago is forgotten`, () => {
    const r = rules();
    for (let i = 0; i <= MAX_PATHS; i += 1) r.change(A, 'Edit', `${CWD}/f${i}.ts`, T0 + i);
    assert.equal(r.change(B, 'Write', `${CWD}/f1.ts`, T0 + 5000).length, 1);
    assert.deepEqual(r.change(B, 'Write', `${CWD}/f0.ts`, T0 + 5001), []);
  });

  test(`at most ${MAX_AGENTS_PER_PATH} agents per file: the latest ones`, () => {
    const r = rules();
    for (let i = 0; i <= MAX_AGENTS_PER_PATH; i += 1) r.change(`crew-${i}:main`, 'Edit', FILE, T0 + i);
    const others = r.change(B, 'Write', FILE, T0 + 100).map((h) => h.others[0].key);
    assert.equal(others.length, MAX_AGENTS_PER_PATH);
    assert.equal(others.includes('crew-0:main'), false, 'the first to change it is forgotten');
  });

  test(`at most ${MAX_HAZARDS} hazards: notes give way first, a new one too, then the oldest alert`, () => {
    const r = rules();
    r.change(A, 'Edit', FILE, T0);
    const [alert] = r.change(B, 'Write', FILE, T0 + 1);
    for (let i = 0; i < MAX_HAZARDS; i += 1) {
      r.change(A, 'Edit', `${CWD}/n${i}.ts`, T0 + 10 + i);
      r.change(B, 'Edit', `${CWD}/n${i}.ts`, T0 + 500 + i);
    }
    assert.equal(r.c.list().length, MAX_HAZARDS);
    assert.equal(r.c.list()[0].id, alert.id, 'the alert outlived older notes');
    assert.equal(r.c.list().some((h) => h.path === `${CWD}/n0.ts`), false);
    const s = rules();
    for (let i = 0; i < MAX_HAZARDS; i += 1) {
      s.change(A, 'Edit', `${CWD}/w${i}.ts`, T0 + i);
      s.change(B, 'Write', `${CWD}/w${i}.ts`, T0 + 500 + i);
    }
    s.change(A, 'Edit', `${CWD}/late.ts`, T0 + 900);
    assert.deepEqual(s.change(B, 'Edit', `${CWD}/late.ts`, T0 + 901), [], 'a new note among alerts gives way itself');
    assert.equal(s.c.list().filter((h) => h.kind === 'write').length, MAX_HAZARDS, 'no alert pushed out by a note');
    s.change(A, 'Edit', `${CWD}/later.ts`, T0 + 902);
    s.change(B, 'Write', `${CWD}/later.ts`, T0 + 903);
    assert.equal(s.c.list()[0].path, `${CWD}/w1.ts`, 'a new alert pushes out the oldest');
  });
});

describe('hazardText', () => {
  /** @type {any} two crews in one folder, and a helper of the second */
  const state = {
    sessions: [{ id: 'crew-a', number: 1 }, { id: 'crew-b', number: 2 }],
    agents: { [A]: { name: 'Foreman', sessionId: 'crew-a' }, [B]: { name: 'Foreman', sessionId: 'crew-b' }, 'crew-b:h1': { name: 'Scout 1', sessionId: 'crew-b' } },
  };
  /** @param {Record<string, any>} fields @returns {any} */
  const hazard = (fields) => ({ kind: 'write', sessionId: 'crew-b', agentKey: B, others: [{ key: A, sessionId: 'crew-a', files: 1, at: T0 - 4 * 60_000 }], at: T0, folder: CWD, path: FILE, tool: 'Write', command: null, ...fields });

  test('a file: who did what to it, and when the other agent changed it; crews by number', () => {
    assert.equal(hazardText(hazard({}), state, T0), 'Foreman (crew 2) wrote over src/auth.ts, which Foreman (crew 1) changed 4 min ago');
    assert.equal(hazardText(hazard({}), state, T0 + 10 * 60_000), 'Foreman (crew 2) wrote over src/auth.ts, which Foreman (crew 1) changed 14 min ago', 'counted from now');
    assert.equal(hazardText(hazard({ kind: 'edit', tool: 'Edit', others: [{ key: A, sessionId: 'crew-a', files: 1, at: T0 - 30_000 }] }), state, T0), 'Foreman (crew 2) edited src/auth.ts, which Foreman (crew 1) changed just now');
    assert.equal(hazardText(hazard({ tool: 'apply_patch' }), state, T0), 'Foreman (crew 2) deleted src/auth.ts, which Foreman (crew 1) changed 4 min ago');
  });

  test('a git command: who runs it where, and the others with how many files; its own crew needs no number', () => {
    const git = hazard({ kind: 'git', path: null, tool: null, command: 'git stash', others: [{ key: 'crew-b:h1', sessionId: 'crew-b', files: 3, at: T0 }] });
    assert.equal(hazardText(git, state, T0), 'Foreman (crew 2) runs git stash in api-server, where Scout 1 has changed 3 files');
    const two = { ...git, others: [{ key: A, sessionId: 'crew-a', files: 1, at: T0 }, { key: 'crew-b:h1', sessionId: 'crew-b', files: 4, at: T0 }] };
    assert.equal(hazardText(two, state, T0), 'Foreman (crew 2) runs git stash in api-server, where Foreman (crew 1) and Scout 1 have changed 5 files');
    const three = { ...two, others: [...two.others, { key: 'gone:main', sessionId: 'gone', files: 1, at: T0 }] };
    assert.equal(hazardText(three, state, T0), 'Foreman (crew 2) runs git stash in api-server, where Foreman (crew 1) and 2 others have changed 6 files');
    assert.equal(hazardText({ ...git, agentKey: 'gone:main', others: [{ key: 'gone:h', sessionId: 'gone', files: 1, at: T0 }] }, state, T0), 'An agent runs git stash in api-server, where another agent has changed 1 file');
  });
});

describe('the store keeps them on state.hazards', () => {
  const OTHER = '7c1d0e3f-2e5b-4d44-8f20-1b8c7d6e5f40';

  /** A store fed hook payloads at given times, at noon (no Night Shift achievement in its log). */
  function town() {
    const store = createStore({ now: () => T0, localHour: () => 12 });
    return {
      store,
      /** @param {string} name @param {Record<string, any>} extra @param {number} ts @param {Record<string, any>} [who] */
      send(name, extra, ts, who = {}) {
        store.ingest(envelope(hook(name, extra, who), ts));
      },
      hazards: () => store.getState().hazards,
      /** The activity log's lines about two agents on the same files. */
      lines: () => store.getState().log.filter((entry) => entry.kind === 'conflict'),
    };
  }
  /** @param {string} tool @param {Record<string, any>} input */
  const done = (tool, input) => ({ tool_name: tool, tool_input: input, tool_response: {}, tool_use_id: `${tool}-${Math.random()}` });
  const edit = done('Edit', { file_path: FILE, old_string: 'a', new_string: 'b' });
  const write = done('Write', { file_path: FILE, content: 'all new' });
  /** @param {string} command */
  const bash = (command) => ({ tool_name: 'Bash', tool_input: { command }, tool_use_id: `b-${Math.random()}` });

  test("two crews in one folder: a write over the other crew's edit, with a log line naming who did it", () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('PostToolUse', write, T0 + 90_000, { session: OTHER });
    assert.deepEqual(t.hazards().map((h) => [h.kind, h.agentKey, h.others[0].key]), [['write', `${OTHER}:main`, `${t.store.getState().sessions[0].id}:main`]]);
    const line = t.store.getState().log.at(-1);
    assert.deepEqual([line?.kind, line?.level, line?.agentKey, line?.text], ['conflict', 'warn', `${OTHER}:main`, 'Foreman (crew 2) wrote over src/auth.ts, which Foreman (crew 1) changed 1 min ago'], "right after the write's own line");
    assert.equal(t.lines().length, 1, 'one line when it starts');
  });

  test('an edit over it is a note, logged as information', () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('PostToolUse', edit, T0 + 1000, { session: OTHER });
    assert.deepEqual(t.hazards().map((h) => h.kind), ['edit']);
    assert.deepEqual(t.lines().map((entry) => entry.level), ['info']);
  });

  test('a failed edit changes nothing; a helper and another crew count like any two agents', () => {
    const t = town();
    t.send('PostToolUseFailure', { ...write, error: 'File has not been read yet' }, T0);
    t.send('PostToolUse', write, T0 + 1, { session: OTHER });
    assert.deepEqual(t.hazards(), []);
    const helper = { agent: { id: 'agent-h1', type: 'general-purpose' } };
    t.send('SubagentStart', {}, T0 + 2, helper);
    t.send('PostToolUse', write, T0 + 3, helper);
    assert.deepEqual(t.hazards().map((h) => [h.agentKey, h.others[0].key]), [[`${t.store.getState().sessions[0].id}:h1`, `${OTHER}:main`]]);
  });

  test("a lead hands its draft to its own helper: the helper's write and commit are no conflict", () => {
    const t = town();
    const helper = { agent: { id: 'agent-h1', type: 'general-purpose' } };
    t.send('PostToolUse', write, T0);
    t.send('SubagentStart', {}, T0 + 1000, helper);
    t.send('PostToolUse', write, T0 + 2000, helper);
    t.send('PreToolUse', bash('git add -A && git commit -m "Finish the draft"'), T0 + 3000, helper);
    assert.deepEqual(t.hazards(), []);
    t.send('PreToolUse', bash('git checkout -- src/auth.ts'), T0 + 4000, helper);
    assert.equal(t.hazards().length, 1, 'throwing it away still counts');
  });

  test("a helper finishing leaves its work to its lead, and ends the hazards it did; its crew leaving ends them all", () => {
    const t = town();
    const lead = () => `${t.store.getState().sessions[0].id}:main`;
    const helper = { agent: { id: 'agent-h1', type: 'Explore' } };
    t.send('SubagentStart', {}, T0, helper);
    t.send('PostToolUse', edit, T0 + 1, helper);
    t.send('PostToolUse', write, T0 + 2, { session: OTHER });
    t.send('PostToolUse', done('Write', { file_path: `${CWD}/src/b.ts`, content: 'b' }), T0 + 3, { session: OTHER });
    t.send('PostToolUse', done('Write', { file_path: `${CWD}/src/b.ts`, content: 'mine' }), T0 + 4, helper);
    assert.equal(t.hazards().length, 2);
    t.send('SubagentStop', { last_assistant_message: 'Done' }, T0 + 5, helper);
    assert.deepEqual(t.hazards().map((h) => [h.agentKey, h.others[0].key]), [[`${OTHER}:main`, lead()]], "the other crew's write over the helper's edit, now its lead's");
    t.send('PreToolUse', bash('git stash'), T0 + 6, { session: OTHER });
    assert.deepEqual(t.hazards().at(-1)?.others.map((o) => [o.key, o.files]), [[lead(), 2]], "the helper's files are still in the tree");
    t.send('SessionEnd', { reason: 'prompt_input_exit' }, T0 + 7, { session: OTHER });
    assert.deepEqual(t.hazards(), []);
  });

  test("an interrupted helper sends no SubagentStop: its Agent call ending, or the lead's interrupted Stop, ends it", () => {
    const t = town();
    const helper = { agent: { id: 'agent-h1', type: 'general-purpose' } };
    const call = { tool_name: 'Agent', tool_input: { description: 'Rewrite auth', prompt: 'p', subagent_type: 'general-purpose' }, tool_use_id: 'call-1' };
    t.send('PreToolUse', call, T0);
    t.send('SubagentStart', {}, T0 + 1, helper);
    t.send('PostToolUse', edit, T0 + 2, helper);
    t.send('PostToolUse', write, T0 + 3, { session: OTHER });
    assert.equal(t.hazards().length, 1);
    t.send('PostToolUse', done('Edit', { file_path: `${CWD}/src/b.ts`, old_string: 'a', new_string: 'b' }), T0 + 4, { session: OTHER });
    t.send('PostToolUse', done('Write', { file_path: `${CWD}/src/b.ts`, content: 'x' }), T0 + 5, helper);
    assert.equal(t.hazards().length, 2);
    t.send('PostToolUseFailure', { ...call, error: 'Interrupted', is_interrupt: true }, T0 + 6);
    assert.deepEqual(t.hazards().map((h) => h.others[0].key), [`${t.store.getState().sessions[0].id}:main`], 'its write over the other crew ends; the write over its edit is now about its lead');
    const codex = town();
    const codexHelper = { agent: { id: 'h2', type: 'general-purpose' } };
    codex.send('PreToolUse', call, T0);
    codex.send('SubagentStart', {}, T0 + 1, codexHelper);
    codex.send('PostToolUse', edit, T0 + 2, { session: OTHER });
    codex.send('PostToolUse', write, T0 + 3, codexHelper);
    codex.send('PostToolUse', { ...call, tool_response: { status: 'async_launched', agentId: 'h2' } }, T0 + 4);
    assert.equal(codex.hazards().length, 1, 'launched in the background: still at work');
    codex.store.ingest(envelope({ ...hook('Stop', {}), andary_source: 'codex' }, T0 + 5));
    assert.equal(codex.hazards().length, 1, "the lead's turn ending is no interrupt: a background helper goes on");
    codex.store.ingest(envelope({ ...hook('Stop', { stop_reason: 'interrupted' }), andary_source: 'codex' }, T0 + 6));
    assert.deepEqual(codex.hazards(), [], 'its write over the other crew ends with it');
  });

  test('a lead whose turn ended is still at work: its changes sit in the tree', () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('Stop', { last_assistant_message: 'Done.' }, T0 + 1);
    t.send('PostToolUse', write, T0 + 2, { session: OTHER });
    assert.equal(t.hazards().length, 1);
  });

  test('a git command is caught when it starts, before it asks for permission', () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('PreToolUse', bash(`cd ${CWD} && git stash`), T0 + 1000, { session: OTHER });
    assert.deepEqual(t.hazards().map((h) => [h.kind, h.command, h.others[0].files]), [['git', 'git stash', 1]]);
    assert.deepEqual(t.lines().map((entry) => [entry.level, entry.text]), [['warn', 'Foreman (crew 2) runs git stash in api-server, where Foreman (crew 1) has changed 1 file']]);
    t.send('PreToolUse', bash('git status && git diff'), T0 + 2000, { session: OTHER });
    t.send('PreToolUse', { tool_name: 'Grep', tool_input: { pattern: 'git stash' }, tool_use_id: 'g1' }, T0 + 3000, { session: OTHER });
    assert.equal(t.hazards().length, 1, 'other commands and tools start nothing');
  });

  test('work a crew committed no longer counts; a failed commit takes nothing out', () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('PostToolUseFailure', { ...bash('git add src/auth.ts && git commit -m "Fix auth"'), error: 'Exit code 1' }, T0 + 1000);
    t.send('PreToolUse', bash('git commit -am wip'), T0 + 600_000, { session: OTHER });
    assert.equal(t.hazards().length, 1);
    const s = town();
    s.send('PostToolUse', edit, T0);
    s.send('PostToolUse', { ...bash('git add src/auth.ts && git commit -m "Fix auth"'), tool_response: {} }, T0 + 1000);
    s.send('PreToolUse', bash('git commit -am wip'), T0 + 600_000, { session: OTHER });
    assert.deepEqual(s.hazards(), []);
  });

  test('a Bash call without a command, or a dispatched one without input, is nothing', () => {
    const t = town();
    t.send('PreToolUse', { tool_name: 'Bash', tool_use_id: 'b0' }, T0);
    const base = { ts: T0, rx: T0, sessionId: 's', agentKey: 's:main', agentId: null, agentType: null, cwd: CWD, member: null, source: /** @type {const} */ ('claude') };
    assert.doesNotThrow(() => t.store.dispatch({ ...base, id: 'x', kind: 'tool.start', data: { tool: 'Bash' } }));
    assert.doesNotThrow(() => t.store.dispatch({ ...base, id: 'y', kind: 'tool.end', data: { tool: 'PowerShell' } }));
    assert.deepEqual(t.hazards(), []);
  });

  test('PowerShell commands are read as PowerShell', () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('PreToolUse', { tool_name: 'PowerShell', tool_input: { command: `Set-Location ${CWD.replaceAll('/', '\\')}; git reset --hard` }, tool_use_id: 'p1' }, T0 + 1, { session: OTHER });
    assert.deepEqual(t.hazards().map((h) => h.command), ['git reset --hard']);
  });

  test("a Codex patch that deletes a file loses the other agent's work like a write", () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.store.ingest(envelope({ ...hook('PostToolUse', done('apply_patch', { command: '*** Delete File: src/auth.ts', file_path: FILE }), { session: OTHER }), andary_tool: 'apply_patch', andary_source: 'codex' }, T0 + 1));
    assert.deepEqual(t.hazards().map((h) => h.kind), ['write']);
    assert.match(t.lines()[0]?.text ?? '', /^Foreman \(crew 2\) deleted src\/auth\.ts, which Foreman \(crew 1\) changed/);
  });

  test("teammates' crews (a team town) are left out: their files are on their computers", () => {
    const t = town();
    const member = (/** @type {Record<string, any>} */ payload) => ({ ...payload, andary_member: 'sam', session_id: `sam~${payload.session_id}` });
    t.store.ingest(envelope(member(hook('PostToolUse', edit)), T0));
    t.store.ingest(envelope(member(hook('PostToolUse', write, { session: OTHER })), T0 + 1));
    t.send('PostToolUse', write, T0 + 2);
    t.store.ingest(envelope(member(hook('PreToolUse', bash('git stash'))), T0 + 3));
    assert.deepEqual(t.hazards(), []);
  });

  test('a Write that made the file, or a Codex patch adding one, is a new file: git clean takes it, a stash does not', () => {
    const t = town();
    t.send('PostToolUse', { ...write, tool_response: { type: 'create', filePath: FILE } }, T0);
    t.store.ingest(envelope({ ...hook('PostToolUse', done('Write', { file_path: `${CWD}/src/added.ts`, content: 'x' })), andary_tool: 'apply_patch', andary_source: 'codex' }, T0 + 1));
    t.send('PostToolUse', done('Write', { file_path: `${CWD}/src/old.ts`, content: 'x' }), T0 + 2);
    t.send('PreToolUse', bash('git stash'), T0 + 3, { session: OTHER });
    t.send('PreToolUse', bash('git clean -f src'), T0 + 4, { session: OTHER });
    assert.deepEqual(t.hazards().map((h) => [h.command, h.others[0].files]), [['git stash', 1], ['git clean -f src', 2]]);
  });

  test("a commit in a later call than its git add: another crew's add then commit sweeps the work up; one's own takes it out", () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('PostToolUse', { ...bash('git add -A'), tool_response: {} }, T0 + 1000, { session: OTHER });
    assert.deepEqual(t.hazards(), [], 'staging alone loses nothing');
    t.send('PreToolUse', bash('git commit -m "$(cat <<\'EOF\'\nSave\nEOF\n)"'), T0 + 2000, { session: OTHER });
    assert.deepEqual(t.hazards().map((h) => h.command), ['git commit after git add -A']);
    const s = town();
    s.send('PostToolUse', edit, T0);
    s.send('PostToolUse', { ...bash('git add src/auth.ts'), tool_response: {} }, T0 + 1000);
    s.send('PostToolUse', { ...bash('git commit -m "Fix auth"'), tool_response: {} }, T0 + 2000);
    s.send('PreToolUse', bash('git reset --hard'), T0 + 3000, { session: OTHER });
    assert.deepEqual(s.hazards(), [], 'committed in two calls');
  });

  test('git checkout <path> without -- over a file another crew changed', () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('PreToolUse', bash('git checkout src/auth.ts'), T0 + 1, { session: OTHER });
    t.send('PreToolUse', bash('git checkout main'), T0 + 2, { session: OTHER });
    assert.deepEqual(t.hazards().map((h) => h.command), ['git checkout src/auth.ts']);
  });

  test("the server's work-tree top (andary_root) is used when a hook has it", () => {
    const workspace = '/home/dev/workspace';
    const t = town();
    t.send('SessionStart', { source: 'startup', cwd: workspace }, T0, { session: OTHER });
    t.send('PostToolUse', { ...done('Edit', { file_path: `${workspace}/billing/a.ts`, old_string: 'a', new_string: 'b' }), cwd: `${workspace}/billing` }, T0 + 1);
    t.store.ingest(envelope({ ...hook('PreToolUse', { ...bash('git stash'), cwd: `${workspace}/api` }, { session: OTHER }), andary_root: `${workspace}/api` }, T0 + 2));
    assert.deepEqual(t.hazards(), [], 'another repository');
    t.send('PreToolUse', { ...bash('git stash'), cwd: `${workspace}/api` }, T0 + 3, { session: OTHER });
    assert.equal(t.hazards().length, 1, 'without it, the workspace is guessed to be one');
  });

  test('a command refused, by PermissionDenied or in the town, ends its alert', () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    const stash = { ...bash('git stash'), tool_use_id: 'stash-1' };
    t.send('PreToolUse', stash, T0 + 1, { session: OTHER });
    assert.equal(t.hazards().length, 1);
    t.send('PermissionDenied', { ...stash, reason: 'Not now' }, T0 + 2, { session: OTHER });
    assert.deepEqual(t.hazards(), []);
    t.store.ingest(envelope({ ...hook('PreToolUse', { ...bash('git reset --hard'), tool_use_id: 'reset-1' }, { session: OTHER }), andary_key: 'key-reset' }, T0 + 3));
    assert.equal(t.hazards().length, 1);
    const approval = { id: 'ap-1', status: /** @type {const} */ ('pending'), held: true, sessionId: OTHER, agentId: null, toolName: 'Bash', toolInput: { command: 'git reset --hard' }, createdAt: T0 + 3, expiresAt: null, callKey: 'key-reset' };
    t.store.setApproval(approval);
    assert.equal(t.hazards().length, 1, 'still asking');
    t.store.setApproval({ ...approval, status: 'denied' });
    assert.deepEqual(t.hazards(), []);
  });

  test('hooks out of order: an older edit arriving after the other crew\'s write', () => {
    const t = town();
    t.send('PostToolUse', write, T0 + 2000, { session: OTHER });
    t.send('PostToolUse', edit, T0 + 1000);
    assert.deepEqual(t.hazards().map((h) => [h.kind, h.agentKey]), [['write', `${OTHER}:main`]]);
    assert.match(t.lines()[0]?.text ?? '', /^Foreman \(crew 1\) wrote over src\/auth\.ts, which Foreman \(crew 2\) changed/, 'the other crew came first, as crew 1');
  });

  test('a reset forgets everything', () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('PostToolUse', write, T0 + 1, { session: OTHER });
    t.store.reset();
    assert.deepEqual(t.hazards(), []);
    t.send('PostToolUse', write, T0 + 2, { session: OTHER });
    assert.deepEqual(t.hazards(), [], 'the edit before the reset is gone too');
  });
});
