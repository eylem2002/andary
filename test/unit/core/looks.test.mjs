import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOKS, readLook } from '../../../public/js/core/looks.js';

test('readLook: ?look= first, then the saved preference, else the coast', () => {
  const storage = (value) => ({ getItem: () => value });
  assert.equal(readLook('?look=snow', storage(null)), 'snow');
  assert.equal(readLook('?look=moon', storage(JSON.stringify({ townLook: 'neon' }))), 'neon');
  assert.equal(readLook('', storage(JSON.stringify({ townLook: 'desert' }))), 'desert');
  assert.equal(readLook('', storage(JSON.stringify({ townLook: 'mars' }))), 'coast');
  assert.equal(readLook('', storage('not json')), 'coast');
  assert.equal(readLook('', null), 'coast');
  assert.deepEqual(LOOKS.map((l) => l.id), ['coast', 'snow', 'neon', 'desert', 'amman']);
});
