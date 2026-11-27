import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyScore, rankMatches } from '../../../public/js/core/fuzzy.js';

describe('fuzzy matching', () => {
  it('finds runs of letters, letters in order, and every word', () => {
    assert.equal(fuzzyScore('', 'anything'), 0);
    assert.ok(fuzzyScore('bill', 'billing-api') > 0);
    assert.ok(fuzzyScore('bapi', 'billing-api') > 0, 'letters in order');
    assert.equal(fuzzyScore('ipab', 'billing-api'), -1, 'not in order');
    assert.ok(fuzzyScore('design sys', 'design-system · Crew 7') > 0);
    assert.equal(fuzzyScore('design zebra', 'design-system'), -1, 'every word must be there');
    assert.ok(fuzzyScore('API', 'billing-api') > 0, 'any case');
  });

  it('prefers a run at a word start, early in the text', () => {
    assert.ok(fuzzyScore('api', 'api-server') > fuzzyScore('api', 'billing-api'));
    assert.ok(fuzzyScore('api', 'billing-api') > fuzzyScore('api', 'rapid'));
    assert.ok(fuzzyScore('auth', 'auth') > fuzzyScore('auth', 'a u t h'));
  });

  it('ranks the best first, keeps order for equals, and leaves out non-matches', () => {
    const items = ['Open approvals', 'Catch me up', 'approvals-bot', 'Settings'];
    assert.deepEqual(rankMatches('appro', items, (s) => s), ['approvals-bot', 'Open approvals']);
    assert.deepEqual(rankMatches('', items, (s) => s), items);
    assert.deepEqual(rankMatches('', items, (s) => s, 2), items.slice(0, 2));
  });
});
