import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  describeApproval,
  doingText,
  formatAgo,
  formatCountdown,
  formatDuration,
  isCommandText,
  listJoin,
  modelLabel,
  plural,
  progressOf,
  roleLabel,
  shortenPath,
  statusLabel,
  truncate,
} from '../../../public/js/ui/format.js';

describe('formatDuration', () => {
  test('seconds, minutes with seconds, minutes, hours, days', () => {
    assert.equal(formatDuration(0), '0s');
    assert.equal(formatDuration(45_900), '45s');
    assert.equal(formatDuration(65_000), '1m 05s');
    assert.equal(formatDuration(9 * 60_000 + 59_000), '9m 59s');
    assert.equal(formatDuration(34 * 60_000), '34m');
    assert.equal(formatDuration(2 * 3_600_000 + 5 * 60_000), '2h 05m');
    assert.equal(formatDuration(27 * 3_600_000), '1d 3h');
  });

  test('negative or invalid input reads as zero', () => {
    assert.equal(formatDuration(-5000), '0s');
    assert.equal(formatDuration(Number.NaN), '0s');
  });
});

describe('formatAgo', () => {
  const now = 1_000_000_000;
  test('long form', () => {
    assert.equal(formatAgo(now - 3000, now), 'just now');
    assert.equal(formatAgo(now - 47_000, now), '40s ago');
    assert.equal(formatAgo(now - 5 * 60_000, now), '5m ago');
    assert.equal(formatAgo(now - 3 * 3_600_000, now), '3h ago');
    assert.equal(formatAgo(now - 50 * 3_600_000, now), '2d ago');
  });

  test('short form rounds seconds down to tens', () => {
    assert.equal(formatAgo(now - 9000, now, { short: true }), 'now');
    assert.equal(formatAgo(now - 19_000, now, { short: true }), '10s');
    assert.equal(formatAgo(now - 61_000, now, { short: true }), '1m');
  });

  test('a timestamp in the future reads as now', () => {
    assert.equal(formatAgo(now + 5000, now, { short: true }), 'now');
  });
});

describe('formatCountdown', () => {
  test('rounds up and pads seconds', () => {
    assert.equal(formatCountdown(105_000), '1:45');
    assert.equal(formatCountdown(9_001), '0:10');
    assert.equal(formatCountdown(500), '0:01');
    assert.equal(formatCountdown(0), '0:00');
    assert.equal(formatCountdown(-3000), '0:00');
  });
});

describe('truncate', () => {
  test('collapses whitespace and adds an ellipsis only when needed', () => {
    assert.equal(truncate('  a\n\tb  ', 10), 'a b');
    assert.equal(truncate('abcdefghij', 10), 'abcdefghij');
    assert.equal(truncate('abcdefghijk', 10), 'abcdefghi…');
    assert.equal(truncate(null, 5), '');
  });
});

describe('shortenPath', () => {
  test('relative to the crew folder', () => {
    assert.equal(shortenPath('/home/dev/app/src/a.ts', { cwd: '/home/dev/app' }), 'src/a.ts');
    assert.equal(shortenPath('/home/dev/app/src/a.ts', { cwd: '/home/dev/app/' }), 'src/a.ts');
  });

  test('home folder becomes ~ outside the crew folder', () => {
    assert.equal(shortenPath('/home/dev/other/x.md', { cwd: '/home/dev/app' }), '~/other/x.md');
    assert.equal(shortenPath('/Users/kim/notes.txt'), '~/notes.txt');
    assert.equal(shortenPath('C:\\Users\\kim\\notes.txt'), '~\\notes.txt');
  });

  test('collapses middle segments to fit', () => {
    const long = 'src/features/authentication/session/refresh/token-store.ts';
    const short = shortenPath(long, { max: 36 });
    assert.ok(short.length <= 36, short);
    assert.ok(short.startsWith('src/…/'), short);
    assert.ok(short.endsWith('token-store.ts'), short);
  });

  test('falls back to the file name, then its tail', () => {
    assert.equal(shortenPath('a/b/very-long-file-name-for-testing.js', { max: 37 }), '…/very-long-file-name-for-testing.js');
    assert.equal(shortenPath('averyveryverylongfilename.js', { max: 12 }), '…filename.js');
  });

  test('empty input', () => {
    assert.equal(shortenPath(''), '');
    assert.equal(shortenPath(undefined), '');
  });
});

describe('words', () => {
  test('plural and listJoin', () => {
    assert.equal(plural(1, 'crew'), '1 crew');
    assert.equal(plural(3, 'crew'), '3 crews');
    assert.equal(plural(2, 'tool call'), '2 tool calls');
    assert.equal(listJoin([]), '');
    assert.equal(listJoin(['a']), 'a');
    assert.equal(listJoin(['a', 'b']), 'a and b');
    assert.equal(listJoin(['a', 'b', 'c']), 'a, b and c');
  });

  test('progressOf counts completed items', () => {
    assert.deepEqual(progressOf([]), { done: 0, total: 0, ratio: 0 });
    assert.deepEqual(progressOf([{ status: 'completed' }, { status: 'pending' }, { status: 'in_progress' }, { status: 'completed' }]), { done: 2, total: 4, ratio: 0.5 });
  });

  test('model labels', () => {
    assert.equal(modelLabel('claude-opus-5-5'), 'Opus 5.5');
    assert.equal(modelLabel('claude-sonnet-4-5-20250929'), 'Sonnet 4.5');
    assert.equal(modelLabel('claude-opus-4-20250514'), 'Opus 4');
    assert.equal(modelLabel('claude-3-5-sonnet-20241022'), 'Sonnet 3.5');
    assert.equal(modelLabel('claude-haiku-5'), 'Haiku 5');
    assert.equal(modelLabel('gpt-something'), 'gpt-something');
    assert.equal(modelLabel(undefined), '');
  });

  test('role and status labels', () => {
    assert.equal(roleLabel({ role: 'lead' }), 'Lead agent');
    assert.equal(roleLabel({ role: 'subagent', type: 'Explore' }), 'Explore subagent');
    assert.equal(roleLabel({ role: 'subagent', type: 'general-purpose' }), 'General-purpose subagent');
    assert.equal(roleLabel({ role: 'subagent' }), 'Subagent');
    assert.equal(roleLabel({ role: 'teammate', type: 'teammate' }), 'Teammate');
    assert.equal(statusLabel('waiting'), 'Waiting for approval');
    assert.equal(statusLabel('nonsense'), 'Idle');
  });

  test('isCommandText', () => {
    assert.equal(isCommandText('$ npm test'), true);
    assert.equal(isCommandText('PS> dir'), true);
    assert.equal(isCommandText('Read a.ts'), false);
    assert.equal(isCommandText(undefined), false);
  });
});

describe('describeApproval', () => {
  test('shell commands are shown verbatim with a prompt', () => {
    assert.deepEqual(describeApproval({ toolName: 'Bash', toolInput: { command: 'rm -rf dist' } }), { action: 'run a command', detail: '$ rm -rf dist' });
  });

  test('file tools show the path relative to the crew folder', () => {
    assert.deepEqual(describeApproval({ toolName: 'Edit', toolInput: { file_path: '/w/app/src/a.ts' }, cwd: '/w/app' }), { action: 'edit a file', detail: 'src/a.ts' });
    assert.equal(describeApproval({ toolName: 'Write', toolInput: { file_path: 'b.ts' } }).action, 'write a file');
  });

  test('web, MCP and unknown tools', () => {
    assert.deepEqual(describeApproval({ toolName: 'WebFetch', toolInput: { url: 'https://x.dev' } }), { action: 'fetch a web page', detail: 'https://x.dev' });
    assert.deepEqual(describeApproval({ toolName: 'mcp__github__create_issue', toolInput: { title: 'Bug' } }), { action: 'use create_issue from github', detail: 'Bug' });
    assert.deepEqual(describeApproval({ toolName: 'Frobnicate', toolInput: { level: 3, note: 'hi' } }), { action: 'use Frobnicate', detail: 'hi' });
  });

  test('survives missing or hostile input', () => {
    assert.deepEqual(describeApproval({ toolName: 'Bash', toolInput: null }), { action: 'run a command', detail: '$ ' });
    assert.deepEqual(describeApproval({ toolName: 'constructor', toolInput: {} }), { action: 'use constructor', detail: '' });
    assert.deepEqual(describeApproval({}), { action: 'use a tool', detail: '' });
  });
});

describe('doingText', () => {
  test('says what the agent is doing or waiting for', () => {
    assert.equal(doingText({ status: 'working', summary: '$ npm test' }), '$ npm test');
    assert.equal(doingText({ status: 'working', description: 'Find callers' }), 'Find callers');
    assert.equal(doingText({ status: 'working' }), 'Getting started');
    assert.equal(doingText({ status: 'waiting' }, { toolName: 'Bash', toolInput: { command: 'npm publish' } }), 'Needs approval: $ npm publish');
    assert.equal(doingText({ status: 'waiting' }), 'Waiting for your answer');
    assert.equal(doingText({ status: 'idle', role: 'lead' }), 'Waiting for your next prompt');
    assert.equal(doingText({ status: 'idle', role: 'subagent' }), 'Idle');
    assert.equal(doingText({ status: 'done', summary: 'Read a.ts' }), 'Finished');
    assert.equal(doingText({ status: 'error', summary: 'grep x' }), 'Failed: grep x');
  });
});
