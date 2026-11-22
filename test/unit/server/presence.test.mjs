import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createPresence } from '../../../server/presence.mjs';
import { HOMES } from '../../../public/js/core/town-map.js';

/** A presence on a fake clock, with Sam (host, home 0) and Lina (home 1). */
function setup() {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  /** @type {string[][]} */
  const batches = [];
  const slots = /** @type {Record<string, number>} */ ({ Sam: 0, Lina: 1 });
  const presence = createPresence({ homeOf: (name) => slots[name] ?? null, hostName: () => 'Sam', onChange: (names) => batches.push(names), now: Date.now, porchMs: 1000, insideMs: 5000 });
  return { presence, batches };
}

test('everyone starts at home; a walk starts where they stand and is told at most ten times a second', () => {
  const { presence, batches } = setup();
  try {
    assert.deepEqual(presence.view('Lina').tile, HOMES[1].door);
    presence.connect('Lina');
    presence.connect('Sam');
    mock.timers.tick(100);
    assert.deepEqual(batches, [['Lina', 'Sam']], 'one batch for both');
    assert.equal(presence.walk('Lina', [10, 26]).ok, true);
    const walk = presence.view('Lina').walk;
    assert.deepEqual(walk?.path[0], HOMES[1].door);
    assert.equal(walk?.at, 100);
    mock.timers.tick(50);
    assert.equal(batches.length, 1, 'not before 100 ms since the last');
    mock.timers.tick(50);
    assert.deepEqual(batches[1], ['Lina']);
  } finally {
    mock.timers.reset();
  }
});

test('walks: at most four a second, the latest wins; refused while at work', () => {
  const { presence } = setup();
  try {
    presence.connect('Lina');
    assert.equal(presence.walk('Lina', [7, 26]).ok, true);
    presence.walk('Lina', [8, 26]);
    presence.walk('Lina', [9, 26]);
    assert.deepEqual(presence.view('Lina').walk?.path.at(-1), [7, 26], 'the next waits its turn');
    mock.timers.tick(250);
    assert.deepEqual(presence.view('Lina').walk?.path.at(-1), [9, 26], 'the latest wins');
    presence.observe({ hook_event_name: 'UserPromptSubmit', andary_member: 'Lina' }, 'team');
    assert.equal(presence.view('Lina').duty, 'work');
    assert.deepEqual(presence.walk('Lina', [4, 26]), { ok: false, error: 'Your character is at work' });
    presence.observe({ hook_event_name: 'PermissionRequest', andary_member: 'Lina' }, 'team');
    assert.equal(presence.view('Lina').duty, 'needs');
    presence.observe({ hook_event_name: 'Stop', andary_member: 'Lina' }, 'team');
    assert.equal(presence.view('Lina').duty, 'free');
    presence.observe({ hook_event_name: 'StopFailure' }, 'local');
    assert.equal(presence.view('Sam').duty, 'needs', 'local events are the host\'s');
    presence.observe({ hook_event_name: 'SessionEnd' }, 'local');
    assert.equal(presence.view('Sam').duty, 'free');
    presence.observe({ hook_event_name: 'UserPromptSubmit', andary_member: 'Mallory' }, 'team');
    assert.equal(presence.walk('Lina', [0, 0]).ok, false);
  } finally {
    mock.timers.reset();
  }
});

test('emotes, phrases and looks are checked and rate limited', () => {
  const { presence } = setup();
  try {
    assert.equal(presence.say('Lina', 'emote', 3).ok, true);
    assert.match(presence.say('Lina', 'emote', 4).error ?? '', /every 2 seconds/);
    assert.match(presence.say('Lina', 'emote', 8).error ?? '', /set emotes/);
    assert.match(presence.say('Lina', 'phrase', 'Hi there').error ?? '', /set phrases/);
    mock.timers.tick(2000);
    assert.equal(presence.say('Lina', 'emote', 4).ok, true);
    assert.equal(presence.say('Lina', 'phrase', 0).ok, true);
    assert.equal(presence.say('Lina', 'phrase', 1).ok, false);
    assert.equal(presence.look('Lina', 'Sam').ok, true);
    assert.equal(presence.look('Lina', 'Sam').ok, false, 'once per 30 s per pair');
    assert.equal(presence.look('Sam', 'Lina').ok, true, 'the other way is another pair');
    assert.equal(presence.look('Lina', 'Lina').ok, false);
    assert.equal(presence.look('Lina', 'Mallory').ok, false);
  } finally {
    mock.timers.reset();
  }
});

test('offline: on the porch after the porch time, inside after the inside time; back when they return', () => {
  const { presence } = setup();
  try {
    presence.connect('Lina');
    presence.connect('Lina');
    presence.walk('Lina', [10, 26]);
    presence.disconnect('Lina');
    assert.equal(presence.view('Lina').online, true, 'a second connection keeps them here');
    presence.disconnect('Lina');
    assert.equal(presence.view('Lina').away, null);
    mock.timers.tick(1000);
    assert.equal(presence.view('Lina').away, 'porch');
    assert.deepEqual(presence.view('Lina').tile, HOMES[1].door, 'home on the porch');
    assert.equal(presence.view('Lina').lights, false);
    mock.timers.tick(4000);
    assert.equal(presence.view('Lina').away, 'inside');
    presence.observe({ hook_event_name: 'PreToolUse', andary_member: 'Lina' }, 'team');
    assert.equal(presence.view('Lina').lights, true, 'her relay posted: lights on');
    mock.timers.tick(120_000);
    assert.equal(presence.view('Lina').lights, false);
    presence.connect('Lina');
    assert.equal(presence.view('Lina').away, null);
    assert.equal(presence.view('Lina').online, true);
    presence.forgetAllBut(new Set(['Sam']));
    assert.equal(presence.view('Lina').online, false, 'forgotten: a fresh start at home');
  } finally {
    mock.timers.reset();
  }
});
