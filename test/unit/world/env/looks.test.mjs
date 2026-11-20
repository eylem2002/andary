import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOKS, readLook } from '../../../../public/js/core/looks.js';
import { COAST_STYLE, LOOK_PALETTES } from '../../../../public/js/world/env/look-palettes.js';
import { C } from '../../../../public/js/world/env/palette.js';
import { skyKeysFor } from '../../../../public/js/world/env/daynight.js';
import { BUILDING_KEYS } from '../../../../public/js/core/catalog.js';

test('readLook: ?look= first, then the saved preference, else the coast', () => {
  const storage = (value) => ({ getItem: () => value });
  assert.equal(readLook('?look=snow', storage(null)), 'snow');
  assert.equal(readLook('?look=moon', storage(JSON.stringify({ townLook: 'neon' }))), 'neon');
  assert.equal(readLook('', storage(JSON.stringify({ townLook: 'desert' }))), 'desert');
  assert.equal(readLook('', storage(JSON.stringify({ townLook: 'mars' }))), 'coast');
  assert.equal(readLook('', storage('not json')), 'coast');
  assert.equal(readLook('', null), 'coast');
  assert.deepEqual(LOOKS.map((l) => l.id), ['coast', 'snow', 'neon', 'desert', 'amman']);
});

const SHARED = ['stone', 'plaster', 'stoneWarm', 'stonePale', 'stoneTrim', 'stoneDark', 'gold', 'goldDeep', 'brick', 'brickDark'];

test('every look paints every building, names real neon tubes and keeps the shared tones apart', () => {
  for (const [id, look] of Object.entries(LOOK_PALETTES)) {
    const colors = { ...C, ...look.colors };
    const tones = SHARED.map((k) => colors[/** @type {keyof typeof colors} */ (k)]);
    if (look.paint) {
      assert.equal(new Set(tones).size, tones.length, `${id}: two shared tones have one colour, so one would repaint the other`);
      assert.deepEqual(Object.keys(look.paint).sort(), [...BUILDING_KEYS].sort(), id);
      for (const paint of Object.values(look.paint)) assert.ok(['pink', 'cyan', 'violet', 'orange', 'mint'].includes(paint.neon), id);
    }
    for (const value of Object.values(look.colors)) assert.ok(Number.isInteger(value) && value >= 0 && value <= 0xffffff, id);
    for (const key of Object.keys(look.colors)) assert.ok(key in C, `${id}: ${key} is not a palette colour`);
    const style = look.style;
    assert.deepEqual(Object.keys(style).sort(), Object.keys(COAST_STYLE).sort(), id);
    for (const rgb of [...Object.values(style.water), ...Object.values(style.strata)]) assert.ok(rgb.length === 3 && rgb.every((c) => c >= 0 && c <= 1), id);
    assert.ok(['palm', 'round', 'cypress'].includes(style.rimTree), id);
  }
});

test('every look\'s sky starts at midnight, runs in order and stays in range', () => {
  for (const { id } of LOOKS) {
    const keys = skyKeysFor(id);
    assert.equal(keys[0].h, 0, id);
    for (let i = 1; i < keys.length; i++) assert.ok(keys[i].h > keys[i - 1].h, `${id} key ${i}`);
    for (const k of keys) {
      for (const field of ['zenith', 'horizon', 'bottom', 'light', 'hemiSky', 'hemiGround']) assert.match(k[field], /^#[0-9a-f]{6}$/, `${id} ${field}`);
      assert.ok(k.night >= 0 && k.night <= 1 && k.lightI >= 0, id);
    }
  }
  assert.ok(skyKeysFor('neon').every((k) => k.night >= 0.55), 'the neon city never switches its lights off');
});
