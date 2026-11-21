// "Needs you" in the HUD: the button goes through what is counted, most urgent first; dismissals
// last a day in local storage; the words for the button and the crew rows.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createStore } from '../../../public/js/core/store.js';
import { DISMISSED_KEY, createNeedsYou, isNote, itemsByAgent, needsYouLabel, notesByAgent, waitedText } from '../../../public/js/ui/needs-you.js';
import { SESSION, envelope, hook } from '../core/helpers.mjs';

const T0 = 1_000_000;
const DAY = 24 * 60 * 60 * 1000;
const OTHER = '7c1d0e3f-2e5b-4d44-8f20-1b8c7d6e5f40';

/** A Storage stand-in that keeps strings. */
function memoryStorage() {
  /** @type {Map<string, string>} */
  const data = new Map();
  return {
    data,
    /** @param {string} key */
    getItem: (key) => data.get(key) ?? null,
    /** @param {string} key @param {string} value */
    setItem: (key, value) => void data.set(key, value),
  };
}

/** Two crews: one asks a question, the other stopped on an error (dismissable). */
function town() {
  const store = createStore({ now: () => T0 });
  /** @param {string} name @param {Record<string, any>} extra @param {number} ts @param {string} [session] */
  const send = (name, extra, ts, session = SESSION) => store.ingest(envelope(hook(name, extra, { session }), ts));
  send('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which port?' }] }, tool_use_id: 'q1' }, T0);
  send('StopFailure', { error: 'server_error' }, T0 + 1000, OTHER);
  return store;
}

describe('createNeedsYou', () => {
  test('the button goes to the most urgent, then the next, then around again; peek does not move', () => {
    const state = town().getState();
    const needsYou = createNeedsYou({ storage: null, now: () => T0 + 5000 });
    const items = needsYou.items(state);
    assert.deepEqual(items.map((i) => i.kind), ['question', 'stopped']);
    assert.equal(needsYou.peek(items)?.kind, 'question');
    assert.equal(needsYou.next(items)?.kind, 'question');
    assert.deepEqual([needsYou.peek(items)?.kind, needsYou.peek(items)?.kind], ['stopped', 'stopped']);
    assert.deepEqual([needsYou.next(items)?.kind, needsYou.next(items)?.kind], ['stopped', 'question']);
    assert.equal(needsYou.next([]), null);
  });

  test('a dismissal hides a dismissable item, survives a reload and is forgotten after a day', () => {
    const state = town().getState();
    const storage = memoryStorage();
    let now = T0 + 5000;
    const needsYou = createNeedsYou({ storage, now: () => now });
    const stopped = needsYou.items(state).find((i) => i.kind === 'stopped');
    assert.ok(stopped?.dismissable);
    needsYou.dismiss(stopped.id);
    assert.deepEqual(needsYou.items(state).map((i) => i.kind), ['question']);
    assert.ok(storage.data.get(DISMISSED_KEY)?.includes(stopped.id));
    const reloaded = createNeedsYou({ storage, now: () => now });
    assert.deepEqual(reloaded.items(state).map((i) => i.kind), ['question'], 'still set aside after a reload');
    now += DAY + 1;
    assert.deepEqual(needsYou.items(state).map((i) => i.kind), ['question', 'stopped'], 'a day later it is back, without a reload');
    assert.deepEqual(createNeedsYou({ storage, now: () => now }).items(state).map((i) => i.kind), ['question', 'stopped']);
  });

  test('a question cannot be set aside: it blocks the agent', () => {
    const state = town().getState();
    const needsYou = createNeedsYou({ storage: null, now: () => T0 });
    const question = needsYou.items(state)[0];
    assert.equal(question.dismissable, false);
    needsYou.dismiss(question.id);
    assert.equal(needsYou.items(state)[0].id, question.id);
  });

  test('someone only watching (a team town\'s view link) has nothing to answer', () => {
    const state = town().getState();
    assert.deepEqual(createNeedsYou({ storage: null, viewOnly: () => true }).items(state), []);
  });

  test('unreadable or full storage never breaks the list', () => {
    const state = town().getState();
    const broken = { getItem: () => '{not json', setItem: () => { throw new Error('full'); } };
    const needsYou = createNeedsYou({ storage: broken, now: () => T0 });
    const stopped = needsYou.items(state)[1];
    needsYou.dismiss(stopped.id);
    assert.equal(needsYou.items(state).length, 1, 'kept in memory until the page reloads');
  });
});

describe('words', () => {
  const state = town().getState();
  const needsYou = createNeedsYou({ storage: null, now: () => T0 });
  const items = needsYou.items(state);

  test('the button says how many and what comes first', () => {
    // The visible words first ("2 need you"), then where a click goes.
    assert.equal(needsYouLabel(items, items[1]), '2 need you. Next: Server error');
    assert.equal(needsYouLabel(items.slice(0, 1), items[0]), '1 needs you. Next: Asks: Which port?');
    assert.equal(needsYouLabel([], null), '0 need you');
  });

  test('crew rows say how long it has waited', () => {
    assert.deepEqual(waitedText(items[0], T0 + 65_000), { short: '1m 05s', long: 'waiting for 1m 05s' });
    const finished = { ...items[0], kind: /** @type {const} */ ('finished') };
    assert.equal(waitedText(finished, T0 + 65_000).long, 'finished 1m 05s ago');
    const stuck = { ...items[0], kind: /** @type {const} */ ('stuck') };
    assert.deepEqual(waitedText(stuck, T0 + 65_000), { short: '1m 05s', long: 'stuck for 1m 05s' }, 'a stuck agent is not waiting for you');
  });

  test('one item per agent: its most urgent', () => {
    const byAgent = itemsByAgent(state, needsYou, T0);
    assert.deepEqual([...byAgent.keys()], [`${SESSION}:main`, `${OTHER}:main`]);
  });
});

describe('two agents on the same files', () => {
  const file = '/home/dev/code/api-server/src/auth.ts';
  /** Two crews in one folder: the first edits a file, the second edits it too (a note), and asks a question. */
  function sameFile() {
    const store = createStore({ now: () => T0 });
    /** @param {string} name @param {Record<string, any>} extra @param {number} ts @param {string} [session] */
    const send = (name, extra, ts, session = SESSION) => store.ingest(envelope(hook(name, extra, { session }), ts));
    const edit = { tool_name: 'Edit', tool_input: { file_path: file, old_string: 'a', new_string: 'b' }, tool_response: {}, tool_use_id: 'e' };
    send('PostToolUse', edit, T0);
    send('PostToolUse', edit, T0 + 1000, OTHER);
    return { store, send, edit };
  }

  test('a note goes under what the agent does, on both rows, never instead of it', () => {
    const { store } = sameFile();
    const needsYou = createNeedsYou({ storage: null, now: () => T0 + 2000 });
    const [note] = needsYou.items(store.getState());
    assert.equal(isNote(note), true);
    assert.deepEqual([...itemsByAgent(store.getState(), needsYou, T0 + 2000).keys()], [], 'nothing takes the place of what they do');
    const notes = notesByAgent(store.getState(), needsYou, T0 + 2000);
    assert.deepEqual([...notes.keys()].sort(), [`${OTHER}:main`, `${SESSION}:main`].sort());
    assert.equal(notes.get(`${SESSION}:main`)?.text, 'Edited src/auth.ts, which Foreman (crew 1) changed just now');
  });

  test('an alert takes the row; the newest note is the one shown', () => {
    const { store, send, edit } = sameFile();
    send('PostToolUse', { ...edit, tool_input: { ...edit.tool_input, file_path: `${file}.bak` } }, T0 + 3000);
    send('PostToolUse', { ...edit, tool_input: { ...edit.tool_input, file_path: `${file}.bak` } }, T0 + 4000, OTHER);
    const needsYou = createNeedsYou({ storage: null, now: () => T0 + 5000 });
    assert.match(notesByAgent(store.getState(), needsYou, T0 + 5000).get(`${OTHER}:main`)?.text ?? '', /^Edited src\/auth\.ts\.bak/);
    send('PostToolUse', { tool_name: 'Write', tool_input: { file_path: file, content: 'x' }, tool_response: {}, tool_use_id: 'w' }, T0 + 6000, OTHER);
    const row = itemsByAgent(store.getState(), needsYou, T0 + 7000);
    assert.equal(row.get(`${SESSION}:main`)?.text, 'Wrote over src/auth.ts, which Foreman (crew 1) changed just now');
    assert.equal(row.get(`${OTHER}:main`)?.counted, true);
  });

  test('its time says how long ago it happened: nobody waits', () => {
    const { store } = sameFile();
    const [note] = createNeedsYou({ storage: null, now: () => T0 }).items(store.getState());
    assert.deepEqual(waitedText(note, T0 + 1000 + 65_000), { short: '1m 05s', long: '1m 05s ago' });
  });
});
