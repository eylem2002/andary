// The demo town's growth: points for finished turns, helpers and tasks, kept in this browser so
// a returning visitor finds the town as they left it. It starts a little short of the Ferris
// wheel, so a visitor sees the town grow within a few minutes.
import { earnsPoint } from '../core/growth.js';

export const DEMO_PROGRESS_KEY = 'andary:demo-progress';
const START_POINTS = 92;

/**
 * @param {(progress: { points: number, days: string[] }) => void} onProgress
 * @param {() => number} now
 * @param {Pick<Storage, 'getItem'|'setItem'>|null} [storage]
 */
export function createDemoProgress(onProgress, now, storage = safeStorage()) {
  let points = START_POINTS;
  try {
    const saved = Number.parseInt(storage?.getItem(DEMO_PROGRESS_KEY) ?? '', 10);
    if (Number.isInteger(saved) && saved > 0) points = saved;
  } catch {
    // storage blocked: start fresh
  }
  const days = madeUpDays(now());
  onProgress({ points, days });
  /** @param {any} payload */
  return function observe(payload) {
    if (!earnsPoint(payload)) return;
    points += 1;
    try {
      storage?.setItem(DEMO_PROGRESS_KEY, String(points));
    } catch {
      // not kept
    }
    onProgress({ points, days });
  };
}

/** Nine busy days in a row, ending today. @param {number} ms */
function madeUpDays(ms) {
  const days = [];
  for (let back = 8; back >= 0; back -= 1) {
    // Calendar days, not 24-hour steps: a daylight-saving change would skip or repeat a day.
    const d = new Date(ms);
    d.setDate(d.getDate() - back);
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return days;
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
