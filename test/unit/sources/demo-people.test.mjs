import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ME, createDemoPeople } from '../../../public/js/sources/demo-people.js';
import { defaultProfile, validateProfile } from '../../../public/js/core/profile.js';
import { HOMES, LOTS } from '../../../public/js/core/town-map.js';
import { WALK_TILES_PER_SECOND } from '../../../public/js/core/presence.js';

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
  assert.match(/** @type {any} */ (people.save({ v: 2 })).error, /Profile not saved/);
  assert.match(/** @type {any} */ (people.save({ ...defaultProfile(3), name: 'Lina' })).error, /Another person is called Lina/);
});

test('in the demo you walk and wave as on a host, and Lina strolls now and then', () => {
  /** @type {any[]} */
  const moves = [];
  /** @type {any[]} */
  const said = [];
  /** @type {(() => void)[]} */
  const timers = [];
  let t = 1000;
  const people = createDemoPeople({ onPeople: () => {}, onPresence: (p) => moves.push(...p), onSaid: (s) => said.push(s), now: () => t, every: (fn) => timers.push(fn) });
  people.start();
  assert.deepEqual(people.walk(LOTS.library.door), { ok: true });
  assert.deepEqual(moves[0].walk.path[0], HOMES[0].door);
  assert.deepEqual(moves[0].walk.path.at(-1), LOTS.library.door);
  assert.equal(moves[0].walk.at, 1000);
  assert.equal(people.walk([0, 0]).ok, false, 'not onto the lawn');
  assert.equal(people.say('emote', 2), true);
  assert.equal(people.say('phrase', 99), false);
  assert.deepEqual(said, [{ kind: 'emote', name: 'You', id: 2 }]);
  timers[0]();
  assert.equal(moves.at(-1).name, 'Lina');
  assert.deepEqual(moves.at(-1).walk.path.at(-1), LOTS.cafe.door);
  assert.deepEqual(said.at(-1), { kind: 'emote', name: 'Lina', id: 0 });
  timers[0]();
  assert.equal(moves.filter((m) => m.name === 'Lina').length, 1, 'not while she is still walking');
  t += 60 * 1000 / WALK_TILES_PER_SECOND;
  timers[0]();
  assert.deepEqual(moves.at(-1).walk.path.at(-1), HOMES[1].door, 'and home again');
});
