import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactSigns, formatStat, signLabel, signScale } from '../../../../public/js/world/env/sign-format.js';
import { MAX_BOXES, PILE_COUNTS, clampLevel, pileLayout } from '../../../../public/js/world/env/pile-layout.js';
import { GROVE_SLOTS, nextFreeSlot, worktreeLabel } from '../../../../public/js/world/env/grove-slots.js';
import { createRng, hashString, range } from '../../../../public/js/world/env/rand.js';
import { boxCorners, fitLightFrame } from '../../../../public/js/world/env/shadow-fit.js';

test('formatStat trims, strips control characters and caps the length', () => {
  assert.equal(formatStat('  42   reads '), '42 reads');
  assert.equal(formatStat(''), null);
  assert.equal(formatStat(null), null);
  assert.equal(formatStat(7), '7');
  assert.equal(formatStat('a\u0000b'), 'a b');
  const long = formatStat('x'.repeat(50));
  assert.equal(Array.from(long).length, 22);
  assert.ok(long.endsWith('…'));
});

test('signScale grows gently with zoom and is clamped', () => {
  assert.ok(signScale(1) > 0.88 && signScale(1) < 1);
  assert.ok(signScale(4) > signScale(1));
  assert.equal(signScale(1000), 1.25);
  assert.equal(signScale(0.01), 0.88);
  assert.equal(signScale(Number.NaN), signScale(1));
});

test('compactSigns only on narrow screens at low zoom; labels read naturally', () => {
  assert.equal(compactSigns(390, 1), true);
  assert.equal(compactSigns(390, 3), false);
  assert.equal(compactSigns(1440, 1), false);
  assert.equal(signLabel('Library', '3 reads'), 'Library, 3 reads');
  assert.equal(signLabel('Library', null), 'Library');
});

test('pile levels add boxes on top without moving the earlier ones', () => {
  const a = pileLayout();
  const b = pileLayout();
  assert.deepEqual(a, b, 'deterministic');
  assert.equal(a.length, MAX_BOXES);
  for (let level = 1; level < PILE_COUNTS.length; level++) {
    const shown = a.slice(0, PILE_COUNTS[level]);
    assert.ok(shown.every((box) => box.level <= level));
  }
  const top = Math.max(...a.map((box) => box.y + box.size));
  assert.ok(top > 3, 'a full pile teeters well above head height');
  assert.ok(a.every((box) => Math.abs(box.x) < 1.2 && Math.abs(box.z) < 1.2), 'stays on its lot');
});

test('clampLevel accepts only 0–5', () => {
  assert.equal(clampLevel(9), 5);
  assert.equal(clampLevel(-2), 0);
  assert.equal(clampLevel('3'), 3);
  assert.equal(clampLevel('lots'), 0);
});

test('grove slots fill front first and report when full', () => {
  assert.equal(nextFreeSlot([]), 0);
  assert.equal(nextFreeSlot([true, true]), 2);
  assert.equal(nextFreeSlot(GROVE_SLOTS.map(() => true)), -1);
  assert.ok(GROVE_SLOTS.every((s) => Math.abs(s.x) <= 5.5 && Math.abs(s.z) <= 5.5));
  assert.ok(GROVE_SLOTS[0].z > 0, 'first slot is in the front half');
});

test('worktreeLabel keeps the tail of long names', () => {
  assert.equal(worktreeLabel('feature/login'), 'feature/login');
  assert.equal(worktreeLabel('worktrees/feature/very-long-branch-name'), '…-long-branch-name');
  assert.equal(worktreeLabel(''), 'worktree');
  assert.equal(worktreeLabel(undefined), 'worktree');
});

test('createRng is deterministic and in range; helpers behave', () => {
  const a = createRng(1);
  const b = createRng(1);
  for (let i = 0; i < 100; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  const rng = createRng(5);
  const v = range(rng, 2, 3);
  assert.ok(v >= 2 && v < 3);
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
});

test('fitLightFrame encloses every point inside the light frustum', () => {
  /** @type {{min: [number, number, number], max: [number, number, number]}} */
  const box = { min: [-26, -5, -36], max: [26, 12, 27] };
  const len = Math.hypot(0.3, 0.8, 0.52);
  /** @type {[number, number, number]} */
  const toLight = [0.3 / len, 0.8 / len, 0.52 / len];
  const frame = fitLightFrame(toLight, boxCorners(box), 80, 1);
  assert.ok(frame.right > frame.left && frame.top > frame.bottom);
  assert.ok(frame.near > 0 && frame.far > frame.near);
  assert.ok(frame.far - frame.near < 140, 'depth range is tight');
  const dist = Math.hypot(...frame.position.map((p, i) => p - frame.center[i]));
  assert.ok(Math.abs(dist - 80) < 1e-6);
  assert.equal(boxCorners(box).length, 8);
});
