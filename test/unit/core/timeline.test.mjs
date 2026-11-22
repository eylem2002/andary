// The timeline (core/timeline.js), fed through the store with real Claude Code and Codex hook
// shapes: spans per call coloured by building, failures, waits for you, prompts and turn ends, the
// diff a span points to, bounded memory that keeps the day, and the window the HUD cuts out.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createStore } from '../../../public/js/core/store.js';
import { DAY_MS, MAX_LANES, MAX_SPANS, bucketWidth, createTimeline, recordEvent, recordWait, timelineView } from '../../../public/js/core/timeline.js';
import { fromCodex } from '../../../server/adapters/codex.mjs';
import { PATCH, codex } from '../server/adapters/fixtures.mjs';
import { CWD, FIXTURES, SESSION, envelope, hook } from './helpers.mjs';

const MAIN = `${SESSION}:main`;
const T0 = 1_700_000_000_000;
const HOUR = 60 * 60_000;

function setup() {
  let t = T0;
  const store = createStore({ localHour: () => 12, now: () => t });
  /** @param {Record<string, any>} payload @param {number} [step] */
  const send = (payload, step = 1000) => {
    t += step;
    return store.ingest(envelope(payload, t));
  };
  const lane = (key = MAIN) => store.getState().timeline.lanes[key];
  return { store, send, lane, now: () => t };
}

/** @param {string} tool @param {Record<string, any>} input @param {string} id */
const pre = (tool, input, id) => hook('PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: id });
/** @param {string} tool @param {Record<string, any>} input @param {string} id @param {any} [response] */
const post = (tool, input, id, response = {}) => hook('PostToolUse', { tool_name: tool, tool_input: input, tool_use_id: id, tool_response: response });

describe('timeline: what each event puts on its agent\'s lane', () => {
  test('a call is a span from its start to its end, in its building, with what it did', () => {
    const { send, lane } = setup();
    send(FIXTURES.PreToolUse);
    assert.equal(lane().spans[0].end, null, 'running');
    send(post('Read', { file_path: `${CWD}/src/auth/login.ts` }, 'toolu_read1'), 500);
    const [span] = lane().spans;
    assert.deepEqual([span.building, span.tool, span.summary, span.end - span.start, span.fails], ['library', 'Read', 'Read src/auth/login.ts', 500, 0]);
    assert.equal(span.file, `${CWD}/src/auth/login.ts`);
  });

  test('a failed call keeps its first error line; an interrupt is no failure', () => {
    const { send, lane } = setup();
    send(pre('Bash', { command: 'npm test' }, 'toolu_bash2'));
    send(FIXTURES.PostToolUseFailure);
    send(pre('Bash', { command: 'npm run dev' }, 'toolu_dev'));
    send(hook('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm run dev' }, tool_use_id: 'toolu_dev', error: 'Interrupted', is_interrupt: true }));
    const [tests, dev] = lane().spans;
    assert.deepEqual([tests.fails, tests.error, tests.command], [1, 'Exit code 1', 'npm test']);
    assert.equal(dev.fails, 0);
  });

  test('a finished call whose start the town missed still shows, as long as it took', () => {
    const { send, lane, now } = setup();
    send(FIXTURES.PostToolUse);
    const [span] = lane().spans;
    assert.deepEqual([span.start, span.end], [now() - 3120, now()]);
  });

  test('an edit points to the diff the town kept of it', () => {
    const { send, lane, store } = setup();
    const input = { file_path: `${CWD}/src/a.ts`, old_string: 'a', new_string: 'b' };
    send(pre('Edit', input, 'e1'));
    send(post('Edit', input, 'e1'));
    const [change] = store.getState().agents[MAIN].changes;
    assert.equal(lane().spans[0].changeId, change.id);
  });

  test('your prompts are pins and the turn\'s end a cap; calls still open close with it', () => {
    const { send, lane } = setup();
    send(FIXTURES.UserPromptSubmit);
    send(pre('Bash', { command: 'sleep 100' }, 'b'));
    send(FIXTURES.Stop);
    // A Stop hook kept the turn going: the same cap, with the newer words.
    send(hook('Stop', { last_assistant_message: 'Fixed the lint too.', stop_hook_active: true }));
    const { marks, spans } = lane();
    assert.deepEqual(marks.map((m) => [m.kind, m.text, m.ended]), [['prompt', 'Fix the flaky login test', null], ['end', 'Fixed the lint too.', 'done']]);
    assert.notEqual(spans[0].end, null);
  });

  test('waits for you are spans: a permission until the call goes on, a stop until your prompt, a stuck alert until it ends', () => {
    const { send, lane } = setup();
    send(FIXTURES.PermissionRequest);
    send(pre('Bash', { command: 'rm -rf dist' }, 'rm'));
    send(post('Bash', { command: 'rm -rf dist' }, 'rm'));
    send(FIXTURES.StopFailure);
    send(FIXTURES.UserPromptSubmit);
    for (let i = 0; i < 3; i++) {
      send(pre('Bash', { command: 'npm test' }, `t${i}`));
      send(hook('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: `t${i}`, error: 'Exit code 1\nFAIL login.test.ts', is_interrupt: false }));
    }
    const waits = lane().waits;
    assert.deepEqual(waits.map((w) => [w.kind, w.end !== null]), [['permission', true], ['stopped', true], ['stuck', false]]);
    assert.match(waits[2].text, /npm test/);
  });

  test('a question is a wait of its own kind', () => {
    const { send, lane } = setup();
    send(pre('AskUserQuestion', { questions: [{ question: 'Which database?' }] }, 'q'));
    assert.equal(lane().waits[0]?.kind, 'question');
  });

  test('Codex: a shell command and a patch over several files, each file its own span with its diff', () => {
    const { send, lane, store } = setup();
    const codexMain = 'thr_123:main';
    for (const payload of [
      ...fromCodex(codex('PreToolUse', { tool_name: 'Bash', tool_use_id: 'c1', tool_input: { command: ['npm', 'test'] } })),
      ...fromCodex(codex('PostToolUse', { tool_name: 'Bash', tool_use_id: 'c1', tool_input: { command: ['npm', 'test'] }, tool_response: { exit_code: 1, stderr: '2 failed' } })),
      ...fromCodex(codex('PreToolUse', { tool_name: 'apply_patch', tool_use_id: 'p', tool_input: { command: PATCH } })),
      ...fromCodex(codex('PostToolUse', { tool_name: 'apply_patch', tool_use_id: 'p', tool_input: { command: PATCH }, tool_response: { output: 'Done' } })),
    ]) send(payload);
    const spans = lane(codexMain).spans;
    assert.deepEqual(spans.map((s) => [s.tool, s.building, s.fails]), [['Bash', 'terminal', 1], ['Write', 'workshop', 0], ['MultiEdit', 'workshop', 0], ['Edit', 'workshop', 0], ['apply_patch', 'workshop', 0]]);
    const changes = store.getState().agents[codexMain].changes.map((c) => c.id);
    assert.deepEqual(spans.slice(1, 4).map((s) => s.changeId), changes);
  });

  test('a helper gets a lane of its own, named as the crew names it', () => {
    const { send, lane } = setup();
    send(FIXTURES.SubagentStart);
    send(hook('PreToolUse', { tool_name: 'Grep', tool_input: { pattern: 'TODO' }, tool_use_id: 'g' }, { agent: { id: 'agent-a1b2c3', type: 'Explore' } }));
    const helper = lane(`${SESSION}:a1b2c3`);
    assert.deepEqual([helper.name, helper.role, helper.spans[0].building], ['Scout 1', 'subagent', 'detective']);
  });
});

describe('timeline: bounded memory keeps the day', () => {
  /** @param {number} i @param {number} at */
  const call = (i, at) => /** @type {any} */ ({ id: `e${i}`, ts: at, kind: i % 2 ? 'tool.end' : 'tool.start', sessionId: 's', agentKey: 's:main', data: { tool: 'Read', toolUseId: `c${Math.floor(i / 2)}`, building: 'library', summary: 'Read a', input: {} } });
  const who = { name: 'Foreman', role: /** @type {const} */ ('lead') };

  test('a busy lane merges its older calls into buckets that grow with age, and keeps the day\'s shape', () => {
    const t = createTimeline();
    // 80,000 events (40,000 calls) over 12 hours, a call a second or so, in four buildings.
    const step = (12 * HOUR) / 40_000;
    for (let i = 0; i < 80_000; i++) {
      const e = call(i, T0 + Math.floor(i / 2) * step + (i % 2) * 400);
      e.data.building = ['library', 'terminal', 'workshop', 'detective'][Math.floor(i / 2_000) % 4];
      recordEvent(t, e, who);
    }
    const { spans, last } = t.lanes['s:main'];
    assert.ok(spans.length <= MAX_SPANS, `${spans.length} spans`);
    assert.equal(spans.reduce((n, s) => n + s.calls, 0), 40_000, 'every call is counted');
    assert.ok(spans[0].start - T0 < 15 * 60_000, 'the morning is still there');
    for (let hour = 0; hour < 12; hour++) {
      const inHour = spans.filter((s) => s.start >= T0 + hour * HOUR && s.start < T0 + (hour + 1) * HOUR);
      assert.ok(inHour.length >= 2 && inHour.length <= (hour === 11 ? MAX_SPANS : 150), `hour ${hour}: ${inHour.length} spans`);
      assert.ok(inHour.every((s) => (s.end ?? last) - s.start <= HOUR), `hour ${hour}: no span longer than an hour`);
    }
    assert.ok(spans.at(-1)?.calls === 1 || (spans.at(-1)?.calls ?? 0) < 20, 'the last minutes stay fine-grained');
    assert.match(spans[0].summary, /^\d+ calls, mostly /);
  });

  test('bucket widths grow with age, and with each level', () => {
    assert.deepEqual([bucketWidth(30 * 60_000, 0), bucketWidth(2 * HOUR, 0), bucketWidth(5 * HOUR, 0), bucketWidth(10 * HOUR, 0)], [0, 60_000, 300_000, 900_000]);
    assert.deepEqual([bucketWidth(30 * 60_000, 1), bucketWidth(30 * 60_000, 3), bucketWidth(2 * HOUR, 3)], [15_000, 60_000, 60_000]);
    assert.deepEqual([bucketWidth(30 * 60_000, 4), bucketWidth(2 * HOUR, 4), bucketWidth(10 * HOUR, 4)], [120_000, 120_000, 1_800_000]);
  });

  test('what is more than a day old goes', () => {
    const t = createTimeline();
    recordEvent(t, call(0, T0), who);
    recordEvent(t, call(1, T0 + 10), who);
    recordEvent(t, call(2, T0 + DAY_MS + 60_000), who);
    assert.equal(t.lanes['s:main'].spans.length, 1);
  });

  test('lanes are bounded: the quietest goes', () => {
    const t = createTimeline();
    for (let i = 0; i <= MAX_LANES; i++) recordEvent(t, { ...call(0, T0 + i), sessionId: `s${i}`, agentKey: `s${i}:main` }, who);
    assert.equal(Object.keys(t.lanes).length, MAX_LANES);
    assert.equal(t.lanes['s0:main'], undefined);
  });

  test('a wait that does not change kind is one span', () => {
    const t = createTimeline();
    const agent = { key: 's:main', sessionId: 's', ...who };
    recordWait(t, agent, { kind: 'permission', text: 'rm -rf dist' }, T0);
    recordWait(t, agent, { kind: 'permission', text: 'rm -rf dist' }, T0 + 5);
    recordWait(t, agent, { kind: 'stuck', text: 'loops' }, T0 + 9);
    recordWait(t, agent, null, T0 + 20);
    assert.deepEqual(t.lanes['s:main'].waits.map((w) => [w.kind, w.start, w.end]), [['permission', T0, T0 + 9], ['stuck', T0 + 9, T0 + 20]]);
  });
});

describe('timelineView: the window the HUD shows', () => {
  test('crews in the order given, leads first, items cut to the window, running ones ending now', () => {
    const { send, store, now } = setup();
    send(hook('UserPromptSubmit', { prompt: 'Other crew' }, { session: 'other' }));
    send(FIXTURES.UserPromptSubmit);
    send(FIXTURES.SubagentStart);
    send(hook('PreToolUse', { tool_name: 'Grep', tool_input: { pattern: 'TODO' }, tool_use_id: 'g' }, { agent: { id: 'agent-a1b2c3', type: 'Explore' } }));
    send(pre('Read', { file_path: `${CWD}/a.ts` }, 'r'));
    const groups = timelineView(store.getState().timeline, { from: now() - 60_000, to: now() + 1000, order: [SESSION, 'other'] });
    assert.deepEqual(groups.map((g) => g.sessionId), [SESSION, 'other']);
    assert.deepEqual(groups[0].lanes.map((l) => l.name), ['Foreman', 'Scout 1']);
    const [prompt, read] = groups[0].lanes[0].items;
    assert.equal(prompt.type, 'prompt');
    assert.match(prompt.label, /^Your prompt: Fix the flaky/);
    assert.deepEqual([read.type, read.open, read.end], ['tool', true, now() + 1000]);
    assert.deepEqual(timelineView(store.getState().timeline, { from: now() - 60_000, to: now(), sessions: ['other'] }).map((g) => g.sessionId), ['other']);
    assert.deepEqual(timelineView(store.getState().timeline, { from: now() + 5000, to: now() + 9000 }), [], 'nothing in the window');
  });

  test('calls too short to see merge and keep their failures', () => {
    const { send, store, now } = setup();
    for (let i = 0; i < 5; i++) {
      send(pre('Bash', { command: `ls ${i}` }, `b${i}`), 100);
      send(i === 2 ? hook('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'ls 2' }, tool_use_id: 'b2', error: 'Exit code 2', is_interrupt: false }) : post('Bash', { command: `ls ${i}` }, `b${i}`), 100);
    }
    const [lane] = timelineView(store.getState().timeline, { from: T0, to: now(), minMs: 5000 })[0].lanes;
    assert.equal(lane.items.length, 1);
    assert.deepEqual([lane.items[0].calls, lane.items[0].fails, lane.items[0].label], [5, 1, '5 calls, mostly Terminal Works (1 failed)']);
  });
});
