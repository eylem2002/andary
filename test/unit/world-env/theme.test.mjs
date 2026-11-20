import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C, NEON, PAINT, paintMap, shade } from '../../../public/js/world/env/palette.js';
import { BEACH, WATERLINE_Z, sandHeight } from '../../../public/js/world/env/beach.js';
import { SEA } from '../../../public/js/world/env/terrain.js';
import { GRADE, gradeAt } from '../../../public/js/world/env/grade.js';
import { BUILDING_KEYS } from '../../../public/js/core/catalog.js';

test('shade mixes towards white or black and leaves 0 alone', () => {
  assert.equal(shade(0x808080, 0), 0x808080);
  assert.equal(shade(0x808080, 1), 0xffffff);
  assert.equal(shade(0x808080, -1), 0x000000);
  assert.equal(shade(0x000000, 0.5), 0x808080);
  assert.equal(shade(0x123456, 5), 0xffffff, 'amount is clamped');
});

test('every building has its own paint with all five colours', () => {
  assert.deepEqual(Object.keys(PAINT).sort(), [...BUILDING_KEYS].sort());
  for (const [key, paint] of Object.entries(PAINT)) {
    for (const part of ['wall', 'deep', 'trim', 'accent', 'neon']) {
      const v = paint[part];
      assert.ok(Number.isInteger(v) && v >= 0 && v <= 0xffffff, `${key}.${part}`);
    }
    assert.ok(Object.values(NEON).includes(paint.neon), `${key} uses a neon tube colour`);
  }
});

test('paintMap swaps the shared stucco tones for the building paint', () => {
  const paint = PAINT.library;
  const map = paintMap(paint);
  assert.equal(map.get(C.stone), paint.wall);
  assert.equal(map.get(C.stoneTrim), paint.trim);
  assert.equal(map.get(C.gold), paint.accent);
  assert.equal(map.get(C.brick), paint.deep);
  assert.equal(map.get(C.glass), undefined, 'glass keeps its colour');
});

test('the beach slopes from the seawall into the sea and the waterline lies on it', () => {
  assert.ok(BEACH.minX < BEACH.maxX);
  assert.equal(sandHeight(BEACH.top.z), BEACH.top.y);
  assert.ok(Math.abs(sandHeight(BEACH.toe.z) - BEACH.toe.y) < 1e-9);
  assert.ok(WATERLINE_Z < BEACH.top.z && WATERLINE_Z > BEACH.toe.z);
  assert.ok(Math.abs(sandHeight(WATERLINE_Z) - SEA.level) < 1e-9);
});

test('gradeAt blends day into night and clamps', () => {
  assert.deepEqual(gradeAt(0), { ...GRADE.day });
  assert.deepEqual(gradeAt(1), { ...GRADE.night });
  assert.deepEqual(gradeAt(-3), gradeAt(0));
  assert.deepEqual(gradeAt(9), gradeAt(1));
  const mid = gradeAt(0.5);
  assert.ok(Math.abs(mid.saturation - (GRADE.day.saturation + GRADE.night.saturation) / 2) < 1e-9);
  assert.equal(mid.shadow.length, 3);
});
