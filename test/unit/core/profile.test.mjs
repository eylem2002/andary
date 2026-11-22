import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREW_COLORS } from '../../../public/js/core/catalog.js';
import { LOOKS } from '../../../public/js/core/looks.js';
import {
  HOUSE_STYLES, LOOK_CHOICES, LOOK_FIELDS, PERSON_COLOR_COUNT, PERSON_COLOR_NAMES, PROFILE_MAX_BYTES,
  defaultProfile, randomProfile, validateProfile,
} from '../../../public/js/core/profile.js';

/** A seeded generator, so a failing fuzz case can be replayed. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test('person colours are the crew colours, and house styles the town looks', () => {
  assert.equal(PERSON_COLOR_COUNT, CREW_COLORS.length);
  assert.equal(PERSON_COLOR_NAMES.length, CREW_COLORS.length);
  assert.deepEqual([...HOUSE_STYLES], LOOKS.map((look) => look.id));
});

test('the default and random profiles are valid, and come back as equal copies', () => {
  const random = seeded(7);
  for (const profile of [defaultProfile(3), ...Array.from({ length: 200 }, () => randomProfile(random))]) {
    const check = validateProfile(profile);
    assert.ok(check.ok, JSON.stringify(profile));
    assert.deepEqual(check.profile, profile);
    assert.notEqual(check.profile, profile);
  }
  assert.equal(defaultProfile(99).color, 0);
  assert.deepEqual(randomProfile(seeded(1), { color: 5, house: 'snow' }).color, 5);
});

test('the largest possible profile fits the byte cap', () => {
  const longest = (/** @type {readonly any[]} */ list) => (typeof list[0] === 'string' ? list.reduce((a, b) => (b.length > a.length ? b : a)) : list.length - 1);
  const look = Object.fromEntries(LOOK_FIELDS.map((field) => [field, longest(LOOK_CHOICES[field])]));
  look.topColor = 'theme';
  const profile = { v: 1, color: 7, house: 'desert', look };
  assert.ok(validateProfile(profile).ok);
  assert.ok(Buffer.byteLength(JSON.stringify(profile)) < PROFILE_MAX_BYTES);
});

test('anything that is not exactly a version 1 profile is refused', () => {
  const good = defaultProfile(0);
  const cases = [
    null, 'profile', 42, [], { ...good, v: 2 }, { ...good, extra: 1 }, { v: 1, color: 0, house: 'coast' },
    { ...good, color: 8 }, { ...good, color: -1 }, { ...good, color: 1.5 }, { ...good, color: '1' },
    { ...good, house: 'castle' }, { ...good, look: null }, { ...good, look: [] },
    { ...good, look: { ...good.look, hat: 'fedora' } }, { ...good, look: { ...good.look, skin: 8 } },
    { ...good, look: { ...good.look, hairColor: 9 } }, { ...good, look: { ...good.look, topColor: 10 } },
    { ...good, look: { ...good.look, bottomColor: 'theme' } }, { ...good, look: { ...good.look, unknown: 'x' } },
    { ...good, look: { ...good.look, extra: undefined } }, { ...good, look: { ...good.look, eyes: '<b>' } },
    { ...good, look: Object.fromEntries(Object.entries(good.look).slice(1)) },
    Object.assign(Object.create({ v: 1 }), good),
  ];
  for (const raw of cases) assert.equal(validateProfile(raw).ok, false, JSON.stringify(raw));
});

test('an oversized profile is refused before anything else, and a cycle does not throw', () => {
  const big = { ...defaultProfile(0), pad: 'x'.repeat(PROFILE_MAX_BYTES) };
  assert.match(/** @type {any} */ (validateProfile(big)).error, /512 bytes/);
  const cyclic = /** @type {any} */ ({ v: 1 });
  cyclic.self = cyclic;
  assert.equal(validateProfile(cyclic).ok, false);
});

test('fuzz: mutated profiles are either refused or come back unchanged and in bounds', () => {
  const random = seeded(2026);
  const junk = [null, undefined, true, -1, 0, 1, 7, 8, 9, 10, 1e9, 0.5, NaN, '', 'none', 'theme', 'cap', {}, [], '__proto__'];
  const pick = (/** @type {any[]} */ list) => list[Math.floor(random() * list.length)];
  let accepted = 0;
  for (let i = 0; i < 3000; i++) {
    const profile = /** @type {any} */ (structuredClone(randomProfile(random)));
    const where = random() < 0.25 ? profile : profile.look;
    const key = random() < 0.85 ? pick(Object.keys(where)) : pick(['x', 'constructor', 'toString', 'look2']);
    if (random() < 0.1) delete where[key];
    else where[key] = pick(junk);
    const check = validateProfile(profile);
    if (!check.ok) continue;
    accepted += 1;
    assert.deepEqual(check.profile, JSON.parse(JSON.stringify(profile)));
    for (const field of LOOK_FIELDS) {
      const value = /** @type {any} */ (check.profile.look[field]);
      const choices = /** @type {readonly any[]} */ (LOOK_CHOICES[field]);
      if (typeof choices[0] === 'string') assert.ok(choices.includes(value));
      else assert.ok(value === 'theme' || (Number.isInteger(value) && value >= 0 && value < choices.length));
    }
  }
  assert.ok(accepted > 0, 'some mutations land on another valid value');
});
