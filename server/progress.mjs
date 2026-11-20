// The town's growth and the days it was busy, kept across restarts in <ANDARY_HOME>/progress.json
// (numbers and dates only, mode 0600). See public/js/core/growth.js for what the points unlock.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { earnsPoint } from '../public/js/core/growth.js';
import { localDate } from '../public/js/core/dates.js';

/**
 * @typedef {object} Progress
 * @property {number} points
 * @property {string[]} days   local dates with any work, oldest first, the last 400
 */

const DAYS_KEPT = 400;

/**
 * @param {{ stateFile: string|null, onChange: (progress: Progress) => void, now?: () => number }} options
 */
export function createProgress({ stateFile, onChange, now = Date.now }) {
  /** @type {Progress} */
  let progress = { points: 0, days: [] };
  /** @type {NodeJS.Timeout|null} */
  let saveTimer = null;
  if (stateFile && existsSync(stateFile)) {
    try {
      const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
      progress = {
        points: Number.isInteger(saved.points) && saved.points > 0 ? saved.points : 0,
        days: Array.isArray(saved.days) ? saved.days.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(-DAYS_KEPT) : [],
      };
    } catch {
      // a damaged file starts over
    }
  }

  function write() {
    if (!stateFile) return;
    try {
      writeFileSync(`${stateFile}.tmp`, JSON.stringify({ v: 1, ...progress }), { mode: 0o600 });
      renameSync(`${stateFile}.tmp`, stateFile);
    } catch {
      // kept in memory
    }
  }

  return {
    /**
     * Counts a hook event: a point for finished work, and today as a busy day.
     * @param {Record<string, any>} event  the raw hook payload
     */
    observe(event) {
      let changed = false;
      const today = localDate(now());
      if (progress.days.at(-1) !== today) {
        progress = { ...progress, days: [...progress.days.filter((d) => d !== today), today].slice(-DAYS_KEPT) };
        changed = true;
      }
      if (earnsPoint(event)) {
        progress = { ...progress, points: progress.points + 1 };
        changed = true;
      }
      if (!changed) return;
      onChange(progress);
      if (!saveTimer) {
        saveTimer = setTimeout(() => {
          saveTimer = null;
          write();
        }, 2000);
        saveTimer.unref?.();
      }
    },
    snapshot: () => progress,
    dispose() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        write();
      }
    },
  };
}
