import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_KEYS } from '../../../public/js/core/catalog.js';
import { LOTS, WORK_FACING, isWalkable, tileToWorld, worldToTile } from '../../../public/js/world/layout.js';
import {
  laneOffset,
  offsetPolyline,
  planRoute,
  routeLength,
  slotEntry,
  slotPosition,
  standingSpots,
} from '../../../public/js/world/agents/routes.js';

const walkable = (p) => {
  const [c, r] = worldToTile(p.x, p.z);
  return isWalkable(c, r);
};

test('a route ends exactly on the standing spot and only turns at corners', () => {
  const from = tileToWorld(4, 9); // in front of the Library
  const to = standingSpots('terminal')[0];
  const route = planRoute(from, to, 0);
  assert.deepEqual(route.at(-1), { x: to.x, z: to.z });
  for (let i = 1; i < route.length - 1; i++) {
    const a = route[i - 1];
    const b = route[i];
    assert.ok(a.x === b.x || a.z === b.z, 'interior segments are axis-aligned');
  }
});

test('every waypoint of every route between buildings stays on the roads', () => {
  for (const fromKey of BUILDING_KEYS) {
    for (const toKey of BUILDING_KEYS) {
      const from = standingSpots(fromKey)[0];
      const to = standingSpots(toKey)[1] ?? standingSpots(toKey)[0];
      for (const p of planRoute(from, to, 0.3)) assert.ok(walkable(p), `${fromKey}→${toKey} ${p.x},${p.z}`);
    }
  }
});

test('lane offsets shift the path sideways, to the right of travel', () => {
  // Walking east (+x): right of travel is south (+z).
  const line = offsetPolyline(
    [
      { x: 0, z: 0 },
      { x: 4, z: 0 },
    ],
    0.3,
  );
  assert.deepEqual(line, [
    { x: 0, z: 0.3 },
    { x: 4, z: 0.3 },
  ]);
  // A right-angle corner gets the miter so both legs stay 0.3 from the centre line.
  const corner = offsetPolyline(
    [
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      { x: 4, z: 4 },
    ],
    0.3,
  );
  assert.deepEqual(corner[1], { x: 3.7, z: 0.3 });
});

test('lanes keep right, stay on the road and are deterministic', () => {
  const lanes = new Set();
  for (let seed = 0; seed < 5000; seed += 37) {
    const lane = laneOffset(seed);
    assert.ok(lane > 0 && lane <= 0.65, 'right of the centre line, inside the 2-unit road');
    assert.equal(lane, laneOffset(seed));
    lanes.add(lane);
  }
  assert.ok(lanes.size >= 4, 'several lanes in use');
});

test('walkers going opposite ways along a road pass on different sides', () => {
  const east = planRoute(tileToWorld(3, 16), tileToWorld(12, 16), 0.3);
  const west = planRoute(tileToWorld(12, 16), tileToWorld(3, 16), 0.3);
  const zEast = east[0].z;
  const zWest = west[0].z;
  assert.ok(zEast > tileToWorld(3, 16).z && zWest < tileToWorld(3, 16).z, `${zEast} vs ${zWest}`);
});

test('routes to a work spot pass through the building door', () => {
  const from = standingSpots('cafe')[0];
  const spot = standingSpots('library')[3];
  const door = tileToWorld(...LOTS.library.door);
  const route = planRoute(from, spot, 0, LOTS.library.door);
  const nearDoor = route.some((p) => Math.hypot(p.x - door.x, p.z - door.z) < 0.01);
  assert.ok(nearDoor, 'a waypoint on the door tile');
  assert.equal(slotEntry('library', { kind: 'spot', index: 0 }), LOTS.library.door);
  assert.equal(slotEntry('library', { kind: 'queue', index: 0 }), null);
});

test('routes from where you stand are short and routeLength adds segments', () => {
  const spot = standingSpots('cafe')[0];
  assert.deepEqual(planRoute(spot, spot, 0), [{ x: spot.x, z: spot.z }]);
  assert.equal(
    routeLength({ x: 0, z: 0 }, [
      { x: 3, z: 0 },
      { x: 3, z: 4 },
    ]),
    7,
  );
});

test('standing spots and queue places are on walkable ground, facing sensibly', () => {
  for (const key of BUILDING_KEYS) {
    const spots = standingSpots(key);
    assert.ok(spots.length >= 4, `${key} has spots`);
    for (const s of spots) assert.ok(walkable(s), `${key} spot`);
    for (let n = 0; n < 14; n++) {
      const q = slotPosition(key, { kind: 'queue', index: n });
      assert.ok(walkable(q), `${key} queue ${n} at ${q.x},${q.z}`);
    }
    assert.equal(slotPosition(key, { kind: 'spot', index: 0 }).facing, WORK_FACING);
  }
});

test('queue places do not stack on top of each other', () => {
  const seen = new Set();
  for (let n = 0; n < 12; n++) {
    const q = slotPosition('board', { kind: 'queue', index: n });
    const key = `${q.x.toFixed(2)},${q.z.toFixed(2)}`;
    assert.ok(!seen.has(key), `duplicate queue place ${key}`);
    seen.add(key);
  }
});
