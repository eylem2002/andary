// Two agents on the same files (core/conflicts.js): an edit over another active agent's recent
// change is a note, a write over it or a git command over its changes an alert; each lasts half an
// hour or until either agent finishes. The rules on their own, then as the store feeds them.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CONFLICT_MS, MAX_AGENTS_PER_PATH, MAX_HAZARDS, MAX_PATHS, createConflicts, hazardText } from '../../../public/js/core/conflicts.js';
import { createStore } from '../../../public/js/core/store.js';
import { CWD, envelope, hook } from './helpers.mjs';

const T0 = 1_000_000;
const A = 'crew-a:main';
const B = 'crew-b:main';
const FILE = `${CWD}/src/auth.ts`;

/** The rules, and short ways to report a file change or a git command to them. */
function rules() {
  const c = createConflicts();
  /** @param {string} agent */
  const session = (agent) => agent.split(':')[0];
  return {
    c,
    /** @param {string} agent @param {string} tool @param {string} path @param {number} at @param {string} [folder] */
    change: (agent, tool, path, at, folder = CWD) => c.changed({ agent, session: session(agent), tool, path, folder, at }),
    /** @param {string} agent @param {string} command @param {number} at @param {string} [folder] */
    run: (agent, command, at, folder = CWD) => c.command({ agent, session: session(agent), command, folder, at }),
  };
}

describe('same file', () => {
  test("an edit over another agent's change is a note; a write over it an alert that replaces the note", () => {
    const r = rules();
    assert.deepEqual(r.change(A, 'Edit', FILE, T0), [], 'nobody else changed it');
    const [note] = r.change(B, 'Edit', FILE, T0 + 60_000);
    assert.deepEqual([note.kind, note.agentKey, note.otherKey, note.path, note.theirsAt, note.at], ['edit', B, A, FILE, T0, T0 + 60_000]);
    const [alert] = r.change(B, 'Write', FILE, T0 + 120_000);
    assert.deepEqual([alert.kind, alert.otherKey, alert.theirsAt], ['write', A, T0]);
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
    assert.deepEqual(r.change(B, 'Edit', FILE, T0 + 3000), [], 'an edit does not turn an alert back into a note');
    const [back] = r.change(A, 'Edit', FILE, T0 + 4000);
    assert.deepEqual([back.agentKey, back.otherKey, back.kind], [A, B, 'edit'], 'the other way round is a pair of its own');
    const [again] = r.change(B, 'Write', FILE, T0 + 5000);
    assert.equal(again.theirsAt, T0 + 4000, 'over the newer change');
    assert.notEqual(again.id, first.id);
    assert.deepEqual(r.c.list().map((h) => [h.agentKey, h.kind]), [[A, 'edit'], [B, 'write']]);
  });

  test('every other agent on the file is a pair of its own', () => {
    const r = rules();
    r.change(A, 'Edit', FILE, T0);
    r.change('crew-c:main', 'Edit', FILE, T0 + 1);
    assert.deepEqual(r.change(B, 'Write', FILE, T0 + 2).map((h) => h.otherKey).sort(), [A, 'crew-c:main']);
  });

  test("paths are compared normalised: a relative path is the hook folder's, backslashes and dots go", () => {
    const r = rules();
    r.change(A, 'Edit', `${CWD}/src/./lib/../auth.ts`, T0);
    const [hazard] = r.change(B, 'Write', 'src\\auth.ts', T0 + 1);
    assert.equal(hazard?.path, FILE);
    assert.deepEqual(r.change('crew-c:main', 'Write', '~/auth.ts', T0 + 2), [], 'a path it cannot place is no change');
  });

  test('a hazard ends when either agent finishes, or its crew leaves; their changes are forgotten', () => {
    const r = rules();
    r.change(A, 'Edit', FILE, T0);
    r.change(B, 'Write', FILE, T0 + 1);
    assert.equal(r.c.finished(A), true);
    assert.deepEqual(r.c.list(), []);
    assert.deepEqual(r.change('crew-c:main', 'Write', FILE, T0 + 2).map((h) => h.otherKey), [B], "A's change is gone, B's is not");
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
  test('a command in a folder where another agent changed files names how many', () => {
    const r = rules();
    for (const [i, file] of ['src/a.ts', 'src/b.ts', 'README.md'].entries()) r.change(A, 'Edit', `${CWD}/${file}`, T0 + i);
    r.change(A, 'Write', `${CWD}/src/a.ts`, T0 + 10);
    const [hazard] = r.run(B, 'git stash', T0 + 60_000);
    assert.deepEqual([hazard.kind, hazard.agentKey, hazard.otherKey, hazard.command, hazard.files, hazard.theirsAt, hazard.folder], ['git', B, A, 'git stash', 3, T0 + 10, CWD]);
  });

  test("from a subfolder too, as git acts on the whole work tree; not in another folder, or for a file outside the agent's", () => {
    const r = rules();
    r.change(A, 'Edit', `${CWD}/README.md`, T0);
    r.change(A, 'Edit', '/home/dev/.config/app.json', T0 + 1);
    assert.equal(r.run(B, 'git reset --hard', T0 + 2, `${CWD}/packages/web`)[0]?.files, 1, 'only the file in its folder');
    assert.deepEqual(r.run(B, 'git reset --hard', T0 + 3, '/home/dev/code/billing'), []);
    const s = rules();
    s.change(A, 'Edit', `${CWD}/packages/web/src/a.ts`, T0, `${CWD}/packages/web`);
    assert.equal(s.run(B, 'git stash', T0 + 1, CWD)[0]?.files, 1, 'a helper that worked in a package of it');
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
    assert.equal(r.run(B, 'git add -A && git commit', T0 + 1000).length, 1);
    assert.deepEqual(r.run(B, 'git add -A && git commit', T0 + 2000), [], 'what it swept up was seen');
    r.change(A, 'Edit', `${CWD}/src/b.ts`, T0 + 3000);
    assert.equal(r.run(B, 'git add -A && git commit', T0 + 4000)[0]?.files, 1, 'only the newer change');
    assert.equal(r.run(B, 'git reset --hard', T0 + 5000)[0]?.files, 2);
  });

  test('one alert per other agent, each with its own files; its own changes never count', () => {
    const r = rules();
    r.change(A, 'Edit', `${CWD}/a.ts`, T0);
    r.change('crew-c:main', 'Edit', `${CWD}/c1.ts`, T0 + 1);
    r.change('crew-c:main', 'Edit', `${CWD}/c2.ts`, T0 + 2);
    r.change(B, 'Edit', `${CWD}/b.ts`, T0 + 3);
    assert.deepEqual(r.run(B, 'git stash', T0 + 4).map((h) => [h.otherKey, h.files]), [[A, 1], ['crew-c:main', 2]]);
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
    const others = r.change(B, 'Write', FILE, T0 + 100).map((h) => h.otherKey);
    assert.equal(others.length, MAX_AGENTS_PER_PATH);
    assert.equal(others.includes('crew-0:main'), false, 'the first to change it is forgotten');
  });

  test(`at most ${MAX_HAZARDS} hazards: notes give way first, then the oldest alert`, () => {
    const r = rules();
    r.change(A, 'Edit', FILE, T0);
    const [alert] = r.change(B, 'Write', FILE, T0 + 1);
    for (let i = 0; i < MAX_HAZARDS; i += 1) {
      r.change(A, 'Edit', `${CWD}/n${i}.ts`, T0 + 10 + i);
      r.change(B, 'Edit', `${CWD}/n${i}.ts`, T0 + 500 + i);
    }
    const kept = r.c.list();
    assert.equal(kept.length, MAX_HAZARDS);
    assert.equal(kept[0].id, alert.id, 'the alert outlived older notes');
    assert.equal(kept.some((h) => h.path === `${CWD}/n0.ts`), false);
    const s = rules();
    for (let i = 0; i <= MAX_HAZARDS; i += 1) {
      s.change(A, 'Edit', `${CWD}/w${i}.ts`, T0 + i);
      s.change(B, 'Write', `${CWD}/w${i}.ts`, T0 + 500 + i);
    }
    assert.equal(s.c.list().length, MAX_HAZARDS);
    assert.equal(s.c.list()[0].path, `${CWD}/w1.ts`, 'with no note left, the oldest alert goes');
  });
});

describe('hazardText', () => {
  /** @type {any} two crews in one folder, and a helper of the second */
  const state = {
    sessions: [{ id: 'crew-a', number: 1 }, { id: 'crew-b', number: 2 }],
    agents: { [A]: { name: 'Foreman', sessionId: 'crew-a' }, [B]: { name: 'Foreman', sessionId: 'crew-b' }, 'crew-b:h1': { name: 'Scout 1', sessionId: 'crew-b' } },
  };
  /** @param {Partial<import('../../../public/js/core/conflicts.js').Hazard>} fields @returns {any} */
  const hazard = (fields) => ({ kind: 'write', sessionId: 'crew-b', agentKey: B, otherSessionId: 'crew-a', otherKey: A, at: T0, folder: CWD, path: FILE, tool: 'Write', command: null, theirsAt: T0 - 4 * 60_000, files: 1, ...fields });

  test('a file: what was done to it, and when the other agent of which crew changed it', () => {
    assert.equal(hazardText(hazard({}), state, T0), 'Wrote over src/auth.ts, which Foreman (crew 1) changed 4 min ago');
    assert.equal(hazardText(hazard({}), state, T0 + 10 * 60_000), 'Wrote over src/auth.ts, which Foreman (crew 1) changed 14 min ago', 'counted from now');
    assert.equal(hazardText(hazard({ kind: 'edit', tool: 'Edit', theirsAt: T0 - 30_000 }), state, T0), 'Edited src/auth.ts, which Foreman (crew 1) changed just now');
    assert.equal(hazardText(hazard({ tool: 'apply_patch' }), state, T0), 'Deleted src/auth.ts, which Foreman (crew 1) changed 4 min ago');
  });

  test('a git command: where, and how many files the other agent changed there; its own crew needs no number', () => {
    const git = hazard({ kind: 'git', path: null, tool: null, command: 'git stash', otherKey: 'crew-b:h1', otherSessionId: 'crew-b', files: 3 });
    assert.equal(hazardText(git, state, T0), 'git stash in api-server, where Scout 1 has changed 3 files');
    assert.equal(hazardText({ ...git, files: 1, otherKey: 'gone:main' }, state, T0), 'git stash in api-server, where another agent has changed 1 file');
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

  test('two crews in one folder: a write over the other crew\'s edit, with a log line', () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('PostToolUse', write, T0 + 90_000, { session: OTHER });
    assert.deepEqual(t.hazards().map((h) => [h.kind, h.agentKey, h.otherKey]), [['write', `${OTHER}:main`, `${t.store.getState().sessions[0].id}:main`]]);
    const line = t.store.getState().log.at(-1);
    assert.deepEqual([line?.kind, line?.level, line?.agentKey, line?.text], ['conflict', 'warn', `${OTHER}:main`, 'Wrote over src/auth.ts, which Foreman (crew 1) changed 1 min ago'], 'right after the write\'s own line');
    assert.equal(t.lines().length, 1, 'one line when it starts');
  });

  test('an edit over it is a note, logged as information', () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('PostToolUse', edit, T0 + 1000, { session: OTHER });
    assert.deepEqual(t.hazards().map((h) => h.kind), ['edit']);
    assert.deepEqual(t.lines().map((entry) => entry.level), ['info']);
  });

  test('a failed edit changes nothing; a helper and its lead count like any two agents', () => {
    const t = town();
    t.send('PostToolUseFailure', { ...write, error: 'File has not been read yet' }, T0);
    t.send('PostToolUse', write, T0 + 1, { session: OTHER });
    assert.deepEqual(t.hazards(), []);
    const helper = { agent: { id: 'agent-h1', type: 'general-purpose' } };
    t.send('SubagentStart', {}, T0 + 2, helper);
    t.send('PostToolUse', write, T0 + 3, helper);
    assert.deepEqual(t.hazards().map((h) => [h.agentKey, h.otherKey]), [[`${t.store.getState().sessions[0].id}:h1`, `${OTHER}:main`]]);
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

  test("a lead whose turn ended is still at work: its changes sit in the tree", () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('Stop', { last_assistant_message: 'Done.' }, T0 + 1);
    t.send('PostToolUse', write, T0 + 2, { session: OTHER });
    assert.equal(t.hazards().length, 1);
  });

  test('a git command is caught when it starts, before it asks for permission', () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('PreToolUse', { tool_name: 'Bash', tool_input: { command: `cd ${CWD} && git stash` }, tool_use_id: 'b1' }, T0 + 1000, { session: OTHER });
    assert.deepEqual(t.hazards().map((h) => [h.kind, h.command, h.files]), [['git', 'git stash', 1]]);
    assert.deepEqual(t.lines().map((entry) => [entry.level, entry.text]), [['warn', 'git stash in api-server, where Foreman (crew 1) has changed 1 file']]);
    t.send('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git status && git diff' }, tool_use_id: 'b2' }, T0 + 2000, { session: OTHER });
    t.send('PreToolUse', { tool_name: 'Grep', tool_input: { pattern: 'git stash' }, tool_use_id: 'g1' }, T0 + 3000, { session: OTHER });
    assert.equal(t.hazards().length, 1, 'other commands and tools start nothing');
  });

  test('PowerShell commands are read as PowerShell', () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.send('PreToolUse', { tool_name: 'PowerShell', tool_input: { command: `Set-Location ${CWD.replaceAll('/', '\\')}; git reset --hard` }, tool_use_id: 'p1' }, T0 + 1, { session: OTHER });
    assert.deepEqual(t.hazards().map((h) => h.command), ['git reset --hard']);
  });

  test('a Codex patch that deletes a file loses the other agent\'s work like a write', () => {
    const t = town();
    t.send('PostToolUse', edit, T0);
    t.store.ingest(envelope({ ...hook('PostToolUse', done('apply_patch', { command: '*** Delete File: src/auth.ts', file_path: FILE }), { session: OTHER }), andary_tool: 'apply_patch', andary_source: 'codex' }, T0 + 1));
    assert.deepEqual(t.hazards().map((h) => h.kind), ['write']);
    assert.match(t.lines()[0]?.text ?? '', /^Deleted src\/auth\.ts, which Foreman \(crew 1\) changed/);
  });

  test("teammates' crews (a team town) are left out: their files are on their computers", () => {
    const t = town();
    const member = (/** @type {Record<string, any>} */ payload) => ({ ...payload, andary_member: 'sam', session_id: `sam~${payload.session_id}` });
    t.store.ingest(envelope(member(hook('PostToolUse', edit)), T0));
    t.store.ingest(envelope(member(hook('PostToolUse', write, { session: OTHER })), T0 + 1));
    t.send('PostToolUse', write, T0 + 2);
    t.store.ingest(envelope(member(hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git stash' }, tool_use_id: 'b1' })), T0 + 3));
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
