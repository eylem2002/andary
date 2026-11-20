import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpotAllocator } from '../../../../public/js/world/agents/spots.js';

const allocator = (spots = 3) => createSpotAllocator(() => spots);

test('agents take the nearest free spots, then queue', () => {
  const a = allocator(2);
  assert.deepEqual(a.claim('library', 'a').slot, { key: 'library', kind: 'spot', index: 0 });
  assert.deepEqual(a.claim('library', 'b').slot, { key: 'library', kind: 'spot', index: 1 });
  assert.deepEqual(a.claim('library', 'c').slot, { key: 'library', kind: 'queue', index: 0 });
  assert.deepEqual(a.claim('library', 'd').slot, { key: 'library', kind: 'queue', index: 1 });
  assert.deepEqual(a.occupancy('library'), { spots: ['a', 'b'], queue: ['c', 'd'] });
});

test('leaving a spot promotes the head of the queue and shuffles the rest forward', () => {
  const a = allocator(2);
  for (const id of ['a', 'b', 'c', 'd', 'e']) a.claim('cafe', id);
  const moves = a.release('a');
  assert.deepEqual(moves, [
    { id: 'c', key: 'cafe', kind: 'spot', index: 0 },
    { id: 'd', key: 'cafe', kind: 'queue', index: 0 },
    { id: 'e', key: 'cafe', kind: 'queue', index: 1 },
  ]);
  assert.deepEqual(a.occupancy('cafe'), { spots: ['c', 'b'], queue: ['d', 'e'] });
});

test('leaving the queue only moves the people behind', () => {
  const a = allocator(1);
  for (const id of ['a', 'b', 'c', 'd']) a.claim('spa', id);
  assert.deepEqual(a.release('c'), [{ id: 'd', key: 'spa', kind: 'queue', index: 1 }]);
  assert.deepEqual(a.occupancy('spa'), { spots: ['a'], queue: ['b', 'd'] });
});

test('claiming another building releases the old place first', () => {
  const a = allocator(1);
  a.claim('library', 'a');
  a.claim('library', 'b');
  const { slot, moves } = a.claim('terminal', 'a');
  assert.deepEqual(slot, { key: 'terminal', kind: 'spot', index: 0 });
  assert.deepEqual(moves, [{ id: 'b', key: 'library', kind: 'spot', index: 0 }]);
});

test('claiming the same building keeps the place; unknown releases are harmless', () => {
  const a = allocator(2);
  a.claim('web', 'x');
  a.claim('web', 'y');
  assert.deepEqual(a.claim('web', 'y'), { slot: { key: 'web', kind: 'spot', index: 1 }, moves: [] });
  assert.deepEqual(a.release('nobody'), []);
  assert.equal(a.slotOf('nobody'), null);
});

test('capacity is per building', () => {
  const a = createSpotAllocator((key) => (key === 'board' ? 1 : 4));
  a.claim('board', 'a');
  assert.equal(a.claim('board', 'b').slot.kind, 'queue');
  a.claim('hall', 'c');
  assert.equal(a.claim('hall', 'd').slot.kind, 'spot');
});
