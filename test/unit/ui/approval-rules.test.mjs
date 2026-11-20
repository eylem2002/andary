// "Allow always" words and hints on the approval card (no DOM needed).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { allowedToday, alwaysParts, approvalHint, askedAgainAfterAlways, destinationWords, offeredSuggestion, savedText, shownRules } from '../../../public/js/ui/approval-rules.js';

const NPM_TEST = [{ toolName: 'Bash', ruleContent: 'npm test:*' }];
const LINT = [{ toolName: 'Bash', ruleContent: 'npm run lint' }];
/** 3 pm local time, and the evening before. */
const NOW = new Date(2026, 10, 21, 15, 0).getTime();
const YESTERDAY = new Date(2026, 10, 20, 23, 0).getTime();

/**
 * An approval with the fields these helpers read: by default a held request, made a minute ago,
 * that offers to save `npm test:*` for this project.
 * @param {Record<string, unknown>} [fields]
 * @returns {any}
 */
function approval(fields = {}) {
  return { id: 'now', status: 'pending', held: true, sessionId: 's1', createdAt: NOW - 60_000, suggestions: [{ index: 0, rules: NPM_TEST, destination: 'localSettings' }], ...fields };
}

/** Earlier requests for the same rule, made `minutes` ago and settled `status`. @param {number} count @param {string} status @param {Record<string, unknown>} [fields] */
function earlier(count, status, fields = {}) {
  return Array.from({ length: count }, (_, i) => approval({ id: `${status}-${i}`, status, createdAt: NOW - (i + 2) * 60_000, ...fields }));
}

describe('what the card offers to save', () => {
  test('where a rule is kept, in words', () => {
    assert.equal(destinationWords('localSettings'), 'for this project, only you');
    assert.equal(destinationWords('session'), 'until this session ends');
    assert.equal(destinationWords('userSettings'), '');
  });

  test('one suggestion: the first for this project, else the first for the session', () => {
    const session = { index: 0, rules: LINT, destination: 'session' };
    const local = { index: 2, rules: NPM_TEST, destination: 'localSettings' };
    assert.equal(offeredSuggestion(approval({ suggestions: [session, local, { ...local, index: 3 }] })), local);
    assert.equal(offeredSuggestion(approval({ suggestions: [session, { ...session, index: 1 }] })), session);
    assert.equal(offeredSuggestion(approval({ suggestions: [] })), null);
    assert.equal(offeredSuggestion(approval({ suggestions: undefined })), null);
  });

  test('ignores an offer of a shape the server never sends', () => {
    for (const [why, bad] of /** @type {[string, unknown][]} */ ([
      ['no index', { rules: NPM_TEST, destination: 'localSettings' }],
      ['a fractional index', { index: 0.5, rules: NPM_TEST, destination: 'localSettings' }],
      ['a negative index', { index: -1, rules: NPM_TEST, destination: 'localSettings' }],
      ['no rules', { index: 0, rules: [], destination: 'localSettings' }],
      ['a rule with an unknown field', { index: 0, rules: [{ toolName: 'Bash', scope: 'all' }], destination: 'localSettings' }],
      ['a shared destination', { index: 0, rules: NPM_TEST, destination: 'projectSettings' }],
      ['not an object', 'Bash(npm test:*)'],
    ])) {
      assert.equal(offeredSuggestion(approval({ suggestions: [bad] })), null, why);
    }
  });

  test('the line under the button names the literal rule and where it is kept', () => {
    assert.deepEqual(alwaysParts({ index: 0, rules: NPM_TEST, destination: 'localSettings' }), { lead: 'Adds the rule', rules: 'Bash(npm test:*)', where: 'for this project, only you' });
    assert.deepEqual(alwaysParts({ index: 1, rules: [...NPM_TEST, { toolName: 'Read' }], destination: 'session' }), { lead: 'Adds the rules', rules: 'Bash(npm test:*), Read', where: 'until this session ends' });
  });

  test('hidden characters in a rule are shown, so nothing is saved unseen', () => {
    assert.equal(shownRules([{ toolName: 'Bash', ruleContent: 'npm test‮:*' }]), 'Bash(npm test⟨U+202E⟩:*)');
  });

  test('what an "Allow always" saved, for the result line', () => {
    assert.equal(savedText(approval({ status: 'allowed', always: { rules: NPM_TEST, destination: 'localSettings', at: NOW } })), 'Bash(npm test:*) for this project, only you');
    assert.equal(savedText(approval({ status: 'allowed', always: { rules: LINT, destination: 'session', at: NOW } })), 'Bash(npm run lint) until this session ends');
    assert.equal(savedText(approval({ status: 'allowed' })), '');
    assert.equal(savedText(approval({ status: 'allowed', always: { rules: 'nonsense' } })), '');
  });
});

describe('counting the same rule', () => {
  test('earlier requests for the same rule allowed today, in the town or the terminal', () => {
    const current = approval();
    const others = [...earlier(2, 'allowed'), ...earlier(1, 'resolved')];
    assert.equal(allowedToday(current, [current, ...others], NOW), 3);
  });

  test('a rule saved with "Allow always" counts by the rule it saved', () => {
    const saved = approval({ id: 'saved', status: 'allowed', createdAt: NOW - 600_000, suggestions: [], always: { rules: NPM_TEST, destination: 'localSettings', at: NOW - 590_000 } });
    assert.equal(allowedToday(approval(), [saved], NOW), 1);
  });

  test('leaves out other rules, other answers, later requests, other days and itself', () => {
    const current = approval();
    const others = [
      ...earlier(1, 'allowed', { suggestions: [{ index: 0, rules: LINT, destination: 'localSettings' }] }),
      ...earlier(1, 'allowed', { suggestions: [] }),
      ...earlier(1, 'denied'),
      ...earlier(1, 'expired'),
      ...earlier(1, 'pending'),
      approval({ id: 'later', status: 'allowed', createdAt: NOW - 1000 }),
      approval({ id: 'yesterday', status: 'allowed', createdAt: YESTERDAY }),
      { ...current, status: 'allowed' },
    ];
    assert.equal(allowedToday(current, others, NOW), 0);
    assert.equal(allowedToday(approval({ suggestions: [] }), earlier(3, 'allowed', { suggestions: [] }), NOW), 0, 'no rule, nothing to count');
  });

  test('a rule that comes back in the same session after "Allow always" did not take', () => {
    const saved = approval({ id: 'saved', status: 'allowed', createdAt: NOW - 600_000, always: { rules: NPM_TEST, destination: 'localSettings', at: NOW - 590_000 } });
    assert.equal(askedAgainAfterAlways(approval(), [saved]), true);
    assert.equal(askedAgainAfterAlways(approval({ sessionId: 's2' }), [saved]), false, 'another session may have started before it was saved');
    assert.equal(askedAgainAfterAlways(approval({ createdAt: NOW - 595_000 }), [saved]), false, 'asked before the rule was saved');
    assert.equal(askedAgainAfterAlways(approval({ suggestions: [{ index: 0, rules: LINT, destination: 'localSettings' }] }), [saved]), false, 'another rule');
    assert.equal(askedAgainAfterAlways(approval(), earlier(3, 'allowed')), false, 'plain allows save nothing');
  });
});

describe('the hint on a waiting card', () => {
  const saved = approval({ id: 'saved', status: 'allowed', createdAt: NOW - 600_000, always: { rules: NPM_TEST, destination: 'localSettings', at: NOW - 590_000 } });

  test('says when the same rule was allowed twice or more today', () => {
    assert.equal(approvalHint(approval(), earlier(1, 'allowed'), NOW), '');
    assert.equal(approvalHint(approval(), earlier(2, 'allowed'), NOW), 'You allowed this 2 times today.');
    assert.equal(approvalHint(approval(), earlier(5, 'allowed'), NOW), 'You allowed this 5 times today.', 'a held card offers Allow always itself');
  });

  test('a card answered in the terminal points to its "don\'t ask again" from the third time', () => {
    const terminal = approval({ held: false });
    assert.equal(approvalHint(terminal, earlier(2, 'resolved'), NOW), 'You allowed this 2 times today.');
    assert.equal(approvalHint(terminal, earlier(3, 'resolved'), NOW), 'You allowed this 3 times today. Tip: choose “don\'t ask again” in the terminal.');
  });

  test('a rule that came back after "Allow always" says so first', () => {
    const hint = 'You chose allow always for this; Claude Code asked again (a managed setting may not allow saved rules).';
    assert.equal(approvalHint(approval(), [saved, ...earlier(4, 'allowed')], NOW), hint);
    assert.equal(approvalHint(approval({ held: false }), [saved], NOW), hint);
  });

  test('only while the request waits', () => {
    assert.equal(approvalHint(approval({ status: 'allowed' }), earlier(3, 'allowed'), NOW), '');
    assert.equal(approvalHint(approval({ status: 'denied' }), [saved], NOW), '');
  });
});
