// "Needs you" in the HUD: the button goes through what is counted, most urgent first; dismissals
// last a day in local storage; the words for the button and the crew rows.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createStore } from '../../../public/js/core/store.js';
import { DISMISSED_KEY, createNeedsYou, itemsByAgent, needsYouLabel, waitedText } from '../../../public/js/ui/needs-you.js';
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
  test('the button goes to the most urgent, then the next, then around again', () => {
    const state = town().getState();
    const needsYou = createNeedsYou({ storage: null, now: () => T0 + 5000 });
    const items = needsYou.items(state);
    assert.deepEqual(items.map((i) => i.kind), ['question', 'stopped']);
    assert.deepEqual([needsYou.next(items)?.kind, needsYou.next(items)?.kind, needsYou.next(items)?.kind], ['question', 'stopped', 'question']);
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
    assert.equal(needsYouLabel(items), '2 things need you. Next: Asks: Which port?');
    assert.equal(needsYouLabel(items.slice(0, 1)), '1 thing needs you. Next: Asks: Which port?');
    assert.equal(needsYouLabel([]), '0 things need you');
  });

  test('crew rows say how long it has waited', () => {
    assert.deepEqual(waitedText(items[0], T0 + 65_000), { short: '1m 05s', long: 'waiting for 1m 05s' });
    const finished = { ...items[0], kind: /** @type {const} */ ('finished') };
    assert.equal(waitedText(finished, T0 + 65_000).long, 'finished 1m 05s ago');
  });

  test('one item per agent: its most urgent', () => {
    const byAgent = itemsByAgent(state, needsYou, T0);
    assert.deepEqual([...byAgent.keys()], [`${SESSION}:main`, `${OTHER}:main`]);
  });
});
