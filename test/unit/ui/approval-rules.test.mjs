// "Allow always" words and hints on the approval card (no DOM needed).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { allowedToday, alwaysLine, approvalHint, askedAgainAfterAlways, destinationWords, offeredSuggestion, reachWords, savedText } from '../../../public/js/ui/approval-rules.js';

const NPM_TEST = [{ toolName: 'Bash', ruleContent: 'npm test' }];
const LINT = [{ toolName: 'Bash', ruleContent: 'npm run lint' }];
/** 3 pm local time, and the evening before. */
const NOW = new Date(2026, 10, 21, 15, 0).getTime();
const YESTERDAY = new Date(2026, 10, 20, 23, 0).getTime();
const ASKED_AGAIN = 'Claude Code asked again after “Allow always”: the rule may not have taken.';

/**
 * An approval with the fields these helpers read: by default a held request in /w/app, made a
 * minute ago, that offers to save `npm test` for this project.
 * @param {Record<string, unknown>} [fields]
 * @returns {any}
 */
function approval(fields = {}) {
  return { id: 'now', status: 'pending', held: true, sessionId: 's1', cwd: '/w/app', createdAt: NOW - 60_000, suggestions: [{ index: 0, rules: NPM_TEST, destination: 'localSettings' }], ...fields };
}

/**
 * Earlier requests for the same rule, made minutes ago: allowed in the town, or settled in the
 * terminal after the tool ran.
 * @param {number} count
 * @param {string} status
 * @param {Record<string, unknown>} [fields]
 */
function earlier(count, status, fields = {}) {
  const proof = status === 'resolved' ? { proof: 'ran' } : {};
  return Array.from({ length: count }, (_, i) => approval({ id: `${status}-${i}`, status, ...proof, createdAt: NOW - (i + 2) * 60_000, ...fields }));
}

/** A line as the card reads it. @param {import('../../../public/js/ui/approval-rules.js').Segment[]} line */
const read = (line) => line.map((part) => ('code' in part ? `[${part.code}]` : part.text)).join('');

/** An earlier request that asked to save `npm test`, ten minutes ago. @param {string} destination */
const savedEarlier = (destination) =>
  approval({ id: 'saved', status: 'allowed', createdAt: NOW - 600_000, always: { rules: NPM_TEST, destination, at: NOW - 590_000 } });

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

  test('ignores an offer the server would not make', () => {
    for (const [why, bad] of /** @type {[string, unknown][]} */ ([
      ['no index', { rules: NPM_TEST, destination: 'localSettings' }],
      ['a fractional index', { index: 0.5, rules: NPM_TEST, destination: 'localSettings' }],
      ['a negative index', { index: -1, rules: NPM_TEST, destination: 'localSettings' }],
      ['no rules', { index: 0, rules: [], destination: 'localSettings' }],
      ['a rule with an unknown field', { index: 0, rules: [{ toolName: 'Bash', scope: 'all' }], destination: 'localSettings' }],
      ['the whole tool', { index: 0, rules: [{ toolName: 'Bash' }], destination: 'localSettings' }],
      ['an empty content, saved as the whole tool', { index: 0, rules: [{ toolName: 'Bash', ruleContent: '' }], destination: 'localSettings' }],
      ['a star', { index: 0, rules: [{ toolName: 'Bash', ruleContent: '*' }], destination: 'localSettings' }],
      ['a glob', { index: 0, rules: [{ toolName: 'Bash', ruleContent: 'rm -f *.log' }], destination: 'localSettings' }],
      ['a path rule, a gitignore pattern', { index: 0, rules: [{ toolName: 'Edit', ruleContent: 'src' }], destination: 'localSettings' }],
      ['a PowerShell prefix', { index: 0, rules: [{ toolName: 'PowerShell', ruleContent: 'Get-Item:*' }], destination: 'localSettings' }],
      ['a shared destination', { index: 0, rules: NPM_TEST, destination: 'projectSettings' }],
      ['not an object', 'Bash(npm test)'],
    ])) {
      assert.equal(offeredSuggestion(approval({ suggestions: [bad] })), null, why);
    }
  });

  test('the line above the button names the literal rule, what it allows and where it is kept', () => {
    assert.equal(
      read(alwaysLine({ index: 0, rules: NPM_TEST, destination: 'localSettings' })),
      'Allow always asks Claude Code to save the rule [Bash(npm test)] (only this command) for this project, only you.',
    );
    assert.equal(
      read(alwaysLine({ index: 0, rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], destination: 'session' })),
      'Allow always asks Claude Code to save the rule [Bash(npm test:*)] (commands starting with “npm test”) until this session ends.',
    );
    assert.equal(
      read(alwaysLine({ index: 1, rules: [...LINT, { toolName: 'mcp__github__get_issue' }], destination: 'localSettings' })),
      'Allow always asks Claude Code to save the rules [Bash(npm run lint)] (only this command), [mcp__github__get_issue] (every use of this tool) for this project, only you.',
    );
  });

  test('every rule gets words, so an escaped rule cannot pass for another command', () => {
    assert.equal(
      read(alwaysLine({ index: 0, rules: [{ toolName: 'Bash', ruleContent: 'echo ), Bash(git status' }], destination: 'localSettings' })),
      'Allow always asks Claude Code to save the rule [Bash(echo \\), Bash\\(git status)] (only this command) for this project, only you.',
    );
    assert.equal(reachWords({ toolName: 'Bash', ruleContent: 'npm test' }), 'only this command');
    assert.equal(reachWords({ toolName: 'PowerShell', ruleContent: 'Get-ChildItem' }), 'only this command');
    assert.equal(reachWords({ toolName: 'Bash', ruleContent: 'git log *' }), 'commands starting with “git log”');
    assert.equal(reachWords({ toolName: 'WebFetch', ruleContent: 'domain:example.com' }), 'only fetches from “example.com”');
    assert.equal(reachWords({ toolName: 'mcp__github__get_issue' }), 'every use of this tool');
    assert.equal(reachWords({ toolName: 'Read', ruleContent: 'src' }), '', 'a rule the town does not offer');
  });

  test('words show hidden characters', () => {
    assert.equal(reachWords({ toolName: 'Bash', ruleContent: 'npm test\u202E:*' }), 'commands starting with “npm test⟨U+202E⟩”');
  });

  test('the rule an "Allow always" asked Claude Code to save, for the result line', () => {
    assert.equal(savedText(approval({ status: 'allowed', always: { rules: NPM_TEST, destination: 'localSettings', at: NOW } })), 'Bash(npm test) for this project, only you');
    assert.equal(savedText(approval({ status: 'allowed', always: { rules: LINT, destination: 'session', at: NOW } })), 'Bash(npm run lint) until this session ends');
    assert.equal(savedText(approval({ status: 'allowed' })), '');
    assert.equal(savedText(approval({ status: 'allowed', always: { rules: 'nonsense' } })), '');
  });
});

describe('counting the same rule', () => {
  test('earlier requests for it in this project allowed today: in the town, or in the terminal when the tool ran', () => {
    const current = approval();
    const others = [...earlier(2, 'allowed'), ...earlier(1, 'resolved')];
    assert.equal(allowedToday(current, [current, ...others], NOW), 3);
  });

  test('a rule saved with "Allow always" counts by the rule it asked to save', () => {
    assert.equal(allowedToday(approval(), [savedEarlier('localSettings')], NOW), 1);
  });

  test('leaves out other projects, other rules, other answers, stops, later requests, other days and itself', () => {
    const current = approval();
    const others = [
      ...earlier(1, 'allowed', { cwd: '/w/other' }),
      ...earlier(1, 'allowed', { suggestions: [{ index: 0, rules: LINT, destination: 'localSettings' }] }),
      ...earlier(1, 'allowed', { suggestions: [] }),
      ...earlier(1, 'resolved', { proof: 'stopped' }),
      ...earlier(1, 'resolved', { proof: 'denied' }),
      ...earlier(1, 'resolved', { proof: undefined }),
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

  test('a rule saved for this project that comes back in the same session may not have been saved', () => {
    const saved = savedEarlier('localSettings');
    assert.equal(askedAgainAfterAlways(approval(), [saved]), true);
    assert.equal(askedAgainAfterAlways(approval({ sessionId: 's2' }), [saved]), false, 'another session may have started before it was saved');
    assert.equal(askedAgainAfterAlways(approval({ createdAt: NOW - 595_000 }), [saved]), false, 'asked before the rule was saved');
    assert.equal(askedAgainAfterAlways(approval({ suggestions: [{ index: 0, rules: LINT, destination: 'localSettings' }] }), [saved]), false, 'another rule');
    assert.equal(askedAgainAfterAlways(approval(), earlier(3, 'allowed')), false, 'plain allows save nothing');
  });

  test('a rule kept for the session is not judged: a resumed session keeps its id, not its rules', () => {
    assert.equal(askedAgainAfterAlways(approval(), [savedEarlier('session')]), false);
  });
});

describe('the hint on a waiting card', () => {
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

  test('a project rule that came back after "Allow always" says so first, without blaming anything', () => {
    assert.equal(approvalHint(approval(), [savedEarlier('localSettings'), ...earlier(4, 'allowed')], NOW), ASKED_AGAIN);
    assert.equal(approvalHint(approval({ held: false }), [savedEarlier('localSettings')], NOW), ASKED_AGAIN);
    assert.equal(approvalHint(approval(), [savedEarlier('session')], NOW), '', 'a session rule is not judged');
  });

  test('only while the request waits', () => {
    assert.equal(approvalHint(approval({ status: 'allowed' }), earlier(3, 'allowed'), NOW), '');
    assert.equal(approvalHint(approval({ status: 'denied' }), [savedEarlier('localSettings')], NOW), '');
  });
});
