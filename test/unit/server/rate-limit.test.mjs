import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTokenBucket } from '../../../server/rate-limit.mjs';

describe('createTokenBucket', () => {
  it('allows a burst, then refuses until tokens refill', () => {
    let now = 0;
    const bucket = createTokenBucket({ ratePerSecond: 300, burst: 600, now: () => now });
    for (let i = 0; i < 600; i += 1) assert.ok(bucket.take(), `request ${i}`);
    assert.equal(bucket.take(), false);
    now += 10; // 10 ms at 300/s refills 3 tokens
    assert.ok(bucket.take());
    assert.ok(bucket.take());
    assert.ok(bucket.take());
    assert.equal(bucket.take(), false);
  });

  it('never stores more than the burst size', () => {
    let now = 0;
    const bucket = createTokenBucket({ ratePerSecond: 10, burst: 5, now: () => now });
    now += 60_000;
    assert.equal(bucket.available(), 5);
  });

  it('can take several tokens at once and ignores clocks going backwards', () => {
    let now = 1000;
    const bucket = createTokenBucket({ ratePerSecond: 1, burst: 3, now: () => now });
    assert.ok(bucket.take(3));
    now = 0;
    assert.equal(bucket.take(), false);
    assert.equal(bucket.available(), 0);
  });
});
