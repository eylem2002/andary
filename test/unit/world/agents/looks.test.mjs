import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREW_COLORS } from '../../../../public/js/core/catalog.js';
import { contrastRatio, ensureContrastWithWhite, mix, parseHex, safeColor } from '../../../../public/js/world/agents/color.js';
import { cleanPersonLook, kitFor, normalizeHat, resolveLook, wearableFor } from '../../../../public/js/world/agents/looks.js';
import { CLOTH_COLORS, LOOK_CHOICES, SKIN_TONES, defaultProfile, randomProfile } from '../../../../public/js/core/profile.js';
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

test('a person is drawn from the look they chose, 1.3× a helper by height, every choice in the geometry key', () => {
  const look = { ...defaultProfile(2).look, hair: 'bun', topColor: 6, extra: 'cape', hat: 'beanie', skin: 3, pet: 'cat' };
  const person = resolveLook({ id: 'person:Lina', color: CREW_COLORS[2], role: 'person', person: look });
  assert.equal(person.role, 'person');
  assert.equal(person.hat, 'beanie');
  assert.equal(person.person?.hair, 'bun');
  assert.equal(person.person?.pet, 'cat');
  assert.equal(person.person?.colors.shirt, CLOTH_COLORS[6].hex);
  assert.equal(person.skin, SKIN_TONES[3].hex);
  const helper = resolveLook({ id: 'x:agent-1', role: 'subagent' });
  assert.equal(helper.person, null, 'helpers keep their plain figure');
  assert.ok(Math.abs(person.height / 1.6 - 1.3) < 1e-9, 'a person stands 1.3× a helper');
  const tall = resolveLook({ id: 'p', color: CREW_COLORS[2], role: 'person', person: { ...look, height: 'tall' } });
  const short = resolveLook({ id: 'p', color: CREW_COLORS[2], role: 'person', person: { ...look, height: 'short' } });
  assert.ok(tall.height > person.height && person.height > short.height && short.height > helper.height);
  assert.equal(resolveLook({ id: 'p', color: CREW_COLORS[2], role: 'person', person: { ...look, topColor: 'theme' } }).person?.colors.shirt, person.color, "'theme' wears their own colour");
  // Every field changes the geometry key, so two people never share geometry by mistake.
  const keys = new Set();
  const random = (() => { let n = 1; return () => ((n = (n * 16807) % 2147483647) / 2147483647); })();
  for (let i = 0; i < 300; i++) keys.add(resolveLook({ id: 'p', color: '#2457D6', role: 'person', person: randomProfile(random).look }).key);
  assert.ok(keys.size > 290);
  for (const field of /** @type {(keyof typeof look)[]} */ (Object.keys(look))) {
    const choices = /** @type {readonly any[]} */ (LOOK_CHOICES[field]);
    const other = { ...look, [field]: typeof choices[0] === 'string' ? choices.find((c) => c !== look[field]) : (Number(look[field]) + 1) % choices.length };
    assert.notEqual(resolveLook({ id: 'p', color: '#2457D6', role: 'person', person: other }).key, person.key, field);
  }
});

test('a person look from anywhere is checked field by field', () => {
  const clean = cleanPersonLook({ hair: 'mullet', skin: 99, topColor: 'theme', hat: 'beanie', extra: '<script>' });
  const fallback = defaultProfile(0).look;
  assert.equal(clean.hair, fallback.hair);
  assert.equal(clean.skin, fallback.skin);
  assert.equal(clean.topColor, 'theme');
  assert.equal(clean.hat, 'beanie');
  assert.equal(clean.extra, 'none');
  assert.deepEqual(cleanPersonLook(null), fallback);
});
