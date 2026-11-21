// Two agents on the same files (core/conflicts.js): an edit over another active agent's recent
// change is a note, a write over it or a git command over others' changes an alert; each lasts half
// an hour or until its agents finish. The rules on their own, then as the store feeds them.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CONFLICT_MS, MAX_AGENTS_PER_PATH, MAX_HAZARDS, MAX_PATHS, createConflicts, hazardText } from '../../../public/js/core/conflicts.js';
import { gitHazardOf } from '../../../public/js/core/git-commands.js';
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
    /** @param {string} agent @param {string} tool @param {string} path @param {number} at @param {string} [folder] @param {{ lead?: string|null, since?: number }} [helper] */
    change: (agent, tool, path, at, folder = CWD, helper = {}) => c.changed({ ...actor(agent, at, helper), tool, path, folder }),
    /**
     * @param {string} agent @param {string} command  a command line, read by git-commands.js
     * @param {number} at @param {string} [folder] @param {{ lead?: string|null, since?: number, sessionFolder?: string }} [more]
     */
    run(agent, command, at, folder = CWD, more = {}) {
      const git = gitHazardOf(command, { folder, sessionFolder: more.sessionFolder ?? CWD });
      assert.ok(git, `a git hazard: ${command}`);
      return c.command({ ...actor(agent, at, more), ...git });
    },
  };
}

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
    r.c.committed({ agent: A, folder: CWD, root: CWD, paths: [`${CWD}/src/a.ts`] });
    assert.equal(r.run(B, 'git commit -am wip', T0 + 600_000)[0]?.others[0].files, 1, 'b.ts is still uncommitted');
    r.c.committed({ agent: A, folder: CWD, root: CWD, paths: [] });
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

  test('a helper finishing ends its hazards; so does its crew leaving', () => {
    const t = town();
    const helper = { agent: { id: 'agent-h1', type: 'Explore' } };
    t.send('SubagentStart', {}, T0, helper);
    t.send('PostToolUse', edit, T0 + 1, helper);
    t.send('PostToolUse', write, T0 + 2, { session: OTHER });
    assert.equal(t.hazards().length, 1);
    t.send('SubagentStop', { last_assistant_message: 'Done' }, T0 + 3, helper);
    assert.deepEqual(t.hazards(), []);
    t.send('PostToolUse', edit, T0 + 4);
    t.send('PostToolUse', write, T0 + 5, { session: OTHER });
    assert.deepEqual(t.hazards().map((h) => h.kind), ['edit', 'write'], "the lead's edit over the other crew's write, and that crew's write over it");
    t.send('SessionEnd', { reason: 'prompt_input_exit' }, T0 + 6, { session: OTHER });
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
    t.send('PostToolUseFailure', { ...call, error: 'Interrupted', is_interrupt: true }, T0 + 4);
    assert.deepEqual(t.hazards(), []);
    const codex = town();
    const codexHelper = { agent: { id: 'h2', type: 'general-purpose' } };
    codex.send('PreToolUse', call, T0);
    codex.send('SubagentStart', {}, T0 + 1, codexHelper);
    codex.send('PostToolUse', edit, T0 + 2, codexHelper);
    codex.send('PostToolUse', write, T0 + 3, { session: OTHER });
    codex.send('PostToolUse', { ...call, tool_response: { status: 'async_launched', agentId: 'h2' } }, T0 + 4);
    assert.equal(codex.hazards().length, 1, 'launched in the background: still at work');
    codex.store.ingest(envelope({ ...hook('Stop', {}), andary_source: 'codex' }, T0 + 5));
    assert.equal(codex.hazards().length, 1, "the lead's turn ending is no interrupt: a background helper goes on");
    codex.store.ingest(envelope({ ...hook('Stop', { stop_reason: 'interrupted' }), andary_source: 'codex' }, T0 + 6));
    assert.deepEqual(codex.hazards(), []);
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
