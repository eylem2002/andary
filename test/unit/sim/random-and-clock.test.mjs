import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SEED, createRandom, mulberry32, seedFrom } from '../../../public/js/sim/random.js';
import { createClock } from '../../../public/js/sim/clock.js';
import { createFakeClock, flush } from '../core/helpers.mjs';

describe('random', () => {
  it('mulberry32 is deterministic, uniform-ish and in [0, 1)', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const values = Array.from({ length: 2000 }, () => a());
    assert.deepEqual(values.slice(0, 5), Array.from({ length: 5 }, () => b()));
    assert.ok(values.every((v) => v >= 0 && v < 1));
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    assert.ok(Math.abs(mean - 0.5) < 0.05, `mean ${mean}`);
  });

  it('turns any seed into a 32-bit number', () => {
    assert.equal(seedFrom(7), 7);
    assert.equal(seedFrom(-7.9), 7);
    assert.equal(seedFrom('demo'), seedFrom('demo'));
    assert.notEqual(seedFrom('demo'), seedFrom('demo2'));
    assert.equal(seedFrom(undefined), DEFAULT_SEED);
    assert.equal(seedFrom(Number.NaN), DEFAULT_SEED);
  });

  it('helpers stay in range and ids look like the real thing', () => {
    const rng = createRandom(1);
    for (let i = 0; i < 500; i++) {
      const n = rng.int(3, 5);
      assert.ok(n >= 3 && n <= 5 && Number.isInteger(n));
      const f = rng.float(0.6, 4);
      assert.ok(f >= 0.6 && f < 4);
    }
    assert.ok(['x', 'y'].includes(rng.pick(['x', 'y'])));
    assert.deepEqual([...rng.shuffle([1, 2, 3, 4])].sort(), [1, 2, 3, 4]);
    assert.equal(rng.sample([1, 2, 3, 4], 2).length, 2);
    assert.equal(new Set(rng.sample([1, 2, 3, 4], 4)).size, 4);
    assert.match(rng.uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.match(rng.toolUseId(), /^toolu_01[0-9A-Za-z]{22}$/);
    assert.match(rng.agentId(), /^a[0-9a-f]{16}$/);
    assert.equal(rng.chance(0), false);
    assert.equal(rng.chance(1), true);
  });
});

describe('simulation clock', () => {
  it('sleeps for duration / speed', async () => {
    const fake = createFakeClock(0);
    const clock = createClock({ scheduler: fake, speed: 2 });
    clock.start();
    let done = false;
    clock.sleep(1000).then(() => (done = true));
    await fake.advance(499);
    assert.equal(done, false);
    await fake.advance(1);
    assert.equal(done, true);
  });

  it('stop() clears every timer and remembers how long each sleeper had left', async () => {
    const fake = createFakeClock(0);
    const clock = createClock({ scheduler: fake });
    let done = false;
    clock.sleep(1000).then(() => (done = true));
    assert.equal(clock.armed, 0, 'nothing is armed before start');
    clock.start();
    assert.equal(clock.armed, 1);
    await fake.advance(600);
    clock.stop();
    assert.equal(fake.pending, 0);
    assert.equal(clock.armed, 0);
    await fake.advance(10_000);
    assert.equal(done, false);
    clock.start();
    await fake.advance(399);
    assert.equal(done, false);
    await fake.advance(1);
    assert.equal(done, true);
  });

  it('setSpeed re-arms sleepers in progress', async () => {
    const fake = createFakeClock(0);
    const clock = createClock({ scheduler: fake });
    clock.start();
    let done = false;
    clock.sleep(1000).then(() => (done = true));
    await fake.advance(500);
    clock.setSpeed(5);
    assert.equal(clock.speed, 5);
    await fake.advance(100);
    assert.equal(done, true, '500 story-ms left at 5× is 100 ms');
    clock.setSpeed(0);
    assert.equal(clock.speed, 1, 'nonsense speeds fall back to 1');
    clock.setSpeed(1000);
    assert.equal(clock.speed, 50, 'and huge ones are capped');
  });

  it('delays can be cancelled; whenRunning waits for start()', async () => {
    const fake = createFakeClock(0);
    const clock = createClock({ scheduler: fake });
    let resumed = false;
    clock.whenRunning().then(() => (resumed = true));
    await flush();
    assert.equal(resumed, false);
    clock.start();
    await flush();
    assert.equal(resumed, true);
    let fired = false;
    const delay = clock.delay(100);
    delay.promise.then(() => (fired = true));
    delay.cancel();
    await fake.advance(1000);
    assert.equal(fired, false);
    assert.equal(fake.pending, 0);
  });
});
