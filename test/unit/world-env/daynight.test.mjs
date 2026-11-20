import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SKY_KEYS,
  clampElevation,
  hexToRgb,
  hourFromDate,
  isSunUp,
  keysAround,
  lateness,
  moonPosition,
  normalizeHour,
  skyState,
  sunPosition,
} from '../../../public/js/world/env/daynight.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('normalizeHour wraps into [0, 24) and survives garbage', () => {
  assert.equal(normalizeHour(25), 1);
  assert.equal(normalizeHour(-1), 23);
  assert.equal(normalizeHour(24), 0);
  assert.equal(normalizeHour(Number.NaN), 12);
});

test('hourFromDate reads the local clock', () => {
  assert.ok(near(hourFromDate(new Date(2026, 0, 1, 18, 30, 0)), 18.5));
});

test('keyframes are sorted and every keyframe is reachable', () => {
  for (let i = 1; i < SKY_KEYS.length; i++) assert.ok(SKY_KEYS[i].h > SKY_KEYS[i - 1].h);
  for (const key of SKY_KEYS) {
    const { a, t } = keysAround(key.h);
    assert.equal(a, key);
    assert.equal(t, 0);
  }
});

test('keysAround wraps from the last keyframe to midnight', () => {
  const { a, b, t } = keysAround(23);
  assert.equal(a, SKY_KEYS[SKY_KEYS.length - 1]);
  assert.equal(b, SKY_KEYS[0]);
  assert.ok(t > 0 && t < 1);
});

test('the sun keeps to the southern sky: south-east at dawn, south at noon, south-west at dusk', () => {
  const noon = sunPosition(12.25);
  assert.ok(noon.elevation > 0.9);
  assert.ok(noon.dir[2] > 0.3 && Math.abs(noon.dir[0]) < 0.2, 'midday sun is in the south');
  const morning = sunPosition(6.5).dir;
  assert.ok(morning[0] > 0.5 && morning[2] > 0.5, 'morning sun is in the south-east');
  const evening = sunPosition(18).dir;
  assert.ok(evening[0] < -0.5 && evening[2] > 0.5, 'evening sun is in the south-west, lighting the fronts');
  assert.ok(sunPosition(2).elevation < 0, 'no sun at 2am');
});

test('the moon stays above the horizon all night', () => {
  for (const h of [19, 21, 0, 3, 5.5]) {
    const moon = moonPosition(h);
    assert.ok(moon.elevation > 0.3, `moon up at ${h}`);
    assert.ok(Math.abs(Math.hypot(...moon.dir) - 1) < 1e-9);
  }
});

test('sun and moon take turns', () => {
  assert.equal(isSunUp(12), true);
  assert.equal(isSunUp(3), false);
  assert.equal(isSunUp(22), false);
});

test('skyState: night factor, light and stars follow the clock', () => {
  const noon = skyState(12);
  const midnight = skyState(0);
  assert.equal(noon.night, 0);
  assert.equal(midnight.night, 1);
  assert.ok(noon.lightIntensity > 1);
  assert.ok(midnight.lightIntensity < noon.lightIntensity);
  assert.ok(midnight.light[2] > midnight.light[0], 'moonlight is bluish');
  assert.equal(noon.stars, 0);
  assert.equal(midnight.stars, 1);
  assert.ok(midnight.bloom > noon.bloom, 'bloom is stronger at night');
  assert.ok(noon.sunUp && !midnight.sunUp);
});

test('skyState colours stay in range and change smoothly through the day', () => {
  let prev = skyState(0);
  for (let h = 0.05; h < 24; h += 0.05) {
    const s = skyState(h);
    for (const key of ['zenith', 'horizon', 'bottom', 'light', 'hemiSky', 'hemiGround']) {
      for (let i = 0; i < 3; i++) {
        assert.ok(s[key][i] >= 0 && s[key][i] <= 1, `${key} in range at ${h}`);
        if (key === 'light') continue;
        assert.ok(Math.abs(s[key][i] - prev[key][i]) < 0.12, `${key} smooth at ${h.toFixed(2)}`);
      }
      // The light colour may swing while the light is nearly off; what you see is colour x intensity.
      const lit = (state, i) => state.light[i] * state.lightIntensity;
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(lit(s, i) - lit(prev, i)) < 0.3, `light smooth at ${h.toFixed(2)}`);
    }
    prev = s;
  }
});

test('the key light switches between sun and moon only while it is dark', () => {
  for (let h = 0; h < 24; h += 0.01) {
    const a = skyState(h);
    const b = skyState(h + 0.01);
    if (a.sunUp !== b.sunUp) assert.ok(a.lightIntensity < 0.05 && b.lightIntensity < 0.05, `switch at ${h}`);
  }
});

test('clampElevation keeps the light at least 14 degrees up and unit length', () => {
  const low = clampElevation([1, 0.01, 0]);
  assert.ok(Math.asin(low[1]) >= (14 * Math.PI) / 180 - 1e-9);
  assert.ok(near(Math.hypot(...low), 1));
  assert.deepEqual(clampElevation([0, 1, 0]), [0, 1, 0]);
});

test('lateness rises after 22:00, peaks in the small hours, and is 0 by day', () => {
  assert.equal(lateness(12), 0);
  assert.equal(lateness(21), 0);
  assert.equal(lateness(3), 1);
  assert.ok(lateness(23) > 0 && lateness(23) < 1);
  assert.equal(lateness(5.6), 0);
});

test('hexToRgb parses #rrggbb', () => {
  assert.deepEqual(hexToRgb('#ff8000'), [1, 128 / 255, 0]);
});
