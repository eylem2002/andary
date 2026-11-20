// Speech-bubble rules, kept pure so they are unit-tested: text cleanup and truncation, how long a
// bubble stays, a per-agent slot that never swaps text faster than a person can read, and a
// vertical de-overlap pass for bubbles of agents standing close together on screen.

import { clamp } from './easing.js';

export const BUBBLE_MAX_CHARS = 120;
/** A bubble stays at least this long before a newer line may replace it (no flicker). */
export const BUBBLE_MIN_VISIBLE_MS = 1400;
const BUBBLE_TONES = Object.freeze(['speech', 'thought', 'shout', 'code']);

/**
 * Control characters and bidi overrides: hook text comes from untrusted repositories, and an
 * override character could visually scramble a bubble.
 * @param {number} code
 */
function isInvisible(code) {
  return (
    code < 32 ||
    (code >= 127 && code <= 159) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/**
 * Collapses whitespace, drops control characters and cuts to `max` characters (code points,
 * so emoji are never split), preferring a word boundary, with an ellipsis.
 * @param {unknown} text
 * @param {number} [max]
 */
export function truncateText(text, max = BUBBLE_MAX_CHARS) {
  const chars = [];
  let space = false;
  for (const ch of String(text ?? '')) {
    if (ch.trim() === '') {
      space = chars.length > 0; // any run of whitespace becomes one space
      continue;
    }
    if (isInvisible(ch.codePointAt(0))) continue;
    if (space) chars.push(' ');
    space = false;
    chars.push(ch);
  }
  if (chars.length <= max) return chars.join('');
  let cut = chars.slice(0, max - 1).join('');
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace >= max * 0.6) cut = cut.slice(0, lastSpace);
  return `${cut.replace(/[\s.,;:!?-]+$/u, '')}…`;
}

/**
 * How long a bubble stays: an explicit duration (clamped to something sensible) or a reading
 * time that grows with the text.
 * @param {string} text
 * @param {number} [ms]
 */
export function bubbleDurationMs(text, ms) {
  if (Number.isFinite(ms) && ms > 0) return clamp(ms, 800, 20000);
  return clamp(1800 + text.length * 45, 2400, 7500);
}

/** @param {unknown} tone */
export function normalizeTone(tone) {
  return BUBBLE_TONES.includes(/** @type {string} */ (tone)) ? /** @type {string} */ (tone) : 'speech';
}

/**
 * @typedef {object} BubbleLine
 * @property {string} text
 * @property {string} tone
 * @property {number} shownAt
 * @property {number} until
 */

/**
 * @typedef {object} BubbleSlot
 * @property {BubbleLine|null} current
 * @property {{text: string, tone: string, ms?: number}|null} pending  newest line waiting its turn
 * @property {number} minVisibleMs
 */

/** @param {number} [minVisibleMs] @returns {BubbleSlot} */
export function createBubbleSlot(minVisibleMs = BUBBLE_MIN_VISIBLE_MS) {
  return { current: null, pending: null, minVisibleMs };
}

/** @param {BubbleSlot} slot @param {number} now @param {{text: string, tone: string, ms?: number}} line */
function show(slot, now, line) {
  slot.current = { text: line.text, tone: line.tone, shownAt: now, until: now + bubbleDurationMs(line.text, line.ms) };
  slot.pending = null;
}

/**
 * Offers a new line. It shows at once unless the current bubble is still within its minimum
 * time, in which case it waits (only the newest waiting line is kept).
 * @param {BubbleSlot} slot
 * @param {number} now ms
 * @param {{text: string, tone: string, ms?: number}} line  text already truncated
 * @returns {'show'|'queued'|'extended'|'ignored'}
 */
export function offerBubble(slot, now, line) {
  if (!line.text) return 'ignored';
  const current = slot.current;
  if (current && current.text === line.text && current.tone === line.tone) {
    current.until = Math.max(current.until, now + bubbleDurationMs(line.text, line.ms));
    slot.pending = null;
    return 'extended';
  }
  if (!current || now - current.shownAt >= slot.minVisibleMs) {
    show(slot, now, line);
    return 'show';
  }
  slot.pending = { text: line.text, tone: line.tone, ms: line.ms };
  return 'queued';
}

/**
 * Advances a slot in time.
 * @param {BubbleSlot} slot
 * @param {number} now ms
 * @returns {'show'|'hide'|null} what the overlay must change
 */
export function tickBubble(slot, now) {
  const current = slot.current;
  if (slot.pending && (!current || now - current.shownAt >= slot.minVisibleMs)) {
    show(slot, now, slot.pending);
    return 'show';
  }
  if (current && now >= current.until) {
    slot.current = null;
    return 'hide';
  }
  return null;
}

/**
 * @typedef {object} BubbleBox
 * @property {number} x       horizontal centre (px)
 * @property {number} bottom  bottom edge before de-overlap (px, larger is lower on screen)
 * @property {number} w
 * @property {number} h
 * @property {number} dy      output: vertical shift (≤ 0 moves up)
 * @property {boolean} [fixed] an obstacle that never moves (a name pill)
 */

/** @param {BubbleBox} a @param {BubbleBox} b @param {number} gap */
function overlaps(a, b, gap) {
  if (a.x + a.w / 2 + gap <= b.x - b.w / 2 || b.x + b.w / 2 + gap <= a.x - a.w / 2) return false;
  const aBottom = a.bottom + a.dy;
  const bBottom = b.bottom + b.dy;
  return aBottom - a.h < bBottom + gap && bBottom - b.h < aBottom + gap;
}

/** Most bubbles on screen at once: more is noise, and it buries the agents saying them. */
export const MAX_BUBBLES = 4;
/** Most bubbles stacked over one spot (a crowd at a door): the rest wait their turn. */
export const MAX_STACK = 2;

/**
 * @typedef {object} BubbleCandidate
 * @property {number} x         horizontal centre (px)
 * @property {number} y         bottom edge before de-overlap (px)
 * @property {number} w         width (px)
 * @property {number} h         height (px)
 * @property {number} priority  higher keeps its bubble
 * @property {boolean} muted    in: last frame's; out: this frame's
 */

/**
 * Picks which bubbles show this frame: at most `max` on screen and at most `stack` over one spot,
 * highest priority first. The others are muted, not dropped: they show when room frees up, or
 * run out unseen. Allocation-free; `scratch` must hold `count` entries.
 * @param {BubbleCandidate[]} list @param {number} count @param {Int32Array} scratch
 * @param {number} [max] @param {number} [stack]
 */
export function pickBubbles(list, count, scratch, max = MAX_BUBBLES, stack = MAX_STACK) {
  for (let i = 0; i < count; i++) scratch[i] = i;
  for (let i = 1; i < count; i++) {
    const k = scratch[i];
    let j = i - 1;
    while (j >= 0 && list[scratch[j]].priority < list[k].priority) {
      scratch[j + 1] = scratch[j];
      j--;
    }
    scratch[j + 1] = k;
  }
  let shown = 0;
  for (let i = 0; i < count; i++) {
    const p = list[scratch[i]];
    let column = 0;
    for (let j = 0; j < i && column < stack; j++) {
      const q = list[scratch[j]];
      // Bubbles that would collide (or nearly) end up stacked by deOverlap.
      if (!q.muted && Math.abs(p.x - q.x) * 2 < p.w + q.w && Math.abs(p.y - q.y) < p.h + q.h) column++;
    }
    p.muted = shown >= max || column >= stack;
    if (!p.muted) shown++;
  }
}

/** A bubble that has just become visible keeps its place this long (ms): time to read most lines. */
export const BUBBLE_DWELL_MS = 4000;
/** `lastShown` of an agent never seen talking: earlier than anyone else. */
export const NEVER_SHOWN = -1000;

/**
 * Who keeps a bubble when there are too many: the agent you selected or point at, then agents
 * that need you or are failing (status waiting or error), then whoever has been seen talking
 * least recently, so every agent gets turns. A bubble that has just become visible keeps its
 * place for BUBBLE_DWELL_MS; after that it is being seen now, so a waiting agent goes first, and
 * of two bubbles past their dwell the one showing longer yields first. Allocation-free.
 * @param {boolean} focused  selected or pointed at
 * @param {boolean} urgent   the agent waits for you or failed
 * @param {number} visibleSince  ms the bubble became visible, or -1 when it is not
 * @param {number} lastShown     ms the agent's last visible bubble ended (NEVER_SHOWN if never)
 * @param {number} now ms
 */
export function bubblePriority(focused, urgent, visibleSince, lastShown, now) {
  const tier = (focused ? 4e6 : 0) + (urgent ? 1e6 : 0);
  if (visibleSince >= 0) {
    if (now - visibleSince < BUBBLE_DWELL_MS) return tier + 5e5;
    return tier - (2 * now - visibleSince) / 1000;
  }
  return tier - lastShown / 1000;
}

/**
 * @typedef {BubbleCandidate & {focused: boolean, urgent: boolean, visibleSince: number, lastShown: number, fresh: boolean}} Talker
 */

/**
 * One frame of turn-taking: ranks the talkers (bubblePriority), picks who shows (pickBubbles) and
 * keeps the books: when each bubble became visible, when each agent was last seen talking, and
 * which bubbles have just come back (`fresh`). Allocation-free.
 * @param {Talker[]} list @param {number} count @param {Int32Array} scratch @param {number} now ms
 */
export function takeTurns(list, count, scratch, now) {
  for (let i = 0; i < count; i++) {
    const t = list[i];
    t.priority = bubblePriority(t.focused, t.urgent, t.visibleSince, t.lastShown, now);
  }
  pickBubbles(list, count, scratch);
  for (let i = 0; i < count; i++) {
    const t = list[i];
    t.fresh = false;
    if (t.muted) {
      if (t.visibleSince >= 0) t.lastShown = now;
      t.visibleSince = -1;
    } else if (t.visibleSince < 0) {
      t.visibleSince = now;
      t.fresh = true;
    }
  }
}

/** Sort key: obstacles first, then bubbles from the bottom of the screen up. @param {BubbleBox} a @param {BubbleBox} b */
function before(a, b) {
  if (Boolean(a.fixed) !== Boolean(b.fixed)) return Boolean(a.fixed);
  return a.bottom > b.bottom;
}

/**
 * Pushes overlapping bubbles upward. Fixed boxes (name pills) never move; bubbles lowest on
 * screen (nearest the camera) keep their place; every other bubble moves up just above whatever
 * it collides with. Allocation-free: `order` is caller-provided scratch space of `count` entries.
 * @param {BubbleBox[]} boxes
 * @param {number} count
 * @param {Int32Array|number[]} order
 * @param {number} [gap] px between stacked boxes
 */
export function deOverlap(boxes, count, order, gap = 4) {
  for (let i = 0; i < count; i++) order[i] = i;
  for (let i = 1; i < count; i++) {
    const k = order[i];
    let j = i - 1;
    while (j >= 0 && before(boxes[k], boxes[order[j]])) {
      order[j + 1] = order[j];
      j--;
    }
    order[j + 1] = k;
  }
  for (let i = 0; i < count; i++) {
    const a = boxes[order[i]];
    a.dy = 0;
    if (a.fixed) continue;
    // Each placed box can push `a` up at most once, so this settles in ≤ i passes.
    for (let pass = 0; pass <= i; pass++) {
      let moved = false;
      for (let j = 0; j < i; j++) {
        const b = boxes[order[j]];
        if (!overlaps(a, b, gap)) continue;
        a.dy = b.bottom + b.dy - b.h - gap - a.bottom;
        moved = true;
      }
      if (!moved) break;
    }
  }
}
