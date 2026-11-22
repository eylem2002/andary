// The timeline strip's pure parts (ui/timeline.js): the window each zoom shows, where the keys
// move the focus, and the words an item is read with.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { itemWords, moveFrom, visibleLanes, zoomWindow } from '../../../public/js/ui/timeline.js';

/** @param {string} id @param {number} start @param {Partial<import('../../../public/js/core/timeline.js').TimelineItem>} [extra] */
const item = (id, start, extra = {}) => /** @type {import('../../../public/js/core/timeline.js').TimelineItem} */ ({ id, laneKey: 'x', type: 'tool', start, end: start + 2000, open: false, label: 'Read a.ts', building: 'library', wait: null, calls: 1, fails: 0, ended: null, detail: null, changeId: null, ...extra });

describe('timeline strip', () => {
  test('zoom: the last 15 minutes, the last hour, today from midnight (at least an hour)', () => {
    const now = new Date(2026, 10, 22, 14, 30).getTime();
    assert.deepEqual(zoomWindow('15m', now), { from: now - 15 * 60_000, to: now, since: false });
    assert.deepEqual(zoomWindow('1h', now, now - 2 * 60 * 60_000), { from: now - 60 * 60_000, to: now, since: false });
    // Never before what the town remembers, but two minutes at least.
    assert.deepEqual(zoomWindow('today', now, now - 5 * 60_000), { from: now - 5 * 60_000, to: now, since: true });
    assert.deepEqual(zoomWindow('15m', now, now - 30_000), { from: now - 2 * 60_000, to: now, since: true });
    assert.equal(zoomWindow('today', now).from, new Date(2026, 10, 22).getTime());
    const early = new Date(2026, 10, 22, 0, 10).getTime();
    assert.equal(zoomWindow('today', early).from, early - 60 * 60_000);
  });

  test('keys: along a lane, to the nearest moment of the lane above or below, to the ends', () => {
    const lanes = [
      { key: 'a', name: 'Foreman', role: /** @type {const} */ ('lead'), items: [item('a1', 0), item('a2', 100), item('a3', 900)] },
      { key: 'b', name: 'Scout 1', role: /** @type {const} */ ('subagent'), items: [item('b1', 80), item('b2', 800)] },
    ];
    const at = (/** @type {string} */ lane, /** @type {string} */ id, /** @type {string} */ key) => moveFrom(lanes, lane, id, key)?.id ?? null;
    assert.deepEqual([at('a', 'a2', 'ArrowRight'), at('a', 'a2', 'ArrowLeft'), at('a', 'a3', 'ArrowRight')], ['a3', 'a1', null]);
    assert.deepEqual([at('a', 'a2', 'ArrowDown'), at('a', 'a3', 'ArrowDown'), at('b', 'b1', 'ArrowUp'), at('a', 'a1', 'ArrowUp')], ['b1', 'b2', 'a2', null]);
    assert.deepEqual([at('a', 'a2', 'Home'), at('a', 'a1', 'End'), at('a', 'a1', 'Enter'), at('z', 'a1', 'ArrowRight')], ['a1', 'a3', null, null]);
  });

  test('words: who, what, when and for how long; a running call says so far', () => {
    const start = new Date(2026, 10, 22, 9, 5).getTime();
    assert.equal(itemWords(item('a', start), 'Foreman (crew 1)'), 'Foreman (crew 1): Read a.ts, 09:05, took 2s');
    assert.equal(itemWords(item('a', start, { open: true, end: start + 65_000 }), 'Scout 1'), 'Scout 1: Read a.ts, 09:05, for 1m 05s so far');
    assert.equal(itemWords(item('p', start, { type: 'prompt', label: 'Your prompt: fix it' }), 'Foreman'), 'Foreman: Your prompt: fix it, 09:05');
  });

  test('compact lanes: each crew\'s lead, with its helpers once opened; taller: everyone', () => {
    const lane = (/** @type {string} */ key, /** @type {'lead'|'subagent'} */ role) => ({ key, name: key, role, items: [item(key, 0)] });
    const groups = [
      { sessionId: 'a', lanes: [lane('a:main', 'lead'), lane('a:1', 'subagent'), lane('a:2', 'subagent')] },
      { sessionId: 'b', lanes: [lane('b:1', 'subagent')] },
    ];
    const keys = (/** @type {ReturnType<typeof visibleLanes>} */ shown) => shown.map((g) => [g.sessionId, g.helpers, g.lanes.map((l) => l.key).join(' ')]);
    assert.deepEqual(keys(visibleLanes(groups, { tall: false, opened: new Set() })), [['a', 2, 'a:main'], ['b', 1, 'b:1']]);
    assert.deepEqual(keys(visibleLanes(groups, { tall: false, opened: new Set(['a']) })), [['a', 2, 'a:main a:1 a:2'], ['b', 1, 'b:1']]);
    assert.deepEqual(keys(visibleLanes(groups, { tall: true, opened: new Set() })), [['a', 2, 'a:main a:1 a:2'], ['b', 1, 'b:1']]);
  });
});
