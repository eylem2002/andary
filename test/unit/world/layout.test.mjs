import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAP, COLS, ROWS, TILE, LOTS, DECOR, tileToWorld, worldToTile, isWalkable, findTilePath,
  cornersOnly, nearestWalkable, workSpots, queueSpot, lotBounds, ringRoadCorners,
} from '../../../public/js/world/layout.js';
import { BUILDING_KEYS } from '../../../public/js/core/catalog.js';

test('map is a 26 x 32 rectangle: the original 26 x 26 town and the residential quarter', () => {
  assert.equal(ROWS, 32);
  assert.equal(COLS, 26);
  for (const row of MAP) assert.equal(row.length, COLS);
});

test('every catalogued building has a lot whose door is a walkable tile right below it', () => {
  assert.deepEqual(Object.keys(LOTS).sort(), [...BUILDING_KEYS].sort());
  for (const lot of Object.values(LOTS)) {
    const [col, row] = lot.door;
    assert.ok(isWalkable(col, row), `${lot.key} door must be walkable`);
    assert.equal(MAP[row - 1][col], lot.letter, `${lot.key} door must face its lot`);
    const [c0, r0, c1, r1] = lot.rect;
    assert.ok(c0 <= c1 && r0 <= r1, `${lot.key} rect is valid`);
  }
});

test('every door is reachable from every other door', () => {
  const keys = Object.keys(LOTS);
  for (const a of keys) {
    for (const b of keys) {
      const path = findTilePath(LOTS[a].door, LOTS[b].door);
      assert.ok(path.length > 0, `${a} → ${b}`);
      assert.deepEqual(path[0], LOTS[a].door);
      assert.deepEqual(path.at(-1), LOTS[b].door);
    }
  }
});

test('paths only step between 4-connected walkable tiles', () => {
  const path = findTilePath(LOTS.cafe.door, LOTS.harbor.door);
  for (let i = 1; i < path.length; i++) {
    const [pc, pr] = path[i - 1];
    const [c, r] = path[i];
    assert.equal(Math.abs(c - pc) + Math.abs(r - pr), 1);
    assert.ok(isWalkable(c, r));
  }
});

test('unreachable targets return an empty path', () => {
  assert.deepEqual(findTilePath(LOTS.cafe.door, [0, 0]), []);
});

test('cornersOnly keeps the ends and every turn', () => {
  /** @type {[number, number][]} */
  const tiles = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [3, 2]];
  assert.deepEqual(cornersOnly(tiles), [[0, 0], [2, 0], [2, 2], [3, 2]]);
  assert.deepEqual(cornersOnly([[1, 1]]), [[1, 1]]);
});

test('tileToWorld and worldToTile round-trip, and the original town stays centred', () => {
  for (const [c, r] of [[0, 0], [12, 7], [25, 25], [25, 31]]) {
    const { x, z } = tileToWorld(c, r);
    assert.deepEqual(worldToTile(x, z), [c, r]);
  }
  const first = tileToWorld(0, 0);
  const last = tileToWorld(COLS - 1, 25);
  assert.equal(first.x + last.x, 0);
  assert.equal(first.z + last.z, 0);
  assert.equal(tileToWorld(1, 0).x - first.x, TILE);
});

test('nearestWalkable snaps a work spot back onto the street', () => {
  for (const key of Object.keys(LOTS)) {
    for (const spot of workSpots(/** @type {any} */ (key))) {
      const [c, r] = nearestWalkable(spot.x, spot.z);
      assert.ok(isWalkable(c, r), `${key} spot snaps to a walkable tile`);
    }
  }
});

test('work spots are distinct and queue spots march away from the door', () => {
  const spots = workSpots('permits');
  assert.equal(new Set(spots.map((s) => `${s.x},${s.z}`)).size, spots.length);
  const q0 = queueSpot('permits', 0);
  const q3 = queueSpot('permits', 3);
  assert.ok(q3.x > q0.x);
});

test('lot bounds and decor areas are inside the map', () => {
  const half = (COLS * TILE) / 2;
  for (const key of Object.keys(LOTS)) {
    const { center, width, depth } = lotBounds(/** @type {any} */ (key));
    assert.ok(Math.abs(center.x) + width / 2 <= half);
    assert.ok(Math.abs(center.z) + depth / 2 <= half);
  }
  for (const rect of Object.values(DECOR)) assert.ok(rect.every(Number.isFinite));
  assert.equal(ringRoadCorners().length, 4);
});

test('agents waiting at a door on a road stand clear of both vehicle lanes', () => {
  // Vehicles drive 0.5 either side of a road's centre line; half a car plus a little is 0.42.
  const clear = 0.42;
  const onRoad = BUILDING_KEYS.filter((key) => MAP[LOTS[key].door[1]][LOTS[key].door[0]] === '#');
  assert.ok(onRoad.includes('cafe') && onRoad.includes('station'), 'the south row opens onto the ring road');
  for (const key of onRoad) {
    const centre = tileToWorld(...LOTS[key].door).z;
    const places = [...workSpots(key), queueSpot(key, 0), queueSpot(key, 3)];
    for (const p of places) {
      for (const lane of [centre - 0.5, centre + 0.5]) {
        assert.ok(Math.abs(p.z - lane) >= clear, `${key} place at z=${p.z.toFixed(2)} is in the lane at ${lane.toFixed(2)}`);
      }
    }
  }
});
