import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLACE_NAMES, isPlaceNames, nextPlaceNames } from '../../../public/js/core/place-names.js';

test('the P key cycles auto → always → off → auto, and recovers from junk', () => {
  assert.deepEqual([...PLACE_NAMES], ['auto', 'always', 'off']);
  assert.equal(nextPlaceNames('auto'), 'always');
  assert.equal(nextPlaceNames('always'), 'off');
  assert.equal(nextPlaceNames('off'), 'auto');
  assert.equal(nextPlaceNames('nonsense'), 'auto');
  assert.equal(isPlaceNames('always'), true);
  assert.equal(isPlaceNames('on'), false);
  assert.equal(isPlaceNames(undefined), false);
});
