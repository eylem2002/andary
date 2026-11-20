import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREW_COLORS } from '../../../../public/js/core/catalog.js';
import { contrastRatio, ensureContrastWithWhite, mix, parseHex, safeColor } from '../../../../public/js/world/agents/color.js';
import { kitFor, normalizeHat, resolveLook, wearableFor } from '../../../../public/js/world/agents/looks.js';
import { pickQuality } from '../../../../public/js/world/agents/quality.js';

test('agent types carry fitting tools', () => {
  assert.equal(kitFor('subagent', 'Explore'), 'magnifier');
  assert.equal(kitFor('subagent', 'Plan'), 'blueprint');
  assert.equal(kitFor('subagent', 'general-purpose'), 'toolbox');
  assert.equal(kitFor('subagent', undefined), 'toolbox');
  assert.equal(kitFor('lead', 'Explore'), null);
  assert.equal(kitFor('subagent', 'code-reviewer'), null);
});

test('roles and custom types wear something fitting', () => {
  assert.equal(wearableFor('lead', undefined), 'hivis');
  assert.equal(wearableFor('teammate', 'Explore'), 'backpack');
  assert.equal(wearableFor('subagent', 'code-reviewer'), 'glasses');
  assert.equal(wearableFor('subagent', 'test-runner'), 'net');
  assert.equal(wearableFor('subagent', 'debugger'), 'wrench');
  assert.equal(wearableFor('subagent', 'docs-writer'), 'earpencil');
  assert.equal(wearableFor('subagent', 'web-researcher'), 'headset');
  assert.equal(wearableFor('subagent', 'statusline-setup'), 'satchel');
  assert.equal(wearableFor('subagent', 'Explore'), null);
});

test('hats default by role and reject unknown values', () => {
  assert.equal(normalizeHat(undefined, 'lead'), 'hardhat');
  assert.equal(normalizeHat('sombrero', 'subagent'), 'cap');
  assert.equal(normalizeHat('wizard', 'lead'), 'wizard');
});

test('looks are deterministic per id and vary between ids', () => {
  const a = resolveLook({ id: 's1:main', color: '#2457D6', role: 'lead' });
  assert.deepEqual(resolveLook({ id: 's1:main', color: '#2457D6', role: 'lead' }), a);
  assert.equal(a.hat, 'hardhat');
  const crew = resolveLook({ id: 's1:agent-1', role: 'subagent' });
  assert.ok(a.height > crew.height, 'the Foreman stands taller');
  const skins = new Set();
  for (let i = 0; i < 60; i++) skins.add(resolveLook({ id: `s1:agent-${i}` }).skin);
  assert.ok(skins.size >= 4, 'varied skin tones');
  const bad = resolveLook({ id: 'x', color: 'red; background: url(x)' });
  assert.equal(bad.color, '#2457d6', 'invalid colours fall back');
});

test('colours parse safely and pills keep white text at AA contrast', () => {
  assert.deepEqual(parseHex('#abc'), [170, 187, 204]);
  assert.equal(parseHex('nope'), null);
  assert.equal(safeColor('#ABCDEF', '#000000'), '#abcdef');
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  for (const color of CREW_COLORS) {
    assert.equal(ensureContrastWithWhite(color), color.toLowerCase(), `${color} is already AA`);
  }
  const pale = ensureContrastWithWhite('#9fe8ff');
  assert.ok(contrastRatio(pale, '#ffffff') >= 4.5);
});

test('auto quality drops to low on touch, small screens and few cores', () => {
  /** @type {Parameters<typeof pickQuality>[0]} */
  const desktop = { requested: 'auto', coarsePointer: false, width: 1440, height: 900, cores: 8 };
  assert.equal(pickQuality(desktop), 'high');
  assert.equal(pickQuality({ ...desktop, coarsePointer: true }), 'low');
  assert.equal(pickQuality({ ...desktop, width: 500 }), 'low');
  assert.equal(pickQuality({ ...desktop, cores: 4 }), 'low');
  assert.equal(pickQuality({ ...desktop, cores: 0 }), 'high', 'unknown core count is not penalised');
  assert.equal(pickQuality({ ...desktop, cores: 2, requested: 'high' }), 'high', 'explicit wins');
});
