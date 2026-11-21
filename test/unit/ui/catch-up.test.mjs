// Catch me up in the HUD (ui/catch-up.js): the words of a crew's line, the period, where a
// catch-up starts and when the masthead offers one, and the order of the lines.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createStore } from '../../../public/js/core/store.js';
import { OFFER_MS, catchUpOffered, catchUpRows, catchUpStart, crewWords, periodText, readAway, readDigest } from '../../../public/js/ui/catch-up.js';
import { createNeedsYou } from '../../../public/js/ui/needs-you.js';
import { SESSION, envelope, hook } from '../core/helpers.mjs';

const MINUTE = 60_000;
const OTHER = '7c1d0e3f-2e5b-4d44-8f20-1b8c7d6e5f40';
const QUIET = '9e2f1a4b-3c6d-4e55-8a31-2c9d8e7f6a51';

/** A crew's summary with nothing in it but what a test gives. @param {Record<string, any>} [fields] @returns {any} */
function crew(fields = {}) {
  return { sessionId: SESSION, cwd: '/home/dev/code/api-server', title: null, lastAt: 0, turns: 0, lastMessage: null, stops: {}, failures: 0, tests: null, commits: 0, pushes: 0, allPushed: false, files: 0, asked: 0, answered: 0, helpersStarted: 0, helpersFinished: 0, toolCalls: 0, ...fields };
}

describe('a crew\'s line', () => {
  test('in plain words, numbers as the rest of the HUD writes them', () => {
    assert.equal(crewWords(crew({ turns: 3, tests: 'passed', commits: 1, pushes: 1, allPushed: true, files: 2, toolCalls: 40 })), '3 turns, tests passing, 1 commit pushed, 2 files changed');
    assert.equal(crewWords(crew({ turns: 1, tests: 'failed', files: 1, failures: 4 })), '1 turn, tests failing, 1 file changed, 4 failed tool calls');
  });

  test('stops say why', () => {
    assert.equal(crewWords(crew({ stops: { rate_limit: 1 } })), 'stopped (rate limited)');
    assert.equal(crewWords(crew({ turns: 2, stops: { rate_limit: 2, server_error: 1 } })), '2 turns, stopped 3 times (rate limited and server error)');
    assert.equal(crewWords(crew({ stops: { context_window_full: 1 } })), 'stopped (context window full)', 'a kind the town has no words for');
  });

  test('commits and pushes, honest about what was pushed', () => {
    assert.equal(crewWords(crew({ commits: 2, pushes: 1, allPushed: true })), '2 commits pushed');
    assert.equal(crewWords(crew({ commits: 2, pushes: 1, allPushed: false })), '2 commits, 1 push');
    assert.equal(crewWords(crew({ commits: 1 })), '1 commit');
    assert.equal(crewWords(crew({ pushes: 1, allPushed: true })), 'pushed');
    assert.equal(crewWords(crew({ pushes: 3, allPushed: true })), 'pushed 3 times');
  });

  test('permissions asked and answered, helpers started and finished', () => {
    assert.equal(crewWords(crew({ asked: 3, answered: 1 })), '3 permission requests (1 answered)');
    assert.equal(crewWords(crew({ asked: 2, answered: 2 })), '2 permission requests (all answered)');
    assert.equal(crewWords(crew({ asked: 1, answered: 1 })), '1 permission request (answered)');
    assert.equal(crewWords(crew({ asked: 2 })), '2 permission requests (none answered)');
    assert.equal(crewWords(crew({ asked: 1 })), '1 permission request (not answered)');
    assert.equal(crewWords(crew({ answered: 1 })), '1 permission request answered', 'asked before the period');
    assert.equal(crewWords(crew({ helpersStarted: 2, helpersFinished: 1 })), '2 helpers (1 finished)');
    assert.equal(crewWords(crew({ helpersFinished: 1 })), '1 helper finished');
  });

  test('a crew that only used tools says how many; one that did nothing says nothing', () => {
    assert.equal(crewWords(crew({ toolCalls: 14 })), '14 tool calls');
    assert.equal(crewWords(crew({ toolCalls: 14, turns: 1 })), '1 turn');
    assert.equal(crewWords(crew()), '');
  });
});

describe('the period', () => {
  test('since you left, since you last looked, or everything the town remembers', () => {
    assert.equal(periodText('left', 0, 72 * MINUTE), 'Since you left, 1h ago.');
    assert.equal(periodText('looked', 0, 25 * MINUTE), 'Since you last looked, 25m ago.');
    assert.equal(periodText('looked', 0, 5000), 'Since you last looked, a moment ago.');
    assert.equal(periodText('all', 0, 1), 'Everything the town remembers, up to a day back.');
  });

  test('starts when you last looked or when you left, whichever is later; the first time, as far back as it goes', () => {
    const away = { since: 100 * MINUTE, until: 160 * MINUTE };
    assert.deepEqual(catchUpStart(null, null), { since: 0, reason: 'all' });
    assert.deepEqual(catchUpStart(null, away), { since: 100 * MINUTE, reason: 'left' });
    assert.deepEqual(catchUpStart(40 * MINUTE, away), { since: 100 * MINUTE, reason: 'left' }, 'you saw what happened before you left');
    assert.deepEqual(catchUpStart(130 * MINUTE, away), { since: 130 * MINUTE, reason: 'looked' }, 'you looked while you were away');
    assert.deepEqual(catchUpStart(40 * MINUTE, null), { since: 40 * MINUTE, reason: 'looked' });
  });
});

describe('the offer', () => {
  test('while you are away, and for half an hour after you come back, until you look', () => {
    const away = { since: 100 * MINUTE, until: 160 * MINUTE };
    assert.equal(catchUpOffered(null, null, 0), false, 'never away');
    assert.equal(catchUpOffered({ since: 100 * MINUTE, until: null }, null, 130 * MINUTE), true, 'still away: an open town offers it');
    assert.equal(catchUpOffered(away, null, 161 * MINUTE), true, 'the first look ever');
    assert.equal(catchUpOffered(away, 40 * MINUTE, 161 * MINUTE), true, 'looked before you left');
    assert.equal(catchUpOffered(away, 100 * MINUTE, 161 * MINUTE), false, 'looked since you left');
    assert.equal(catchUpOffered(away, null, 160 * MINUTE + OFFER_MS), false, 'half an hour after you came back');
  });
});

describe('what comes from the network', () => {
  test('a summary is read defensively', () => {
    assert.equal(readDigest(null), null);
    assert.equal(readDigest({ since: 0, until: 1 }), null);
    const digest = readDigest({ since: 0, until: 1, crews: [null, { sessionId: 7 }, { sessionId: 's', turns: -2, files: 2.7, stops: { rate_limit: 'x', server_error: 1 }, tests: 'maybe', title: '' }] });
    assert.equal(digest?.crews.length, 1);
    const [only] = digest?.crews ?? [];
    assert.deepEqual([only.turns, only.files, only.stops, only.tests, only.title, only.lastMessage], [0, 2, { rate_limit: 0, server_error: 1 }, null, null, null]);
  });

  test('an absence needs a time it began', () => {
    assert.equal(readAway(null), null);
    assert.equal(readAway({ until: 5 }), null);
    assert.deepEqual(readAway({ since: 1, until: null }), { since: 1, until: null });
    assert.deepEqual(readAway({ since: 1, until: 9 }), { since: 1, until: 9 });
  });
});

describe('the lines', () => {
  const T0 = 10_000_000;
  /** Your crews: one asks a question, one finished a turn, one is quiet; a teammate's crew too. */
  function town() {
    const store = createStore({ now: () => T0 });
    /** @param {string} name @param {Record<string, any>} extra @param {string} session @param {number} [ts] */
    const send = (name, extra, session, ts = T0) => store.ingest(envelope(hook(name, extra, { session }), ts));
    send('SessionStart', { source: 'startup' }, SESSION);
    send('SessionStart', { source: 'startup', cwd: '/home/dev/code/web-app' }, OTHER);
    send('SessionStart', { source: 'startup', cwd: '/home/dev/code/docs-site' }, QUIET);
    send('Stop', { last_assistant_message: 'Shipped.' }, OTHER);
    send('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which port?' }] }, tool_use_id: 'q1' }, SESSION, T0 + 1000);
    store.ingest(envelope({ ...hook('SessionStart', { source: 'startup', cwd: '/home/lina/shop' }, { session: 'Lina~1' }), andary_member: 'Lina' }, T0));
    return store.getState();
  }

  test('crews that need you first, linking to their item; then the others; quiet crews by name', () => {
    const state = town();
    const items = createNeedsYou({ storage: null, now: () => T0 + 5000 }).items(state);
    const digest = {
      since: 0,
      until: T0 + 5000,
      crews: [
        crew({ sessionId: OTHER, cwd: '/home/dev/code/web-app', turns: 1, lastMessage: 'Shipped.', lastAt: T0 + 2000 }),
        crew({ sessionId: 'gone-crew', cwd: '/home/dev/code/old-tool', turns: 2, lastAt: T0 }),
        crew({ sessionId: SESSION, toolCalls: 3, lastAt: T0 + 1000 }),
      ],
    };
    const { rows, quiet } = catchUpRows(state, digest, items);
    assert.deepEqual(rows.map((r) => [r.name, r.words, r.item?.kind ?? null]), [
      ['api-server', '3 tool calls', 'question'],
      ['web-app', '1 turn', null],
      ['old-tool', '2 turns', null],
    ]);
    assert.equal(rows[0].item?.agentKey, `${SESSION}:main`, 'the line goes to the agent that asks');
    assert.equal(rows[1].said, 'Shipped.');
    assert.equal(rows[2].number, 0, 'a crew that has left town has no number');
    // Your quiet crews, never a teammate's: theirs are theirs.
    assert.deepEqual(quiet, ['docs-site']);
  });

  test('a crew that needs you is listed even when it did nothing since you looked', () => {
    const state = town();
    const items = createNeedsYou({ storage: null, now: () => T0 + 5000 }).items(state);
    const { rows, quiet } = catchUpRows(state, { since: 0, until: T0, crews: [] }, items);
    assert.deepEqual(rows.map((r) => [r.name, r.words]), [['api-server', '']]);
    assert.deepEqual(quiet, ['web-app', 'docs-site']);
  });
});
