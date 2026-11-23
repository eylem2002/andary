import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREW_COLORS } from '../../../public/js/core/catalog.js';
import { defaultProfile } from '../../../public/js/core/profile.js';
import { HOMES } from '../../../public/js/core/town-map.js';
import { createTownPeople, displayName, mergePresence, personFigureId, whereOf } from '../../../public/js/ui/town-people.js';
import { describeLook } from '../../../public/js/ui/character.js';

function fakeWorld() {
  /** @type {any[][]} */
  const calls = [];
  const agents = new Set();
  return {
    calls,
    setHome: (/** @type {any[]} */ ...args) => calls.push(['setHome', ...args]),
    addAgent: (/** @type {any} */ spec) => {
      calls.push(['addAgent', spec]);
      agents.add(spec.id);
    },
    updateAgent: (/** @type {any[]} */ ...args) => calls.push(['updateAgent', ...args]),
    removeAgent: (/** @type {string} */ id) => {
      calls.push(['removeAgent', id]);
      agents.delete(id);
    },
    hasAgent: (/** @type {string} */ id) => agents.has(id),
    placePerson: (/** @type {any[]} */ ...args) => calls.push(['placePerson', ...args]),
  };
}

const lina = { name: 'Lina', slot: 1, color: 1, host: false, online: true, profile: { ...defaultProfile(1), house: /** @type {const} */ ('desert') } };
const sam = { name: 'Sam', slot: 0, color: 0, host: true, online: false, profile: null };

test('each home shows its owner, and each online person stands on their porch', () => {
  const world = fakeWorld();
  const people = createTownPeople(() => /** @type {any} */ (world));
  people.sync([sam, lina]);
  const homes = world.calls.filter((c) => c[0] === 'setHome');
  assert.equal(homes.length, 6, 'every home is set once');
  assert.deepEqual(homes[0], ['setHome', 0, { name: 'Sam', color: CREW_COLORS[0], style: 'coast', lights: false }]);
  assert.deepEqual(homes[1], ['setHome', 1, { name: 'Lina', color: CREW_COLORS[1], style: 'desert', lights: true }]);
  assert.deepEqual(homes[2], ['setHome', 2, null]);
  const added = world.calls.filter((c) => c[0] === 'addAgent').map((c) => c[1]);
  assert.deepEqual(added.map((spec) => [spec.id, spec.role, spec.home, spec.color]), [[personFigureId('Lina'), 'person', 1, CREW_COLORS[1]]], 'Sam is offline: no figure');
});

test('only what changed reaches the world, and someone going offline leaves', () => {
  const world = fakeWorld();
  const people = createTownPeople(() => /** @type {any} */ (world));
  people.sync([sam, lina]);
  world.calls.length = 0;
  people.sync([sam, lina]);
  assert.deepEqual(world.calls, [], 'nothing changed');
  people.sync([sam, { ...lina, profile: { ...lina.profile, look: { ...lina.profile.look, hat: 'crown' } } }]);
  assert.deepEqual(world.calls.map((c) => c[0]), ['updateAgent'], 'her place did not change');
  assert.equal(world.calls[0][2].person.hat, 'crown');
  world.calls.length = 0;
  people.sync([sam, { ...lina, online: false }]);
  assert.deepEqual(world.calls.map((c) => c.slice(0, 2)), [['setHome', 1], ['removeAgent', 'person:Lina']]);
  world.calls.length = 0;
  people.redraw([sam]);
  assert.equal(world.calls.filter((c) => c[0] === 'setHome').length, 6, 'a new world gets everything again');
});

test('the preview is described in one sentence, the character by their own name', () => {
  const look = { ...defaultProfile(2).look, glasses: 'round', hat: 'beanie', extra: 'headphones', pet: 'dog', hand: 'coffee' };
  assert.equal(describeLook({ ...defaultProfile(2), look }), 'Medium, regular, peach skin, brown short hair, round glasses, a beanie, headphones; wearing pine t-shirt, navy trousers, white sneakers, with a dog, holding a coffee.');
  assert.match(describeLook({ ...defaultProfile(0), look: { ...look, hair: 'bald', topColor: 5, topPattern: 'stripes', patternColor: 4 } }), /bald.*red t-shirt with white stripes/);
  assert.equal(displayName({ ...lina, profile: { ...lina.profile, name: 'Lina Ç.' } }), 'Lina Ç.');
  assert.equal(displayName(sam), 'Sam');
});

test('presence: walks on this browser\'s clock, dim on the porch, gone inside, lights from the host', () => {
  const world = fakeWorld();
  const people = createTownPeople(() => /** @type {any} */ (world));
  /** @type {[number, number][]} */
  const path = [[2, 3], [3, 3]];
  let town = [sam, lina];
  people.sync(town, 0);
  const placed = world.calls.filter((c) => c[0] === 'placePerson');
  assert.deepEqual(placed, [['placePerson', 'person:Lina', { tile: [...HOMES[1].door], walk: null, dim: false }]], 'standing at her door');
  world.calls.length = 0;
  town = mergePresence(town, [{ name: 'Lina', walk: { path, at: 5000 }, tile: [2, 3], profile: 'ignored' }, { name: 'Zed', online: true }, null]);
  assert.equal(town.length, 2, 'nobody new from a presence message');
  assert.equal(town[1].profile, lina.profile, 'only presence fields are taken');
  people.sync(town, 1000);
  assert.deepEqual(world.calls, [['placePerson', 'person:Lina', { tile: [2, 3], walk: { path, at: 4000 }, dim: false }]], 'the server is 1 s ahead');
  world.calls.length = 0;
  town = mergePresence(town, [{ name: 'Lina', online: false, away: 'porch', lights: true }, { name: 'Sam', lights: true }]);
  people.sync(town, 1000);
  assert.deepEqual(world.calls.map((/** @type {any} */ c) => c[0] === 'setHome' ? [c[0], c[1], c[2].lights] : [c[0], c[1], c[2].dim]), [['setHome', 0, true], ['placePerson', 'person:Lina', true]], 'Sam\'s crews light his home; Lina sits dimmed on her porch');
  world.calls.length = 0;
  people.sync(mergePresence(town, [{ name: 'Lina', away: 'inside', lights: false }]), 1000);
  assert.deepEqual(world.calls.map((c) => c.slice(0, 2)), [['setHome', 1], ['removeAgent', 'person:Lina']]);
  assert.deepEqual(whereOf({ ...sam, tile: /** @type {any} */ ('x'), walk: /** @type {any} */ ({ path: [] }) }, 0), { tile: [...HOMES[0].door], walk: null, dim: true });
});
