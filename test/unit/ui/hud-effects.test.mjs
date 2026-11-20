// The words of the toasts the HUD shows for fresh changes (pure helpers, no DOM needed).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { crewToastBody } from '../../../public/js/ui/hud-effects.js';

describe('new crew toast', () => {
  test('names the number key where there is a keyboard', () => {
    assert.equal(crewToastBody(3, false), 'Press 3 to jump to it.');
    assert.equal(crewToastBody(9, false), 'Press 9 to jump to it.');
  });

  test('says nothing about keys on a phone, or for crews without a key', () => {
    assert.equal(crewToastBody(3, true), 'A Claude Code session started.');
    assert.equal(crewToastBody(10, false), 'A Claude Code session started.');
    assert.equal(crewToastBody(0, false), 'A Claude Code session started.');
  });
});
