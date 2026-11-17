import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { INTEREST, TIMING, ZOOM, interestOf, nextShot, remember, weight } from '../../../public/js/ui/shots.js';

const everyone = () => true;

/** @param {Array<[string, string, number]>} events  [agentKey, kind, at] */
function momentsFrom(events) {
  const moments = new Map();
  for (const [agentKey, kind, at] of events) remember(moments, { kind, agentKey }, at);
  return moments;
}

describe('interest', () => {
  test('arrivals, trouble and handoffs beat routine tool calls', () => {
    assert.ok(interestOf('subagent.start') > interestOf('tool.start'));
    assert.ok(interestOf('permission.request') > interestOf('tool.start'));
    assert.ok(interestOf('turn.fail') > interestOf('todos.set'));
    assert.ok(interestOf('message.send') > interestOf('task.upsert'));
  });

  test('unknown kinds and inherited names never draw the camera', () => {
    assert.equal(interestOf('session.heartbeat'), 0);
    assert.equal(interestOf('toString'), 0);
    assert.equal(interestOf('__proto__'), 0);
  });

  test('every score is between 1 and 10', () => {
    for (const [kind, score] of Object.entries(INTEREST)) assert.ok(score >= 1 && score <= 10, kind);
  });
});

describe('weight', () => {
  const moment = { agentKey: 'a', score: 8, at: 1000 };

  test('full when fresh, fading to nothing over the memory span', () => {
    assert.equal(weight(moment, 1000), 8);
    assert.equal(weight(moment, 1000 + TIMING.memoryMs / 2), 4);
    assert.equal(weight(moment, 1000 + TIMING.memoryMs), 0);
    assert.equal(weight(moment, 1000 + TIMING.memoryMs * 3), 0);
  });

  test('a moment stamped a little in the future counts as fresh', () => {
    assert.equal(weight(moment, 900), 8);
  });
});

describe('remember', () => {
  test('keeps the strongest recent moment for each agent', () => {
    const moments = momentsFrom([
      ['a', 'tool.start', 0],
      ['a', 'permission.request', 100],
      ['a', 'tool.start', 200],
      ['b', 'todos.set', 300],
    ]);
    assert.equal(moments.get('a')?.score, INTEREST['permission.request']);
    assert.equal(moments.get('a')?.at, 100);
    assert.equal(moments.get('b')?.score, INTEREST['todos.set']);
  });

  test('a weaker event replaces a moment that has faded below it', () => {
    const moments = momentsFrom([
      ['a', 'permission.request', 0],
      ['a', 'tool.start', TIMING.memoryMs - 100],
    ]);
    assert.equal(moments.get('a')?.score, INTEREST['tool.start']);
  });

  test('ignores dull events and events without an agent', () => {
    const moments = new Map();
    remember(moments, { kind: 'session.heartbeat', agentKey: 'a' }, 0);
    remember(moments, { kind: 'subagent.start' }, 0);
    assert.equal(moments.size, 0);
  });
});

describe('nextShot', () => {
  test('nothing worth watching: no shot', () => {
    assert.equal(nextShot({ moments: new Map(), current: null, now: 0, exists: everyone }), null);
  });

  test('the first shot is a close-up of the strongest moment', () => {
    const moments = momentsFrom([
      ['a', 'tool.start', 0],
      ['b', 'subagent.start', 0],
    ]);
    const shot = nextShot({ moments, current: null, now: 0, exists: everyone });
    assert.deepEqual(shot, { agentKey: 'b', zoom: ZOOM.close, startedAt: 0, count: 1 });
  });

  test('a fresher moment can beat a stronger stale one', () => {
    const moments = momentsFrom([
      ['a', 'subagent.start', 0],
      ['b', 'turn.stop', 8000],
    ]);
    assert.equal(nextShot({ moments, current: null, now: 8000, exists: everyone })?.agentKey, 'b');
  });

  test('holds every shot for its minimum length, however strong the next moment', () => {
    const current = { agentKey: 'a', zoom: ZOOM.close, startedAt: 0, count: 1 };
    const moments = momentsFrom([['b', 'subagent.start', 1000]]);
    assert.equal(nextShot({ moments, current, now: TIMING.minShotMs - 1, exists: everyone }), null);
    assert.equal(nextShot({ moments, current, now: TIMING.minShotMs, exists: everyone })?.agentKey, 'b');
  });

  test('after the minimum, only a strong moment cuts in early', () => {
    const current = { agentKey: 'a', zoom: ZOOM.close, startedAt: 0, count: 1 };
    const now = TIMING.minShotMs + 100;
    const weak = momentsFrom([['b', 'tool.start', now]]);
    assert.equal(nextShot({ moments: weak, current, now, exists: everyone }), null);
    const strong = momentsFrom([['b', 'permission.request', now]]);
    assert.equal(nextShot({ moments: strong, current, now, exists: everyone })?.agentKey, 'b');
  });

  test('a strong moment early in a shot still wins over a fresher routine one', () => {
    const current = { agentKey: 'a', zoom: ZOOM.close, startedAt: 0, count: 1 };
    const now = TIMING.minShotMs;
    const moments = momentsFrom([
      ['b', 'subagent.start', 200],
      ['c', 'tool.start', now],
    ]);
    assert.equal(nextShot({ moments, current, now, exists: everyone })?.agentKey, 'b');
  });

  test('after the maximum, any remaining moment gets the camera', () => {
    const current = { agentKey: 'a', zoom: ZOOM.close, startedAt: 0, count: 1 };
    const now = TIMING.maxShotMs;
    const moments = momentsFrom([['b', 'tool.start', now - 1000]]);
    assert.equal(nextShot({ moments, current, now, exists: everyone })?.agentKey, 'b');
  });

  test('never cuts to the agent already on screen', () => {
    const current = { agentKey: 'a', zoom: ZOOM.close, startedAt: 0, count: 1 };
    const moments = momentsFrom([['a', 'subagent.start', TIMING.maxShotMs]]);
    assert.equal(nextShot({ moments, current, now: TIMING.maxShotMs, exists: everyone }), null);
  });

  test('cuts right away when the subject has left the town, and skips agents who are gone', () => {
    const current = { agentKey: 'a', zoom: ZOOM.close, startedAt: 0, count: 1 };
    const moments = momentsFrom([
      ['b', 'tool.start', 0],
      ['c', 'subagent.start', 0],
    ]);
    const exists = (/** @type {string} */ key) => key === 'b';
    const shot = nextShot({ moments, current, now: 10, exists });
    assert.equal(shot?.agentKey, 'b');
    assert.equal(shot?.count, 2);
  });

  test('every fourth shot is a wide one', () => {
    let current = null;
    const zooms = [];
    for (let i = 0; i < 8; i++) {
      const now = i * TIMING.maxShotMs;
      const moments = momentsFrom([[`agent-${i}`, 'tool.start', now]]);
      current = nextShot({ moments, current, now, exists: everyone }) ?? current;
      zooms.push(current?.zoom);
    }
    assert.deepEqual(zooms, [ZOOM.close, ZOOM.close, ZOOM.close, ZOOM.wide, ZOOM.close, ZOOM.close, ZOOM.close, ZOOM.wide]);
  });

  test('timings leave each shot time to read', () => {
    assert.ok(TIMING.minShotMs >= 4000);
    assert.ok(TIMING.maxShotMs > TIMING.minShotMs);
    assert.ok(TIMING.idleResumeMs > TIMING.maxShotMs);
    assert.ok(ZOOM.close > ZOOM.wide && ZOOM.wide > 1);
  });
});
