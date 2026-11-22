import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREW_COLORS } from '../../../public/js/core/catalog.js';
import { LOOKS } from '../../../public/js/core/looks.js';
import {
  HOUSE_STYLES, LOOK_CHOICES, LOOK_FIELDS, NAME_MAX_CHARS, OUTFITS, PERSON_COLOR_COUNT, PERSON_COLOR_NAMES, PROFILE_MAX_BYTES,
  SKIN_TONES, cleanDisplayName, defaultProfile, randomLook, randomProfile, validChoice, validateProfile,
} from '../../../public/js/core/profile.js';

/** A seeded generator, so a failing fuzz case can be replayed. @param {number} seed */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test('person colours are the crew colours, house styles the town looks, and the choices are as wide as asked', () => {
  assert.equal(PERSON_COLOR_COUNT, CREW_COLORS.length);
  assert.equal(PERSON_COLOR_NAMES.length, CREW_COLORS.length);
  assert.deepEqual([...HOUSE_STYLES], LOOKS.map((look) => look.id));
  assert.ok(SKIN_TONES.length >= 10);
  assert.equal(LOOK_CHOICES.top.length, 17);
  assert.equal(LOOK_CHOICES.hair.length, 15);
  assert.deepEqual([...LOOK_CHOICES.topPattern], ['plain', 'stripes', 'checks', 'dots', 'emblem']);
  assert.deepEqual([...LOOK_CHOICES.pet], ['none', 'cat', 'dog', 'bird']);
});

test('the default, random and ready-made looks are valid, and come back as equal copies', () => {
  const random = seeded(7);
  const profiles = [defaultProfile(3), ...Array.from({ length: 200 }, () => randomProfile(random)), ...OUTFITS.map((o) => ({ ...defaultProfile(0), look: { ...defaultProfile(0).look, ...o.look } }))];
  for (const profile of profiles) {
    const check = validateProfile(profile);
    assert.ok(check.ok, JSON.stringify(profile));
    assert.deepEqual(check.profile, profile);
    assert.notEqual(check.profile, profile);
  }
  assert.equal(defaultProfile(99).color, 0);
  assert.equal(randomProfile(seeded(1), { color: 5, house: 'snow', name: 'Lina', agents: 'Pixel' }).agents, 'Pixel');
  for (const field of LOOK_FIELDS) assert.ok(validChoice(field, randomLook(seeded(3))[field]), field);
});

test('the largest possible profile, names in any script included, fits the byte cap', () => {
  const longest = (/** @type {readonly any[]} */ list) => (typeof list[0] === 'string' ? list.reduce((a, b) => (b.length > a.length ? b : a)) : list.length - 1);
  const look = Object.fromEntries(LOOK_FIELDS.map((field) => [field, longest(LOOK_CHOICES[field])]));
  look.topColor = 'theme';
  look.patternColor = 'theme';
  const wide = '鷹'.repeat(NAME_MAX_CHARS);
  const profile = { v: 1, color: 7, house: 'desert', name: wide, agents: wide, look };
  assert.ok(validateProfile(profile).ok);
  assert.ok(Buffer.byteLength(JSON.stringify(profile)) <= PROFILE_MAX_BYTES, `${Buffer.byteLength(JSON.stringify(profile))} bytes`);
});

test('names are plain text: letters and digits of any script, spaces, dots, dashes; nothing invisible', () => {
  assert.equal(cleanDisplayName('  Zeynep   Ç. '), 'Zeynep Ç.');
  assert.equal(cleanDisplayName('<b>Pixel</b>'), 'bPixelb');
  assert.equal(cleanDisplayName('Pi​xel‮'), 'Pixel');
  assert.equal(cleanDisplayName('x'.repeat(40)).length, NAME_MAX_CHARS);
  assert.equal(cleanDisplayName(42), '');
  const good = defaultProfile(0);
  assert.ok(validateProfile({ ...good, name: 'Zeynep Ç.', agents: 'Pixel' }).ok);
  for (const name of [' Pixel', 'Pixel ', 'Pi  xel', '<i>', 'Pi​xel', 'x'.repeat(21), 42, null]) {
    assert.equal(validateProfile({ ...good, name }).ok, false, JSON.stringify(name));
    assert.equal(validateProfile({ ...good, agents: name }).ok, false, JSON.stringify(name));
  }
});

test('anything that is not exactly a version 1 profile is refused', () => {
  const good = defaultProfile(0);
  /** @param {Record<string, unknown>} patch */
  const look = (patch) => ({ ...good, look: { ...good.look, ...patch } });
  const { name: _name, ...noName } = good;
  const cases = [
    null, 'profile', 42, [], { ...good, v: 2 }, { ...good, extra: 1 }, noName,
    { ...good, color: 8 }, { ...good, color: -1 }, { ...good, color: 1.5 }, { ...good, color: '1' },
    { ...good, house: 'castle' }, { ...good, look: null }, { ...good, look: [] },
    look({ hat: 'fedora' }), look({ skin: 12 }), look({ hairColor: 12 }), look({ topColor: 12 }), look({ hairStreak: 'theme' }),
    look({ bottomColor: 'theme' }), look({ unknown: 'x' }), look({ extra: undefined }), look({ eyes: '<b>' }), look({ height: 'giant' }),
    { ...good, look: Object.fromEntries(Object.entries(good.look).slice(1)) },
    Object.assign(Object.create({ v: 1 }), good),
  ];
  for (const raw of cases) assert.equal(validateProfile(raw).ok, false, JSON.stringify(raw));
});

test('an oversized profile is refused before anything else, and a cycle does not throw', () => {
  const big = { ...defaultProfile(0), pad: 'x'.repeat(PROFILE_MAX_BYTES) };
  assert.match(/** @type {any} */ (validateProfile(big)).error, new RegExp(`${PROFILE_MAX_BYTES} bytes`));
  const cyclic = /** @type {any} */ ({ v: 1 });
  cyclic.self = cyclic;
  assert.equal(validateProfile(cyclic).ok, false);
});

test('fuzz: mutated profiles are either refused or come back unchanged and in bounds', () => {
  const random = seeded(2026);
  const junk = [null, undefined, true, -1, 0, 1, 7, 8, 11, 12, 1e9, 0.5, NaN, '', 'none', 'theme', 'cap', 'Pixel', ' x', {}, [], '__proto__'];
  const pick = (/** @type {any[]} */ list) => list[Math.floor(random() * list.length)];
  let accepted = 0;
  for (let i = 0; i < 4000; i++) {
    const profile = /** @type {any} */ (structuredClone(randomProfile(random)));
    const where = random() < 0.25 ? profile : profile.look;
    const key = random() < 0.85 ? pick(Object.keys(where)) : pick(['x', 'constructor', 'toString', 'look2']);
    if (random() < 0.1) delete where[key];
    else where[key] = pick(junk);
    const check = validateProfile(profile);
    if (!check.ok) continue;
    accepted += 1;
    assert.deepEqual(check.profile, JSON.parse(JSON.stringify(profile)));
    for (const field of LOOK_FIELDS) assert.ok(validChoice(field, /** @type {any} */ (check.profile).look[field]), field);
    for (const name of [check.profile?.name, check.profile?.agents]) assert.equal(cleanDisplayName(name), name);
  }
  assert.ok(accepted > 0, 'some mutations land on another valid value');
});
