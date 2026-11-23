import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLS, HOMES, HOME_COUNT, LOTS, MAP, MAP_BOUNDS, ROWS, TILE, findTilePath, isWalkable, tileAt, tileToWorld } from '../../../public/js/core/town-map.js';

test('six home plots of 2 x 2 tiles, west to east, each on its own `h` tiles', () => {
  assert.equal(HOMES.length, HOME_COUNT);
  assert.equal(HOME_COUNT, 6);
  HOMES.forEach((home, i) => {
    assert.equal(home.slot, i);
    const [c0, r0, c1, r1] = home.rect;
    assert.equal(c1 - c0, 1);
    assert.equal(r1 - r0, 1);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) assert.equal(tileAt(c, r), 'h');
    if (i) assert.ok(c0 > HOMES[i - 1].rect[2] + 1, 'a garden between neighbours');
  });
});

test('every home door is a walkable tile on the street right below its plot', () => {
  for (const home of HOMES) {
    const [col, row] = home.door;
    assert.ok(isWalkable(col, row), `home ${home.slot} door is walkable`);
    assert.equal(tileAt(col, row), '#');
    assert.equal(row, home.rect[3] + 1);
    assert.ok(col >= home.rect[0] && col <= home.rect[2]);
  }
});

test('every home is reachable from every building, and the park square from the street', () => {
  for (const home of HOMES) {
    for (const lot of Object.values(LOTS)) assert.ok(findTilePath(home.door, lot.door).length > 0, `home ${home.slot} → ${lot.key}`);
  }
  const park = MAP.findIndex((line) => line.includes('f'));
  assert.ok(findTilePath(HOMES[0].door, [9, park]).length > 0);
  assert.ok(!isWalkable(12, park), 'the fountain is not walkable');
});

test('the map grew by a quarter at most, and its bounds match its tiles', () => {
  assert.ok(COLS * ROWS <= 26 * 26 * 1.3);
  assert.equal(MAP_BOUNDS.maxX - MAP_BOUNDS.minX, COLS * TILE);
  assert.equal(MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ, ROWS * TILE);
  assert.equal(tileToWorld(COLS - 1, ROWS - 1).z, MAP_BOUNDS.maxZ - TILE / 2);
});
