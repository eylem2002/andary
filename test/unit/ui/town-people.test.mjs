import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREW_COLORS } from '../../../public/js/core/catalog.js';
import { defaultProfile } from '../../../public/js/core/profile.js';
import { createTownPeople, personFigureId } from '../../../public/js/ui/town-people.js';
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
  assert.deepEqual(world.calls.map((c) => c[0]), ['updateAgent']);
  assert.equal(world.calls[0][2].person.hat, 'crown');
  world.calls.length = 0;
  people.sync([sam, { ...lina, online: false }]);
  assert.deepEqual(world.calls.map((c) => c.slice(0, 2)), [['setHome', 1], ['removeAgent', 'person:Lina']]);
  world.calls.length = 0;
  people.redraw([sam]);
  assert.equal(world.calls.filter((c) => c[0] === 'setHome').length, 6, 'a new world gets everything again');
});

test('the preview is described in one sentence', () => {
  const look = { ...defaultProfile(2).look, face: /** @type {const} */ ('glasses'), hat: /** @type {const} */ ('beanie'), extra: /** @type {const} */ ('scarf') };
  assert.equal(describeLook({ ...defaultProfile(2), look }), 'Peach skin, brown short hair, glasses, a beanie, a pine t-shirt, navy trousers, white sneakers and a scarf.');
  assert.match(describeLook({ ...defaultProfile(0), look: { ...look, hair: 'bald', topColor: 5 } }), /^Peach skin, bald, glasses, a beanie, a red t-shirt/);
});
