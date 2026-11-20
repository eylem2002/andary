// The page's sign-in (ADR 0015): taken from the link's fragment into this origin's storage.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCredentials, signInHeaders, signInProtocols } from '../../../public/js/sources/credentials.js';

const TOKEN = 'Abc_def-0123456789ghijklmnopqrstuvwxyzABCDE';
const VIEW = 'View_token-0123456789abcdefghijklmnopqrstu';

/** A page at `hash`, with storage and history that record what happens. @param {string} hash */
function page(hash) {
  /** @type {Map<string, string>} */
  const store = new Map();
  /** @type {string[]} */
  const replaced = [];
  return {
    store,
    replaced,
    place: {
      location: { hash, pathname: '/', search: '?demo=1' },
      history: { replaceState: (/** @type {unknown} */ _d, /** @type {string} */ _u, /** @type {string} */ url) => replaced.push(url) },
      storage: { getItem: (/** @type {string} */ k) => store.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void store.set(k, v) },
    },
  };
}

test('the sign-in link\'s fragment is kept in storage and taken out of the address bar', () => {
  const p = page(`#signin=${TOKEN}`);
  assert.deepEqual(readCredentials(p.place), { token: TOKEN, view: null });
  assert.deepEqual(p.replaced, ['/?demo=1'], 'the query stays, the token goes');
  p.place.location.hash = '';
  assert.deepEqual(readCredentials(p.place), { token: TOKEN, view: null }, 'remembered for later requests');
  assert.equal(p.replaced.length, 1);
});

test('a view link adds a view token without dropping the owner\'s', () => {
  const p = page(`#signin=${TOKEN}`);
  readCredentials(p.place);
  p.place.location.hash = `#view=${VIEW}`;
  assert.deepEqual(readCredentials(p.place), { token: TOKEN, view: VIEW });
});

test('anything that is not a token is ignored and left alone', () => {
  const p = page('#signin=<script>&other=1');
  assert.deepEqual(readCredentials(p.place), { token: null, view: null });
  assert.deepEqual(p.replaced, []);
  p.store.set('andary:signin', 'not json');
  assert.deepEqual(readCredentials(p.place), { token: null, view: null });
});

test('requests carry the sign-in explicitly: a header for fetch, subprotocols for the socket', () => {
  assert.deepEqual(signInHeaders({ token: TOKEN, view: VIEW }), { 'x-andary-token': TOKEN, 'x-andary-view': VIEW });
  assert.deepEqual(signInProtocols({ token: TOKEN, view: null }), ['andary', `andary.token.${TOKEN}`]);
  assert.deepEqual(signInProtocols({ token: null, view: null }), ['andary']);
});
