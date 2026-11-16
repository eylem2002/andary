import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCompactPills } from '../../../public/js/world/agents/tags.js';

/** @param {Partial<{x:number,y:number,w:number,h:number,priority:number,compact:boolean}>} p */
const pill = (p) => ({ x: 0, y: 0, w: 80, h: 22, priority: 0, compact: false, agent: null, ...p });
const scratch = new Int32Array(16);

test('pills that do not touch all stay full', () => {
  const list = [pill({ x: 0, priority: 1 }), pill({ x: 200, priority: 2 }), pill({ x: 0, y: 100, priority: 3 })];
  pickCompactPills(list, list.length, scratch);
  assert.deepEqual(list.map((p) => p.compact), [false, false, false]);
});

test('in a pile-up only the highest-priority pill keeps its name', () => {
  const list = [pill({ x: 0, priority: 5 }), pill({ x: 10, y: 6, priority: 9 }), pill({ x: 20, y: 12, priority: 1 })];
  pickCompactPills(list, list.length, scratch);
  assert.deepEqual(list.map((p) => p.compact), [true, false, true]);
});

test('a shrunk pill needs extra room before it expands again (no flicker at crowd edges)', () => {
  // Just clear of the full pill, but within the expansion margin.
  const edge = () => [pill({ x: 0, priority: 9 }), pill({ x: 83, priority: 1, compact: true })];
  const list = edge();
  pickCompactPills(list, list.length, scratch);
  assert.equal(list[1].compact, true);
  const fresh = edge();
  fresh[1].compact = false;
  pickCompactPills(fresh, fresh.length, scratch);
  assert.equal(fresh[1].compact, false);
});

test('only full pills block: a pill behind a shrunk one can stay full', () => {
  const list = [
    pill({ x: 0, priority: 9 }),
    pill({ x: 60, priority: 5 }), // overlaps the first → shrinks
    pill({ x: 140, priority: 1 }), // overlaps only the shrunk one → stays full
  ];
  pickCompactPills(list, list.length, scratch);
  assert.deepEqual(list.map((p) => p.compact), [false, true, false]);
});
