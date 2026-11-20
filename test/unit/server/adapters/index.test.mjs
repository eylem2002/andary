import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf, toTownPayloads } from '../../../../server/adapters/index.mjs';

describe('toTownPayloads', () => {
  it('passes Claude Code payloads through, without fields only the server may set', () => {
    assert.deepEqual(toTownPayloads('claude', { hook_event_name: 'Stop', andary_member: 'Mallory', andary_source: 'codex' }), [{ hook_event_name: 'Stop' }]);
    assert.equal(toTownPayloads('codex', { hook_event_name: 'Stop', andary_member: 'Mallory' })[0].andary_member, undefined);
    const forged = toTownPayloads('claude', { hook_event_name: 'PostToolUse', tool_name: 'Read', andary_tool: 'Bash', andary_anything: 1 })[0];
    assert.deepEqual(Object.keys(forged).filter((key) => key.startsWith('andary_')), [], 'every andary_ field is the server\'s to set');
    assert.equal(sourceOf('codex'), 'codex');
    for (const other of [undefined, 'claude', 'gemini', 7]) assert.equal(sourceOf(other), 'claude');
  });
});
