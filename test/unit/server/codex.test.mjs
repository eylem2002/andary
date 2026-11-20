import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { parsePatch } from '../../../server/adapters/apply-patch.mjs';
import { fromCodex } from '../../../server/adapters/codex.mjs';
import { sourceOf, toTownPayloads } from '../../../server/adapters/index.mjs';

const PATCH = [
  '*** Begin Patch',
  '*** Add File: src/new.ts',
  '+export const a = 1;',
  '+export const b = 2;',
  '*** Update File: src/app.ts',
  '@@ function main()',
  ' const x = 1;',
  '-const y = 2;',
  '+const y = 3;',
  '@@',
  '-old()',
  '+renewed()',
  '*** Update File: src/old-name.ts',
  '*** Move to: src/new-name.ts',
  '@@',
  '-a',
  '+b',
  '*** Delete File: src/gone.ts',
  '*** End Patch',
].join('\n');

/** A Codex hook payload, as its hooks send them. @param {string} event @param {Record<string, any>} [extra] */
const codex = (event, extra = {}) => ({
  session_id: 'thr_123',
  transcript_path: '/home/dev/.codex/sessions/2026/11/20/rollout-1.jsonl',
  cwd: '/home/dev/code/app',
  hook_event_name: event,
  model: 'gpt-5.3-codex',
  permission_mode: 'default',
  turn_id: 'turn_1',
  ...extra,
});

describe('parsePatch', () => {
  it('reads added, updated (with hunks and a move) and deleted files', () => {
    const files = parsePatch(PATCH);
    assert.deepEqual(files.map((f) => [f.op, f.path, f.moveTo, f.hunks.length]), [
      ['add', 'src/new.ts', null, 1],
      ['update', 'src/app.ts', null, 2],
      ['update', 'src/old-name.ts', 'src/new-name.ts', 1],
      ['delete', 'src/gone.ts', null, 0],
    ]);
    assert.deepEqual(files[0].hunks[0], { before: '', after: 'export const a = 1;\nexport const b = 2;' });
    assert.deepEqual(files[1].hunks[0], { before: 'const x = 1;\nconst y = 2;', after: 'const x = 1;\nconst y = 3;' });
    assert.deepEqual(files[1].hunks[1], { before: 'old()', after: 'renewed()' });
  });

  it('is empty for anything that is not a patch, and copes with CRLF', () => {
    for (const bad of [undefined, 42, '', 'diff --git a/x b/x', '*** Update File: x']) assert.deepEqual(parsePatch(bad), []);
    assert.equal(parsePatch(PATCH.replace(/\n/g, '\r\n')).length, 4);
  });
});

describe('fromCodex', () => {
  it('turns a patch into one Write, Edit or MultiEdit per file, with paths in the session folder', () => {
    const events = fromCodex(codex('PostToolUse', { tool_name: 'apply_patch', tool_use_id: 'call_9', tool_input: { command: PATCH }, tool_response: { output: 'Done' } }));
    assert.deepEqual(events.map((e) => [e.tool_name, e.tool_use_id, e.tool_input.file_path]), [
      ['Write', 'call_9', join('/home/dev/code/app', 'src/new.ts')],
      ['MultiEdit', 'call_9#2', join('/home/dev/code/app', 'src/app.ts')],
      ['Edit', 'call_9#3', join('/home/dev/code/app', 'src/new-name.ts')],
      ['apply_patch', 'call_9#4', join('/home/dev/code/app', 'src/gone.ts')],
    ]);
    assert.equal(events[0].tool_input.content, 'export const a = 1;\nexport const b = 2;');
    assert.deepEqual(events[1].tool_input.edits[1], { old_string: 'old()', new_string: 'renewed()' });
    assert.deepEqual([events[2].tool_input.old_string, events[2].tool_input.new_string], ['a', 'b']);
    for (const event of events) {
      assert.equal(event.andary_source, 'codex');
      assert.equal(event.session_id, 'thr_123');
      assert.deepEqual(event.tool_response, { output: 'Done' });
    }
  });

  it('keeps a patch it cannot read as one apply_patch call', () => {
    const [event] = fromCodex(codex('PreToolUse', { tool_name: 'apply_patch', tool_use_id: 'c', tool_input: { command: 'not a patch' } }));
    assert.equal(event.tool_name, 'apply_patch');
  });

  it('turns spawn_agent into an Agent call, and joins a shell command given as a list', () => {
    const [spawn] = fromCodex(codex('PreToolUse', { tool_name: 'spawn_agent', tool_use_id: 's', tool_input: { message: 'Review the login flow\nthen report', agent_type: 'reviewer' } }));
    assert.equal(spawn.tool_name, 'Agent');
    assert.deepEqual([spawn.tool_input.description, spawn.tool_input.subagent_type, spawn.tool_input.prompt], ['Review the login flow', 'reviewer', 'Review the login flow\nthen report']);
    const [shell] = fromCodex(codex('PreToolUse', { tool_name: 'Bash', tool_use_id: 'b', tool_input: { command: ['npm', 'test'] } }));
    assert.equal(shell.tool_input.command, 'npm test');
  });

  it('a command that exits with an error is a failure, so it rains', () => {
    const [failure] = fromCodex(codex('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b', tool_input: { command: 'npm test' }, tool_response: { exit_code: 1, stderr: '2 tests failed' } }));
    assert.equal(failure.hook_event_name, 'PostToolUseFailure');
    assert.equal(failure.error, '2 tests failed');
    assert.equal(failure.is_interrupt, false);
    const [ok] = fromCodex(codex('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b', tool_input: { command: 'ls' }, tool_response: { exit_code: 0 } }));
    assert.equal(ok.hook_event_name, 'PostToolUse');
    const [unknown] = fromCodex(codex('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b', tool_input: { command: 'ls' }, tool_response: 'plain text' }));
    assert.equal(unknown.hook_event_name, 'PostToolUse', 'no exit code: not a failure');
  });

  it('an interrupt ends the turn; permission requests and other events pass through unchanged', () => {
    const [stop] = fromCodex(codex('Interrupt'));
    assert.deepEqual([stop.hook_event_name, stop.stop_reason], ['Stop', 'interrupted']);
    const request = codex('PermissionRequest', { tool_name: 'apply_patch', tool_input: { command: PATCH } });
    assert.deepEqual(fromCodex(request), [{ ...request, andary_source: 'codex' }], 'the town shows exactly what it would approve');
    const start = codex('SessionStart', { source: 'startup' });
    assert.deepEqual(fromCodex(start), [{ ...start, andary_source: 'codex' }]);
  });
});

describe('toTownPayloads', () => {
  it('passes Claude Code payloads through, without fields only the server may set', () => {
    assert.deepEqual(toTownPayloads('claude', { hook_event_name: 'Stop', andary_member: 'Mallory', andary_source: 'codex' }), [{ hook_event_name: 'Stop' }]);
    assert.equal(toTownPayloads('codex', { hook_event_name: 'Stop', andary_member: 'Mallory' })[0].andary_member, undefined);
    assert.equal(sourceOf('codex'), 'codex');
    for (const other of [undefined, 'claude', 'gemini', 7]) assert.equal(sourceOf(other), 'claude');
  });
});
