// The review queue and the standup in the HUD (ui/review.js, ui/standup.js): marks read
// defensively and bounded, a card's period in words, Catch me up's "Today" and its Markdown.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { crewPeriod, readMarks, withMark } from '../../../public/js/ui/review.js';
import { crewCost, standupText, startOfDay } from '../../../public/js/ui/standup.js';
import { periodText } from '../../../public/js/ui/catch-up.js';

const MINUTE = 60_000;

describe('review marks', () => {
  test('read defensively: anything that is not a time is dropped', () => {
    assert.deepEqual(readMarks('{"a":5,"b":"x","c":-1,"d":null,"e":1e3}'), { a: 5, e: 1000 });
    assert.deepEqual(readMarks('[1,2]'), {});
    assert.deepEqual(readMarks('not json'), {});
    assert.deepEqual(readMarks(null), {});
  });

  test('bounded: the oldest marks go first', () => {
    let marks = {};
    for (let i = 1; i <= 305; i += 1) marks = withMark(marks, `s${i}`, i);
    assert.equal(Object.keys(marks).length, 300);
    assert.ok(!('s1' in marks) && !('s5' in marks) && 's6' in marks && 's305' in marks);
    assert.equal(withMark({ a: 1 }, 'a', 9).a, 9, 'a newer mark replaces the old one');
  });

  test('a card says how many turns since when', () => {
    const crew = /** @type {any} */ ({ turns: 3, reviewedAt: 0, start: 10 * MINUTE });
    assert.equal(crewPeriod(crew, 120 * MINUTE), '3 turns since you marked it reviewed 2h ago');
    assert.equal(crewPeriod({ ...crew, turns: 1, reviewedAt: null }, 15 * MINUTE), '1 turn, the first 5m ago; never marked reviewed');
  });
});

describe('standup', () => {
  test('today starts at midnight on this computer\'s clock', () => {
    const noon = new Date(2026, 10, 23, 12, 30).getTime();
    assert.equal(startOfDay(noon), new Date(2026, 10, 23).getTime());
  });

  test('a crew\'s cost is every agent of it together, or unknown', () => {
    const state = /** @type {any} */ ({ usage: { 's1:main': { costUsd: 1 }, 's1:a2': { costUsd: 0.25 }, 's2:main': { costUsd: 9 } } });
    assert.equal(crewCost(state, 's1'), 1.25);
    assert.equal(crewCost(state, 's3'), null);
  });

  test('the period says today, and how far back the town remembers', () => {
    const clock = (/** @type {number} */ ts) => `${ts / MINUTE}min`;
    const digest = (/** @type {Record<string, any>} */ d) => /** @type {any} */ ({ since: 0, from: 0, until: 90 * MINUTE, limit: null, crews: [], ...d });
    assert.equal(periodText('today', 0, digest({}), clock), 'Today, since midnight.');
    assert.equal(periodText('today', 0, digest({ since: 30 * MINUTE, limit: 'started' }), clock), 'Today. The town only remembers since 30min (it restarted).');
  });

  test('Markdown from the dialog\'s lines, titled for a standup or a catch-up', () => {
    const state = /** @type {any} */ ({ usage: { 's1:main': { costUsd: 0.5 } } });
    const rows = [{ sessionId: 's1', name: 'api', words: '1 turn', said: 'Done.', item: null, number: 1 }];
    const now = new Date(2026, 10, 23, 17).getTime();
    const today = standupText(state, { rows, quiet: ['docs'] }, { today: true, period: 'Today, since midnight.', now });
    assert.match(today, /^# Standup: .+2026/);
    assert.match(today, /## api\n\n- 1 turn\n- Last turn: Done\.\n- Cost so far: \$0\.50 \(estimate\)\n\nQuiet: docs\.\n$/);
    assert.match(standupText(state, { rows: [], quiet: [] }, { today: false, period: 'Since you last looked, 5m ago.', now }), /^# What my crews did \(/);
  });
});
