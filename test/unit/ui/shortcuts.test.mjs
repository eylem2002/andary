import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SHORTCUT_HELP, isTypingTarget, shortcutFor } from '../../../public/js/ui/shortcuts.js';

describe('shortcutFor', () => {
  test('maps the documented keys', () => {
    const cases = {
      f: 'follow',
      F: 'follow',
      g: 'walk-mode',
      G: 'walk-mode',
      Escape: 'escape',
      '[': 'rotate-left',
      ']': 'rotate-right',
      '+': 'zoom-in',
      '=': 'zoom-in',
      '-': 'zoom-out',
      '0': 'reset-view',
      n: 'cycle-time',
      m: 'toggle-sound',
      a: 'approvals',
      c: 'director',
      C: 'director',
      h: 'toggle-panels',
      H: 'toggle-panels',
      p: 'place-names',
      P: 'place-names',
      i: 'needs-you',
      w: 'catch-up',
      W: 'catch-up',
      r: 'review',
      R: 'review',
      '?': 'help',
    };
    for (const [key, action] of Object.entries(cases)) assert.equal(shortcutFor({ key }), action, key);
  });

  test('1 to 9 jump to crews', () => {
    assert.equal(shortcutFor({ key: '1' }), 'crew-1');
    assert.equal(shortcutFor({ key: '9' }), 'crew-9');
  });

  test('unknown keys and modifier chords are left to the browser', () => {
    assert.equal(shortcutFor({ key: 'x' }), null);
    assert.equal(shortcutFor({ key: 'f', ctrlKey: true }), null);
    assert.equal(shortcutFor({ key: 'r', metaKey: true }), null);
    assert.equal(shortcutFor({ key: '1', altKey: true }), null);
  });

  test('Space pauses only the demo, and never steals a button press', () => {
    assert.equal(shortcutFor({ key: ' ' }, { mode: 'demo' }), 'pause');
    assert.equal(shortcutFor({ key: ' ' }, { mode: 'live' }), null);
    assert.equal(shortcutFor({ key: ' ' }, { mode: 'demo', target: { tagName: 'BUTTON' } }), null);
    assert.equal(shortcutFor({ key: ' ' }, { mode: 'demo', target: { tagName: 'INPUT', type: 'checkbox' } }), null);
    assert.equal(shortcutFor({ key: ' ' }, { mode: 'demo', target: { tagName: 'DIV', role: 'tab' } }), null);
    assert.equal(shortcutFor({ key: ' ' }, { mode: 'demo', target: { tagName: 'OL' } }), 'pause');
  });

  test('ignored while typing', () => {
    assert.equal(shortcutFor({ key: 'f' }, { target: { tagName: 'INPUT', type: 'text' } }), null);
    assert.equal(shortcutFor({ key: '1' }, { target: { tagName: 'TEXTAREA' } }), null);
    assert.equal(shortcutFor({ key: 'a' }, { target: { tagName: 'SELECT' } }), null);
    assert.equal(shortcutFor({ key: 'm' }, { target: { tagName: 'DIV', isContentEditable: true } }), null);
    assert.equal(shortcutFor({ key: 'm' }, { target: { tagName: 'INPUT', type: 'range' } }), 'toggle-sound');
  });
});

describe('isTypingTarget', () => {
  test('text fields yes, other controls no', () => {
    assert.equal(isTypingTarget(null), false);
    assert.equal(isTypingTarget({ tagName: 'input' }), true);
    assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'search' }), true);
    assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' }), false);
    assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
    assert.equal(isTypingTarget({ tagName: 'DIV', role: 'textbox' }), true);
  });
});

test('the help dialog lists every shortcut once', () => {
  const labels = SHORTCUT_HELP.map((item) => item.label);
  assert.equal(new Set(labels).size, labels.length);
  assert.ok(SHORTCUT_HELP.find((item) => item.keys.includes('Space'))?.demoOnly);
  assert.match(SHORTCUT_HELP.find((item) => item.keys.includes('W'))?.label ?? '', /^Catch me up/);
});
