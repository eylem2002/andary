import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_NOTE_CHARS, carriesNotes, noteStateText, noteText } from '../../../public/js/core/notes.js';

describe('noteText', () => {
  /** @type {[string, unknown, string|null][]} */
  const TABLE = [
    ['plain text stays', 'Use the staging database', 'Use the staging database'],
    ['line breaks stay, CRLF and CR become LF', 'one\r\ntwo\rthree\nfour', 'one\ntwo\nthree\nfour'],
    ['a tab becomes a space', 'a\tb', 'a b'],
    ['control characters go', 'a\u0000b\u0007c\u001Bd\u007Fe\u0085f', 'abcdef'],
    ['bidirectional overrides and zero-width characters go', 'safe‮evil​x⁦y', 'safeevilxy'],
    ['a lone surrogate goes', 'a\uD800b', 'ab'],
    ['more than one blank line becomes one', 'a\n\n\n\n\nb', 'a\n\nb'],
    ['spaces at the ends of lines and of the note go', '  hi  \n  there  \n', 'hi\n  there'],
    ['only spaces is nothing', ' \n\t ', ''],
    ['not a string is nothing', 42, ''],
    ['the longest note stays whole', 'x'.repeat(MAX_NOTE_CHARS), 'x'.repeat(MAX_NOTE_CHARS)],
    ['a longer one is refused, never cut', 'x'.repeat(MAX_NOTE_CHARS + 1), null],
    ['what cleaning removes does not count', `${'x'.repeat(MAX_NOTE_CHARS)}\u200B\u200B`, 'x'.repeat(MAX_NOTE_CHARS)],
  ];
  for (const [why, raw, expected] of TABLE) it(why, () => assert.equal(noteText(raw), expected));
});

describe('carriesNotes', () => {
  it('names the hooks whose output the agent reads as context, per agent', () => {
    for (const hook of ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit']) assert.equal(carriesNotes('claude', hook), true, hook);
    for (const hook of ['PermissionRequest', 'SessionStart', 'SessionEnd', 'Stop', 'Notification', 'SubagentStop']) assert.equal(carriesNotes('claude', hook), false, hook);
    assert.equal(carriesNotes('codex', 'PostToolUse'), true);
    assert.equal(carriesNotes('codex', 'PostToolUseFailure'), false, 'Codex has no such hook: the adapter makes it from a PostToolUse');
    assert.equal(carriesNotes('claude', undefined), false);
  });
});

describe('noteStateText', () => {
  it('says where a note is', () => {
    assert.equal(noteStateText({ status: 'queued' }), "Note queued for the agent's next step");
    assert.equal(noteStateText({ status: 'delivered', hook: 'PostToolUse' }), 'Note handed to the agent with its PostToolUse hook');
    assert.equal(noteStateText({ status: 'expired', reason: 'the session ended' }), 'Note expired: the session ended');
  });
});
