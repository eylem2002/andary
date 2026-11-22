import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ME, createDemoPeople } from '../../../public/js/sources/demo-people.js';
import { defaultProfile, validateProfile } from '../../../public/js/core/profile.js';

test('the demo is a small team town: you, hosting, and Lina, both at home', () => {
  /** @type {any[]} */
  const seen = [];
  const people = createDemoPeople({ onPeople: (list, me) => seen.push([list, me]) });
  people.start();
  const [[list, me]] = seen;
  assert.equal(me, DEMO_ME);
  assert.deepEqual(list.map((/** @type {any} */ p) => [p.name, p.slot, p.host, p.online]), [['You', 0, true, true], ['Lina', 1, false, true]]);
  for (const person of list) assert.ok(validateProfile(person.profile).ok, person.name);
});

test('saving your look keeps Lina\'s colour hers', () => {
  /** @type {any[]} */
  const seen = [];
  const people = createDemoPeople({ onPeople: (list) => seen.push(list), saved: { ...defaultProfile(1) } });
  people.start();
  assert.equal(seen[0][0].color, 0, 'a saved look asking for Lina\'s colour starts without it');
  assert.deepEqual(people.save(defaultProfile(1)), { color: 2, asked: 1 });
  assert.deepEqual(people.save(defaultProfile(5)), { color: 5, asked: 5 });
  assert.equal(seen.at(-1)[0].color, 5);
  assert.equal(people.save({ v: 2 }), null);
});
