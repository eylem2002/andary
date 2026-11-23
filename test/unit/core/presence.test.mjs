import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMOTES, MAX_ROUTE_TILES, PHRASES, WALK_TILES_PER_SECOND, continueWalk, headingTile, isTile, planWalk, positionAt, stepFrom, walkDuration } from '../../../public/js/core/presence.js';
import { HOMES, LOTS, isWalkable } from '../../../public/js/core/town-map.js';

test('a walk goes on the walking grid, to a reachable tile at most 60 steps away', () => {
  const home = HOMES[0].door;
  const plan = planWalk(home, LOTS.cafe.door);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.path?.[0], home);
  assert.deepEqual(plan.path?.at(-1), LOTS.cafe.door);
  for (const tile of plan.path ?? []) assert.ok(isWalkable(tile[0], tile[1]));
  assert.match(planWalk(home, [0, 0]).error ?? '', /streets and squares/);
  assert.match(planWalk(home, [3.5, 2]).error ?? '', /a tile/);
  assert.match(planWalk(home, 'cafe').error ?? '', /a tile/);
  assert.match(planWalk(home, [99, 2]).error ?? '', /a tile/);
  // The whole town is less than 60 steps across, so the bound is a guard; it holds when it is lower.
  assert.equal(planWalk([19, 26], [2, 3]).ok, true);
  assert.match(planWalk(home, LOTS.cafe.door, 3).error ?? '', /more than 3 tiles/);
  assert.equal(MAX_ROUTE_TILES, 60);
});

test('positionAt moves 2.2 tiles a second along the path, and stops at its end', () => {
  /** @type {[number, number][]} */
  const path = [[2, 3], [3, 3], [4, 3], [4, 4]];
  assert.deepEqual(positionAt(path, 1000, 0), { col: 2, row: 3, done: false }, 'before it starts');
  const half = positionAt(path, 0, 1000 / WALK_TILES_PER_SECOND / 2);
  assert.ok(Math.abs(half.col - 2.5) < 1e-9 && half.row === 3);
  const turn = positionAt(path, 0, (2.5 / WALK_TILES_PER_SECOND) * 1000);
  assert.ok(Math.abs(turn.row - 3.5) < 1e-9 && turn.col === 4);
  assert.deepEqual(positionAt(path, 0, 1e9), { col: 4, row: 4, done: true });
  assert.equal(walkDuration(path), (3 / WALK_TILES_PER_SECOND) * 1000);
  assert.deepEqual(positionAt([], 0, 0).done, true);
});

test('one step at a time only onto walkable tiles; emotes and phrases are a fixed set', () => {
  assert.deepEqual(stepFrom([2, 3], 1, 0), [3, 3]);
  assert.equal(stepFrom([2, 3], 0, -1), null, 'not into the lawn');
  assert.equal(isTile([0, 0]), true);
  assert.equal(isTile([-1, 0]), false);
  assert.equal(EMOTES.length, 8);
  assert.ok(PHRASES.length >= 8 && PHRASES.length <= 12);
});

test('a new walk carries on from where the figure is: mid-step it finishes the step first', () => {
  /** @type {[number, number][]} */
  const path = [[2, 3], [3, 3], [4, 3]];
  const tick = 1000 / WALK_TILES_PER_SECOND;
  // Standing: from their tile, now.
  const still = continueWalk({ tile: [2, 3], walk: null }, [4, 3], 500);
  assert.deepEqual(still, { ok: true, path, at: 500 });
  // A finished walk: from its last tile.
  assert.deepEqual(continueWalk({ tile: [2, 3], walk: { path, at: 0 } }, [3, 3], 1e6).path, [[4, 3], [3, 3]]);
  // Mid-step (0.4 of the way from [2,3] to [3,3]): the step is kept, and `at` set back by 0.4 of a step.
  const now = 0.4 * tick;
  const turn = /** @type {{ path: [number, number][], at: number }} */ (continueWalk({ tile: [2, 3], walk: { path, at: 0 } }, [2, 3], now));
  assert.deepEqual(turn.path, [[2, 3], [3, 3], [2, 3]]);
  assert.ok(Math.abs(turn.at - 0) < 1e-6, 'the figure is where it was');
  const p = positionAt(turn.path, turn.at, now);
  assert.ok(Math.abs(p.col - 2.4) < 1e-9 && p.row === 3);
  assert.equal(continueWalk({ tile: [2, 3], walk: { path, at: 0 } }, [0, 0], now).ok, false);
  // Keys step from the tile being entered, so a held key never walks back.
  assert.deepEqual(headingTile({ tile: [2, 3], walk: { path, at: 0 } }, now), [3, 3]);
  assert.deepEqual(headingTile({ tile: [2, 3], walk: { path, at: 0 } }, 1e6), [4, 3]);
  assert.deepEqual(headingTile({ tile: [5, 5], walk: null }, now), [5, 5]);
});
