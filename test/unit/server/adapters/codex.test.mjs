import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fromCodex } from '../../../../server/adapters/codex.mjs';
import { PATCH, codex } from './fixtures.mjs';

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

  it('quotes list arguments, so one argument with a space never reads as two', () => {
    const line = (/** @type {string[]} */ command) => fromCodex(codex('PreToolUse', { tool_name: 'Bash', tool_use_id: 'b', tool_input: { command } }))[0].tool_input.command;
    assert.equal(line(['rm', 'a b']), "rm 'a b'");
    assert.equal(line(['rm', 'a', 'b']), 'rm a b');
    assert.equal(line(['sh', '-c', "echo 'hi'; ls"]), `sh -c 'echo '\\''hi'\\''; ls'`);
  });

  it("keeps Codex's own tool name on calls it renames, so approvals asked under it settle", () => {
    const patch = fromCodex(codex('PostToolUse', { tool_name: 'apply_patch', tool_use_id: 'p', tool_input: { command: PATCH } }));
    assert.ok(patch.every((event) => event.andary_tool === 'apply_patch'));
    const [spawn] = fromCodex(codex('PostToolUse', { tool_name: 'spawn_agent', tool_use_id: 's', tool_input: { message: 'Go' } }));
    assert.equal(spawn.andary_tool, 'spawn_agent');
    const [shell] = fromCodex(codex('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b', tool_input: { command: 'ls' } }));
    assert.equal(shell.andary_tool, undefined);
  });

  it('leaves events it already translated as they are (a replayed recording)', () => {
    const first = fromCodex(codex('PostToolUse', { tool_name: 'apply_patch', tool_use_id: 'p', tool_input: { command: PATCH }, tool_response: { exit_code: 0 } }));
    const failure = fromCodex(codex('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b', tool_input: { command: ['npm', 'test'] }, tool_response: { exit_code: 1, stderr: 'x' } }));
    const stop = fromCodex(codex('Interrupt'));
    for (const event of [...first, ...failure, ...stop]) {
      const { andary_tool: _tool, ...recorded } = event;
      const [again] = fromCodex(recorded);
      assert.deepEqual([again.hook_event_name, again.tool_name, again.tool_input, again.andary_source], [event.hook_event_name, event.tool_name, event.tool_input, 'codex']);
    }
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

