import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp01,
  crossedTick,
  damp,
  easeInOutCubic,
  easeOutBack,
  hashString,
  rand01,
  smoothstep,
  turnToward,
  windowed,
  wrapAngle,
} from '../../../../public/js/world/agents/easing.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('easing curves start at 0 and end at 1', () => {
  for (const ease of [easeInOutCubic, easeOutBack]) {
    close(ease(0), 0);
    close(ease(1), 1);
  }
  close(smoothstep(0, 1, 0.5), 0.5);
  assert.equal(clamp01(-2), 0);
  assert.equal(clamp01(3), 1);
});

test('easeOutBack overshoots before settling (the "pop")', () => {
  const peak = Math.max(...Array.from({ length: 99 }, (_, i) => easeOutBack((i + 1) / 100)));
  assert.ok(peak > 1.05 && peak < 1.2, `peak ${peak}`);
});

test('windowed is 1 inside the window and 0 outside', () => {
  assert.equal(windowed(0.1, 0.3, 0.6), 0);
  assert.equal(windowed(0.45, 0.3, 0.6), 1);
  assert.equal(windowed(0.9, 0.3, 0.6), 0);
});

test('damp is frame-rate independent', () => {
  // Two half steps must land where one full step lands.
  const full = damp(8, 0.1);
  const half = damp(8, 0.05);
  close(1 - (1 - half) * (1 - half), full);
});

test('angles wrap and turn along the shorter arc', () => {
  close(wrapAngle(3 * Math.PI), Math.PI);
  close(wrapAngle(-Math.PI / 2 - 2 * Math.PI), -Math.PI / 2);
  // From 170° to -170° the short way is +20°, not -340°.
  const from = (170 * Math.PI) / 180;
  const to = (-170 * Math.PI) / 180;
  const step = turnToward(from, to, 0.1);
  assert.ok(step > from, 'turns counter-clockwise across ±180°');
  close(turnToward(0, 0.05, 0.1), 0.05);
});

test('crossedTick fires exactly once per period at the offset', () => {
  let fired = 0;
  for (let t = 0; t < 10; t += 1 / 60) {
    if (crossedTick(t, t + 1 / 60, 2, 0.5)) fired++;
  }
  assert.equal(fired, 5);
  assert.equal(crossedTick(1, 1, 2), false);
  assert.equal(crossedTick(0, 1, 0), false);
});

test('hashString and rand01 are deterministic and in range', () => {
  assert.equal(hashString('s1:main'), hashString('s1:main'));
  assert.notEqual(hashString('s1:main'), hashString('s1:abc'));
  for (let i = 0; i < 200; i++) {
    const r = rand01(hashString(`agent-${i}`), i);
    assert.ok(r >= 0 && r < 1);
  }
});
