import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isOfferedDestination, isPermissionRule, offerableSuggestions, ruleReach, ruleText, rulesText } from '../../../public/js/core/permission-rules.js';

/** An allow rule suggestion, as Claude Code sends one (CONTRACTS §4.2). @param {Record<string, unknown>} [extra] */
const suggestion = (extra = {}) => ({ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings', ...extra });
/** @param {string} toolName @param {string} [ruleContent] */
const rule = (toolName, ruleContent) => (ruleContent === undefined ? { toolName } : { toolName, ruleContent });

describe('which suggestions the town may offer', () => {
  it('offers allow rules for this project or this session, at their place in the list', () => {
    const offered = offerableSuggestions([
      suggestion({ destination: 'projectSettings' }),
      suggestion(),
      { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
      suggestion({ rules: [rule('mcp__github__get_issue')], destination: 'session' }),
    ]);
    assert.deepEqual(offered, [
      { index: 1, rules: [rule('Bash', 'npm test:*')], destination: 'localSettings' },
      { index: 3, rules: [rule('mcp__github__get_issue')], destination: 'session' },
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
      ['one narrow rule beside a broad one', suggestion({ rules: [rule('Bash', 'npm test'), rule('Bash', '*')] })],
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

describe('what a rule allows', () => {
  it('one exact command or value', () => {
    assert.deepEqual(ruleReach(rule('Bash', 'npm test')), { kind: 'exact' });
    assert.deepEqual(ruleReach(rule('Bash', 'rm -rf node_modules')), { kind: 'exact' });
    assert.deepEqual(ruleReach(rule('PowerShell', 'Get-ChildItem')), { kind: 'exact' });
    assert.deepEqual(ruleReach(rule('WebFetch', 'domain:example.com')), { kind: 'exact' });
    assert.deepEqual(ruleReach(rule('Read', './src/app.ts')), { kind: 'exact' });
  });

  it('commands starting with a prefix, written either way Claude Code writes one', () => {
    assert.deepEqual(ruleReach(rule('Bash', 'npm test:*')), { kind: 'prefix', prefix: 'npm test' });
    assert.deepEqual(ruleReach(rule('Bash', 'npm test *')), { kind: 'prefix', prefix: 'npm test' });
    assert.deepEqual(ruleReach(rule('PowerShell', 'git log:*')), { kind: 'prefix', prefix: 'git log' });
  });

  it('every call of one MCP tool, the narrowest rule there is for it', () => {
    assert.deepEqual(ruleReach(rule('mcp__github__get_issue')), { kind: 'tool' });
  });

  it('nothing it cannot say plainly: whole tools, wildcards, MCP rules with content', () => {
    for (const [why, broad] of /** @type {[string, unknown][]} */ ([
      ['no content: the whole tool', rule('Bash')],
      ['empty content, which Claude Code saves as the bare tool', rule('Bash', '')],
      ['blank content', rule('Bash', '   ')],
      ['a star: the whole tool', rule('Bash', '*')],
      ['a wildcard in the middle', rule('Bash', 'rm -f *.log')],
      ['a wildcard before the subcommand', rule('Bash', 'git * main')],
      ['a leading wildcard', rule('Bash', '* --version')],
      ['two wildcards', rule('Bash', 'npm * test:*')],
      ['a prefix of nothing', rule('Bash', ':*')],
      ['a prefix of spaces', rule('Bash', '   *')],
      ['a star glued to a word', rule('Bash', 'ls*')],
      ['a path pattern', rule('Read', '/home/me/project/**')],
      ['a gitignore character class', rule('Edit', './src/[ab].ts')],
      ['a gitignore single-character wildcard', rule('Edit', './src/a?.ts')],
      ['a domain wildcard', rule('WebFetch', 'domain:*.example.com')],
      ['a prefix on a tool that is not a command line', rule('Skill', 'commit:*')],
      ['a whole built-in tool', rule('WebSearch')],
      ['a whole MCP server', rule('mcp__github')],
      ['every tool of an MCP server', rule('mcp__github__*')],
      ['an MCP rule with content, which Claude Code skips', rule('mcp__github__get_issue', 'x')],
      ['a tool name with parentheses', rule('Bash(x)', 'ls')],
      ['not a rule', 'Bash(ls)'],
    ])) {
      assert.equal(ruleReach(broad), null, why);
    }
  });
});

describe('how a rule is written', () => {
  it('in Claude Code\'s settings syntax: Tool(content), or the tool alone', () => {
    assert.equal(ruleText(rule('Bash', 'npm test:*')), 'Bash(npm test:*)');
    assert.equal(ruleText(rule('mcp__github__get_issue')), 'mcp__github__get_issue');
    assert.equal(ruleText(rule('WebFetch', 'domain:example.com')), 'WebFetch(domain:example.com)');
    assert.equal(ruleText(rule('Bash', '')), 'Bash', 'an empty content is saved as the bare tool');
    assert.equal(ruleText({ ruleContent: 'npm test:*' }), '');
    assert.equal(ruleText('Bash'), '');
  });

  it('escapes a backslash and parentheses as Claude Code does, so one rule cannot read as two', () => {
    assert.equal(ruleText(rule('Bash', 'echo ), Bash(git status')), 'Bash(echo \\), Bash\\(git status)');
    assert.equal(ruleText(rule('Bash', 'printf "a\\n"')), 'Bash(printf "a\\\\n")');
  });

  it('reveals hidden characters: the rule is read before it is saved', () => {
    assert.equal(ruleText(rule('Bash', 'npm test‮:*')), 'Bash(npm test⟨U+202E⟩:*)');
  });

  it('several rules on one line', () => {
    assert.equal(rulesText([rule('Bash', 'npm test:*'), rule('Bash', 'npm run lint')]), 'Bash(npm test:*), Bash(npm run lint)');
    assert.equal(rulesText([]), '');
    assert.equal(rulesText('Bash'), '');
  });
});
