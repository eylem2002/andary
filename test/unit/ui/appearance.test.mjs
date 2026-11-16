import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNightHour, resolveReducedMotion, resolveTheme, timeOfDayFor } from '../../../public/js/ui/appearance.js';

test('time of day for each mode', () => {
  assert.equal(timeOfDayFor('auto'), 'auto');
  assert.equal(timeOfDayFor('day'), 13);
  assert.equal(timeOfDayFor('night'), 22);
});

test('night hours', () => {
  assert.equal(isNightHour(23), true);
  assert.equal(isNightHour(2), true);
  assert.equal(isNightHour(19.5), true);
  assert.equal(isNightHour(6), false);
  assert.equal(isNightHour(13), false);
});

test('theme: explicit choice wins, then the town clock, then the system', () => {
  assert.equal(resolveTheme({ theme: 'light', timeMode: 'night' }, 23), 'light');
  assert.equal(resolveTheme({ theme: 'dark', timeMode: 'day' }, 13), 'dark');
  assert.equal(resolveTheme({ theme: 'auto', timeMode: 'night' }, 13), 'dark');
  assert.equal(resolveTheme({ theme: 'auto', timeMode: 'day' }, 23), null);
  assert.equal(resolveTheme({ theme: 'auto', timeMode: 'auto' }, 23), 'dark');
  assert.equal(resolveTheme({ theme: 'auto', timeMode: 'auto' }, 10), null);
});

test('reduced motion: override or system', () => {
  assert.equal(resolveReducedMotion({ motion: 'reduce' }, false), true);
  assert.equal(resolveReducedMotion({ motion: 'full' }, true), false);
  assert.equal(resolveReducedMotion({ motion: 'system' }, true), true);
  assert.equal(resolveReducedMotion({ motion: 'system' }, false), false);
});
