import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_DEFS,
  ACTIVITY_NAMES,
  HAMMER_IMPACT,
  HAMMER_PERIOD,
  PROP_NAMES,
  hammerRaise,
  impatience,
  rampPhase,
} from '../../../../public/js/world/agents/activities.js';
import { Animator, BLEND_SECONDS, PROP_SECONDS } from '../../../../public/js/world/agents/animator.js';
import { P, POSE_SIZE, createPose } from '../../../../public/js/world/agents/pose.js';

const DT = 1 / 60;
const run = (anim, seconds, moving = false) => {
  for (let t = 0; t < seconds; t += DT) anim.update(DT, moving);
};
const prop = (anim, name) => anim.propScale[PROP_NAMES.indexOf(name)];

test('every catalog activity has a pose that stays finite and in a sane range', async () => {
  const { BUILDING_ACTIVITY } = await import('../../../../public/js/core/catalog.js');
  for (const activity of new Set(Object.values(BUILDING_ACTIVITY))) assert.ok(ACTIVITY_DEFS[activity], activity);
  const pose = createPose();
  /** @type {import('../../../../public/js/world/agents/activities.js').AnimContext} */
  const ctx = { seed: 0.37, seedInt: 12345, gait: 0, variant: 'box' };
  for (const name of ACTIVITY_NAMES) {
    for (let t = 0; t < 40; t += 0.37) {
      ctx.gait = t * 3;
      ACTIVITY_DEFS[name].pose(pose, t, ctx);
      for (let i = 0; i < POSE_SIZE; i++) {
        assert.ok(Number.isFinite(pose[i]), `${name} channel ${i} at ${t}`);
        assert.ok(Math.abs(pose[i]) < 7, `${name} channel ${i} = ${pose[i]}`);
      }
    }
  }
});

test('the catalog activity list is fully covered', () => {
  const expected = ['idle', 'walk', 'run', 'read', 'type', 'hammer', 'search', 'think', 'wait', 'celebrate',
    'facepalm', 'sleep', 'sip', 'carry', 'wave', 'spa', 'write'];
  assert.deepEqual([...ACTIVITY_NAMES].sort(), expected.sort());
});

test('switching activity cross-fades over BLEND_SECONDS', () => {
  const anim = new Animator(42);
  run(anim, 0.5);
  assert.equal(anim.set('celebrate'), true);
  assert.equal(anim.set('celebrate'), false, 'same activity is a no-op');
  assert.equal(anim.set('moonwalk'), false, 'unknown activities are ignored');
  anim.update(DT);
  assert.ok(anim.blend > 0 && anim.blend < 1);
  run(anim, BLEND_SECONDS);
  assert.equal(anim.blend, 1);
});

test('a switch mid-blend starts from what is on screen (no pop)', () => {
  const anim = new Animator(7);
  run(anim, 0.4);
  anim.set('sleep');
  run(anim, BLEND_SECONDS / 2);
  const before = Float32Array.from(anim.pose);
  anim.set('celebrate');
  anim.update(1e-6);
  for (let i = 0; i < POSE_SIZE; i++) {
    if (i === P.EYES) continue; // blinking is layered on top
    assert.ok(Math.abs(anim.pose[i] - before[i]) < 1e-3, `channel ${i} jumped`);
  }
});

test('props pop in and out with the activity', () => {
  const anim = new Animator(3, 'magnifier');
  assert.equal(prop(anim, 'magnifier'), 1, 'a Scout idles with the magnifier');
  anim.set('read');
  run(anim, PROP_SECONDS + 0.05);
  assert.equal(prop(anim, 'book'), 1);
  assert.equal(prop(anim, 'magnifier'), 0, 'the kit is put away while reading');
  anim.set('spa');
  run(anim, PROP_SECONDS + 0.05);
  assert.equal(prop(anim, 'towel'), 1);
  assert.equal(prop(anim, 'hat'), 0, 'the towel replaces the hat');
});

test('props overshoot slightly while popping in', () => {
  const anim = new Animator(3);
  anim.set('sip');
  let peak = 0;
  for (let t = 0; t < PROP_SECONDS; t += 1 / 240) {
    anim.update(1 / 240);
    peak = Math.max(peak, prop(anim, 'mug'));
  }
  assert.ok(peak > 1.02, `peak ${peak}`);
});

test('carry shows a mailbag at the post office and stays in hand while walking', () => {
  const anim = new Animator(9);
  anim.setVariant('mailbag');
  anim.set('carry');
  run(anim, 0.4);
  assert.equal(prop(anim, 'mailbag'), 1);
  assert.equal(prop(anim, 'box'), 0);
  anim.setVariant('box');
  anim.set('walk');
  anim.setOverlay('carry');
  run(anim, 0.4, true);
  assert.equal(prop(anim, 'box'), 1, 'box carried along the street');
  anim.setOverlay('read');
  assert.equal(anim.overlay, null, 'only carry layers over walking');
});

test('the hammer lands once per cycle and that is when sparks fly', () => {
  assert.ok(hammerRaise(0.57) > 0.9, 'wound up before the strike');
  assert.ok(hammerRaise(HAMMER_IMPACT) < 0.01, 'down at impact');
  const anim = new Animator(5);
  anim.set('hammer');
  const beats = [];
  for (let i = 0; i < 60 * 5; i++) {
    anim.update(DT);
    const beat = anim.beat();
    if (beat) beats.push(anim.time);
  }
  assert.equal(beats[0] > HAMMER_PERIOD * HAMMER_IMPACT - DT, true);
  assert.ok(beats.length >= 4 && beats.length <= 5, `${beats.length} strikes in 5 s`);
  for (let i = 1; i < beats.length; i++) assert.ok(Math.abs(beats[i] - beats[i - 1] - HAMMER_PERIOD) < 2 * DT);
});

test('sleeping emits zzz; nothing is emitted mid-blend', () => {
  const anim = new Animator(11);
  anim.set('sleep');
  anim.update(DT);
  assert.equal(anim.beat(), null);
  const kinds = new Set();
  for (let i = 0; i < 60 * 6; i++) {
    anim.update(DT);
    kinds.add(anim.beat()?.kind);
  }
  assert.ok(kinds.has('zzz'));
});

test('waiting grows impatient: faster foot taps and more watch checks', () => {
  assert.equal(impatience(0), 0);
  assert.equal(impatience(1e6), 1);
  const countLooks = (from, to) => {
    const pose = createPose();
    /** @type {import('../../../../public/js/world/agents/activities.js').AnimContext} */
    const ctx = { seed: 0.5, seedInt: 99, gait: 0, variant: 'box' };
    let looks = 0;
    let looking = false;
    for (let t = from; t < to; t += DT) {
      ACTIVITY_DEFS.wait.pose(pose, t, ctx);
      const now = pose[P.HEAD_PITCH] > 0.3;
      if (now && !looking) looks++;
      looking = now;
    }
    return looks;
  };
  assert.ok(countLooks(30, 42) > countLooks(0, 12), 'checks the watch more often later');
});

test('ramped beats speed up smoothly without jumping', () => {
  let prev = rampPhase(0, 1, 3, 10);
  let prevRate = 1;
  for (let t = 0.1; t < 20; t += 0.1) {
    const phase = rampPhase(t, 1, 3, 10);
    const rate = (phase - prev) / 0.1;
    assert.ok(rate >= prevRate - 1e-9 && rate <= 3 + 1e-9, `rate ${rate} at ${t}`);
    prev = phase;
    prevRate = rate;
  }
});

test('gaits advance with distance; walking in place still steps', () => {
  const anim = new Animator(1);
  anim.set('walk');
  const g0 = anim.ctx.gait;
  anim.advanceGait(0.2);
  assert.ok(anim.ctx.gait > g0);
  const g1 = anim.ctx.gait;
  anim.update(DT, false);
  assert.notEqual(anim.ctx.gait, g1, 'treadmill when not moving');
  const legs = [];
  for (let i = 0; i < 30; i++) legs.push(anim.update(DT, false)[P.LEG_L_PITCH]);
  assert.ok(Math.max(...legs) - Math.min(...legs) > 0.3, 'legs swing');
});

test('blinks happen but eyes are open most of the time', () => {
  const anim = new Animator(1234);
  let closed = 0;
  const frames = 60 * 20;
  for (let i = 0; i < frames; i++) if (anim.update(DT)[P.EYES] < 0.5) closed++;
  assert.ok(closed > 0 && closed < frames * 0.1, `${closed} closed frames`);
});
