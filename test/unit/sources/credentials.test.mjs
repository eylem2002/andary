// The page's sign-in (ADR 0015): taken from the link's fragment into this origin's storage, as a
// candidate until the server accepts it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmSignIn, readCredentials, signInHeaders, signInProtocols } from '../../../public/js/sources/credentials.js';

const TOKEN = 'Abc_def-0123456789ghijklmnopqrstuvwxyzABCDE';
const OTHER = 'Other-token-0123456789abcdefghijklmnopqrstu';
const VIEW = 'View_token-0123456789abcdefghijklmnopqrstu';

/** A page at `hash`, with storage and history that record what happens. @param {string} hash */
function page(hash) {
  /** @type {Map<string, string>} */
  const store = new Map();
  /** @type {string[]} */
  const replaced = [];
  const location = { hash, pathname: '/', search: '?demo=1' };
  return {
    store,
    replaced,
    place: {
      location,
      history: {
        replaceState: (/** @type {unknown} */ _d, /** @type {string} */ _u, /** @type {string} */ url) => {
          replaced.push(url);
          location.hash = '';
        },
      },
      storage: { getItem: (/** @type {string} */ k) => store.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void store.set(k, v) },
    },
  };
}

test('the sign-in link leaves the address bar and waits as a candidate until the server accepts it', () => {
  const p = page(`#signin=${TOKEN}`);
  assert.deepEqual(readCredentials(p.place), { token: null, view: null, candidate: { token: TOKEN, view: null } });
  assert.deepEqual(p.replaced, ['/?demo=1'], 'the query stays, the token goes');
  confirmSignIn(true, p.place);
  assert.deepEqual(readCredentials(p.place), { token: TOKEN, view: null, candidate: null }, 'kept for later requests');
});

test('a link with a token the server refuses cannot replace a sign-in that works', () => {
  const p = page(`#signin=${TOKEN}`);
  readCredentials(p.place);
  confirmSignIn(true, p.place);
  p.place.location.hash = `#signin=${OTHER}`; // someone else's link, or a stale one
  assert.equal(readCredentials(p.place).candidate?.token, OTHER);
  confirmSignIn(false, p.place);
  assert.deepEqual(readCredentials(p.place), { token: TOKEN, view: null, candidate: null });
});

test('a view link adds a view token without dropping the owner\'s', () => {
  const p = page(`#signin=${TOKEN}`);
  readCredentials(p.place);
  confirmSignIn(true, p.place);
  p.place.location.hash = `#view=${VIEW}`;
  readCredentials(p.place);
  confirmSignIn(true, p.place);
  assert.deepEqual(readCredentials(p.place), { token: TOKEN, view: VIEW, candidate: null });
});

test('anything that is not a token is ignored and left alone', () => {
  const p = page('#signin=<script>&other=1');
  assert.deepEqual(readCredentials(p.place), { token: null, view: null, candidate: null });
  assert.deepEqual(p.replaced, []);
});

test('without storage the sign-in is kept in memory, not lost', () => {
  const p = page(`#signin=${TOKEN}`);
  const place = { ...p.place, storage: null };
  readCredentials(place);
  confirmSignIn(true, place);
  assert.equal(readCredentials(place).token, TOKEN);
});

test('requests carry the sign-in explicitly: a header for fetch, subprotocols for the socket', () => {
  assert.deepEqual(signInHeaders({ token: TOKEN, view: VIEW }), { 'x-andary-token': TOKEN, 'x-andary-view': VIEW });
  assert.deepEqual(signInProtocols({ token: TOKEN, view: null }), ['andary', `andary.token.${TOKEN}`]);
  assert.deepEqual(signInProtocols({ token: null, view: null }), ['andary']);
});
