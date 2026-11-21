import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUBBLE_DWELL_MS,
  BUBBLE_MAX_CHARS,
  BUBBLE_MIN_VISIBLE_MS,
  bubbleDurationMs,
  bubblePriority,
  createBubbleSlot,
  deOverlap,
  NEVER_SHOWN,
  normalizeTone,
  offerBubble,
  pickBubbles,
  takeTurns,
  tickBubble,
  truncateText,
} from '../../../../public/js/world/agents/bubbles.js';

test('short text is only tidied', () => {
  assert.equal(truncateText('  Reading   src/app.ts\n now '), 'Reading src/app.ts now');
  assert.equal(truncateText(null), '');
  assert.equal(truncateText(42), '42');
});

test('long text is cut at a word boundary with an ellipsis, within the limit', () => {
  const long = 'grep for every TODO in the repository and then summarise what is left to do before the release '.repeat(3);
  const out = truncateText(long);
  assert.ok(out.endsWith('…'));
  assert.ok([...out].length <= BUBBLE_MAX_CHARS);
  assert.ok(!out.slice(0, -1).endsWith(' '), 'no dangling space before the ellipsis');
  const word = out.slice(0, -1).split(' ').at(-1);
  assert.ok(long.includes(`${word} `), 'cut falls between words');
});

test('emoji are never split and control or bidi characters are dropped', () => {
  const emoji = '🎉'.repeat(200);
  const out = truncateText(emoji, 10);
  assert.equal([...out].length, 10);
  assert.equal(out, `${'🎉'.repeat(9)}…`);
  assert.equal(truncateText('a\u0007b‮c\u0000d'), 'abcd');
});

test('a hard cut is used when there is no nearby space', () => {
  const out = truncateText('x'.repeat(300), 20);
  assert.equal(out, `${'x'.repeat(19)}…`);
});

test('durations grow with the text and respect explicit values within bounds', () => {
  assert.ok(bubbleDurationMs('hi') < bubbleDurationMs('a much longer line of chatter about tests'));
  assert.equal(bubbleDurationMs('hi', 5000), 5000);
  assert.equal(bubbleDurationMs('hi', 10), 800);
  assert.equal(bubbleDurationMs('hi', Number.NaN), bubbleDurationMs('hi'));
});

test('unknown tones fall back to speech', () => {
  assert.equal(normalizeTone('code'), 'code');
  assert.equal(normalizeTone('yell'), 'speech');
});

test('a new line waits until the current one has been readable for the minimum time', () => {
  const slot = createBubbleSlot();
  assert.equal(offerBubble(slot, 0, { text: 'one', tone: 'speech' }), 'show');
  assert.equal(offerBubble(slot, 100, { text: 'two', tone: 'speech' }), 'queued');
  assert.equal(offerBubble(slot, 200, { text: 'three', tone: 'shout' }), 'queued');
  assert.equal(tickBubble(slot, BUBBLE_MIN_VISIBLE_MS - 1), null);
  assert.equal(tickBubble(slot, BUBBLE_MIN_VISIBLE_MS), 'show');
  assert.equal(slot.current.text, 'three', 'only the newest waiting line is kept');
  assert.equal(slot.current.tone, 'shout');
});

test('bubbles hide after their duration; repeating a line extends it instead of flickering', () => {
  const slot = createBubbleSlot();
  offerBubble(slot, 0, { text: 'hello', tone: 'speech', ms: 2000 });
  assert.equal(offerBubble(slot, 1500, { text: 'hello', tone: 'speech', ms: 2000 }), 'extended');
  assert.equal(tickBubble(slot, 2500), null);
  assert.equal(tickBubble(slot, 3500), 'hide');
  assert.equal(slot.current, null);
  assert.equal(offerBubble(slot, 3600, { text: '', tone: 'speech' }), 'ignored');
});

test('overlapping bubbles stack upward; the one nearest the camera keeps its place', () => {
  const boxes = [
    { x: 100, bottom: 200, w: 120, h: 40, dy: 0 }, // nearer the camera (lower on screen)
    { x: 130, bottom: 190, w: 120, h: 40, dy: 0 },
    { x: 400, bottom: 190, w: 120, h: 40, dy: 0 }, // far to the side: untouched
  ];
  const order = new Int32Array(3);
  deOverlap(boxes, 3, order, 4);
  assert.equal(boxes[0].dy, 0);
  assert.equal(boxes[1].bottom + boxes[1].dy, 200 - 40 - 4);
  assert.equal(boxes[2].dy, 0);
});

test('three bubbles in one spot form a tidy column', () => {
  const boxes = [0, 1, 2].map((i) => ({ x: 50, bottom: 300 - i, w: 80, h: 30, dy: 0 }));
  deOverlap(boxes, 3, new Int32Array(3), 2);
  const tops = boxes.map((b) => b.bottom + b.dy - b.h).sort((a, b) => b - a);
  const bottoms = boxes.map((b) => b.bottom + b.dy).sort((a, b) => b - a);
  for (let i = 1; i < 3; i++) assert.ok(bottoms[i] <= tops[i - 1] - 2, 'no overlap after the pass');
});

test('name pills are fixed obstacles: bubbles move above them, pills never move', () => {
  const boxes = [
    { x: 100, bottom: 160, w: 80, h: 22, dy: 0, fixed: true }, // a neighbour's pill
    { x: 110, bottom: 175, w: 140, h: 40, dy: 0 }, // a bubble lower on screen that would cover it
  ];
  deOverlap(boxes, 2, new Int32Array(2), 4);
  assert.equal(boxes[0].dy, 0, 'the pill stays');
  assert.equal(boxes[1].bottom + boxes[1].dy, 160 - 22 - 4, 'the bubble clears the pill');
});

describe('the bubble budget', () => {
  /** @param {number} x @param {number} priority @param {Partial<import('../../../../public/js/world/agents/bubbles.js').BubbleCandidate>} [over] */
  const talker = (x, priority, over = {}) => ({ x, y: 300, w: 120, h: 30, priority, muted: false, ...over });

  test('at most two bubbles stack over one spot; the highest priorities keep theirs', () => {
    const crowd = [talker(100, 1), talker(110, 3), talker(105, 2)];
    pickBubbles(crowd, 3, new Int32Array(3));
    assert.deepEqual(crowd.map((t) => t.muted), [true, false, false]);
  });

  test('bubbles far apart all show, up to four on screen', () => {
    const town = [0, 200, 400, 600, 800, 1000].map((x, i) => talker(x, i));
    pickBubbles(town, 6, new Int32Array(6));
    assert.deepEqual(town.map((t) => t.muted), [true, true, false, false, false, false]);
  });

  test('bubbles at the same x but on different streets do not stack', () => {
    const pair = [talker(100, 1, { y: 100 }), talker(100, 2, { y: 400 }), talker(100, 3, { y: 700 })];
    pickBubbles(pair, 3, new Int32Array(3));
    assert.deepEqual(pair.map((t) => t.muted), [false, false, false]);
  });

  test('priority: the selected agent, then agents that need you, then whoever talked least recently', () => {
    const now = 60_000;
    // Tiers beat everything below them, however the turns stand.
    assert.ok(bubblePriority(true, false, -1, now - 100, now) > bubblePriority(false, true, now - 100, 0, now));
    assert.ok(bubblePriority(false, true, -1, now - 100, now) > bubblePriority(false, false, now - 100, NEVER_SHOWN, now));
    // A bubble that just became visible keeps its place for the dwell…
    assert.ok(bubblePriority(false, false, now - 1000, 0, now) > bubblePriority(false, false, -1, NEVER_SHOWN, now));
    // …then gives way to any agent waiting its turn…
    assert.ok(bubblePriority(false, false, -1, now - 100, now) > bubblePriority(false, false, now - BUBBLE_DWELL_MS, 0, now));
    // …the one waiting longest first; and of two showing, the one showing longer yields first.
    assert.ok(bubblePriority(false, false, -1, 10_000, now) > bubblePriority(false, false, -1, 30_000, now));
    assert.ok(bubblePriority(false, false, 50_000, 0, now) > bubblePriority(false, false, 20_000, 0, now));
  });

  test('turn-taking is fair: five chatty agents share four places without flicker', () => {
    // Far apart, always talking: the budget (4) is the only limit.
    const list = [0, 1, 2, 3, 4].map((i) => ({ x: i * 300, y: 300, w: 120, h: 30, priority: 0, muted: false, focused: false, urgent: false, visibleSince: -1, lastShown: NEVER_SHOWN, fresh: false }));
    const visibleMs = [0, 0, 0, 0, 0];
    const switches = [0, 0, 0, 0, 0];
    const scratch = new Int32Array(5);
    let shortest = Infinity;
    const since = [0, 0, 0, 0, 0];
    for (let now = 0; now < 60_000; now += 100) {
      const before = list.map((t) => t.muted);
      takeTurns(list, 5, scratch, now);
      assert.equal(list.filter((t) => !t.muted).length, 4);
      list.forEach((t, i) => {
        if (!t.muted) visibleMs[i] += 100;
        if (before[i] !== t.muted && now > 0) {
          switches[i]++;
          if (!t.muted) since[i] = now;
          else shortest = Math.min(shortest, now - since[i]);
        }
      });
    }
    const fewest = Math.min(...visibleMs);
    const most = Math.max(...visibleMs);
    assert.ok(fewest >= most * 0.6, `everyone gets turns (${visibleMs.join(', ')})`);
    assert.ok(shortest >= BUBBLE_DWELL_MS, `a bubble stays at least the dwell (${shortest} ms)`);
  });

  test('a bubble that comes back is marked fresh, once', () => {
    const t = { x: 0, y: 0, w: 100, h: 30, priority: 0, muted: true, focused: false, urgent: false, visibleSince: -1, lastShown: 500, fresh: false };
    takeTurns([t], 1, new Int32Array(1), 1000);
    assert.deepEqual([t.muted, t.fresh, t.visibleSince], [false, true, 1000]);
    takeTurns([t], 1, new Int32Array(1), 1100);
    assert.deepEqual([t.fresh, t.visibleSince], [false, 1000]);
  });
});
