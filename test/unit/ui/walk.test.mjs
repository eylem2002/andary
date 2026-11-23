import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeOwner, placeOf, walkPlaces } from '../../../public/js/ui/walk.js';
import { defaultProfile } from '../../../public/js/core/profile.js';
import { HOMES, LOTS } from '../../../public/js/core/town-map.js';
import { WALK_TILES_PER_SECOND } from '../../../public/js/core/presence.js';

const sam = { name: 'Sam', slot: 0, color: 0, host: true, online: true, profile: null };
const lina = { name: 'Lina', slot: 1, color: 1, host: false, online: true, profile: { ...defaultProfile(1), name: 'Captain Lina' } };
const omar = { name: 'Omar', slot: 2, color: 2, host: false, online: false, profile: null };

test('"Walk to…" offers every door, every home and the teammates who are out, by their shown names', () => {
  const places = walkPlaces([sam, lina, omar], 'Sam', 0);
  const groups = (/** @type {string} */ group) => places.filter((p) => p.group === group);
  assert.equal(groups('Buildings').length, Object.keys(LOTS).length);
  assert.deepEqual(groups('Buildings').find((p) => p.label === 'Library')?.tile, LOTS.library.door);
  assert.deepEqual(groups('Homes').map((p) => [p.label, p.tile]), [['Your home', HOMES[0].door], ["Captain Lina's home", HOMES[1].door], ["Omar's home", HOMES[2].door]]);
  assert.deepEqual(groups('Teammates').map((p) => p.label), ['Captain Lina (Lina)'], 'not yourself, not Omar who is away');
  // A teammate on a walk: where they are going (the tile being entered).
  /** @type {[number, number][]} */
  const path = [[2, 3], [3, 3], [4, 3]];
  const walking = walkPlaces([sam, { ...lina, walk: { path, at: 0 } }], 'Sam', 0.5 * 1000 / WALK_TILES_PER_SECOND);
  assert.deepEqual(walking.find((p) => p.group === 'Teammates')?.tile, [3, 3]);
});

test('homes in words: yours, a teammate\'s, or nobody\'s', () => {
  const owner = homeOwner([sam, lina], 'Lina');
  assert.equal(owner(0), "Sam's");
  assert.equal(owner(1), 'your');
  assert.equal(owner(4), null);
});

test('placeOf names a door, a home or the street', () => {
  const homeName = (/** @type {number} */ slot) => (slot === 0 ? 'your' : slot === 1 ? "Lina's" : null);
  assert.equal(placeOf(LOTS.library.door, homeName), 'the Library door');
  assert.equal(placeOf(HOMES[0].door, homeName), 'your home');
  assert.equal(placeOf(HOMES[1].door, homeName), "Lina's home");
  assert.equal(placeOf(HOMES[2].door, homeName), 'the street', 'an empty plot');
  assert.equal(placeOf([2, 3], homeName), 'the street');
});
