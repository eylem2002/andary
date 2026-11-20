import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isOfferedDestination, isPermissionRule, offerableSuggestions, ruleText, rulesText } from '../../../public/js/core/permission-rules.js';

/** An allow rule suggestion, as Claude Code sends one (CONTRACTS §4.2). @param {Record<string, unknown>} [extra] */
const suggestion = (extra = {}) => ({ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings', ...extra });

describe('which suggestions the town may offer', () => {
  it('offers allow rules for this project or this session, at their place in the list', () => {
    const offered = offerableSuggestions([
      suggestion({ destination: 'projectSettings' }),
      suggestion(),
      { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
      suggestion({ rules: [{ toolName: 'Read' }], destination: 'session' }),
    ]);
    assert.deepEqual(offered, [
      { index: 1, rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], destination: 'localSettings' },
      { index: 3, rules: [{ toolName: 'Read' }], destination: 'session' },
    ]);
  });

  it('never offers shared or user-wide rules, other behaviours, other updates or malformed ones', () => {
    for (const [why, refused] of /** @type {[string, unknown][]} */ ([
      ['committed project settings', suggestion({ destination: 'projectSettings' })],
      ['every project', suggestion({ destination: 'userSettings' })],
      ['no destination', suggestion({ destination: undefined })],
      ['a deny rule', suggestion({ behavior: 'deny' })],
      ['an ask rule', suggestion({ behavior: 'ask' })],
      ['replacing rules', suggestion({ type: 'replaceRules' })],
      ['a mode', { type: 'setMode', mode: 'bypassPermissions', destination: 'session' }],
      ['folders', { type: 'addDirectories', directories: ['/'], destination: 'session' }],
      ['no rules', suggestion({ rules: [] })],
      ['rules that are not a list', suggestion({ rules: { toolName: 'Bash' } })],
      ['a rule without a tool', suggestion({ rules: [{ ruleContent: 'npm test:*' }] })],
      ['an empty tool name', suggestion({ rules: [{ toolName: '' }] })],
      ['a rule content that is not text', suggestion({ rules: [{ toolName: 'Bash', ruleContent: 42 }] })],
      ['a rule with a field the card cannot show', suggestion({ rules: [{ toolName: 'Bash', ruleContent: 'ls', scope: 'all' }] })],
      ['a suggestion with a field the card cannot show', suggestion({ also: { destination: 'userSettings' } })],
      ['not an object', 'addRules'],
      ['nothing', null],
    ])) {
      assert.deepEqual(offerableSuggestions([refused]), [], why);
    }
    assert.deepEqual(offerableSuggestions(undefined), []);
    assert.deepEqual(offerableSuggestions({ 0: suggestion() }), [], 'only a list');
  });

  it('copies the rules, so the offer does not share the request\'s objects', () => {
    const original = suggestion();
    const [offer] = offerableSuggestions([original]);
    assert.notEqual(offer.rules[0], original.rules[0]);
    assert.deepEqual(offer.rules, original.rules);
  });

  it('knows a rule and the two destinations', () => {
    assert.equal(isPermissionRule({ toolName: 'Bash' }), true);
    assert.equal(isPermissionRule({ toolName: 'Bash', ruleContent: '' }), true);
    assert.equal(isPermissionRule({ toolName: 'Bash', extra: 1 }), false);
    assert.equal(isOfferedDestination('localSettings'), true);
    assert.equal(isOfferedDestination('session'), true);
    assert.equal(isOfferedDestination('userSettings'), false);
  });
});

describe('how a rule is written', () => {
  it('in Claude Code\'s settings syntax: Tool(content), or the tool alone', () => {
    assert.equal(ruleText({ toolName: 'Bash', ruleContent: 'npm test:*' }), 'Bash(npm test:*)');
    assert.equal(ruleText({ toolName: 'Read' }), 'Read');
    assert.equal(ruleText({ toolName: 'WebFetch', ruleContent: 'domain:example.com' }), 'WebFetch(domain:example.com)');
    assert.equal(ruleText({ ruleContent: 'npm test:*' }), '');
    assert.equal(ruleText('Bash'), '');
  });

  it('several rules on one line', () => {
    assert.equal(rulesText([{ toolName: 'Bash', ruleContent: 'npm test:*' }, { toolName: 'Bash', ruleContent: 'npm run lint' }]), 'Bash(npm test:*), Bash(npm run lint)');
    assert.equal(rulesText([]), '');
    assert.equal(rulesText('Bash'), '');
  });
});
